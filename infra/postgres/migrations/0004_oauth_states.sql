BEGIN;

CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('discord')),
  state_hash bytea NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/panel',
  requested_ip inet,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_states_return_path
    CHECK (
      char_length(return_to) BETWEEN 1 AND 2048
      AND left(return_to, 1) = '/'
      AND left(return_to, 2) <> '//'
      AND position(E'\\' in return_to) = 0
    ),
  CONSTRAINT oauth_states_verifier_length
    CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  CONSTRAINT oauth_states_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX oauth_states_cleanup_idx
  ON oauth_states (expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
