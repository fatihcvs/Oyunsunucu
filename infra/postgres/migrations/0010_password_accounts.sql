BEGIN;

-- Password sign-in for customers.
--
-- The verifier lives on the account row rather than on `users`, so one person
-- can hold a password account and a Discord account side by side without either
-- one owning the identity.
ALTER TABLE auth_accounts DROP CONSTRAINT auth_accounts_provider_check;
ALTER TABLE auth_accounts
  ADD CONSTRAINT auth_accounts_provider_check
  CHECK (provider IN ('email', 'discord', 'password'));

ALTER TABLE auth_accounts ADD COLUMN password_hash text;

-- A password account without a verifier could never authenticate, and a
-- verifier on any other provider would be dead weight nobody reads.
ALTER TABLE auth_accounts
  ADD CONSTRAINT auth_accounts_password_hash_shape
  CHECK (
    (provider = 'password' AND password_hash IS NOT NULL) OR
    (provider <> 'password' AND password_hash IS NULL)
  );

COMMIT;
