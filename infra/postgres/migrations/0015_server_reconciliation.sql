BEGIN;

-- When each server was last compared against the provider.
--
-- Null means never checked, which sorts first: a server nobody has verified is
-- more interesting than one checked an hour ago. The worker claims the stalest
-- row, so a single index carries the whole sweep.
ALTER TABLE servers ADD COLUMN reconciled_at timestamptz;

CREATE INDEX servers_reconcile_idx ON servers (reconciled_at NULLS FIRST)
  WHERE status <> 'deleted';

COMMIT;
