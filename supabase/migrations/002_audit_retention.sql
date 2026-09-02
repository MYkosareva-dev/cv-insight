-- Retention for Supabase Auth's audit trail, which lives in THIS database (we are the controller).
-- Disclosed on /privacy as 90 days. pg_cron must be enabled for the project (Database → Extensions).
create extension if not exists pg_cron;

-- The auth schema is owned by supabase_auth_admin and the job runs as the scheduling
-- role, so DELETE must be granted explicitly or the job fails silently every night.
grant usage on schema auth to postgres;
grant delete on table auth.audit_log_entries to postgres;

select cron.schedule(
  'purge-auth-audit-log',            -- job name (idempotent: re-running replaces the schedule)
  '0 3 * * *',                       -- daily 03:00 UTC
  $$ delete from auth.audit_log_entries where created_at < now() - interval '90 days' $$
);

-- Prove it: schedule a one-off run a minute out, then read cron.job_run_details.
-- A row in cron.job means "scheduled"; only status='succeeded' in cron.job_run_details
-- means the purge actually has permission to run.
--   select status, return_message, end_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'purge-auth-audit-log')
--   order by end_time desc limit 3;
