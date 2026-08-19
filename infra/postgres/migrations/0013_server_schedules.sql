BEGIN;

-- Scheduled restarts.
--
-- `next_run_at` is stored rather than derived on read, so the worker can find
-- due work with an index instead of computing a wall clock for every server on
-- every poll. It is recomputed inside the same transaction that fires a run,
-- which is what keeps one schedule from firing twice.
CREATE TABLE server_schedules (
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('restart')),
  local_hour smallint NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
  local_minute smallint NOT NULL CHECK (local_minute BETWEEN 0 AND 59),
  offset_minutes smallint NOT NULL DEFAULT 180 CHECK (offset_minutes BETWEEN -840 AND 840),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, kind)
);

-- The worker's only query: enabled schedules whose time has come.
CREATE INDEX server_schedules_due_idx ON server_schedules (next_run_at) WHERE enabled;

COMMIT;
