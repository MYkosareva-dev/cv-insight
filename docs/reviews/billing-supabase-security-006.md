# supabase-security — migration 006, `feature/billing`

Scope: `supabase/migrations/006_subscription_events.sql` only, audited statically before
the owner applies it. Run once, after the migration was written. Saved verbatim.

---

VERDICT: PASS (no BLOCKER). One MAJOR, which is about data-model correctness rather than access control. It is cheap to fix now and impossible to backfill after the migration is applied.

Scope: one file, `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql` (55 lines), audited statically because it is not applied yet. I compared it with SPEC.md lines 387 and 721–777 and with the CLAUDE.md policy matrix. The file matches the SPEC block exactly, apart from its 3-line header comment. Context I also checked: `scripts/check.mjs` R3 (lines 270–279) strips `--` comments before testing for `security\s+definer`, so the comment on line 34 ("Not security definer (R3)") does not trip it. `src/app/api/account/route.ts:62` erases an account with `admin.auth.admin.deleteUser(userId)`, a hard delete, and does not delete ledger rows explicitly. I modified no files.

Table-by-table:
- subscription_events: RLS on (line 22). Policies found: SELECT only (`subscription_events_owner_select`, `using (auth.uid() = user_id)`). Expected: S only. Match. No INSERT/UPDATE/DELETE policy for any role.
- resume_versions (ALTER only): 006 adds no policy, so it stays S/I from 001 and remains append-only. Both new columns are nullable; `model` has a check of 3..120 chars; `retrieval_log` is unconstrained jsonb.

Function audit (`subscription_events_append_only`):
- It is `language plpgsql set search_path = ''`, which satisfies the linter's mutable-search-path rule. It is not security definer. It uses no dynamic SQL. Its body references only `tg_op` and `pg_trigger_depth()`; the latter lives in `pg_catalog`, which Postgres always searches even when search_path is empty. OK.
- Does the cascade reach the trigger at depth 2? Yes. Postgres implements ON DELETE CASCADE as an internal AFTER ROW trigger (`RI_FKey_cascade_del`) on `auth.users`. That trigger is called through the normal trigger-call path, so `pg_trigger_depth()` is 1 inside it. Its SPI `DELETE FROM ONLY subscription_events WHERE user_id = $1` then fires this BEFORE DELETE row trigger at depth 2, so `< 2` lets it through. A direct DELETE from PostgREST (service role) or the SQL editor runs at depth 0, so the trigger sees 1 and refuses. Running the DELETE inside a plain function, a `select f()` or a DO block does not raise the depth either, so those are refused too. The RI query runs as the table owner with RLS bypassed, so RLS does not block the cascade. The reasoning is sound. SPEC line 774 rightly treats it as unproven until the Block H item 11 erasure run witnesses it.
- `return old` is correct. In a BEFORE DELETE row trigger, returning OLD lets the delete proceed; returning NULL would skip the row silently and break erasure without any error. The UPDATE branch raises before it reaches the return.
- UPDATE is refused at every depth, including service role and the SQL editor. The FK has no ON UPDATE CASCADE and `auth.users.id` never changes, so nothing legitimate is blocked.

Key / exposure audit (PostgREST):
- anon: under Supabase's usual default grants on `public`, anon has table privileges, but the policy is not restricted `to authenticated`. `auth.uid()` is null for anon, so `null = user_id` never matches and anon gets zero rows. Writes fail on RLS (no policy). Nothing leaks.
- authenticated: sees only its own rows, which hold its own Stripe customer and subscription ids; that is acceptable. INSERT/UPDATE/DELETE: there is no policy, so INSERT gets a 42501 RLS violation (the Block H refused-INSERT test). UPDATE/DELETE match zero rows silently, and RLS filters them before the trigger ever fires.
- service_role: bypasses RLS and can INSERT, which is intended. UPDATE/DELETE are stopped by the trigger.
- TRUNCATE: PostgREST has no TRUNCATE verb, and no exposed function runs dynamic SQL, so no API path reaches it. See MINOR-2.

Idempotency on re-run:
- Every statement is guarded: `create table if not exists`, `create index if not exists`, `enable row level security` (repeatable), the policy guarded by pg_policies, `create or replace function`, `drop trigger if exists` + `create trigger`, and `add column if not exists` (a re-run does not re-add the check constraint, which is correct).
- Caveat: `create table if not exists` and the policy guard both keep a drifted earlier version silently; they do not reconcile its shape (see NOTE-2).

Manual dashboard checks (after applying):
1. `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='subscription_events';` — record which privileges anon, authenticated and service_role actually hold.
2. `select tgname, tgenabled from pg_trigger where tgrelid='public.subscription_events'::regclass and not tgisinternal;` — expect one trigger, enabled (`O`).
3. `select policyname, cmd, roles, qual, with_check from pg_policies where tablename='subscription_events';` — expect exactly one row, `cmd = SELECT`.
4. Block H item 11: a direct UPDATE is refused with message 1, a direct DELETE with message 2, and account deletion succeeds with the ledger rows gone.
5. Unchanged from the standing checklist: region EU-Frankfurt, email confirmation per SPEC, no extra OAuth providers.

Findings:

[MAJOR] Rows are ordered by arrival time (`received_at`), not by when Stripe created the event. "Latest row" means latest by `received_at`, and the table has no column for the Stripe event's `created` timestamp. Stripe does not guarantee delivery order and retries failed deliveries for up to about 3 days. So an older `customer.subscription.updated` (status active) that is redelivered after a `customer.subscription.deleted` becomes the latest row and gives Pro back until its `current_period_end`. Because the trigger refuses every UPDATE, this column can never be backfilled once rows exist; adding it later would have to be nullable and would leave history unordered. → Fix before applying: add `stripe_event_created timestamptz not null` (from `event.created`). Order `currentPlan()` by `stripe_event_created desc, received_at desc`, and change the index to `(user_id, stripe_event_created desc)`. Update the SPEC block in the same branch.

[MINOR-1] The immutability promise is stronger in prose than in mechanism. The table owner (`postgres` in the SQL editor) can still run `alter table subscription_events disable trigger ...` or `drop trigger`. A DELETE issued from inside any other trigger (depth ≥ 2) also passes, though creating such a trigger needs DDL rights that are the same as being able to drop this one. Anyone who can delete the auth user also removes the ledger, which is intended for erasure. SPEC 387 and 721 and CLAUDE.md say "the operator cannot edit a row from the SQL editor either". That is true of a plain UPDATE or DELETE, not of someone with DDL rights. → Reword to "refuses a plain UPDATE/DELETE from every role, the service role and the SQL editor included; it is a guard against accident, not against the schema owner". No code change.

[MINOR-2] TRUNCATE skips row triggers and RLS. Supabase's usual default grants (ALL) on `public` include TRUNCATE (and TRIGGER) for anon, authenticated and service_role. No REST or RPC path issues TRUNCATE today, so nothing is exploitable through the API. But a future `security invoker` function with dynamic SQL, or a direct DB connection as service_role, could wipe the ledger. → Add `revoke truncate, trigger, references on subscription_events from anon, authenticated, service_role;` and optionally `revoke insert, update, delete on subscription_events from anon, authenticated;` as defence beneath RLS. Optionally also add a `before truncate ... for each statement` trigger that raises.

[MINOR-3] The new `resume_versions` columns can be written by the user, and `retrieval_log` has no size limit. `resume_versions` keeps its owner INSERT policy, so any signed-in user can POST a version with any `model` string (3..120 chars) and any jsonb `retrieval_log`, of any size and containing anything, including text the "titles, never chunk text" rule forbids. This affects only the user's own rows (no other user's data is reached and no privileges are gained), so it is not a security leak. But the provenance is self-reported, not proven, and storage can be inflated (the existing `judge` jsonb has the same gap). → Add `check (retrieval_log is null or (jsonb_typeof(retrieval_log) = 'array' and pg_column_size(retrieval_log) <= 65536))`. Render `model` and `retrieval_log` as untrusted data (React escaping is enough), and do not describe them as proof anywhere in docs.

[NOTE-1] Policy shape: there is no `to authenticated` and no `(select auth.uid())` initplan wrapping. Leaving out `to authenticated` does not matter here (anon evaluates to null and gets zero rows), and it is consistent with the deferral recorded in 001_init.sql lines 128–130. The initplan form only affects performance; the table is tiny per user and `user_id` leads the index. Fine as is, and it matches 001–005.

[NOTE-2] The pg_policies guard (line 24) filters by `tablename` and `policyname` but not `schemaname = 'public'`, unlike 004_profiles.sql lines 66–87. A same-named policy in another schema would skip creation. → Add `and schemaname = 'public'` for consistency.

[NOTE-3] Idempotency through `stripe_event_id unique` is correct (the implicit unique index is global). The webhook must use a plain `.insert()` and treat 23505 as a 200. An `.upsert()` (`ON CONFLICT DO UPDATE`) would hit the BEFORE UPDATE trigger, raise, and return 500. Stripe would then redeliver for days. `ignoreDuplicates: true` (`DO NOTHING`) would also be safe.

[NOTE-4] `status` and `stripe_event_type` have no check constraint. That is deliberate (SPEC line 776, "verbatim") and acceptable because only the service role writes them. Optionally add `check (stripe_event_id like 'evt\_%')` as a cheap sanity check.

[NOTE-5] The trigger function sits in `public` and PUBLIC can execute it by default. A function returning `trigger` cannot be called directly ("trigger functions can only be called as triggers"), so exposing it over RPC has no effect.

Files: `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql` (audited), `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md` (387, 721–777), `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\scripts\check.mjs` (R3, 270–279), `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\account\route.ts` (62), `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\001_init.sql` (66–75, 99–130).

Process reminder: CLAUDE.md requires this report to be saved verbatim to `docs/reviews/` before acting on it. I made no file changes, as instructed, so the caller needs to save it.
