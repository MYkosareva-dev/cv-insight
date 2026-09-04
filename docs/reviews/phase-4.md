# AI Code Review — `phase-4-generate` — 2026-09-04

**Scope:** `git diff main...HEAD`, merge-base `b8a5e71` → HEAD `60221b6` — 15 commits (`1afb28e`…`60221b6`), 55 files, +6976/−385. SPEC v2.15 → **v2.17**; CLAUDE.md as of `main` (unchanged by this branch — which is one of the findings). Reviewed against SPEC Block D #5/#6/#7/#9, Block E's result screen and Settings, Block F prompts P1–P3 and rules B1–B10, and CLAUDE.md in full.

**Prior gates read before reviewing, so nothing closed is re-litigated:** `docs/reviews/phase-4-architect-plan.md` (3 BLOCKERs, 8 MAJORs, on the plan), `docs/reviews/phase-4-architect-diff.md` (2 BLOCKERs, on the first implementation round), `docs/reviews/phase-4-owner-round.md` (1 BLOCKER, on the owner-testing round). All three are saved verbatim in the tree, before their findings were acted on, as CLAUDE.md's Process rule requires. Section 1 below records, per item, whether I confirmed the fix **in the code** or only **as a declaration**.

```
VERDICT: REVISE
```

> **STATUS — updated 2026-09-04, after two rounds of owner triage. EVERY FINDING IN**
> **THIS REPORT IS NOW EITHER FIXED OR CARRIED WITH AN ID; NOTHING IS UNTRIAGED.**
> The verdict above and every finding below are left EXACTLY as the review produced
> them, including the two that turned out to be partly wrong (see §7.3) — a review is a
> record of what was said at the time, and editing it to agree with what happened next
> destroys the only thing it is good for. **What happened next is §7, appended.**

**Two BLOCKERs, and neither is a code defect.** Both are the rule book and the evidence file falling behind the code: an eighth table whose DAL and RLS policies appear nowhere in CLAUDE.md's authoritative lists, and a user-facing promise shipping ahead of the run that would witness it. Both need the owner rather than the agent — one is a CLAUDE.md amendment, the other is one `npx playwright test`. Five MAJORs and eleven smaller items follow. The pipeline itself is in good shape: the chokepoints hold, the retry budget caps rather than multiplies, the grounding gate and the base gate are arithmetic in code, and no secret goes anywhere near the client.

**Gates run on this branch, quoted (clean tree at `60221b6`):**
- `node scripts/check.mjs` → `check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree.`
- `npm test` → `tests 256 · suites 50 · pass 256 · fail 0` (174 at the end of Phase 3; the new suites are `budget`, `generation`, `judge`, plus additions to `scoring` and `validation`).
- `npx tsc --noEmit` → clean · `npx eslint .` → clean.
- `npm run build` → compiled in 29.7 s, TypeScript clean, 17/17 pages, `ƒ Proxy (Middleware)` wired, and all four Phase-4 routes present as dynamic (`/api/applications/[id]/{generate,judge,rescore,export}`).
- Playwright was **not** re-run by me; the branch's own evidence is `docs/eval/phase-4-e2e-run.txt` (31 passed, 2 skipped, at `33c3d81`). See BLOCKER 2.
- Secrets inspected by NAME only (`grep -o '^[A-Z_]*' .env.example` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); every recursive search excluded `.env*`. No new environment variable, so `.env.example` needed no change. No secret VALUE appears anywhere in this review.

---

# 1 — Closure of the three prior gates: code vs declaration

Asked for explicitly, because a declaration that outlives its implementation is the failure mode this repo legislates against most often.

## Plan gate (`phase-4-architect-plan.md`)

| # | item | closed **in code** at | notes |
|---|---|---|---|
| B1 | `/rescore` embeds the editor text | `src/lib/coverage.ts:164-219` | ✅ requirements and resume units in one batch, `cosineSimilarity` in process on pgvector's own scale |
| B2 | `/export` saves a `source='user'` row | `src/app/api/applications/[id]/export/route.ts:84-96` | ✅ before the file is returned |
| B3 | lock in `finally`, TTL ≥ `maxDuration` | `generate/route.ts:56,68,223-227` | ✅ TTL 300 000 = `maxDuration` 300 |
| M4 | top-8 chunks → distinct items | `src/lib/generation.ts:36,47,101-108` · `tailoring.ts:92` | ✅ 60 rows ranked, 8 distinct items delivered |
| M5 | query text defined, `application_id` threaded | `generation.ts:79-88` · `retrieval.ts:130-146,169-193` | ✅ closes `p3-8` for scan, generate and rescore; indexing still passes null, correctly |
| M6 | B7 refusing a step after a billed step | `tailoring.ts:315,341-354,377-398` | ✅ **both** branches now, judge and revision |
| M7 | verdict computed, both halves | `src/lib/judge.ts:71-74` | ✅ the model's `verdict` is input to nothing |
| M8 | `missingHonest` carries B4 in words | `judge.ts:132-159` | ✅ and v2.17 added the base gate in front of the words |
| M9 | `/judge`'s `<items>` source | `judge/route.ts:33-46` | **declared only** — re-retrieval, carried as `p4-3` |
| M10 | synchronous ref on metered buttons | `result-workspace.tsx:157,165-167` | ✅ one ref shared by all four buttons |
| M11 | `SCAN.savedVersionUnavailable` reworded | `copy.ts:239-240` | ✅ |
| M12 | revision skip declared | `SPEC.md:651` · `RESULT.reviseWithoutFindings` | ✅ declared and implemented |

## Diff gate (`phase-4-architect-diff.md`)

- **BLOCKER 1 — keyword list removed from P2, undeclared.** Now **declared** as SPEC v2.16 endpoint-#5 note 13, and the code matches: `requirementsJson(parsed, withKeywords)` (`src/lib/tailoring.ts:143-150`) is called with `false` for the writer (`:182`) and `true` for the reviewer (`:239`). Rule B4's table row in SPEC (`:844`) was amended to say the generator is not given the list at all. **Closed, in code and in SPEC.**
- **BLOCKER 2 — the revision's generate step unguarded.** Closed **in code**: `tailoring.ts:340-354` wraps step 3 in the same `DailyLimitError`/`AiUnavailableError` catch as `judgeOrNull`, returns the paid original, and rethrows everything else. Declared as v2.16 note 14. I traced every branch: there is no arrangement of verdicts that discards a billed draft.
- **MAJOR 3 — B1b on the re-scored number.** Closed **in code, on the server**: `rescore/route.ts:117` returns `renderableScore({ match_score: matchScore, coverage })`, so the endpoint cannot hand a client a number the rest of the app would refuse to print. Better than the fix that was asked for.
- **MAJOR 4 — two corpora in one ring, calibration gap.** **Declared only** (`SPEC.md:689`, `docs/eval/coverage-thresholds.md`), carried as `p4-11`. Honest: `RESULT.rescoredExplainer` describes the new computation and claims no comparability.
- **MAJOR 5 — judge output ceiling.** Half in code (`MAX_TOKENS_BY_STEP.judge` 1200 → 3000), half **declared only**: `finish_reason` is still unread, so a length cut is still indistinguishable from a model that got the JSON wrong. `p4-2` re-diagnosed correctly. **But the same edit broke something else — see MAJOR 1.**
- **MAJOR 6 — re-score chunk cap.** Closed **in code**: `MAX_EPHEMERAL_CHUNKS = 200` (`chunking.ts:127`), `chunkContent` gained an explicit cap argument, and `coverage.ts:174` passes it. The storage constant is no longer borrowed.
- **MINORs 7–11** (docblocks stating properties the code lacked) — all **closed in code/comment**: `openingVersion`'s symmetry claim is now a stated dependency (`judge.ts:216-223`), `baseText`'s corpus note is rewritten (`scoring.ts:368-380`), `matchedText`'s "never reaches the database" is corrected (`types.ts:150-156`), the CHECK's absent lower bound is stated (`validation.ts:568-579`), and "ONE embeddings run" is now "usually one" (`rescore/route.ts:46-53`).
- **MINORs 12–13, NITs 14–17** — carried as `p4-12` … `p4-16`, unfixed and declared.

## Owner-testing round (`phase-4-owner-round.md`)

- **BLOCKER — `{{candidateName}}` in the instruction region.** Closed **in code, both halves**: the slots are wrapped (`prompts.ts:136` and `:169`, with P2's closing sentence extended at `:140` and P3's at `:170-172`), and `cleanDisplayName` (`validation.ts:542`) maps `\p{C}` → space, strips `[<>]`, collapses whitespace runs, and does it **before** the length check. Ten unit tests pin it, including the injected-newline case and the angle-bracket case. This is the strongest fix on the branch: the containment and the sanitiser are independent, and neither is asked to carry the other.
- **MAJORs 2 and 3, MINORs 4–9, NITs 10–11** — all closed in code or in the artefact. The eval file now carries the re-run's own verbatim output; all three judge-panel sites use `listCareerItemCorpus()` (`page.tsx:88-91`, `generate/route.ts:215-218`, `judge/route.ts:127-130`); the projection replaced `select('*')`; the e2e probe asserts `SETTINGS.displayNameFailed` before skipping; `auth.spec.ts:308-338` saves a name before the delete; `SETTINGS.displayNameSignedOut` and `displayNameLoadFailed` are their own outcomes.
- **NIT 12** — carried as `p4-25`.

**Nothing re-opened.** I re-checked both diff-gate BLOCKERs and the owner-round BLOCKER against the current tree; all three hold.

---

# 2 — BLOCKERS

## B-1 — CLAUDE.md ships an eighth table it does not list: the DAL roster and the RLS matrix are both stale

`CLAUDE.md:135-138` and `CLAUDE.md:141-148` · `supabase/migrations/004_profiles.sql` · `src/lib/db/profiles.ts` · `scripts/check.mjs:86`

The branch adds a table. `scripts/check.mjs`'s `DAL_FILES` gained `src/lib/db/profiles.ts` — correct, and it is why `check` still passes 13/13. What did **not** change is the document that rule is derived from:

- `CLAUDE.md:135-138` names the DALs exhaustively — seven files, `careerItems` through `imports`. `profiles.ts` is not among them, and the rule says *"`scripts/check.mjs` is driven by that list… Adding a table means adding a DAL and a line there."* The line was added to the script; the list that drives it was not.
- `CLAUDE.md:141-148` is the **least-privilege policy matrix**: `career_items S/I/U/D · documents S/I/D · vacancies S/I/U · applications S/I/U · resume_versions S/I · llm_calls S/I · imports S/I/U`. `profiles S/I/U` is absent, and the rule immediately after reads *"Do not add a missing policy without an owner amendment."*

**The code is right.** I checked `004_profiles.sql` against the matrix's own pattern and it matches on every axis: RLS enabled (`:22`), `select` with `using`, `insert` with `with check`, `update` with **both** `using` and `with check` (`:23-26`) — the pair that stops an owner rewriting `user_id` to another account — no DELETE policy, and `user_id uuid primary key references auth.users(id) on delete cascade` (`:12`) so erasure is structural. `getProfile`/`upsertDisplayName` are the only `.from('profiles')` sites and both run under the caller's session. The upsert is legitimate here and the DAL says why (`profiles.ts:78-91`): CLAUDE.md's upsert ban is scoped to `documents`, whose UPDATE policy is deliberately absent — `profiles` has one.

So this is not a security hole. It is the exact thing CLAUDE.md's own Process section calls a defect: **the rule book no longer describes the app, in the one place a reviewer checks a new table's RLS story against.** Because CLAUDE.md wins on conflict, a stale matrix is not passive — it is an instruction to the next agent that this app has seven owned tables when it has eight, and the next reviewer who checks a new DAL against `CLAUDE.md:138` will find it absent and either flag a correct file or amend the wrong document.

**Required before merge, and it is the owner's edit, not the agent's:** add `lib/db/profiles.ts` to the DAL roster and `profiles S/I/U (no DELETE — clearing a name is an update to null; the row dies with the account through the cascade)` to the matrix. One amendment, two lines. SPEC v2.17 already carries the reasoning (`SPEC.md:317`) and `src/app/api/account/route.ts:25-32` already counts eight tables; CLAUDE.md is the only document left behind.

## B-2 — the display-name feature ships with zero passing evidence, and the migration it was waiting for has since been applied

`docs/eval/phase-4-e2e-run.txt:52-71` · `tests/e2e/generate.spec.ts:568-594` · `tests/e2e/auth.spec.ts:308-338` · `src/app/privacy/page.tsx:24-30` · commit `60221b6`

The recorded suite run is `31 passed, 2 skipped`, and one of the skips is the whole feature:

> ` - 23  generate > a saved display name becomes the resume name line and the file name`
> `SKIPPED: needs migration 004_profiles.sql applied in the Supabase dashboard… Until the owner applies 004, THE DISPLAY-NAME FEATURE IS UNWITNESSED end to end (backlog p4-19).`

That was an honest statement when it was written. It is no longer the state of the world. The branch's **last** commit, `60221b6`, is titled *"004 matches what was applied"* and its message reads *"Replaced verbatim with the SQL the owner applied."* The table exists on the project. The skip condition — the e2e probes by performing the feature's own first save, which is the right shape — has therefore lapsed, and the same probe gates the erasure half in `auth.spec.ts:322`, so **both** the feature and its erasure remain unwitnessed by any recorded run.

What is shipping on top of that absence:

- `/privacy` (`page.tsx:24-30`) now promises the name is stored, used for exactly two things, changeable, and *"deleted along with everything else when you delete your account."* That is a public, GDPR-relevant claim about the eighth table.
- CLAUDE.md, Privacy: *"Right to erasure: Settings → delete account removes the auth user and all owned rows (verified by test)."* The test now exists (`auth.spec.ts:308-338`) and has never been observed to execute its own body.
- CLAUDE.md, Process: *"A configured mechanism is not a working one… Any claim that something happens automatically needs evidence of it having happened at least once… and a user-facing promise may not ship ahead of that evidence."*

This is the same discipline the Phase-3 branch applied to itself when it **re-ran** `phase-3-e2e-run.txt` rather than re-wording it, on the reasoning that *"an evidence file whose commit no longer matches the code is worse than no evidence file."* Here the file's commit matches the code; what no longer matches is its stated reason for skipping.

**Required before merge:** one `npx playwright test` against `60221b6` with 004 applied, and the output pasted into `docs/eval/phase-4-e2e-run.txt` as a third run. Expected result is `33 passed, 1 skipped` — case 23 running, and only the broken-key scan case still skipped. If case 23 fails, that is the finding this blocker exists to surface. No code change is being asked for.

*(A related detail, not a separate finding: the eval header's "Working tree: CLEAN for src/ and tests/" claim does survive `60221b6`, which touched only `docs/backlog.md` and the migration. The claim is true; the skip is what is stale.)*

---

# 3 — MAJOR

## M-1 — `parse_vacancy` was silently dropped from `MAX_TOKENS_BY_STEP`, and SPEC's enumeration of that map is now false on two of four entries

`src/lib/openrouter/server.ts:64-79` and `:268` · `SPEC.md:921`

The commit that raised the judge ceiling removed the neighbouring line as well. The map now reads:

```ts
export const MAX_TOKENS_BY_STEP = {
  import_resume: 8000,
  judge: 3000,          // v2.16, declared
  generate: 2500,
} as const satisfies Partial<Record<LlmStep, number>>;
```

`parse_vacancy: 1200` is gone. **Runtime behaviour is unchanged**, because `:268` reads `MAX_TOKENS_BY_STEP[step as keyof typeof MAX_TOKENS_BY_STEP] ?? 1200` and 1200 is what parse_vacancy had. That is why nothing caught it: `satisfies Partial<Record<…>>` permits the omission, the `as keyof typeof` cast suppresses the index error, and the `??` supplies the same number.

Three things follow, and they are why this is a MAJOR rather than a nit:

1. **It reverses the mechanism the map exists for, in the file that says so.** The docblock four lines above (`:52-63`) is explicit: *"A per-step map instead of a ternary, so the next step to need its own ceiling states it here rather than inheriting a number chosen for something else."* `parse_vacancy` now inherits a number chosen for something else, from a `??` that is not documented as a policy anywhere. This is the v2.10 amendment partially undone — and v2.10 exists because a step inheriting the wrong ceiling produced a 502 on the app's first flow.
2. **The type system can no longer catch the next occurrence.** A fifth chat step added tomorrow compiles, ships, and silently gets 1200 output tokens. Dropping the cast and typing the map as a total `Record<ChatStep, number>` would make the omission a build error — which is the shape this codebase uses everywhere else (`MODEL_BY_STEP` has the same hole, worth closing in the same edit).
3. **It is undeclared, and SPEC now contradicts the code.** `SPEC.md:921` states the map verbatim: *"`MAX_TOKENS_BY_STEP` in `lib/openrouter/server.ts`: import_resume 8000, parse_vacancy 1200, judge 1200, generate 2500."* Two of those four are now wrong — `judge` is 3000 (declared in `docs/backlog.md` p4-2 and in the code docblock, but **not** in the SPEC sentence that names the number) and `parse_vacancy` is not in the map at all. `SPEC.md:915`'s own snippet reads `max_tokens: MAX_TOKENS_BY_STEP[step]`, with no fallback, which is not what the code does either.

**Required:** restore the explicit `parse_vacancy: 1200` (or state the `??` default as a deliberate policy and make the map total), and update `SPEC.md:921` to the four numbers actually shipping. "Silence is a defect, not a deferral" applies to a number as much as to a behaviour.

## M-2 — SPEC Block C's canonical DDL cannot be run on the project it describes

`SPEC.md:322,337,387` · `supabase/migrations/001_init.sql:2,17,62` · `docs/backlog.md` p4-27

`60221b6` establishes a fact with consequences beyond the file it fixed: **`moddatetime` is not available on this Supabase project.** The commit rewrote `004_profiles.sql` to carry its own `plpgsql` touch function for exactly that reason, and filed `p4-27` to re-read `001`–`003`.

`p4-27` names the three `.sql` files. It does not name **SPEC Block C**, which reproduces `001_init.sql` verbatim — `create extension if not exists moddatetime;` at `:322`, and `for each row execute procedure moddatetime(updated_at)` at `:337` and `:387`. SPEC is described in CLAUDE.md as *"the single source of truth for build details."* Its schema section is now a set-up script that fails on line 2 against the very project it was written for, and a second reader following it on a fresh project gets no `career_items` or `applications` touch trigger — which means `updated_at` silently stops advancing on two tables, and nothing in the app would notice.

A second, smaller half of the same gap: **004's DDL never entered Block C at all.** `003_imports.sql`'s table is spelled out there; `profiles` gets a prose note (`SPEC.md:317`) and a tree entry (`:94`), so the only place the eighth table's shape is written down is the migration file — which is also the file that just changed shape.

**Required:** widen `p4-27` to include `SPEC.md` Block C, and add `profiles` to the Block C DDL so all eight tables are described in one place. The fix for the extension itself (a local `touch_updated_at` in 001, as 004 now has) can stay a backlog item; the SPEC text saying the opposite of the truth should not.

## M-3 — `004_profiles.sql` is not re-runnable, contrary to its own commit message, and it is the only migration with no documentation

`supabase/migrations/004_profiles.sql:11-26`

`60221b6`'s message states: *"`create table if not exists` and `drop trigger if exists` make it re-runnable."* They do not. PostgreSQL's `CREATE POLICY` has no `IF NOT EXISTS` form at any version, so a second run of this file gets past the function, the table and the trigger and then aborts at `:23` with `42710 policy "profiles_select_own" for table "profiles" already exists`.

Half-idempotent is worse than plainly non-idempotent, and for a reason specific to how these files are used. They are pasted into the Supabase SQL editor. A partial run leaves the operator staring at an error from a file whose first three statements just succeeded, with no way to tell from the message whether the table was created by this run or a previous one. Wrap the three policies in the `do $$ … if not exists (select from pg_policies …) $$` guard, or drop the idempotency claim from the record — but not both halves as they are.

Two smaller points from the same commit, kept here because they are the same edit:

- **004 is now the only migration in the tree with no header comment.** `001` has one, `002:1-3` has one, `003:1-8` has one — including the *"Run in the Supabase SQL editor AFTER 001 and 002"* ordering instruction, which 004 needs more than any of them and no longer carries. CLAUDE.md's Documentation-voice rule (*"Every committed file reads as product documentation"*) does not exempt SQL. The commit's argument for stripping the comments — that the file must match what ran, byte for byte — is a good argument for not *rewriting* the SQL and not an argument against a leading comment block, which changes nothing a database executes.
- **`public.touch_updated_at()` is a generically-named function created with `create or replace` in the public schema.** Harmless today; worth a `set search_path = ''` and a name that says which migration owns it, before a future migration replaces it out from under this trigger.

## M-4 — CLAUDE.md's central product guarantee is false on two branches this phase deliberately built

`CLAUDE.md:9-10` · `src/lib/tailoring.ts:286-298,377-398` · `SPEC.md:652` · `src/lib/copy.ts` (`RESULT.judgeNotRun`)

CLAUDE.md's opening description of the app — the sentence the whole "why this app is pointless without AI" argument rests on — reads:

> *"…generates a tailored resume grounded ONLY in the user's real experience, and **evaluates every generated resume with a rubric-based LLM judge before showing it**."*

Two branches this phase adds show a generated resume that was **not** evaluated. `judgeOrNull` (`tailoring.ts:377-398`) swallows `DailyLimitError` and `AiUnavailableError` and returns `null`; the draft is then saved and shown with `judge: null` and `RESULT.judgeNotRun` — *"Your resume was saved, but the quality check did not run."* Branch 5 (`:340-354`) is the same one step later.

**The behaviour is correct and I would not change it.** SPEC v2.16 note 9 makes the argument properly: rule B7's cap is checked per step against committed rows, so a user at 49 calls can pass the generate check, spend a Sonnet call, and be refused on the judge — and throwing the draft away to report "nothing was saved" takes their money and their work. The card is honest, the three-state discipline holds, `judgeIssueCounts(null)` keeps both bars on "Not checked yet" (`judge.ts:245-254`), and the version row reads "Not checked" rather than "Approved" (`resume-editor.tsx:171-176`).

What is wrong is that **nothing says the guarantee has an exception.** SPEC v2.16 note 9 declares the deviation from Block D #5's server steps; it does not mention that CLAUDE.md's product sentence, which is the higher authority, now over-promises. Under CLAUDE.md's own conflict order this is the more important of the two documents to have got right, and under "No undeclared deviations" a deviation from CLAUDE.md needs the same treatment a deviation from SPEC gets.

**Required:** either amend `CLAUDE.md:9-10` to *"…and evaluates every generated resume with a rubric-based LLM judge before showing it, or says plainly that the check did not run"*, or add the CLAUDE.md conflict to SPEC v2.16 note 9 explicitly. The words are cheap; the next reader concluding that a `judge: null` version is a bug and "fixing" it by throwing the draft away is not.

## M-5 — `/rescore` is the first metered endpoint in the app with no cap of any kind

`src/app/api/applications/[id]/rescore/route.ts:56-98` · `src/lib/chat.ts:120-135` · `SPEC.md:847` (rule B7)

Rule B7's cap lives in exactly one place: `assertUnderDailyCap` at the head of `lib/chat.ts`'s two exports. Any endpoint that never enters that gate is uncapped, and rule B7's own text excludes embeddings by definition (*"max 50 rows in `llm_calls` per user per rolling 24 h (embeddings excluded)"*). `/rescore` makes **no chat call at all** — that is its selling point, and `RESULT.rescoredExplainer` and US-5's acceptance line both depend on it. The consequence is that a verified user can POST `/rescore` in a loop and spend embeddings money with nothing in front of them but the client's own `inFlight` ref (`result-workspace.tsx:157`), which is not a server-side fence. There is no ledger, no cap check, no 409 lock, and no server-side one-click guard.

The exclusion in B7 was reasonable when it was written, because every embeddings spend in the app was either a side effect of a bounded write (career-item save, bounded by `MAX_CAREER_ITEMS` and skipped when nothing changed — CLAUDE.md, Embeddings) or a limb of a chat-capped request (`/scan`'s `parse_vacancy` gates the whole run). `/rescore` is neither: it is an endpoint whose entire purpose is a **repeatable** embeddings spend, one click at a time, and each call embeds up to `parsedVacancySchema`'s 200 requirements plus up to `MAX_EPHEMERAL_CHUNKS = 200` resume units.

**Magnitude, stated honestly so the severity can be judged:** the Phase-3 probe measured `embed rows=2 … cost_usd_micro=8`, so one re-score is a few micro-USD and a thousand of them is cents. This is a *policy* hole, not a bill. But CLAUDE.md's metered-call section is unambiguous that a model call is metered and that the arithmetic bounding it belongs in code, and the cheapest closure is small: count `rescore` and `embed` rows against their own daily ceiling in `lib/retrieval.ts`, the way `lib/chat.ts` does for chat, or reuse the 409 lock. Either way, rule B7's parenthetical *"(embeddings excluded)"* now needs a sentence saying what bounds them instead.

---

# 4 — MINOR

- **`/judge` and `/export` write `resume_versions` rows no screen can ever render.** `src/app/(app)/applications/[id]/page.tsx:111-122` mounts `ResultWorkspace` — the only reader of `listResumeVersions` — solely when `application.coverage !== null`. But `/judge` gates on `vacancy.parsed` alone (`judge/route.ts:70`) and `/export` gates on neither, and SPEC's own note at `:765` establishes that `parsed` non-null with `coverage` null is reachable (a match failure stores the parse). So a direct POST to either endpoint on such an application appends an append-only row that the detail page will never show — and `/judge` spends a Haiku call to do it. Same class as v2.12 deviation 1's orphan `vacancy` row, on a table with no DELETE policy. Not reachable through the UI (the not-analysed branch renders no editor), which is why this is a MINOR and not more. Gate both on `application.coverage !== null`, as `/generate` already does (`generate/route.ts:111-113`).
- **"Refused before the spend" is true of the chat call and false of the embeddings call that already happened.** `generate/route.ts:124` runs `retrieveItemsFor` — one paid embeddings request — and only then refuses an empty corpus at `:125-133`. The comment at `:131` reads *"Refused before the spend, with the copy that names the cause"*, `judge/route.ts:86-88` says *"Refused BEFORE the paid judge call"* (accurate), and `copy.ts`'s `generateNeedsBase` docblock says *"Refused before the spend instead"* (not accurate). A user with an unindexed base pays one embeddings request per click and receives a 400. Either say which spend was avoided, or check `documents` for a row count before embedding.
- **`RESULT.emptyEditor` — "Resume text is empty" — is the message for a 100-character minimum.** `validation.ts:592-598` attaches it to `.min(MIN_RESUME_CHARS, RESULT.emptyEditor)`, so a 50-character paste is told it is empty when it is not. The schema's own docblock (`:568-579`) acknowledges the tension and argues the bound; what it does not do is give the bound its own sentence. This app tells four sign-in outcomes and three retrieval outcomes apart on exactly this principle. A `RESULT.resumeTooShort` beside `resumeTooLong` closes it.
- **`Rubric` and `JudgeReport` are structurally identical and bridged by `as` casts.** `src/lib/judge.ts:29-36` duplicates `src/lib/db/types.ts:241-248`, and `src/lib/tailoring.ts:250,317,321` crosses between them with `as Rubric` / `as JudgeReport`. The duplication is *justified* — `types.ts` is `server-only` and `judge.ts` must stay unit-testable, the same argument that moved `pricing.ts` and `budget.ts` — but the casts are the part with no defence: they are unnecessary today (the types are mutually assignable, so the assertions do nothing) and they are precisely what would absorb a future divergence without a build error. Drop the three casts, and add a `const _same: Rubric = {} as JudgeReport` style equality assertion in the unit tests so the compiler holds the two shapes together.
- **`SPEC.md`'s v2.16 endpoint-#5 note is numbered 1–11, 13, 14, 12.** Items 13 and 14 were appended after the diff gate and item 12 ended up last. Cosmetic, but the notes are cross-referenced by number from four files (`tailoring.ts:117`, `copy.ts`, the backlog, the architect reports), so out-of-order numbering is the kind of thing that turns into a wrong citation.
- **`RESULT.copied` is now unreachable and undeclared.** The clipboard path is gone — `result-tabs.tsx:298` records that it was replaced — and `copyBullet`'s docblock (`copy.ts:477-481`) explicitly declares itself kept-but-unwired. `copied` (`copy.ts:483`) got no such sentence. Phase 3's precedent is exactly this distinction: unreachable constants added on a branch were deleted, and `APPLICATIONS.loadFailed` survives *because it is declared*. Delete it or declare it.
- **`getProfile` relies on RLS alone to yield at most one row.** `src/lib/db/profiles.ts:26` is `.from('profiles').select('*').maybeSingle()` with no `.eq('user_id', …)`. This is the codebase's established shape and it is safe — and note the failure mode is benign twice over, since `maybeSingle()` would throw rather than pick a row, and `getDisplayName` degrades that to the placeholder. Still: `match_documents` filters by `auth.uid()` *inside* the function with RLS as the fence underneath, and CLAUDE.md calls that belt-and-braces pairing a rule for the retrieval path. One `.eq()` here would make the profiles read match it.

---

# 5 — NITS

- **The "Auto-revised once" badge still outlives the drafts it describes** (`result-workspace.tsx:144`): `versions.some(v => v.source === 'ai_revision')` survives into the state where [Check quality] has appended a `user` version, so the badge sits above the user's own text and the user's own report. Carried as `p4-13`; restated only because this is the branch that ships it, and because the fix is one line — derive it from the version being shown.
- **`termsOf()` (`result-workspace.tsx:42-48`) validates the container and not the members.** `Array.isArray(terms?.supported)` accepts an array of objects, which would render as `[object Object]` in the judge card's `Findings` list. Same-origin, own endpoint, own server-computed payload — but this is the one client-side guard standing between a malformed `judgeTerms` and the panel whose whole purpose is not to suggest a term the base lacks, and its fallback-to-empty design (correctly praised by the owner-round gate) is undermined slightly by not checking what it did accept.
- **`/export`'s dedupe has a race.** Two concurrent exports both read `getLatestResumeVersion` before either inserts, both see `latest.content !== content`, and both append. `p4-5` carries the *older-version* case; the race is a different one. Cosmetic, on an append-only table whose duplicates are visible in the version list.
- **`isHeading` (`src/lib/docx.ts:47-56`) bolds any all-caps line of ≤40 characters**, which includes a company name a user typed in capitals on its own line. The detection is the right call over a hard-coded heading list (the docblock argues it well); the consequence is one wrongly-bold line in a .docx, and it is worth one sentence in that docblock rather than being discovered by a user.

---

# 6 — What the branch gets right

Recorded so a later reviewer does not re-litigate it, and so a later agent does not "improve" it.

- **The retry budget caps and does not multiply, and I verified it by tracing rather than by reading the comment.** `runChatJson` → `runChatWithin` → `issue` share one `Budget` object; `issue` refuses at `budget.spent >= MAX_CHAT_REQUESTS_PER_STEP` (`chat.ts:159-161`), `runChatWithin` re-checks before its network retry (`:270`), and `runChatJson` re-checks before the repair (`:324-326`). A repair wrapped around a network retry therefore issues **2** requests, not 4. Four steps × 2 = the declared 8, `MAX_CHAT_REQUESTS_PER_GENERATE` is *derived* (`budget.ts:55`) rather than written down twice, and `generate/route.ts:156-165` asserts the ledger against it as a labelled defect trap. `tests/unit/budget.test.mjs` pins the arithmetic in both orders of exception — which closes `m-4`'s worst half, because the number had previously been untestable by construction (R6 keeps `tests/` out of `lib/chat.ts`).
- **Both gates hold, and the pipeline never reaches past them.** `lib/chat.ts` and `lib/retrieval.ts` each call `requireUser()` first on every export; `check.mjs` R6 confirms no page, component or route imports the connection; `lib/tailoring.ts` takes no user id at all and says so in its docblock. `lib/generation.ts`, `lib/judge.ts` and `lib/budget.ts` are deliberately not `server-only` and I verified all three read no env and import nothing server-side — which is what makes 256 unit tests possible over the decisions that gate a paid revision.
- **Three retrieval outcomes survive an extraction that could easily have lost them.** `CorpusOutcome` (`coverage.ts:62-64`) has `could_not_search` only at the run level; `SearchedOutcome` cannot express it; `coverage.ts:315-319` throws `AiUnavailableError` rather than mapping a dead search onto gaps; `bestChunk` (`:396-402`) throws on a *missing* outcome and returns null only for `found_nothing`; and the new editor corpus distinguishes a genuinely empty editor (`:175-179`, every requirement honestly a gap) from a failed embed (`:188-195`) and from mis-aligned vectors (`:191-195`). The mis-alignment check is the one nobody asked for and it is the best line in the file: a wrong number is worse than no number.
- **The base gate is one function, used everywhere, and the type system enforces the render site.** `partitionMissingHonest` is `keywordPresent` — rule B1a's own boundary rule — so the judge panel and the coverage gate cannot hold two opinions about one term, and `JudgeCard`'s `terms` prop is *required*, so the raw `missingHonest` has no route to a screen. `termsOf`'s fall-back to empty rather than to the raw list is right and should stay: a missing partition means nobody checked, and "suggest none" is the only honest answer to a question that was not asked.
- **The keyword-list asymmetry is the phase's best judgement call.** A checklist in front of a writer is an instruction to fill it in; the same checklist in front of a reviewer is what it measures against. It was found by *running* the pipeline (`docs/eval/phase-4-e2e-run.txt` records the SKILLS line reading "ms office, google suite, labelbox, supervisely" against a base containing none of it), the assertion that caught it is permanent, and the fix is enforced by the party rule B4 holds accountable rather than by a politer prompt.
- **Client input is data on every path this phase adds.** `<candidate_name>`, `<resume>`, `<items>` are all tagged and all named as data in the prompts' own closing sentences; no route accepts a `role` field or a prompt fragment; `/generate`'s body is `{}` so a caller cannot substitute a corpus between the auth check and the spend; `fillPrompt`'s "never escaped, and here is why" docblock is honest about where the containment actually lives. The display name gets *both* a data block and a sanitiser, and the reason given — it is the one user value the prompts are asked to reproduce rather than to read — is the right reason.
- **`llm_calls` holds for failures.** `issue()` wraps every exit path (`chat.ts:169-193`), `logFailure` distinguishes a request that never reached the service (`cost 0`, `cost_known: true` — the honest flag) from one that was billed and returned nothing usable (`OpenRouterUsageError.usage`, priced through `costUsdMicro`), and `logEmbedCall` runs on both the success and the failure path with the run's `application_id` now threaded through. Fire-and-forget throughout; nothing about a log write can fail a user's request.
- **Privacy holds on every path I checked.** No resume, vacancy, career-item or profile content in any log line, error message or HTTP body: `parseJsonOutput` reduces Zod issues to path + code + schema-authored message specifically because an issue object carries the received value; every new `console.error` logs `err.name` only; `[coverage]` logs drop *counts* and never the dropped spans; retrieved chunks never reach the client, which is why `RESULT.insertedBullet` states the requirement and names the item rather than faking US-3's "ready-to-insert bullet" out of a chunk. `Content-Disposition` is injection-safe on both halves. No `dangerouslySetInnerHTML`; every model-authored string in `judge-card.tsx` is a React text node under a labelled heading.
- **The three UI states Block E requires are present on the new flow.** Loading: four `pending` labels plus `BusyDots` on the one action that runs for a minute, with a `prefers-reduced-motion` fallback that paints the dots rather than hiding them (`globals.css:136-142`). Empty: `RESULT.noVersionYet` with the hero, and the editor is not rendered at all before a version exists. Error: a toast per action with the server's own message and a fallback, plus the judge card's own not-run state and the version list's three-state verdict cell.
- **The e2e asserts the contract, not the model.** 401 on all four endpoints from a context with no cookie, 404-never-403 on a foreign id on all four, one-click-one-spend measured by *request count* rather than by the UI, the empty-editor refusal on all three editor endpoints, and the grounding gate against a resume claiming a Stanford PhD and a Google staff role against a base of two annotation jobs — five violations, `grounding: fail`, `atsFormat: 4`, which is the point of rule B2 being a gate. `scan.spec.ts:400-419` was updated deliberately rather than left to rot when `copyBullet` became `addToResume`.

---

**Checked:** secrets ✓ (no new env var; nothing client-accessible; no value printed) · RLS ✓ in the database, ✗ in CLAUDE.md's matrix (**B-1**) · chokepoints ✓ (`check.mjs` 13/13; `.from(` only in the eight DALs; no connection import outside the two gates; no `getSession()`; no `security definer`) · zod ✓ (every new API input, the P3 output, and the display name — with the sanitiser running before the length check) · `llm_calls` logging ✓ (chat and embed, success and failure, real usage-derived `cost_usd_micro`, `fallback_used`, `application_id` now threaded through the generate and rescore runs)

**Still open for the owner, carried forward unchanged from Phase 3:** `eu-compliance-reviewer` has not run on the Phase-2 owner-feedback round, on Phase 3, or on this phase — which adds a `profiles` table holding a person's name, a new `/privacy` paragraph about it, and a .docx export of personal data. `nextjs-security` has not run on this phase's four new route handlers. `vercel-security` owes the `maxDuration = 300` reconciliation (`p4-1`, `p3-2`) and the body-size ceiling (`p3-1`) before deploy. Block H item 9's dev-route production fence still needs its owner-run verification.

---

# 7 — WHAT HAPPENED NEXT (appended 2026-09-04; the review above is unedited)

Two rounds of owner triage closed this report. Round one took the two blockers and
two majors; round two ruled on the remaining twelve, fixing ten and carrying two.
Every item now has an outcome, and the carried ones have ids.

## 7.1 — Round one: the two blockers and two majors (SPEC v2.18)

| id | outcome | where |
|---|---|---|
| **B-1** | **FIXED** — `lib/db/profiles.ts` added to CLAUDE.md's DAL roster, and `profiles S/I/U (no DELETE — the row dies with the account through the cascade from auth.users…)` to the RLS matrix. Owner amendment | `CLAUDE.md:138`, `:146-149` |
| **B-2** | **FIXED, and it produced a finding this report did not predict** — see §7.3 | `docs/eval/phase-4-e2e-run.txt` |
| **M-1** | **FIXED in both directions, per entry.** `parse_vacancy: 1200` restored to the code (an accidental deletion; the spec was right about what the map should say); SPEC's enumeration corrected to `judge 3000` (a measured, argued raise, so the record was the stale half). Both maps are now total over a new `ChatStep`, so the next omission is a build failure rather than a silent `?? 1200` — which also makes Block F's `max_tokens: MAX_TOKENS_BY_STEP[step]` snippet literally true | `lib/openrouter/server.ts`, `lib/chat.ts`, `SPEC.md:921` |
| **M-2** | **CARRIED — `p4-27` widened** to name SPEC Block C, which reproduces `001_init.sql` verbatim including `create extension if not exists moddatetime` and therefore fails on its second line against the project it describes; and to note that Block C never gained `profiles` at all | `docs/backlog.md` |
| **M-5** | **FIXED — new rule B7a.** 100 `rescore` rows per rolling 24 h, `assertUnderRescoreCap` in the GATE rather than the route, declared in SPEC's rules table with its overshoot bound (≤6 rows, the same shape B7 carries) and the reason `embed` stays uncapped. It needed a second edit the finding did not anticipate: `editorTextCorpus`'s catch turned everything into `could_not_search` → 502, so the cap would have reported a budget decision as an outage and told the user to retry the one thing guaranteed to refuse identically. `DailyLimitError` is now rethrown ahead of that catch | `lib/retrieval.ts`, `lib/db/llmCalls.ts`, `lib/coverage.ts`, `lib/copy.ts` |

## 7.2 — Round two: the owner triage, ten fixed and two carried (SPEC v2.19)

| id | outcome | where |
|---|---|---|
| **M-3** | **FIXED** — each policy guarded by its own `pg_policies` lookup, so a second run converges instead of aborting at `42710`. The commit message had promised the whole file was re-runnable while `create table if not exists` and `drop trigger if exists` covered only the first three statements | `supabase/migrations/004_profiles.sql` |
| **M-3b** | **FIXED** — header restored in `003`'s form, carrying the "Run in the Supabase SQL editor AFTER 001 and 002" ordering instruction. A comment changes nothing a database executes, so "must match what ran byte for byte" never reached it | same |
| **M-3c** | **FIXED** — renamed `public.m004_touch_profiles_updated_at()` with `set search_path = ''`. Not `security definer`: it needs no privileges of its own, and `check.mjs` fails the build on that anywhere under `supabase/`. **APPLIED to the live database, so repo and production agree.** The old `public.touch_updated_at()` is deliberately left in place, because `001` installs `moddatetime` for the `career_items` and `applications` touch triggers and `p4-27` records the extension is unavailable here — a `drop function` would either fail on a dependency or cascade a trigger 004 never created | same |
| **M-4** | **FIXED — the sentence moved, not the behaviour.** `CLAUDE.md:9-11` now reads "…before showing it**, or says plainly that the check did not run**". The two `judge: null` branches are correct: rule B7's cap or an outage refusing the judge step returns the draft the user already paid for, with `RESULT.judgeNotRun` and both bars on "Not checked yet". Discarding it to report "nothing was saved" would take the user's money and their work | `CLAUDE.md:9-11` |
| **§4.1** | **FIXED** — `/judge` and `/export` gate on `application.coverage !== null` as `/generate` always did, so neither appends a row the detail page can never render. Not reachable through the UI, which is the argument FOR the gate: a route reachable only directly is the one whose gate has to be its own | `judge/route.ts`, `export/route.ts` |
| **§4.2** | **FIXED — the code moved to match the comment, not the comment to match a wasted request.** `retrieveItemsFor` counts `documents` first (a `head: true` count over the caller's own RLS-scoped rows, no metered call) and returns an empty payload before embedding. It costs that one read on the happy path, the honest trade in front of a pipeline whose worst case is four chat calls. Zero documents is NOT `found_nothing`: there is nothing to search, so no search runs and none is reported | `lib/tailoring.ts` |
| **§4.3** | **FIXED** — `RESULT.resumeTooShort: 'A resume needs at least 100 characters.'`, with two lower checks in declaration order: `.min(1, emptyEditor)` then `.min(100, resumeTooShort)`. All three consumers read `issues[0]`, so the emptiness check must come first for an empty editor to keep US-5's own sentence. Both outcomes AND the declaration order they depend on are pinned by two new unit tests rather than assumed | `lib/copy.ts`, `lib/validation.ts`, `tests/unit/validation.test.mjs` |
| **§4.5** | **FIXED, with a correction to the finding** — see §7.3 | `SPEC.md` endpoint #5 notes |
| **§4.6** | **FIXED — declared kept**, following Phase 3's precedent for `copyBullet` beside it. The three constants are one mechanism, a label and its two outcomes, so deleting only the middle would leave a label and a failure message for a success nobody could report | `lib/copy.ts` |
| **§4.7** | **FIXED** — `.eq('user_id', userId)` added, so the read filters on the owner AND rests on RLS: the pairing CLAUDE.md requires of `match_documents`. The id is an argument rather than a `getUser()` inside the DAL, matching `upsertDisplayName`'s stated rule — an id from anywhere but the verified session could disagree with it — and all four call sites already hold a verified user | `lib/db/profiles.ts` + 4 call sites |
| **§5.2** | **FIXED** — members checked, not only the container, and a non-string entry is dropped rather than stringified, on the same reasoning as the existing fallback: a term nobody can vouch for is not suggested. The fallback-to-empty design is kept | `result-workspace.tsx` |
| **§5.4** | **FIXED as documentation; heuristic kept.** The docblock names the all-caps company name it wrongly bolds and says why a word list is worse: it would bold EXPERIENCE and not BERUFSERFAHRUNG, while rule B10 allows a non-English posting. A shape test is wrong about one line; a word list is wrong about whole documents | `lib/docx.ts` |
| **§4.4** | **CARRIED as `p4-28`** (MINOR, owner decision). The duplication is justified and stays; the three `as` casts are the part with no defence — no-ops today, and exactly what would absorb a future divergence without a build error | `docs/backlog.md` |
| **§5.3** | **CARRIED as `p4-29`** (NIT, owner decision). Cosmetic on an append-only table, and no single-statement fix exists: `resume_versions` has no uniqueness to lean on, and adding one would forbid a legitimate re-save of unchanged text | `docs/backlog.md` |
| **§5.1** | **Already carried as `p4-13`** before this report was written; the report says so in its own text | `docs/backlog.md` |

## 7.3 — Where this report was WRONG, recorded because a review that only keeps its hits is not a record

Three corrections. None of them changes an outcome above; all three change what the
next reader should trust in a report of this kind.

- **B-2 predicted the wrong culprit, and the run found it.** The blocker was right that
  the display-name feature was unwitnessed and that `/privacy` carried the promise
  anyway. It was wrong about what stood in the way: with migration 004 applied the
  suite came back **30 passed, 2 failed**, and both failures were the same PROBE rather
  than the same feature. It read the outcome with `locator.isVisible({ timeout: 10_000 })`
  — which does not auto-wait, and whose timeout Playwright ignores — so it returned
  false the instant the click dispatched and then demanded the FAILURE copy of a save
  that had succeeded. Playwright's own error context shows `- status: Name saved.` on
  screen at the moment of the assertion. That guard could only ever pass as a SKIP, and
  applying 004 turned it red for precisely the right reason: the feature started working
  and the probe could not see it. Fixed with `.or()`; nothing in `src/` was changed to
  make those two cases pass.
- **B-2's expected number was arithmetically impossible.** It predicted "33 passed, 1
  skipped". The suite holds 33 cases in total and the prior run was 31 passed + 2
  skipped, so un-skipping one yields **32 + 1**. The prediction double-counted the case
  it was about. Recorded because the number in a spec run is the thing nobody
  re-derives.
- **§4.5 overstated its own stakes.** It claimed the endpoint-#5 notes are
  "cross-referenced by number from four files". They are not: `rescore/route.ts` and two
  SPEC lines cite **v2.12**'s notes, and `generation.ts` cites the ARCHITECT report's
  finding number. No repo file cited the endpoint-#5 numbering at all, so renumbering
  broke nothing there. What it did threaten was this report and
  `phase-4-architect-diff.md`, both of which cite the OLD "note 13" and "note 14" — and
  neither was edited, because a review is a record of what was said. SPEC's note block
  now carries the mapping (old 13→12, old 14→13, old 12→14), which is what keeps those
  two citations resolvable instead of silently wrong. The finding's stated hazard was
  real; its inventory of who was exposed to it was not.

## 7.4 — Raised while fixing, and RULED

- **`p4-30` (RULED, first item of Phase 5).** Rule B7a shipped with the defect its own
  hand-over named: `DAILY_RESCORE_LIMIT` sits beside `DAILY_CALL_LIMIT` in
  `src/lib/db/llmCalls.ts`, which imports `server-only`, and `check.mjs` R6 keeps
  `tests/` away from it — so both ceilings are untestable by construction, exactly as
  `MAX_CHAT_REQUESTS_PER_STEP` was until backlog `m-4` moved it to `lib/budget.ts`. The
  two were deliberately kept together rather than split so one became testable and the
  other did not. The owner has ruled that **both move to `lib/budget.ts` as the first
  item of Phase 5**; it is a decision, not an open question.

## 7.5 — Still open for the owner, unchanged by either round

The process gates this report listed are all still outstanding, and none of them is
something these two rounds could close: `eu-compliance-reviewer` has not run on the
Phase-2 owner-feedback round, on Phase 3, or on Phase 4 — which adds a `profiles` table
holding a person's name, a `/privacy` paragraph about it, and a .docx export of personal
data. `nextjs-security` has not run on Phase 4's four route handlers, two of which
gained a gate in round two. `vercel-security` owes the `maxDuration = 300`
reconciliation (`p4-1`, `p3-2`) and the body-size ceiling (`p3-1`) before deploy. Block
H item 9's dev-route production fence still needs its owner-run verification.

**Gates at the close of round two:** `check.mjs` 13/13 · `tsc` clean · `eslint` clean ·
unit **258/258** (two added) · `next build` compiled · Playwright **32 passed, 1
skipped, exit 0** — unchanged across the round, which is the claim worth having given
that four of the ten fixes sit in front of paid calls. `docs/eval/phase-4-e2e-run.txt`
names which cases are the evidence for which fix, and states plainly that the migration
change is not witnessed by that suite and cannot be.
