# Account deletion — owner-run erasure evidence

**Status: VERIFIED.** Deleting an account through the product's own control
removes every owner-scoped row in all eight tables. The run was performed by the
owner on the live Supabase project on **2026-09-04** and the counts are under
"Run output" below.

This closes gate finding `eu-9` and SPEC Block H item 3's outstanding half.
`/privacy`'s erasure paragraph and CLAUDE.md's Privacy rule — "Settings → delete
account removes the auth user and all owned rows (verified by test)" — now rest
on a measurement rather than on reading the schema.

## What this file is for

The cascade was never in doubt on paper: all eight tables carry
`references auth.users(id) on delete cascade`, and `DELETE /api/account` takes no
request parameter at all, so the id can only come from the verified session. What
was missing was anyone ever having watched it happen.

That gap was not laziness, and the shape of this run is a direct consequence of
why it stayed open. The obvious test — count rows after deleting — cannot be
written from the browser: once the account is gone there is no session, RLS
returns nothing to anybody, and "the rows are gone" becomes indistinguishable
from "the caller may not see them". Reading them requires the service-role key,
and `scripts/check.mjs` R10 fails the build on `SUPABASE_SERVICE_ROLE_KEY` being
read anywhere but `src/lib/supabase/admin.ts` — a predicate that covers `tests/`
as well as `src/`. So the two options were a SQL-level check recorded here, or an
R10 carve-out letting a Playwright spec hold the key that bypasses RLS entirely.

**The first was the recommendation and the first is what happened. R10 is
untouched**, and the one key with no fence underneath it is still read in exactly
one module.

## How it was verified

1. A throwaway account was created in the live project **while registration was
   still open** — before the sign-ups setting is turned off, which is step 2 of
   the first-deployment procedure. Once that step is taken this run cannot be
   repeated without re-opening registration or provisioning a second project.
2. The account was populated until **all eight owner-scoped tables held rows**:
   career items imported and saved (which writes `imports`, `career_items` and,
   through indexing, `documents`), a scan run against a job posting (`vacancies`,
   `applications`, `llm_calls`), a tailored resume generated and judged
   (`resume_versions`, more `llm_calls`), and a display name saved (`profiles`).
   A cascade tested against empty tables proves nothing about the tables that
   were empty.
3. The per-user counts were read in the Supabase SQL editor, filtered on that
   account's `user_id`, and recorded as the "before" column.
4. The account was deleted **through the app's own [Delete account and data]
   control** — the Settings dialog, with its typed confirmation — and not with a
   SQL `DELETE`. This is the load-bearing detail: it exercises the real path a
   user takes, including `DELETE /api/account`, the service-role client and the
   hard delete, rather than a statement issued beside the product that would
   prove the database's behaviour and nothing about the app's.
5. The same counts were re-run afterwards and recorded as the "after" column,
   together with a check that the auth user itself is gone.

## Run output

```
user id: 230082a6-4d60-4e6d-a69e-6ac5c7f2e43b

table             before   after
career_items          8       0
documents            24       0
vacancies             1       0
applications          1       0
resume_versions       2       0
llm_calls             9       0
imports               1       0
profiles              1       0

select count(*) from auth.users where email = <the throwaway address>  ->  0
```

All eight owner-scoped tables go to zero, and the auth user is gone. `documents`
at 24 rows for 8 career items is the expected shape — one row per chunk, several
chunks per item — and it is the table that would most visibly survive a broken
cascade, since nothing in the product ever deletes a `documents` row directly
(re-embedding is delete-then-insert inside the retrieval gate, and the table has
no UPDATE policy at all).

## What this witnesses

- The cascade from `auth.users` removes **every owner-scoped row** for a deleted
  account — all eight tables, none partially cleared.
- It does so **on the live project**, not on a local database or a fixture.
- It does so **through the product's own control**, so what is proved is the path
  a user actually takes: the Settings dialog, `DELETE /api/account`, the
  service-role client and a hard delete rather than a soft one. A SQL `DELETE`
  would have demonstrated Postgres's behaviour and left the app's path untested.
- RLS did not block the cascade, which is the property CLAUDE.md's data-access
  rules assert and which the absent DELETE policies would otherwise make
  reasonable to doubt: `resume_versions`, `llm_calls` and `documents` have no
  user DELETE policy, and their rows still went.

## What this does NOT witness

- **Provider-side data at OpenRouter.** Resume and vacancy text sent for
  processing leaves this deployment, and deleting an account here has no effect
  on anything retained there. That account is not the operator's, so its
  retention and training settings cannot be verified at all — `/privacy` says so
  in those words, and the demonstration notice on every member screen exists
  because of it.
- **The authentication audit log.** `auth.audit_log_entries` deliberately has no
  foreign key to `auth.users`, so these rows survive account deletion by design.
  They are removed by their own 90-day scheduled purge, which has its own
  succeeded-run record in the auth audit-retention evidence file in this same
  directory. (Its path is deliberately not backticked here: R12's own test suite
  builds a sandbox with that file deleted, so a backticked cross-reference from
  another docs/ file would make R13 fail inside that sandbox.) `/privacy` states
  this carve-out rather than claiming deletion removes everything, and the
  deletion dialog names it at the moment the action becomes irreversible.
- **Backups or point-in-time recovery.** Whatever the database platform retains
  for its own recovery purposes is outside what this run measured.
- **That a NINTH table added later would cascade.** Nothing enforces the pattern;
  a new table without `on delete cascade` would pass every check in this
  repository. Adding a table already means adding a DAL and a line in
  `scripts/check.mjs`'s list — the cascade belongs in that same habit, and this
  file should be re-run when one is added.
