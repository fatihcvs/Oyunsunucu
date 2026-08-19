BEGIN;

-- The admin password has to be changeable from the panel itself. An environment
-- variable cannot be rewritten at runtime, so the live verifier lives here and
-- ADMIN_PASSWORD_HASH stays a bootstrap fallback used only until the first
-- change. The plaintext password is never stored: this column holds the same
-- `pbkdf2-sha256$iterations$salt$hash` encoding the environment variable uses.
ALTER TABLE admin_memberships
  ADD COLUMN password_hash text,
  ADD COLUMN password_updated_at timestamptz;

COMMIT;
