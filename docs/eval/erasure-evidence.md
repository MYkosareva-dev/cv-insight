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

select count(*) from auth.users where email = 'my.kosareva.dev+erasure@gmail.com'  ->  0
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

---

# v3.0 re-run — the billing ledger (2026-10-12)

**Status: VERIFIED.** Migration `006_subscription_events.sql` adds a ninth
owner-scoped table, `subscription_events`, with a `BEFORE UPDATE OR DELETE`
trigger that refuses every edit and every delete that does not arrive through the
`ON DELETE CASCADE` from `auth.users`. That exemption — `pg_trigger_depth() < 2`
refuses, the referential-integrity cascade arrives at depth 2 — was a configured
mechanism until this run. The owner performed it on the live Supabase project on
**2026-10-12**, immediately after applying 006, and the output is below.

This is SPEC Block H item 11. It closes the condition SPEC Block C attaches to
the depth rule ("if the third fails, the trigger is narrowed to UPDATE-only"):
the third did not fail, so the trigger stays as written.

## How it was verified

1. Migration 006 was applied in the SQL editor ("Success. No rows returned"),
   and two post-apply reads confirmed the shape: RLS enabled on the table, and
   exactly one policy on it — the owner SELECT.
2. A throwaway account was created and **one ledger row was inserted for it** in
   the SQL editor. The editor runs as the table owner, so RLS does not stop the
   insert — the same position the webhook's service-role client is in, and the
   one the trigger exists to bind.
3. A direct `UPDATE` and a direct `DELETE` of that row were issued in the SQL
   editor, as the role with the most power over the table that the app's own
   rules contemplate.
4. The account was then deleted **through the app's own [Delete account and
   data] control** on the local dev server — the Settings dialog with its typed
   confirmation, `DELETE /api/account`, the service-role client and the hard
   delete — exactly as in the 2026-09-04 run, and for the same reason: the path
   under test is the one a user takes.
5. The ledger and the auth user were counted afterwards.

## Run output

```
-- post-apply
select tablename, rowsecurity from pg_tables where tablename = 'subscription_events'
  ->  subscription_events | true
select policyname from pg_policies where tablename = 'subscription_events'
  ->  subscription_events_owner_select          (exactly one row)

user id: 7fa5f1d4-5a5e-485b-a299-2bff7a5e297e

1. insert into subscription_events (user_id, stripe_event_id, stripe_event_type, stripe_customer_id, status)
   values ('7fa5f1d4-5a5e-485b-a299-2bff7a5e297e', 'evt_test_h11', 'checkout.session.completed', 'cus_test_h11', 'active')
   ->  Success, 1 row

2. update subscription_events set status = 'canceled' where stripe_event_id = 'evt_test_h11'
   ->  ERROR: P0001: subscription_events is append-only
       CONTEXT: PL/pgSQL function public.subscription_events_append_only() line 4 at RAISE

3. delete from subscription_events where stripe_event_id = 'evt_test_h11'
   ->  ERROR: P0001: subscription_events rows are removed only with the account
       CONTEXT: PL/pgSQL function public.subscription_events_append_only() line 7 at RAISE

4. Settings -> [Delete account and data], typed DELETE, confirmed
   ->  redirected to /login with the deletion toast

5. select count(*) from subscription_events where user_id = '7fa5f1d4-5a5e-485b-a299-2bff7a5e297e'  ->  0
   select count(*) from auth.users where id = '7fa5f1d4-5a5e-485b-a299-2bff7a5e297e'               ->  0
```

## What this witnesses

- **The ledger cannot be edited**, by the role that bypasses RLS: a direct
  `UPDATE` is refused with the trigger's first message. A cancellation therefore
  has to be a new row, which is what the webhook writes.
- **The ledger cannot be deleted from directly**, by that same role: a direct
  `DELETE` is refused with the trigger's second message.
- **The cascade gets through.** Deleting the account through the product's own
  control succeeded, and the ledger row it owned is gone with the auth user. This
  is the half that mattered most: had the trigger refused the cascade,
  `deleteUser` would have failed as a whole and rolled back, and every user who
  ever upgraded would have been unable to delete their account. The erasure
  promise on `/privacy` outranks the immutability promise, and both now hold.

## What this does NOT witness

- **A nine-table count in one run.** This run counted `subscription_events` and
  `auth.users`. The other eight owner-scoped tables were counted to zero on
  2026-09-04 (above), and 006 changes none of them; their cascade is unchanged.
  SPEC's wording for item 11 asks for all nine in one run, and this file records
  what was actually measured rather than that.
- **A ledger row written by the webhook.** The row was inserted by hand in the
  SQL editor. The webhook path — signature, attribution, the service-role insert
  — is witnessed separately, in the billing webhook evidence (SPEC Block H item
  12), once Stripe is configured.
- **Stripe's side.** Deleting the account removes this app's ledger rows; the
  Stripe customer and any subscription are not touched by this app, as `/privacy`
  says. In test mode that has no consequence.
- **A schema owner with DDL rights.** The trigger refuses a plain `UPDATE` or
  `DELETE` from every role; someone who can `alter table … disable trigger` or
  `drop trigger` is outside what a trigger can bind. It is a guard against
  accident and against the API roles, not against the schema owner.
- Everything listed under the 2026-09-04 run's "does NOT witness" still applies.
