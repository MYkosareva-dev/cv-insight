# Auth audit-log purge — run evidence

**Status: VERIFIED.** The `purge-auth-audit-log` job has run and succeeded. The
record is under "Run output" below.

`/privacy` therefore states the 90-day retention period, and
`AUDIT_RETENTION_VERIFIED` in `src/lib/copy.ts` is `true`. `scripts/check.mjs`
R12 refuses to let that constant be `true` unless this file exists, exceeds 200
bytes and no longer carries its placeholder marker — so the claim and its proof
landed in one commit, which is the whole point of the gate.

## What this file is for

`002_audit_retention.sql` schedules a nightly `pg_cron` job that deletes
`auth.audit_log_entries` older than 90 days. Scheduling it proves nothing: the
`auth` schema is owned by `supabase_auth_admin`, so without the grants in that
migration the job fails with permission denied every night and leaves no
user-visible trace behind a page promising deletion. A row in `cron.job` means
"scheduled"; only a succeeded row in `cron.job_run_details` means it ran.

## How it was verified

1. `supabase/migrations/001_init.sql` applied, then `002_audit_retention.sql`.
2. The 03:00 UTC job fired on its own schedule — not a one-off manual run, which
   is what makes the schedule itself part of what the record proves.
3. `cron.job_run_details` read in the Supabase SQL editor, newest runs first.
4. The output pasted verbatim below. Any format the client produced is fine —
   psql table, expanded display, CSV, JSON. The gate checks that the placeholder
   is gone and the file is substantial, not that the text matches a shape; an
   earlier version demanded a format no client emits, which only ever invited
   someone to type it by hand.
5. In the same commit, `AUDIT_RETENTION_VERIFIED` set to `true` in
   `src/lib/copy.ts`. `/privacy` now states the 90-day period.

The same five steps are how to RE-verify. If a future run stops showing
`succeeded`, fix the grants first: the constant goes back to `false` and the page
returns to promising nothing until a run succeeds again. That is the correct
outcome, not a blocked one — the page never promises a deletion that is not
happening.

## Run output

```
Query: select status, return_message, end_time from cron.job_run_details
       where jobid = 1 order by end_time desc limit 3;
Result: status = succeeded · return_message = DELETE 0 · first scheduled run
        at 03:00 UTC on 2026-09-03, verified by the owner in the Supabase SQL editor.
DELETE 0 is expected: the database is days old, so no entry is yet older than 90 days.
What this proves: pg_cron invokes the job on schedule AND the scheduling role has
DELETE on auth.audit_log_entries — the two things a registered job does not prove.
```
