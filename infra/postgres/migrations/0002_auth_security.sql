BEGIN;

ALTER TABLE auth_sessions
  ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN rotated_from_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL;

CREATE INDEX auth_sessions_family_active_idx
  ON auth_sessions (family_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE verification_tokens
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
  ADD COLUMN revoked_at timestamptz;

CREATE TABLE auth_rate_limits (
  scope text NOT NULL,
  bucket_key bytea NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, bucket_key)
);

CREATE INDEX auth_rate_limits_cleanup_idx
  ON auth_rate_limits (updated_at);

CREATE TABLE draft_import_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_key uuid NOT NULL,
  payload_hash bytea NOT NULL,
  server_draft_id uuid NOT NULL REFERENCES server_drafts(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, import_key)
);

CREATE INDEX draft_import_receipts_owner_idx
  ON draft_import_receipts (owner_user_id, imported_at DESC);

COMMIT;
