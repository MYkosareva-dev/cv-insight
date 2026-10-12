# AI Code Review — full-codebase quality & conformance — main — 2026-10-12

**Scope note.** The brief named main HEAD as `14fbdee`. `main` actually points to `9db0798` ("Merge repository baseline"), whose only change on top of `14fbdee` is `CAP_afa.md`. The checked-out branch `docs/spec-v3.0` differs from main only in `CLAUDE.md` and `SPEC.md`. So `src/`, `supabase/`, `scripts/` and `tests/` are byte-identical across all three commits, and I reviewed the working tree. I checked conformance against **main's** `CLAUDE.md`/`SPEC.md` (via `git show main:…`), not the v3.0 drafts on the branch. Tracked scope: 5 migrations, 3 scripts, 18 unit/e2e specs, 98 files under `src/`. The review was read-only and the tree is clean (`git status --short` is empty). I did not open WORKLOG.md or any `.env*` file; `.env.example` was read for variable names only.

Verdict: **REVISE**. There are no Critical findings and no secret exposure. There is one High privacy fail-open, and a few Medium correctness/SPEC-copy defects.

## Tooling results
- `npm run check`: **passed (13 rules)**. Quote: "check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree."
- `npm test`: **382 tests, 69 suites, 382 pass, 0 fail**, about 19.7 s.
- `npx tsc --noEmit`: exit 0. `npx eslint`: exit 0, no output.
- Playwright e2e (`npm run test:e2e`): **not run**, because it needs a live server and a Supabase project.

---

## Critical
None.

## High

### H1. The contact-header strip fails open when the profile read fails, so contact details reach OpenRouter on /judge and /rescore
- `src/lib/db/profiles.ts:201-211`:
  ```ts
  export async function getContacts(userId: string): Promise<ResumeContacts> {
    try { return contactsOf(await getProfile(userId)); }
    catch (err) { … return EMPTY_CONTACTS; }
  ```
- `src/lib/resumeHeader.ts:267-269`:
  ```ts
  const values = contactValues(contacts);
  if (values.length === 0) return content;
  ```
- Consumers: `src/app/api/applications/[id]/judge/route.ts:135-140` (`resumeTextForModel(parsed.data.content, contacts)` goes into P3), and `src/app/api/applications/[id]/rescore/route.ts:114-123` (the same text is embedded).
- **Why it matters.** CLAUDE.md (Privacy) says contact fields "reach no model call on any path — enforced by the type". The `ModelResumeText` brand does prove the strip function was called. But if the profile read fails transiently, `getContacts` returns `EMPTY_CONTACTS` and the strip becomes a no-op. The editor text, whose stored version carries the header inline, then goes to OpenRouter unchanged and the brand is satisfied. The "never throws" rationale in the docblock ("a run the user has already paid … must not be lost") is valid for **adding** the header after a paid generate. It does not apply to /judge and /rescore, where nothing has been spent yet.
- **Fix.** Add a throwing reader, e.g. `getContactsStrict(userId)` (or let callers use `getProfile` directly), for every path whose output goes to a model, and fail closed (502/500 before any spend) when it throws. Keep the lenient `getContacts` only for header insertion in `generateWithJudge` and for the export warning. Add a unit test asserting that a strip performed with unknown contacts cannot produce `ModelResumeText`. One way to get that is for `resumeTextForModel` to take a `KnownContacts` brand that only the strict reader returns.

## Medium

### M1. The strip only removes header lines made of the *current* profile values, so a header with outdated values still goes to the model
- `src/lib/resumeHeader.ts:239-244`:
  ```ts
  function isContactOnlyLine(line: string, values: readonly string[]): boolean {
    …
    for (const value of values) rest = rest.split(value).join('');
    return rest.replace(HEADER_GLUE, '').length === 0;
  ```
- **Why it matters.** The header is written into `resume_versions` at generate time. Two scenarios leave a stored header the strip does not recognise:
  - The user later changes their phone or email in Settings. The old header line no longer consists only of current values, so it is not stripped and the old phone/email goes to P3 and the `rescore` embeddings.
  - The user clears all contacts. `values` is then empty and the function returns early.

  Both headers are text the **app** inserted, which is exactly what the file says it guarantees to remove ("the app stops ADDING contact details to a model payload").
- **Fix.** Also strip structurally: in the header region (lines before the first blank line after the name line, which is where `withContactHeader` inserts), drop any line that matches an email, phone, `https://` URL or `Open to remote` pattern, regardless of the current profile. Add tests for "profile changed after generation" and "profile cleared after generation".

### M2. `fillPrompt` treats user data as a replacement *pattern*, and re-substitutes slots inside earlier values
- `src/lib/prompts.ts:296-301`:
  ```ts
  return Object.entries(values).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, value),
    template,
  );
  ```
- **Evidence (reproduced in the scratchpad with this exact function).**
  - Input `resumeText: "Budget $$5k; see $' here"` produced `"<resume>Budget $5k; see </resume> NAME <candidate_name>Mira</candidate_name> END here</resume> …"`. `$$` collapsed to `$`, and `$'` spliced the rest of the template, including a closing `</resume>` tag, into the data block.
  - Input `resumeText: "x {{candidateName}} y"` produced `"x Mira y"`: a later key substituted inside an earlier value.
- **Why it matters.** This silently corrupts vacancy, resume and career-item text, and it lets ordinary input break the tagged-block containment that CLAUDE.md's "Client input is DATA" rule relies on. Inputs affected: P1 vacancy, P3 editor text, P4 import, and `<items>` JSON containing `$'`, `` $` `` or `$&`. The docblock asserts "The value is inserted verbatim", which is false.
- **Fix.** Do a single pass over the template only, with a function replacer:
  ```ts
  template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m))
  ```
  Add unit tests for `$'`, `$$`, `$&` and `{{otherKey}}` inside a value.

### M3. `PATCH`/`DELETE /api/career/items/[id]` return 500 rather than 404 for a non-UUID id
- `src/app/api/career/items/[id]/route.ts:29-30` and `:89-90`: `const { id } = await params;` goes straight to `getCareerItem(id)` / `deleteCareerItem(id)`, with no shape check.
- Every other `[id]` route has `if (!z.uuid().safeParse(id).success) throw new NotFoundError();` (applications routes at `route.ts:38`, `generate:94`, `judge:66`, `rescore:71`, `export:69`). `src/app/api/applications/[id]/route.ts:26-28` even says the check was "raised against the career endpoints and closed here rather than repeated" — but the career endpoints never got it.
- **Why it matters.** `invalid input syntax for type uuid` is thrown as a PostgREST error, and `apiErrorResponse` maps it to 500 SERVER_ERROR. SPEC Block D requires 404 NOT_FOUND for absent rows.
- **Fix.** Add the same `z.uuid()` guard as the first line after `requireApiUser()` in both verbs, and an e2e assertion for `/api/career/items/nope`.

### M4. Model failures on /generate and /judge return the generic copy instead of SPEC's endpoint copy
- `src/app/api/applications/[id]/generate/route.ts:163-170`: `generateWithJudge(...)` lets the first generate step's `AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE)` ("AI service is unavailable. Try again.") propagate.
- `src/app/api/applications/[id]/judge/route.ts:137-144`: `judgeResume(...)` does the same.
- The client shows the server's message when there is one: `result-workspace.tsx:229-230`, `toast.error(payload?.error?.message ?? fallbackMessage)`.
- **Why it matters.** SPEC N2 says "generate: banner (US-4)", and US-4 step 5 gives the banner copy as "Generation failed — nothing was saved. Try again." The Block E table gives [Check quality] → toast "Quality check failed — try again." Today those strings only appear when retrieval fails (`retrieveItemsFor(..., RESULT.generationFailed)`) or the response is not JSON. `/api/scan` already does this correctly (`scan/route.ts:207`, which re-throws with `SCAN.aiUnavailable`).
- **Fix.** Wrap the pipeline call in each route with `catch (err) { if (err instanceof AiUnavailableError) throw new AiUnavailableError(RESULT.generationFailed /* or qualityCheckFailed */); throw err; }`.

### M5. `fallback_used` is computed by an id comparison that does not do what its docblock claims
- `src/lib/openrouter/server.ts:276-278` says: "a routing suffix (`…haiku-4.5:beta`, a dated snapshot) is the SAME model serving, not the fallback".
- `src/lib/pricing.ts:51-55`:
  ```ts
  const withoutSuffix = model.split(':')[0] ?? model;
  const segments = withoutSuffix.split('/');
  return (segments[segments.length - 1] ?? withoutSuffix).toLowerCase();
  ```
  Only a `:suffix` is removed. A served id like `openai/gpt-5.4-2026-03-05` normalises to `gpt-5.4-2026-03-05`, which is not equal to `gpt-5.4`.
- **Why it matters.** CLAUDE.md requires `llm_calls` to record "whether the fallback was used". With a dated snapshot, a primary-served call would be logged `fallback_used=true`. The product would then show the red "written by the FALLBACK model" warning (`copy.ts` `writtenByFallback`) on a correct run, and `/quality`'s fallback rate would read 100%.
- **Fix.** Define fallback positively, since there is exactly one fallback model:
  ```ts
  isFallback = normalizeModelId(served) === normalizeModelId(FALLBACK_MODEL)
  ```
  Optionally also strip a trailing `-\d{4}-\d{2}-\d{2}` / `-\d{8}` in `normalizeModelId`, which also fixes the matching `cost_known=false` miss. Add unit cases to `pricing.test.mjs`.

## Low

### L1. A missing `OPENROUTER_API_KEY` is classified as a retryable network error
- In `src/lib/openrouter/server.ts:349-358`, `authHeaders()` is evaluated inside the `try` around `fetch` (`headers: authHeaders()`). Its `throw new Error('OPENROUTER_API_KEY is not set')` is therefore caught by `asRetryable(...)`, which returns `retryable: true` with message `'request failed'`.
- **Effect.** The chat gate sleeps 2 s, makes a second attempt, and writes two `ok=false` rows mislabelled as network failures. No money is spent, but the log hides a configuration fault.
- **Fix.** Compute `const headers = authHeaders();` before the `try` in both `chatCompletion` and `createEmbeddings`.

### L2. A billed 200 whose body is not JSON is logged at zero cost
- `server.ts:376-387` throws a plain `OpenRouterError` (not an `OpenRouterUsageError`), so `logFailure` writes `tokens=0, cost=0, cost_known=true`.
- This is a rare path, but it contradicts the file's own "billed and empty carries real usage" principle.
- **Fix.** Log it with `cost_known=false`, which is honest because usage is unknowable.

### L3. `DELETE /api/account` bypasses the canonical error mapper
- `src/app/api/account/route.ts:44-49`: `if (isApiError(err)) {…} throw err;` lets a non-`ApiError` thrown from `getUser()` escape as Next's HTML 500.
- `deleteUser` at `:62` is outside any `try`, so a network throw there escapes the same way.
- **Fix.** Wrap the body in `try { … } catch (err) { return apiErrorResponse(err); }`, keeping `SETTINGS.deleteFailed` for the known-failure branches.

### L4. DRY: route preambles are copy-pasted across handlers
- **The uuid → application → vacancy → "parsed and coverage" gate** is repeated in `generate/route.ts:91-113`, `judge/route.ts:65-87`, `export/route.ts:68-91` and `rescore/route.ts:70-84`. Rescore omits the coverage half. That may be intentional, but it is exactly the drift a shared helper prevents.
  - **Fix:** `loadAnalysedApplication(id, { requireCoverage })` in a server-only module.
- **The JSON body → `safeParse` → `ValidationError(issues[0]?.message ?? fallback)` pattern** appears in about 8 handlers.
  - **Fix:** `parseJsonBody(request, schema, fallbackMessage)`.
- **Multipart PDF intake** is duplicated between `scan/route.ts:259-291` and `career/import/route.ts:97-129`: Content-Length precheck, `instanceof File`, `isPdfUpload`, `file.size`, `arrayBuffer`, `extractPdfText`. Only the copy constants differ.
  - **Fix:** `readPdfUpload(request, { notPdf, tooLarge })`.

### L5. DRY inside the gates
- `requireUser()` has the same body in `src/lib/chat.ts:69-73`, `src/lib/retrieval.ts:67-71` and `src/lib/auth/requireApiUser.ts:23-27`. The gates can import `requireApiUser`, keeping the call-first discipline.
- The row → `MatchedChunk` mapping plus the found/found_nothing decision is duplicated at `retrieval.ts:631-640` and `:681-690`.
  - **Fix:** a private `toSearchedOutcome(rows)`.

### L6. Duplicate `Rubric`/`JudgeReport` types, bridged by casts
- `src/lib/judge.ts:29-36` and `src/lib/db/types.ts:269-276` are field-for-field identical. Bridging them takes three casts: `tailoring.ts:295` (`withComputedVerdict(data as Rubric) as JudgeReport`), `:409` and `:413` (`judge as Rubric`).
- The casts would hide a future divergence between the Zod output and either type.
- **Fix.** Use `export type Rubric = JudgeReport` (or derive both from `z.output<typeof judgeReportSchema>`) and delete the casts.

### L7. `getLatestResumeVersion` reads every version to keep one
- `src/lib/db/resumeVersions.ts`: `const versions = await listResumeVersions(applicationId); return versions[0] ?? null;`. This pulls up to N × 15,000 characters of resume text on every export.
- **Fix.** `.order('created_at', { ascending: false }).limit(1).maybeSingle()`.

### L8. Stale annotations that tell the next reader the wrong thing
- **"Sonnet" as the generator.** The generator is `openai/gpt-5.4` since SPEC v2.23, but comments still say Sonnet: `generate/route.ts:31` ("generate (P2, Sonnet)"), `:130`; `tailoring.ts:195`, `:251-252` ("Haiku reviews what Sonnet wrote"), `:466`; `prompts.ts:90`, `:231`; `judge.ts:116`; `profiles.ts:64`, `:189`; `result-workspace.tsx:46`; `copy.ts:679`. The historical mentions in `openrouter/server.ts`, `pricing.ts` and the v2.22 provenance blocks are fine.
- **`coverage-probe/route.ts:64-68` and `:113-117`.** These say "`/quality` is Phase 6" (it exists: `src/app/(app)/quality/`) and "`embed` rows carry `application_id: null` by design". Scan, generate and rescore have passed it since v2.16.
- **`supabase/migrations/001_init.sql:128-131`.** This says linter hardening is "DEFERRED to a future 003 migration". SPEC v2.20 renumbered it to `006`, and 003 is `imports`.
- **Fix:** reword these to match the current state.

### L9. Two identical DAL readers
- `listRecentLlmCalls` and `listLlmCallsForQuality` (`src/lib/db/llmCalls.ts:31-40`, `:70-81`) have the same body and differ only in the default limit.
- The docblock justifies keeping two names. That is fine, but one can delegate to the other: `listLlmCallsForQuality = (limit = QUALITY_CALL_WINDOW) => listRecentLlmCalls(limit)`.

## Nit
- **N1. Unused binding.** `src/app/api/career/import/route.ts:46,65` has `const user = await requireApiUser(); … void user;`. Use `await requireApiUser();` and drop the `void`.
- **N2. Orphaned or stacked JSDoc blocks.**
  - `career/import/route.ts:78-92`: the block describing `readResumeText` sits above `MAX_IMPORT_BODY_BYTES`, directly followed by a second block.
  - `openrouter/server.ts:73-74`: a one-line `/** Primary model per step… */` is immediately followed by another docblock.
- **N3. Dead export.** `src/lib/coverage.ts:423-424` (`export const DEFAULT_AI_UNAVAILABLE = ERROR_MESSAGES.AI_UNAVAILABLE;`) has zero references, and its docblock describes a caller that does not exist. Delete it along with the `ERROR_MESSAGES` import.
- **N4. Misleading repair-retry comment.** `src/lib/chat.ts:327-328` says "Nothing of the model's own output is echoed back to it beyond what it just produced", but the repair request includes **none** of the prior output (`ChatMessage` has no `assistant` role). The model regenerates from scratch with only the issue list. Reword the comment. Optionally include the prior output as an assistant turn so the repair is an edit rather than a re-roll.
- **N5. Inconsistent error logging.** `logLlmCall` (`llmCalls.ts:175`, `:179`) and `account/route.ts:85` log the raw error object. Everywhere else logs `{ name }` only. No content leaks today (the `llm_calls` row is metadata), but it breaks the house rule.
- **N6. `titleOf` can truncate a title.** `chunking.ts:141` splits on the first `"\n\n"`, but `validation.ts:97` allows interior newlines in `title`. A title containing a blank line is truncated in coverage attribution and the dev log. Normalise or refuse newlines in titles.

---

## Conformance checklist (main's CLAUDE.md)
- **Gates:** ✓. `lib/chat.ts` and `lib/retrieval.ts` both import `server-only` and call `getUser()` first in every export. The two indexers refuse rather than throw. No route imports the connection (R6 passes).
- **Shared retry budget, no nesting:** ✓. `issue()` refuses at `budget.spent >= MAX_CHAT_REQUESTS_PER_STEP`, and `runChatJson` checks the same budget before the repair, so the network retry and the repair retry cannot multiply. Embeddings never retry. The B7 cap is checked once per step, plus a ledger across /generate.
- **DAL-only `.from()`:** ✓ (R1 passes; a manual grep found only comment mentions outside `lib/db`).
- **Three retrieval outcomes:** ✓. `could_not_search` exists only at the run level in `BatchMatchOutcome`. `coverage.ts:334-338` turns it into a 502. `editorTextCorpus` lets the B7a `DailyLimitError` through as a 429 rather than reporting it as an outage. `retrieveItemsFor` refuses on zero documents before spending.
- **Fire-and-forget `llm_calls`:** ✓. Writes go through `after()`, and both the registration and the insert are wrapped in try/catch. Failure rows carry the attempted model, latency and billed usage when known.
- **Embed after save:** ✓. `career/items/route.ts:103-115` inserts, then `indexCareerItems`, which never throws; partial index failure gives the three-state warning copy.
- **Delete-then-insert re-embedding:** ✓. `reindexCareerItem` embeds first, then deletes and inserts. It is skipped unless title or content changed (`[id]/route.ts:70-71`). There is no upsert on `documents`.
- **Profile strip type:** **partial.** The brand is correctly required at both model sinks, but see H1 (fails open) and M1 (outdated values).
- **RLS matrix:** ✓. Matches CLAUDE.md exactly (`001_init.sql:107-112`, `003:42-44`, `004:70-86`). `match_documents` is invoker with `where d.user_id = auth.uid()`.
- **Secrets:** ✓. Only the two allowed `NEXT_PUBLIC_` names appear in `src/`. `.env.example` lists the four names. No secret values were seen or printed.

## What's done well
- The gate/connection split is real, not cosmetic: `OpenRouterError` never escapes a gate, the connection writes no log rows, and R5/R6 enforce the boundary in prebuild.
- The retry budget is arithmetic in code, with a defect trap (`withinBudget` against `MAX_CHAT_REQUESTS_PER_GENERATE`) and unit tests in `lib/budget.ts`.
- Retrieval is honest by construction. The batch outcome type makes "gap because search died" impossible to express, and both re-index paths embed before deleting.
- The embeddings connection asserts vector count, dimensionality and index uniqueness before anything is stored.
- Privacy hygiene in logging is consistent nearly everywhere: errors log `name` only, Zod issues are reduced to path and code before logging, and OpenRouter 4xx bodies are never read.
- Error handling is uniform: one `ApiError` hierarchy, one `apiErrorResponse`, generic 500s, and 404-not-403 on foreign rows throughout.
- The test suite is broad (382 passing unit tests covering budget, pricing, scoring, judge, header composition, validation and the check rules), and typecheck plus lint are both clean.
