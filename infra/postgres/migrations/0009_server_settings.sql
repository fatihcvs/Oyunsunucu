BEGIN;

-- Settings live next to the server rather than in the provider: the provider is
-- the thing that can be replaced, and a customer's chosen difficulty should
-- survive a migration to a different host. The column is the source of truth;
-- the container variables are derived from it on every apply.
ALTER TABLE servers
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN settings_updated_at timestamptz,
  ADD CONSTRAINT servers_settings_object CHECK (jsonb_typeof(settings) = 'object');

COMMIT;
