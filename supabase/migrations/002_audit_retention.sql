-- Retention for Supabase Auth's audit trail, which lives in THIS database (we are the controller).
-- Disclosed on /privacy as 90 days. pg_cron must be enabled for the project (Database → Extensions).
create extension if not exists pg_cron;
select cron.schedule(
  'purge-auth-audit-log',            -- job name (idempotent: re-running replaces the schedule)
  '0 3 * * *',                       -- daily 03:00 UTC
  $$ delete from auth.audit_log_entries where created_at < now() - interval '90 days' $$
);
