BEGIN;

-- Admin access is an explicit database grant, never an email-domain guess or
-- a client-side flag. Removing the membership immediately removes access while
-- preserving the user's ordinary customer account.
CREATE TABLE admin_memberships (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'operator', 'support')),
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_memberships_role_idx ON admin_memberships (role, created_at);

COMMIT;
