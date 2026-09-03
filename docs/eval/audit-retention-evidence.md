# Auth audit-log purge — run evidence

**Status: TEMPLATE. No purge run has succeeded yet.**

`/privacy` therefore states no retention period, and `AUDIT_RETENTION_VERIFIED`
in `src/lib/copy.ts` is `false`. `scripts/check.mjs` R12 refuses to let that
constant be `true` while the placeholder below is still here, so the claim and
its proof can only land in the same commit.

## What this file is for

`002_audit_retention.sql` schedules a nightly `pg_cron` job that deletes
`auth.audit_log_entries` older than 90 days. Scheduling it proves nothing: the
`auth` schema is owned by `supabase_auth_admin`, so without the grants in that
migration the job fails with permission denied every night and leaves no
user-visible trace behind a page promising deletion. A row in `cron.job` means
"scheduled"; only a succeeded row in `cron.job_run_details` means it ran.

## How to complete it

1. Apply `supabase/migrations/001_init.sql`, then `002_audit_retention.sql`.
2. Let the 03:00 UTC job fire, or schedule a one-off run a minute out.
3. Run:

   ```sql
   select status, return_message, end_time
   from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'purge-auth-audit-log')
   order by end_time desc
   limit 3;
   ```

4. Replace the block below with the verbatim output. Any format the client
   produced is fine — psql table, expanded display, CSV, JSON. The gate checks
   that the placeholder is gone and the file is substantial, not that the text
   matches a shape; an earlier version demanded a format no client emits, which
   only ever invited someone to type it by hand.
5. In the same commit, set `AUDIT_RETENTION_VERIFIED = true` in
   `src/lib/copy.ts`. `/privacy` then states the 90-day period.

If the run does **not** show `succeeded`, fix the grants first. The constant
stays `false` and the page keeps promising nothing — that is the correct
outcome, not a blocked one.

## Run output

```
<PASTE RUN OUTPUT HERE>
```
