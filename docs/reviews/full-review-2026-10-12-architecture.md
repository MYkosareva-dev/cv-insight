ARCHITECTURE REVIEW: CV Insight, full codebase
Reviewer: ai-architect (read-only). Date: 2026-10-12.

VERDICT: APPROVE WITH CHANGES (the system as built). The v3.0 amendment text has to be REVISED before its implementation phase gate opens (see H2 and H3).

---

## Scope, and where it differs from what was asked

- **What was on disk was not main HEAD 14fbdee.** The working tree is branch `docs/spec-v3.0` at `abbc544` ("Specification v3.0: plans, billing, agentic retrieval"). This review has no git tooling and no checkout. I assumed `src/`, `supabase/` and `scripts/` match main, because the only commit on top of main is described as a specification commit. I did not verify that assumption.
- **There are two CLAUDE.md texts.** The CLAUDE.md on disk is the v3.0 rule book: plans, Stripe, a ninth DAL, R10 with two consumers, and agentic guardrails that are now binding. The CLAUDE.md loaded into this session's context is the older v2.x text. I checked the code against both and say which one each finding relies on.
- **Files covered:**
  - `src/`: 101 files globbed. I read every file in `src/lib/` that the brief names, plus all `/api/*` route handlers that call a gate or the DAL.
  - `scripts/check.mjs` and `supabase/migrations/001_init.sql`: read in full.
  - SPEC.md: Blocks A, C, D (function duration), F (OpenRouter and Stripe) and H read. SPEC.md is 328 KB, so Block B, Block E and the rest of Block F were only consulted for specific points.
  - `docs/` shelf: 10 root `.md` files (6 `supabase-*`, `openrouter-api`, `openrouter-processing`, `deploy`, `backlog`). I read `openrouter-api.md` and `deploy.md` in full. The other eight were checked with targeted searches for stale annotations, **not read line by line**, so "no other stale notes" applies only to those searches.
  - `docs/reviews/` and `docs/eval/` are dated records. I treated them as evidence, not as shelf documentation.
- `WORKLOG.md` and `.env*` were not opened.

## Critical

None. No chokepoint is broken, no secret reaches the client boundary, no table lacks its RLS story, and I found no path for an unauthenticated spend.

## High

**H1 [MAJOR]: The daily spend caps (rules B7 and B7a) do not hold under concurrent requests, and v3.0 opens registration on the strength of exactly these caps.**
- Evidence:
  - `src/lib/budget.ts:127-129` compares *committed* rows plus the in-request ledger.
  - `src/lib/chat.ts:136-144` reads `countCallsInLast24h()` once per step.
  - Rows are only written after the response is sent, through `after()` (`src/lib/db/llmCalls.ts:165-181`).
  - The only concurrency guard is a per-instance `Map` keyed on *application id* (`src/app/api/applications/[id]/generate/route.ts:71-84`). `/api/scan`, `/api/career/import`, `/judge` and `/rescore` have no guard at all.
  - So N parallel requests (for example `/generate` on N different applications, each worth up to 8 chat requests) all read the same committed count and all pass.
- Impact:
  - Today this is bounded only because registration is closed (`docs/deploy.md:52-59`).
  - SPEC v3.0 (`SPEC.md:3`) says "Registration OPENS on the deployment", because cost exposure "is now bounded per account by the Free plan". That plan limit would be enforced through the same non-atomic count. A hostile signed-in Free user could multiply their allowance by their parallelism.
- Direction: Make the cap a reservation, not an observation. Write a `pending` row synchronously before the request, or call an atomic per-user counter (a security-invoker SQL function using `pg_advisory_xact_lock(hashtext(auth.uid()::text))`), and settle the row afterwards. Design this into the v3.0 `currentPlan()`/`budget.ts` work. Registration must not open before this exists, with a witnessed run of parallel requests being refused.

**H2 [BLOCKER for the v3.0 implementation, not for current code]: Migration 006 as specified does not extend `llm_calls.step`, so every agentic log row would be rejected silently.**
- Evidence:
  - `SPEC.md:943` says the step vocabulary "grows by one" (`generate_agentic`) and that every agentic request writes an `llm_calls` row.
  - The column CHECK is `step in ('import_resume','parse_vacancy','generate','judge','embed','rescore')` (`supabase/migrations/001_init.sql:82`, `SPEC.md:481`).
  - Migration 006 (`SPEC.md:721-772`) never alters it.
  - `logLlmCall` is fire-and-forget and swallows the 23514 error (`src/lib/db/llmCalls.ts:174-176`).
- Impact:
  - Rule B8 stops holding for the whole Pro path, with no error anywhere.
  - `/quality` under-reports Pro spend.
  - Any plan cap that counts `llm_calls` (the B7 query keys on `CHAT_STEPS`, `llmCalls.ts:27`) never sees agentic calls, so Pro generation would be uncapped.
- Direction: Amend migration 006 to drop and recreate the step CHECK including `generate_agentic`. Add `generate_agentic` to `CHAT_STEPS`. Add a unit or e2e assertion that an agentic run leaves rows behind. This is the "a configured mechanism is not a working one" rule applied before the code is written.

**H3 [MAJOR]: The v3.0 rule book states controls as facts the build does not perform, and its text contradicts itself.**
- **CLAUDE.md now asserts mechanisms that do not exist:**
  - `CLAUDE.md:145-146` says "R10 names both; a third consumer fails the build". R10 pins only the *read site* of the key (`scripts/check.mjs:432-436`). Nothing counts importers of `lib/supabase/admin.ts`, on main or on this branch.
  - `CLAUDE.md:174-176` lists `lib/db/subscriptionEvents.ts` and says check.mjs "is driven by that list". `DAL_FILES` has eight entries (`scripts/check.mjs:84-93`), and the file does not exist.
  - `CLAUDE.md:69-75` says both gates call `currentPlan()` today. There is no `lib/plan.ts`.
- **SPEC Block H item 13 contradicts an owner decision.** It requires a Playwright test to "insert a ledger row through the service role" (`SPEC.md:1722`). SPEC v2.25 recorded the decision *not* to give a test the service-role key (`SPEC.md:1707`), and R10's scope includes `tests/` (`scripts/check.mjs:434`, `isCode` at `:199-202`). That test would be a third consumer, which the same CLAUDE.md forbids. The conflict is undeclared.
- **SPEC contradicts itself:**
  - `SPEC.md:40` has M4 = YES while `SPEC.md:78` still reads "Money does not exist in this app (M4 = NO)".
  - `SPEC.md:76` says the service role is used in "exactly one place", directly above the v3.0 note saying it has two.
- **No not-done ledger exists in the repo.** `README.md:19,368,530`, `docs/deploy.md:7-12,52-59` and `docs/backlog.md` all still describe registration as closed and v3.0 as absent. A search of `docs/**` and `README.md` for v3.0, Stripe, agentic or `subscription_events` finds nothing. CLAUDE.md's Process rule requires an amendment that is not implemented in the same branch to be listed explicitly as not done. If that list exists only in a hand-over I cannot see, it is invisible to the next agent, who reads CLAUDE.md as binding.
- Impact: A rule book naming an unreachable model put four phases of resumes on the fallback (CLAUDE.md:40-44). A rule book naming unenforced fences invites the same failure. The most dangerous single sentence is "Registration OPENS". It is a dashboard action outside the repo, and its justification (H1, H2) does not exist in code.
- Direction:
  - Before merging `docs/spec-v3.0`, add a "v3.0: specified, NOT implemented" block to `docs/backlog.md` (and README's limitations) that names each mechanism.
  - Change CLAUDE.md:145-146 to "will name both" until R10 gains an importer pin.
  - Resolve Block H item 13: either a declared R10 carve-out by owner amendment, or seed through the real webhook with the Stripe CLI.
  - Reconcile `SPEC.md:76/78` with the v3.0 notes.

## Medium

**M1: Retrying a failed scan pays for the vacancy parse again even when the parse is already stored.**
- Evidence: `rerunPlan` (`src/app/api/scan/route.ts:349-379`) only refuses when `coverage !== null`. `parseAndScore` (`:149-165`) always calls `runChatJson('parse_vacancy')`. The most common failed-draft state is a retrieval failure *after* `setVacancyParsed` (`:165`), and the detail page shows that state with the parsed requirements visible (`src/app/(app)/applications/[id]/page.tsx:183-201`).
- Impact: Each retry spends a Haiku call, and possibly its repair retry, to reproduce data already in `vacancies.parsed`. That is the metered-call waste the CLAUDE.md rules exist to prevent, and it eats B7 budget.
- Direction: In the re-run path, reuse `vacancy.parsed` when it is present and go straight to `scoreAgainstCorpus`. Only a draft with `parsed === null` should re-parse.

**M2: The repair retry never shows the model its own invalid output, so it is a blind re-roll rather than a repair.**
- Evidence:
  - `src/lib/chat.ts:337-345` appends only a user message listing the Zod issues to the *original* messages.
  - `ChatMessage` cannot express an assistant turn (`src/lib/openrouter/server.ts:167`, roles are `'system' | 'user'`).
  - The comment at `chat.ts:327-328` ("Nothing of the model's own output is echoed back to it beyond what it just produced") describes an echo that does not happen.
- Impact: The model must regenerate from scratch, guided only by issue paths. For `import_resume` (`max_tokens` 8000) that doubles the largest call in the app and makes the second attempt about as likely to fail as the first. It complies with CLAUDE.md exception (a) on paper but buys less than intended.
- Direction: Allow an `assistant` role and include the prior output, truncated, before the repair instruction. Otherwise rename the mechanism and the comment so they do not promise a repair.

**M3: The result screen's "written by" line can name a model that wrote nothing.**
- Evidence: `generationProvenance` (`src/lib/quality.ts:547-562`) takes the newest `generate` row without filtering on `ok`. Failure rows log the *attempted primary* with `fallback_used: false` (`src/lib/chat.ts:218-240`). Branch 5 of the pipeline, a failed revision after a successful first draft (`src/lib/tailoring.ts:432-444`), therefore leaves a newest row that says `openai/gpt-5.4`, no fallback, while the stored draft came from the earlier successful call.
- Impact: The one product surface built to stop silent model substitution (SPEC v2.22) can state something false.
- Direction: Filter to `ok` rows for provenance. v3.0's `resume_versions.model` fixes this per version going forward; until then, the filter is a one-line fix.

**M4: The function-duration table is incomplete, and an indexing timeout can surface as a failed save.**
- Evidence:
  - `/api/career/import` makes a chat call (8000 output tokens; worst case about 122 s with the network retry) and declares no `maxDuration` (`src/app/api/career/import/route.ts`).
  - `POST /api/career/items` declares none either, yet one request may carry 200 items (`src/lib/validation.ts:227`). That is up to 63 serial embedding batches, each with a 60 s timeout (`src/lib/retrieval.ts:325-340`, `src/lib/openrouter/server.ts:50`).
  - SPEC claims the table covers "every route that makes a chat call" (`SPEC.md:1046`), and `docs/deploy.md:90` repeats it. Five routes, not four, declare more than 60 s.
- Impact:
  - Both routes depend on an undeclared platform default.
  - If `POST /api/career/items` is killed after `insertCareerItems` (`:103-112`), the client gets a 504 for items that *were saved*. That is effectively the "indexing failed the save" outcome CLAUDE.md forbids, and the `after()` log rows are lost too.
- Direction: Declare `maxDuration` on both routes and add them to the SPEC table. Bound indexing per request with a time or batch budget; items left over get the existing non-blocking `indexWarning` and are indexed on their next edit.

**M5: Pipeline orchestration is split between `lib/tailoring.ts` and the route handlers, and the handlers repeat the same preamble.**
- Evidence:
  - `generate/route.ts:86-243` owns the lock, retrieval, two profile reads, the budget trap, persistence, `bestVersion` and the `missingHonest` partition.
  - `judge/route.ts:61-179` re-implements the same load, gate, retrieve and profile sequence.
  - The "getApplication → getVacancy → `parsed && coverage !== null` gate" appears in `generate:98-113`, `judge:68-87`, `export:71-91` and `rescore:73-84` (rescore checks only `parsed`, a small inconsistency), and again in the detail page.
  - `scan/route.ts` (436 lines) mixes multipart parsing, source resolution, row creation and orchestration.
- Impact: Every gate fix has had to be applied N times. The review history shows `/judge` and `/export` each missing the `coverage` half until v2.19. Each new step widens the drift surface, and v3.0 adds an agentic path to `/generate`.
- Direction: Add a server-only `loadAnalysedApplication(id)` returning `{ application, vacancy, parsed }` or throwing the right `ApiError`. Move generate and judge persistence and selection into `lib/tailoring.ts` (or a `lib/pipeline.ts`) so the handlers become transport only: auth, parse body, call, map errors.

**M6: Two god modules, and limits scattered across seven files.**
- Evidence:
  - `src/lib/copy.ts` (1,451 lines) holds UI strings and also behaviour switches: `AUDIT_RETENTION_VERIFIED` (`:29`), `IMPRESSUM_FILLED` (`:103`), the error-code enum (`:1378`) and a size limit, `MAX_PDF_BYTES` (`:284`).
  - `src/lib/validation.ts` (998 lines) mixes auth form schemas, API body schemas and *LLM output* schemas (`parsedVacancySchema:278`, `judgeReportSchema:899`). It is imported by six client components, so model-output schemas ship in browser bundles.
  - Limits live in `copy.ts`, `validation.ts`, `limits.ts`, `budget.ts`, `chunking.ts`, `db/documents.ts` (`MAX_DOCUMENTS`) and `db/careerItems.ts` (`MAX_CAREER_ITEMS` re-export).
- Impact: This is low cohesion, not a security issue (none of these modules reads a secret). v3.0 adds a per-plan limits table on top, so the scatter grows.
- Direction:
  - Split `validation.ts` into `validation/forms.ts` (client-safe), `validation/api.ts` and `validation/llm.ts` (server-only).
  - Move switches and limits out of `copy.ts`.
  - Make `lib/plan.ts` the single home for per-plan numbers, as CLAUDE.md:74-75 already intends.

**M7: The re-score cap depends on the step label the caller passes in, and query embeddings are logged as indexing.**
- Evidence:
  - `embedTexts` applies B7a only when the caller passes `'rescore'` (`src/lib/retrieval.ts:199-207`).
  - `matchDocuments` and `matchDocumentsForTexts` take a `step` argument and never check the cap (`:610-616`, `:661-667`).
  - Generation-time and scan-time *query* embeddings are logged as `'embed'` (`src/lib/tailoring.ts:111-116`, `src/lib/coverage.ts:109-114`), the same label as career-item indexing.
- Impact: A future caller can dodge B7a by passing `'embed'`. `/quality` cannot separate indexing spend from matching spend. This is the "a fence a caller has to remember" pattern `retrieval.ts:168-170` itself warns against.
- Direction: Replace the `step` parameter with intent-named exports (`embedForRescore`, `matchForScan`, `indexItems`) that fix both the label and the fence inside the gate. Consider a distinct `match` step in a future migration; the step CHECK has to change in 006 anyway (H2).

**M8: The v3.0 design places the agentic loop inside the completions gate.**
- Evidence:
  - CLAUDE.md:324 (on disk) says "The loop is a `while` in `lib/chat.ts`".
  - SPEC:148-149 and :179-180 have `lib/retrieval.ts` executing `search_career_base`.
  - `lib/chat.ts` is currently a clean gate: auth, cap, retry budget, logging.
- Impact: The gate becomes an orchestrator that calls the other gate (a chat → retrieval dependency), owns tool-transcript assembly and item resolution, and grows past its single responsibility. The pipeline orchestrator (`lib/tailoring.ts`) would be bypassed for the Pro path, creating a second orchestration home.
- Direction: Owner amendment. Keep the round budget arithmetic (`MAX_TOOL_ROUNDS`, `MAX_SEARCH_CALLS`) and the per-round `getUser()`/`currentPlan()` in a gate primitive, for example `runChatRound()` in `lib/chat.ts`, and put the `while` loop in `lib/tailoring.ts` or a new `lib/agentic.ts`. The guardrails still hold, because every round still leaves through the gate.

## Low

**L1: Two definitions of "the career base as text", despite a comment saying there is one.**
- `careerBaseText` (`src/app/api/scan/route.ts:434-436`) is byte-identical to `itemsCorpus` (`src/lib/generation.ts:145-147`).
- The first feeds rule B1's lexical gate; the second feeds `partitionMissingHonest`. That is two implementations answering the same "is this term in the base" question.
- `scan/route.ts:430-433` says "Two spellings of 'the base as text' would be two things to keep in step."
- Direction: Have the scan route use `itemsCorpus`.

**L2: About 17 stale "Sonnet" annotations in shipped code describe a model that never served** (SPEC v2.23):
- `tailoring.ts:195,251,466`; `prompts.ts:90,231`; `generate/route.ts:31,130`; `result-workspace.tsx:46`; `resume-editor.tsx:367`; `applications/[id]/page.tsx:110`; `quality.ts:508`; `copy.ts:679,770`; `profiles.ts:64,189`; `judge.ts:116`.
- `prompts.ts:13` still says "Phase 0: templates only."
- Direction: Replace "Sonnet" with "the generator" so model swaps stop staling comments.

**L3: Stale `docs/` shelf annotations** (CLAUDE.md requires shelf notes to describe this project):
- `docs/openrouter-api.md:36`: the price list names Sonnet 4.6 and omits `openai/gpt-5.4`. `SPEC.md:1465` has the same gap.
- `docs/openrouter-api.md:83`: places `MAX_CHAT_REQUESTS_PER_STEP` in `lib/chat.ts`. It lives in `src/lib/budget.ts:27`; chat.ts only re-exports it.
- `docs/supabase-signin-signout.md:207-208`: "the sign-out button in `/settings`". It is in the app shell (`src/app/(app)/layout.tsx:37`, moved in v2.20).
- `docs/supabase-signin-signout.md:100-104` and `:199-204`: "reaches exactly one caller". This is accurate for the code but contradicts the on-disk CLAUDE.md:142-146 (two consumers). Settle it together with H3.
- `docs/deploy.md:90`: see M4.
- R13 cannot catch any of these: every backticked path resolves, and the claims around them are what went stale. This is R13's declared limit (`scripts/check.mjs:551-554`).

**L4: SPEC Block A drift.**
- The repository layout omits `src/app/impressum/page.tsx`, which exists.
- It still promises `tests/e2e/privacy.spec.ts` "in Phase 7" (`SPEC.md:254`, `playwright.config.ts:6`), while `SPEC.md:1709` records that the test remains unwritten.

**L5: `fillPrompt` substitutes slots one after another** (`src/lib/prompts.ts:296-300`).
- A value containing `{{otherSlot}}` is itself rewritten on a later pass.
- Closing tags such as `</vacancy>` or `</items>` in vacancy, resume or item text are not neutralised, while contact fields are (SPEC v2.20).
- This is a declared choice; the inconsistency is not.
- Direction: Use a single-pass `replace(/\{\{(\w+)\}\}/g, …)`.

**L6: Each request pays for several Auth round trips.**
- `requireApiUser()` plus one `getUser()` per gate entry means a single `/generate` makes about 6 Auth round trips and 4 cap count queries (`chat.ts:261-262,317-318`; `retrieval.ts:616`). The full base is also re-read per request (`scan/route.ts:399,422`; `generate/route.ts:233`; `judge/route.ts:174`).
- This is acceptable at this scale and is the cost of the deliberate no-userId gate design (`retrieval.ts:35-42`). Note it before v3.0 adds a `currentPlan()` query per gate entry.

**L7: Double submits can double-spend on `/judge` and on a draft re-run.**
- There is no lock on `/judge` or on a draft re-run through `/api/scan`; only client-side reference guards exist. `/generate`'s lock is per instance (declared as `p4-4`).
- Direction: Fold this into H1's reservation mechanism rather than adding more in-memory maps.

**L8: Verify the middleware file name against Next.js 16.**
- `src/middleware.ts` is pinned by R11 (`scripts/check.mjs:103`). Next 16 introduced a rename of middleware to proxy. If the deprecated name is still in use, the rename has to move R11's pin with it.
- I did not verify this against the installed Next version's docs.

**L9: Two known check.mjs gaps are still open.**
- R6 does not detect re-export laundering of the connection module (`docs/reviews/phase-0.md:120`). Nothing exploits it today: `chat.ts:81` re-exports only a type.
- R10 does not pin importers of `admin.ts` (see H3).

## Deviations needing a SPEC/CLAUDE amendment

1. SPEC Block C migration 006 must extend the `llm_calls.step` CHECK to include `generate_agentic` (H2).
2. SPEC Block H item 13's service-role-in-a-test conflicts with SPEC v2.25 (`SPEC.md:1707`), R10's `tests/` scope and CLAUDE.md's "exactly two consumers". It needs either an owner carve-out or a different seeding method (H3).
3. CLAUDE.md:145-146 ("a third consumer fails the build") and CLAUDE.md:174-176 (a nine-entry DAL list that check.mjs is "driven by") describe enforcement that does not exist yet. Either reword them as future tense or implement them in the same branch (H3).
4. The "Registration OPENS" decision in the SPEC v3.0 header should be gated on H1 and H2 being implemented and witnessed. It needs an explicit not-done entry until then (H1/H3).
5. `SPEC.md:76` and `:78` contradict v3.0 (M4, service-role count) (H3).
6. The SPEC function-duration table must add `/api/career/import` and `/api/career/items` (M4).
7. Proposed: move the agentic `while` loop out of `lib/chat.ts` into the orchestrator, keeping budgets in the gate (M8; changes CLAUDE.md:324).

## What's done well

- **The model-call chokepoint holds.**
  - Only `src/lib/openrouter/server.ts:350,465` calls OpenRouter's `fetch`.
  - The only importers of the connection are the two gates (`chat.ts:20`, `retrieval.ts:24`).
  - Every exported gate function calls `getUser()` first (`chat.ts:261,317`; `retrieval.ts:204,313,369,485,616,667`).
  - `OpenRouterError` never escapes a gate.
  - R5 and R6 enforce this at prebuild.
  - Route handlers, pages and components reach model calls only through gates or orchestrators. No client component imports a server module beyond `copy`, `validation`, `limits`, `scoring`, `judge`, types, or a Server Action.
- **The data access boundary holds.** Every `.from(` and `.rpc(` in `src/` is inside the eight listed DALs. Every DAL imports `server-only`. RLS is the fence, `match_documents` is security invoker, and R3 forbids security definer.
- **Retrieval's three outcomes are enforced by types, not convention.**
  - `BatchMatchOutcome` (`retrieval.ts:113-115`) and `CorpusOutcome` (`coverage.ts:63-65`) make `could_not_search` unrepresentable per query.
  - `coverage.ts:334-338` turns it into `AiUnavailableError`.
  - The detail page renders three distinct result states (`applications/[id]/page.tsx:30-38`).
  - The B7a refusal travels as 429, not as an outage (`coverage.ts:199-208`).
- **The metered retry budget is real code.** There is one shared budget per step (`chat.ts:161-171`); the network retry fires only on transport errors (`server.ts:305-318`); embeddings get no retry and no fallback; billed-but-empty responses are logged at their true cost (`server.ts:249-270`).
- **Index safety.** Re-indexing embeds before it deletes (`retrieval.ts:362-407`), and batches never split an item (`retrieval.ts:253-271`).
- **Privacy at the type level.** `ModelResumeText` is a branded type, so a contact block cannot reach a model without a compile error. Error bodies and logs carry metadata only (`errors.ts:144-153`, `server.ts:362-373`).
- **Model and token maps are total over `ChatStep`** (`server.ts:110-154`), so the next missing step is a build failure rather than a silent default.
- **Limitations are declared, not hidden.** The per-instance lock, cap overshoot bounds, CSP cost and the fallback history are all written down where the next reader will find them.
