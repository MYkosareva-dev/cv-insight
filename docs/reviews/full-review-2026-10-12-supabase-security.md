# Supabase security audit: database layer

**Auditor:** supabase-security subagent
**Date:** 2026-10-12
**Commit audited:** 14fbdee, as the brief asked. The brief called this main HEAD, but it is not: local `main` and `origin/main` are both at `9db0798` ("Merge repository baseline"). The diff from `14fbdee` to `9db0798` touches only `CAP_afa.md`. `supabase/`, `src/` and `scripts/` are byte-identical at 14fbdee, at main and at the current branch HEAD (`abbc544`, `docs/spec-v3.0`), so this report holds for all three.
**Mode:** Read-only. Every file was read through `git show 14fbdee:<path>`. Nothing was modified, no migration was applied, and no `.env*` file or WORKLOG.md was opened. Every search was a `git grep` over tracked files with `':!*.env*'`. The only tracked env file is `.env.example`, and it was not read.

**Scope check:** It is complete.
- `supabase/migrations/` has 5 files: `001_init.sql`, `002_audit_retention.sql`, `003_imports.sql`, `004_profiles.sql`, `005_profile_contacts.sql`.
- `src/lib/db/` has 8 DALs plus `types.ts`: applications, careerItems, documents, imports, llmCalls, profiles, resumeVersions, vacancies.
- The migrations create 8 tables. That matches the 8 DALs and the `DAL_FILES` list in `scripts/check.mjs:84-93`.
- `supabase/` contains no `config.toml` and no seed file.

---

```
VERDICT: PASS (no BLOCKER, no Critical, no High). 2 Medium findings must be scheduled before deploy.
```

## Table by table

| Table | RLS | Policies found | Expected (CLAUDE.md) | INSERT WITH CHECK | UPDATE USING+CHECK | FK to auth.users ON DELETE CASCADE |
|---|---|---|---|---|---|---|
| career_items | ✓ 001:115 | S/I/U/D | S/I/U/D | ✓ 001:118 | ✓ 001:120 | ✓ 001:7 |
| documents | ✓ 001:115 | S/I/D | S/I/D | ✓ | n/a | ✓ 001:23 |
| vacancies | ✓ 001:115 | S/I/U | S/I/U | ✓ | ✓ | ✓ 001:38 |
| applications | ✓ 001:115 | S/I/U | S/I/U | ✓ | ✓ | ✓ 001:50 |
| resume_versions | ✓ 001:115 | S/I | S/I | ✓ | n/a | ✓ 001:68 |
| llm_calls | ✓ 001:115 | S/I | S/I | ✓ | n/a | ✓ 001:80 |
| imports | ✓ 003:41 | S/I/U | S/I/U | ✓ 003:43 | ✓ 003:44 | ✓ 003:15 |
| profiles | ✓ 004:59 | S/I/U | S/I/U | ✓ 004:78 | ✓ 004:86-87 | ✓ 004:48 (PK = user_id) |

- No table has an extra policy. No append-only table (`resume_versions`, `llm_calls`) has UPDATE or DELETE. `documents` has no UPDATE.
- Every policy predicate is exactly `auth.uid() = user_id`.
- Migration 005 adds columns only and no policies, which is correct.

## Function audit

- **`match_documents`** (001:134-143):
  - It is SECURITY INVOKER by default. The keyword is not written out (see I-1).
  - It is `stable`.
  - It filters `d.user_id = auth.uid()` inside the body.
  - It has no dynamic SQL.
  - **It has no pinned `search_path`** (see L-1).
  - It has a recall defect under HNSW post-filtering (see M-2).
- **`m004_touch_profiles_updated_at()`** (004:31-45): plpgsql, `set search_path = ''`, not definer. Good.
- **`moddatetime`** triggers (001:16-17, 61-62) come from the extension. Fine.
- **DO block in 001:102-126:** `format()` is used only over a static literal matrix. No input reaches it, so it is fine.
- **`security definer`:** It does not occur anywhere in `supabase/` except as prose inside SQL comments (004:37-38). `check.mjs` R3 (`scripts/check.mjs:271-280` in the file, shown above) strips `--` comments before testing, so R3 and this audit agree.

## Key audit

- **Service-role key:** It is read in exactly one module. `src/lib/supabase/admin.ts:27` reads it; the file is `server-only`, its client is created inside a function, and session persistence is off.
- **`createAdminClient`:** It is imported by exactly one consumer, `src/app/api/account/route.ts:8`, called at :53. That route calls `requireApiUser()` first (:42), takes no request body, and runs `deleteUser(userId)` on the verified id only (:62).
- **Proof that there is no second consumer:** I ran `git grep` for `SUPABASE_SERVICE_ROLE_KEY|createAdminClient|supabase/admin|service_role` over all tracked non-env, non-md files. Outside admin.ts and the account route, the only hits are comments in `scripts/check.mjs` and `tests/`.
- **`@supabase/supabase-js` `createClient`:** It is imported as a value only in admin.ts. Everywhere else the import is `import type { User }`.
- **DALs:** All 8 use `createClient()` from `src/lib/supabase/server.ts`, which is the anon key plus the user's session, so RLS applies to every DAL statement.
- **`.rpc(`:** It appears only at `src/lib/db/documents.ts:111`.

## Manual dashboard checks (I could not verify these from the repo)

1. The project region is EU (Frankfurt, eu-central-1).
2. Email confirmation is disabled, per the SPEC decision. No OAuth providers beyond email/password are enabled.
3. **Live catalogue matches the repo.** The migrations are pasted into the SQL editor by hand, with no migration tracking, and 004:92-101 says the original project already differs from a fresh one. Run these and compare with the table above:
   - `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';`
   - `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname='public' order by 1,3;`
   - `select proname, prosecdef, proconfig from pg_proc where pronamespace='public'::regnamespace;` (expect `prosecdef = false` everywhere)
4. **Live-fire anon test:** Not performed. It needs the project URL and anon key, which exist only in `.env.local`, and this audit does not open that file. For the owner to run: with the anon key and no session, `GET /rest/v1/<table>?select=*` for each of the 8 tables, and `POST /rest/v1/rpc/match_documents`. Expect `[]` from every one.
5. **pg_cron purge evidence:** Confirm `cron.job_run_details` has `status='succeeded'` for `purge-auth-audit-log`. This is already gated by R12.

---

## Findings

### Critical
None.

### High
None.

### Medium

**M-1. Child rows can reference another tenant's parent row. The schema does not enforce tenant isolation on foreign keys.**
- **Where:**
  - `supabase/migrations/001_init.sql:24` (`documents.career_item_id`)
  - `001_init.sql:51` (`applications.vacancy_id`)
  - `001_init.sql:69` (`resume_versions.application_id`)
  - `001_init.sql:81` (`llm_calls.application_id`)
  - `supabase/migrations/003_imports.sql:53` (`career_items.import_id`)
- **Evidence:** Each of these is a single-column FK to the parent `id`. Each INSERT/UPDATE policy checks only `auth.uid() = user_id` on the child row. Postgres referential-integrity checks run as the table owner and ignore RLS. So a row that passes its own policy can point at a parent the caller cannot see.
- **Exploit scenario:**
  - The threat model includes direct PostgREST use. The anon key is public, so any user can sign in against `/auth/v1/token` and call `/rest/v1/*` with their own JWT, without going through the app's handlers.
  - User B learns one of user A's UUIDs, for example an `/applications/<id>` URL shared in a screenshot or a support thread. B then sends `POST /rest/v1/applications {user_id:B, vacancy_id:<A's vacancy>, resume_source:'paste'}`, or `POST /rest/v1/documents {user_id:B, career_item_id:<A's item>, ...}`. RLS accepts both.
  - **Existence oracle:** The response tells B whether any tenant owns that UUID: `23503` foreign-key violation means no, success means yes. This defeats the "404, never 403" rule (S3/S6) at the database layer.
  - **Cross-tenant side effects:** When A deletes the career item, or deletes the account, the cascade deletes or nulls B's rows. One tenant's action changes another tenant's data. The reverse direction is not exploitable today, because every FK is CASCADE or SET NULL and none is RESTRICT. But it is one FK change away from letting B block A's erasure.
  - **No confidentiality breach was found.** Every app path re-reads the parent through RLS before using it. `rerunPlan` in `src/app/api/scan/route.ts:349-364`, and generate/judge/export (`getApplication` then `getVacancy`, which returns 404), all do this. The `patchCareerItemSchema` and `careerItemFields` validators (`src/lib/validation.ts:95-101, 243-246`) strip `import_id`, and `patchApplicationSchema` (:461-466) allows only `status`/`notes`. So the app itself never forwards a client-chosen parent id. The fence is the app code, not the database.
- **Fix:** Use composite tenant-scoped FKs (Postgres 15+, which Supabase runs):
  ```sql
  alter table career_items add constraint career_items_id_user_uq unique (id, user_id);
  alter table documents drop constraint documents_career_item_id_fkey,
    add constraint documents_item_owner_fk foreign key (career_item_id, user_id)
    references career_items(id, user_id) on delete cascade;
  -- same pattern: vacancies(id,user_id) <- applications; applications(id,user_id) <- resume_versions;
  -- applications(id,user_id) <- llm_calls ... on delete set null (application_id);
  -- imports(id,user_id) <- career_items ... on delete set null (import_id);
  ```
  - The column-list `set null (col)` form is required on the nullable FKs. Without it, a SET NULL would also null `user_id`, which is NOT NULL.
  - Before adding the constraints, run a mismatch query per pair to confirm no cross-owned rows already exist.
  - Alternative: add `exists (select 1 from <parent> p where p.id = <fk> and p.user_id = auth.uid())` to each INSERT/UPDATE `with check`. Composite FKs are preferred because they also bind writes made by the service role and by cascades.

**M-2. With HNSW, `match_documents` can return "found nothing" for a user whose chunks exist. The database then produces the second retrieval outcome where the true answer is "could not search properly".**
- **Where:** `001_init.sql:30-31` (global HNSW index) and `001_init.sql:140-142` (`where d.user_id = auth.uid() order by d.embedding <=> q limit match_count`).
- **Evidence:**
  - The HNSW index covers all tenants.
  - When the planner picks it, pgvector collects about `hnsw.ef_search` candidates (default 40) from the global graph, and then applies the `user_id` filter and the RLS predicate.
  - With many tenants, few or none of those 40 candidates belong to the caller. The function then returns fewer than `match_count` rows, or zero, while that user's relevant chunks exist.
  - The repo sets no `hnsw.iterative_scan` (pgvector ≥ 0.8) and no `ef_search`.
- **Exploit or impact scenario:**
  - This is not an access breach. It is an integrity failure of the "three outcomes, never two" rule in CLAUDE.md.
  - Once enough tenants exist that the planner prefers the vector index, a real requirement gets labelled a "gap" because the search silently returned nothing. A single-user dev database never shows it, because the planner uses a sequential scan or the `user_id` index there.
  - A noisy neighbour, a tenant with many chunks near common queries, makes it worse for everyone else.
- **Fix:** Pick one:
  - (a) Inside the function, `set hnsw.iterative_scan = relaxed_order` (or `strict_order`), with a raised `hnsw.max_scan_tuples`. Verify the installed pgvector version first.
  - (b) Rely on exact search. Rule B9 caps a user at 4,000 chunks, so an exact cosine scan over one user's rows through `documents_user_idx` is cheap and has perfect recall. Force it by ordering on a non-indexable expression, or drop the HNSW index.
  - Either way, add an `EXPLAIN (ANALYZE)` check against a multi-tenant fixture to the acceptance evidence.

### Low

**L-1. `match_documents` has no pinned `search_path`.**
- **Where:** `001_init.sql:134-136`. The deferral is recorded at 001:128-131.
- **Evidence:** The body resolves the unqualified `documents` table, the `<=>` operator, and the `vector` type through the caller's `search_path`. The extension is created without a schema (001:1), so it lives in `public`.
- **Exploit scenario:**
  - The function is invoker, not definer, so a search-path hijack gains no privilege. It can only change what the caller's own query means.
  - The risk becomes real if any role that runs the function can create objects in a schema ahead of `public` on its path, or if a future migration adds such a schema. In that case a shadow `documents` view or `<=>` operator would silently change retrieval.
  - The deferral comment says inlining matters for HNSW. That trade-off does not apply here: the ORDER BY and LIMIT sit inside the function body and are planned there whether or not the function is inlined.
- **Fix:** `alter function public.match_documents(vector, int) set search_path = public, pg_catalog;`. Better, fully qualify everything (`public.documents`, `operator(public.<=>)`) and set `search_path = ''`, matching what 004 already does. Re-run `EXPLAIN` to confirm the plan.

**L-2. Default Supabase grants are left as they are: `anon` holds full table privileges, and the policies are not limited to `authenticated`.**
- **Where:** All `create policy` statements (001:118-122, 003:42-44, 004:70-87) have no `to authenticated` clause. No migration contains a `revoke`.
- **Evidence:**
  - Supabase's default privileges give `anon` and `authenticated` ALL on new `public` tables, including TRUNCATE, REFERENCES and TRIGGER, and EXECUTE on functions.
  - Anon is currently kept out only because `auth.uid()` is null, so every predicate is false.
  - TRUNCATE is not governed by RLS. PostgREST does not expose it today, so this is defence in depth, not a live hole.
- **Exploit scenario:** If a future policy is written with a predicate that does not use `auth.uid()` (for example `using (true)` on a lookup table), or with `auth.uid() is null or ...`, anon gets it immediately, because nothing at the grant layer stands behind RLS.
- **Fix:**
  - `revoke all on all tables in schema public from anon;`
  - `revoke truncate, references, trigger on all tables in schema public from authenticated;`
  - `revoke execute on function public.match_documents(vector,int) from anon, public;`
  - Add `to authenticated` to every policy.
  - Mirror all of this in `alter default privileges` so later tables inherit it.

**L-3. Missing indexes, and RLS predicates that re-evaluate per row.**
- **Where:**
  - `documents.career_item_id` has no index (001:24). It is used by `deleteDocumentsForItem` and `listDocumentsForItem`, and by the cascade from `career_items`.
  - `applications.vacancy_id` has no index (001:51).
  - `llm_calls.application_id` has no index (001:81). The `listGenerateCallsForApplication` comment calls this lookup "a single indexed lookup", but the only index is `(user_id, created_at)`.
  - `resume_versions` has no index leading with `user_id` (001:75). `listResumeVersionsForQuality` (`src/lib/db/resumeVersions.ts:47-58`) filters only through RLS, so it scans across all tenants.
  - Every policy uses bare `auth.uid()` rather than `(select auth.uid())`.
- **Exploit scenario:** This is performance, not a security risk, but it ties into availability. An authenticated user calling PostgREST directly can trigger cross-tenant sequential scans on `resume_versions` at will. Cascaded deletes from `career_items` scan `documents`.
- **Fix:**
  - Add the indexes: `create index on documents(career_item_id); create index on applications(vacancy_id); create index on llm_calls(application_id); create index on resume_versions(user_id, created_at desc);`
  - Wrap the policy predicates as `(select auth.uid()) = user_id`.
  - Correct the "single indexed lookup" comment in `src/lib/db/llmCalls.ts:93-96`, or add the index.

**L-4. No test exercises RLS directly through PostgREST.**
- **Where:** `tests/e2e/generate.spec.ts:196-335` covers cross-user 404 through the app routes. Nothing in `tests/` calls `/rest/v1` with a second user's JWT, or with anon.
- **Exploit scenario:** A regression in a policy is masked by the app's own RLS-scoped re-reads, as M-1 shows. Only a direct-REST test proves the fence that the comments repeatedly say is "in the database".
- **Fix:** Add an integration test with two users and anon that, for each table, attempts select, insert, update and delete through `/rest/v1`, plus a foreign-owned FK insert, which becomes possible once M-1 is fixed. `check.mjs` R1 and R10 constrain `tests/`. Use `fetch` against `/rest/v1` with the anon key and user JWTs, which neither rule prohibits.

### Info

- **I-1.** `match_documents` gets SECURITY INVOKER only by default (001:136). Write `security invoker` explicitly, so that the rule "R3 forbids definer" becomes the positive assertion "invoker is declared", and a later `create or replace` that adds a definer clause stands out in review.
- **I-2.** `match_count` is not clamped (001:134, 142). Through the RPC, a user with their own JWT can ask for any limit. They only ever get their own rows, so the effect is limited to load. Add `least(greatest(match_count, 1), 50)`.
- **I-3.** `llm_calls` is client-writable through INSERT, by design. A user calling REST directly can insert fake rows with arbitrary cost or model values. These affect only their own `/quality` view, and can only push their own B7/B7a quota counts up. Because there is no UPDATE or DELETE policy, no user can lower their counted usage. **The append-only matrix is therefore part of the B7 spend cap.** Any future UPDATE or DELETE policy on `llm_calls` would be a budget bypass and should be treated as such. The same reasoning applies to self-inserted `documents` rows: a user can poison only their own retrieval.
- **I-4.** The UPDATE policies cover every column. Through REST a user can rewrite their own `id`, `created_at`, `source` and `match_score`. No other tenant is affected. Column-level `grant update (...)` would narrow this if it ever matters (for example `career_items.source`, which is provenance).
- **I-5.** The policy guards in 004 check the policy name only (004:63-90). On the original project, which 004:92-101 says ran an earlier version of this file, a same-named policy with a different definition would be skipped silently. Run the `pg_policies` query from the manual checks to confirm `profiles_update_own` has both `qual` and `with_check`.
- **I-6.** The `vector` and `moddatetime` extensions are installed in `public` (001:1-2). The Supabase linter flags this ("extension_in_public"). It is related to L-1.
- **I-7.** Migration 002 grants `delete on auth.audit_log_entries to postgres` (002:8-9). This is narrow and correct. It is not a definer and not reachable from the API.
- **I-8.** Account-deletion completeness is confirmed at the schema level. All 8 owned tables reach `auth.users` through `ON DELETE CASCADE`, either directly or through a direct `user_id` FK. No storage buckets are used. `deleteUser` is a hard delete (route :62, default `shouldSoftDelete: false`). Because of M-1, deletion can currently also remove another tenant's rows that point into the deleted account.
- **I-9.** The `pgvector` column is `vector(1536)` on `documents.embedding` (001:26) and on the `match_documents` parameter (001:134). This matches CLAUDE.md. The HNSW `vector_cosine_ops` index exists (001:30-31) and matches the `<=>` operator.

---

## What's done well

- **Least-privilege matrix, built the same way everywhere.** 001's literal matrix plus the generator loop (001:102-126) makes it hard to forget a WITH CHECK. Every INSERT has one, and every UPDATE has both USING and WITH CHECK, so no row can be reassigned to another owner. The absent policies are deliberate and recorded in comments at the point of definition.
- **Append-only tables really are append-only.** `resume_versions` and `llm_calls` have no UPDATE or DELETE paths in either the schema or the DAL. `documents` has no UPDATE, and the DAL has no upsert.
- **Service role confined twice.** One reader (`admin.ts`, enforced by R10) and one consumer (DELETE `/api/account`). The consumer verifies the user first, takes no request body, and creates the client lazily inside a function.
- **`security definer` is banned mechanically.** `check.mjs` R3 strips SQL comments before testing, so prose cannot trip it and a split keyword cannot slip past it. The one plpgsql function pins `search_path = ''`.
- **The app layer never forwards a client-chosen parent id or owner.** `user_id` is always stamped from `requireApiUser()`. Route ids are UUID-validated, and parents are re-read through RLS before use. The Zod schemas strip `import_id`, `match_score` and `coverage` from client patches. This is why M-1 has no confidentiality impact today.
- **Erasure is designed, not assumed.** Every owned table cascades from `auth.users`. The account route documents why `force row level security` would break erasure. Migration 002 makes Supabase's own audit-log retention explicit and gates the privacy claim on proof that the purge has actually run (R12).
- **The 404-not-403 discipline is applied consistently** across the DALs and handlers, and is tested end to end for a real foreign application id.
- **Migrations 004 and 005 can be re-run in full,** with the reasoning recorded. The URL CHECK constraints in 005 keep `javascript:` and `data:` values out of href-adjacent columns at the database layer.

---

## Files referenced

- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\001_init.sql`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\002_audit_retention.sql`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\003_imports.sql`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\004_profiles.sql`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\005_profile_contacts.sql`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\` (all eight DALs plus `types.ts`)
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\supabase\admin.ts`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\supabase\server.ts`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\account\route.ts`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\scan\route.ts`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\validation.ts`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\scripts\check.mjs`
- `D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\generate.spec.ts`

Per CLAUDE.md, this report should be saved verbatim to `docs/reviews/` before anyone acts on it. This audit was read-only and did not write that file.
