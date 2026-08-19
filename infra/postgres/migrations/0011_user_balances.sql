BEGIN;

-- Store credit, held in kuruş like every other amount in the system.
--
-- The balance is a cached total and `balance_entries` is the history that
-- explains it: every change writes a row, and the total is only ever moved by
-- the same statement that records why. That way a wrong balance can always be
-- traced to the entry that caused it instead of being a number nobody can
-- account for.
CREATE TABLE user_balances (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'TRY',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_balances_not_negative CHECK (balance_minor >= 0)
);

CREATE TABLE balance_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Positive tops the account up, negative takes credit back off it.
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor bigint NOT NULL CHECK (balance_after_minor >= 0),
  kind text NOT NULL CHECK (kind IN ('manual_topup', 'manual_deduction')),
  note text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- The operator supplies this, so a double-clicked form cannot double-credit.
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);

CREATE INDEX balance_entries_user_idx ON balance_entries (user_id, occurred_at DESC);

COMMIT;
