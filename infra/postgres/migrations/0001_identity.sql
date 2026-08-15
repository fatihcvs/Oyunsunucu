BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 2 AND 60)
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('email', 'discord')),
  provider_account_id text NOT NULL,
  provider_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX auth_accounts_user_id_idx ON auth_accounts (user_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_active_user_idx ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('signin', 'verify_email', 'recover_account')),
  destination_email text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_tokens_email_normalized CHECK (destination_email = lower(btrim(destination_email))),
  CONSTRAINT verification_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX verification_tokens_pending_idx ON verification_tokens (destination_email, purpose, expires_at) WHERE consumed_at IS NULL;

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_key text NOT NULL,
  document_version text NOT NULL,
  granted boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('registration', 'account_settings', 'checkout')),
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_key, document_version)
);

CREATE INDEX consents_user_id_idx ON consents (user_id, created_at DESC);

CREATE TABLE server_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_version text NOT NULL,
  specification jsonb NOT NULL,
  device_import_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_drafts_specification_object CHECK (jsonb_typeof(specification) = 'object')
);

CREATE INDEX server_drafts_owner_idx ON server_drafts (owner_user_id, updated_at DESC);
CREATE UNIQUE INDEX server_drafts_device_import_once_idx ON server_drafts (owner_user_id, device_import_key) WHERE device_import_key IS NOT NULL;

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  request_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, occurred_at DESC);
CREATE UNIQUE INDEX audit_logs_request_action_unique ON audit_logs (request_id, action) WHERE request_id IS NOT NULL;

COMMIT;
