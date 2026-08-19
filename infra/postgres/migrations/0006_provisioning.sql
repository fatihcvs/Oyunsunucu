BEGIN;

-- One row per game server the customer owns. The provider's resource ids live
-- in provider_resources, so a provider change never rewrites this table.
CREATE TABLE servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  game_id text NOT NULL,
  software_id text NOT NULL,
  plan_id text NOT NULL,
  region_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'provisioning', 'deploying', 'online', 'failed', 'suspended', 'deleting', 'deleted')),
  connection_host text,
  connection_port integer CHECK (connection_port IS NULL OR (connection_port > 0 AND connection_port < 65536)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servers_name_length CHECK (char_length(name) BETWEEN 3 AND 60)
);

CREATE INDEX servers_owner_idx ON servers (owner_user_id, created_at DESC);
CREATE INDEX servers_status_idx ON servers (status, updated_at);

-- What the provider actually created. Recorded so a half-finished setup can be
-- cleaned up instead of leaking an orphaned service or volume.
CREATE TABLE provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  provider text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('service', 'volume', 'proxy', 'container')),
  provider_resource_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (provider, resource_kind, provider_resource_id)
);

CREATE INDEX provider_resources_server_idx ON provider_resources (server_id);
CREATE INDEX provider_resources_orphan_idx ON provider_resources (created_at) WHERE released_at IS NULL;

-- The queue. A customer request never calls the provider directly: it writes a
-- job here with a unique idempotency key, and a worker owns it from there.
CREATE TABLE provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('create_server', 'start_server', 'stop_server', 'restart_server', 'delete_server')),
  -- The same key can only ever enqueue one job, however many times a webhook
  -- or a double-clicked button asks for it.
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'dead')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  lease_owner text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisioning_jobs_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

-- Claiming reads exactly this order: due, not already owned, oldest first.
CREATE INDEX provisioning_jobs_claimable_idx
  ON provisioning_jobs (run_after, created_at)
  WHERE status IN ('pending', 'leased');

CREATE INDEX provisioning_jobs_server_idx ON provisioning_jobs (server_id, created_at DESC);

-- What the customer is shown and what the operator debugs, kept apart.
CREATE TABLE server_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  job_id uuid REFERENCES provisioning_jobs(id) ON DELETE SET NULL,
  kind text NOT NULL,
  customer_message text,
  operator_detail text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX server_events_server_idx ON server_events (server_id, occurred_at DESC);

COMMIT;
