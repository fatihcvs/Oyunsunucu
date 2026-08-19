BEGIN;

-- Backups are queued like any other provider work, so the job table has to
-- accept the kind. The schema-contract test caught this before it reached
-- production, which is exactly what it exists for.
ALTER TABLE provisioning_jobs DROP CONSTRAINT provisioning_jobs_kind_check;
ALTER TABLE provisioning_jobs
  ADD CONSTRAINT provisioning_jobs_kind_check
  CHECK (kind IN (
    'create_server',
    'start_server',
    'stop_server',
    'restart_server',
    'delete_server',
    'apply_settings',
    'resize_server',
    'create_backup'
  ));

COMMIT;
