BEGIN;

-- The job kinds added after this table was written were never allowed by its
-- CHECK, so `apply_settings` and `resize_server` were rejected by the database
-- while every unit test passed against a fake executor. The constraint is the
-- one place that decides what a job may be; it has to move with the contract.
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
    'resize_server'
  ));

COMMIT;
