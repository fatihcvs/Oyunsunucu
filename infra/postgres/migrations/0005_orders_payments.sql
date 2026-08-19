BEGIN;

-- Money is stored in minor units (kuruş) as integers. Floating point cannot
-- represent a currency amount exactly, and a rounding drift here is money.
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  server_draft_id uuid REFERENCES server_drafts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_payment', 'paid', 'provisioning', 'active', 'failed', 'cancelled', 'refunded')),
  currency text NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  -- What the customer agreed to pay. Never recomputed from the catalog.
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  vat_minor bigint NOT NULL CHECK (vat_minor >= 0),
  catalog_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_is_sum CHECK (total_minor = subtotal_minor + vat_minor)
);

CREATE INDEX orders_owner_idx ON orders (owner_user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  CONSTRAINT order_items_amount_is_product CHECK (amount_minor = unit_amount_minor * quantity),
  UNIQUE (order_id, code)
);

-- The catalog the customer actually saw, frozen. A later price change must not
-- be able to alter what an existing order says it costs.
CREATE TABLE price_snapshots (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  catalog_version text NOT NULL,
  specification jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_snapshots_specification_object CHECK (jsonb_typeof(specification) = 'object')
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL DEFAULT 'TRY' CHECK (currency = 'TRY'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

CREATE INDEX payments_order_idx ON payments (order_id, created_at DESC);

-- Providers redeliver webhooks. The unique event id is what makes a repeated
-- delivery a no-op instead of a second provisioned server.
CREATE TABLE payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id),
  CONSTRAINT payment_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX payment_events_unprocessed_idx
  ON payment_events (received_at)
  WHERE processed_at IS NULL;

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  provider_refund_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, provider_refund_id)
);

COMMIT;
