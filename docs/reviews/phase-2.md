# Phase 2 — ai-code-reviewer report

**Branch:** `phase-2-career-base` (16 commits ahead of `main`) · **Date:** 2026-09-03
**Scope:** `git diff main...HEAD` — 33 files, +4030/−103. SPEC v2.10 (US-1, Blocks C/D/E/F/G), CLAUDE.md as amended 2026-09-03.

**VERDICT: REQUEST CHANGES** — one BLOCKER (a gate invariant that CLAUDE.md states unconditionally is not true of two exported gate functions). Everything else is a backlog item. No secret exposure, no chokepoint breach, no RLS change, no `.from(`/`.rpc(` outside `lib/db`.

**Gates run on this branch, quoted:**
- `node scripts/check.mjs` → `check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree.`
- `npm test` → `tests 101 · pass 101 · fail 0`
- `npx tsc --noEmit` → clean · `npm run build` → compiled, TypeScript clean, 14/14 pages, `ƒ Proxy (Middleware)` wired.
- Secrets inspected by NAME only (`grep -o '^[A-Z_]*' .env.example` → `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); every recursive search excluded `.env*`. No new environment variable is introduced by this diff, so `.env.example` needed no change.

---

## BLOCKER

**B-1 — Two exported functions of the embeddings gate spend metered calls without calling `getUser()`.**
`src/lib/retrieval.ts:212` (`indexCareerItems(userId, items)`) and `src/lib/retrieval.ts:260` (`reindexCareerItem(userId, item)`).

Both are public exports of the gate, both reach OpenRouter through the private `embedFor()` (`src/lib/retrieval.ts:126`), and neither calls `requireUser()`. They take the user id as an **argument** and trust it. Only `embedTexts()` and `matchDocuments()` verify anything.

CLAUDE.md, "AI model calls", is unconditional: *"Every OpenRouter call goes through a GATE module (each marked `server-only`), which calls `getUser()` first and refuses without a verified user. … This chokepoint is what keeps an anonymous POST from spending money."* It also singles out this exact spend as the reason `lib/retrieval.ts` exists separately: *"`lib/retrieval.ts` also guards spends that happen as a SIDE EFFECT of saving a career item."* The gate's own header comment (`src/lib/retrieval.ts:28`) repeats the claim — *"the gate calls getUser() FIRST"* — which is now false for the two functions that actually do the indexing.

Why it matters even though it is not exploitable today: both current callers (`src/app/api/career/items/route.ts:38`, `src/app/api/career/items/[id]/route.ts:29`) do call `requireApiUser()` first, so there is no live anonymous path. But the protection has moved out of the chokepoint and into the discipline of every future caller, which is precisely the arrangement the rule replaces. The failure mode is also asymmetric: RLS refuses the `documents` insert for a foreign `user_id`, but the **paid embedding call has already gone out** by then (`embedFor` runs before `insertDocuments`), and `indexCareerItems` catches the write error and counts it as a failed item — money spent, nothing logged as anomalous. Note too that this codebase already accepts a second `getUser()` on the same request (`/api/career/import` calls `requireApiUser()` and then `runChatJson` → `requireUser()`), so there is no cost argument for the current shape.

**Fix (small, local to `lib/retrieval.ts`):** call `requireUser()` at the top of both exported functions and derive the id from the verified user; keep the private `embedFor(userId, …)` core for internal use. If a caller must still pass an id, assert `user.id === userId` and throw `UnauthorizedError` on mismatch — an argument that disagrees with the session is a bug either way. Update the two doc comments so the "getUser() FIRST" claim is true of the whole module.

---

## MAJOR

*(Backlog by the branch's own rule. **M-1 and M-2 are the two I would promote to blocker** if this branch is meant to ship US-1 as SPEC describes it: M-1 makes a guarantee SPEC v2.10 declares explicitly unreachable, and M-2 leaves a metered button double-clickable.)*

**M-1 — The truncation notice can never be displayed; SPEC's "said out loud" guarantee ships silent.**
`src/components/career/import-resume-dialog.tsx:81-91` (`receive`), against `src/app/api/career/import/route.ts:67-72`.

The server sets `notice` correctly: `data.items.length === 0 ? CAREER.noItemsFound : truncated ? CAREER.truncated : null`. The client sets `notice` **only** in the `items.length === 0` branch and returns; the `items.length > 0` path calls `setItems(...)` / `setPhase('review')` and never touches `notice` (which `importFrom` had just cleared at line 96). So `CAREER.truncated` — the one case where truncation actually happened and items exist — is dropped on the floor.

That is the exact defect the copy was created to prevent. SPEC v2.10 (Block F, new copy constants) and `src/lib/copy.ts:181-187` both argue the case: *"silently dropping part of someone's career history is the same defect the chunker refuses when it merges overflow instead of discarding it"*. As built, a 40,000-character CV imports its first half and the user is told nothing.

**Fix:** in `receive`, `setNotice(payload.notice)` unconditionally before the phase switch, and keep the existing `?? CAREER.noItemsFound` fallback for the empty case. The `notice` paragraph at line 273 already renders in both phases, so no layout change is needed. Add an assertion to `career.spec.ts` on a >20,000-character paste.

**M-2 — The Edit dialog's pending state never engages: no loading state, and a double-click buys two re-embeds.**
`src/components/career/career-item-card.tsx:91` and `98-124`.

`const [pending, startTransition] = useTransition()` — but the `fetch(PATCH)` at line 106 is awaited **outside** any transition, and `startTransition` is only reached at line 123, after the dialog has already closed. `isPending` is therefore `false` for the entire request. Consequences:

- Block E's mandatory Loading state is absent on this surface: `disabled={pending}` (line 175) never disables, and `{pending ? CAREER.saving : CAREER.save}` (line 176) never shows "Saving…". The component's own doc comment at line 77 claims *"its own three states: idle, saving (button label and disabled inputs), and error"* — two of three are real.
- A double-click issues two PATCHes. Each one that changes `title`/`content` triggers `reindexCareerItem`, i.e. **two paid embedding calls and two delete-then-insert cycles** for one user intention. This is not one of the two owner-approved retry exceptions; it is an unguarded duplicate submit on a metered path.

The import dialog in the same feature does this correctly with explicit `setPending(true)` / `finally { setPending(false) }` (`import-resume-dialog.tsx:94-116`).

**Fix:** replace `useTransition` with the same explicit `useState` pending used by the import dialog — set it before the fetch, clear it in `finally` — and keep `startTransition(() => router.refresh())` for the refresh only.

**M-3 — A malformed `[id]` answers 500 SERVER_ERROR where Block D mandates 404.**
`src/app/api/career/items/[id]/route.ts:30` (PATCH) and `:90` (DELETE).

The route segment is never validated. `getCareerItem('abc')` → `.eq('id','abc')` against a `uuid` column → PostgREST returns `22P02 invalid input syntax for type uuid`, the DAL throws (`careerItems.ts:45`), and `apiErrorResponse` maps an unrecognised throw to a generic 500. Block D's table gives 404 for *"Row absent OR owned by another user (never reveal which)"* and reserves 500 for *"Unexpected failure after validation and auth"* — a client-supplied id that is not a UUID is neither absent-row nor unexpected. The handler's own comment (line 22) promises *"user B acting on user A's item matches zero rows and the answer is 404"*, which holds for a well-formed foreign UUID and not for a malformed one. Not an information leak of consequence (the caller already knows the id it sent is malformed), but it is a Block D contract break and it will produce noisy 500s in `/quality`-adjacent logs.

**Fix:** parse the segment with `z.string().uuid()` immediately after `requireApiUser()` in both verbs and throw `NotFoundError()` on failure — 404 keeps the "never reveal which" property and needs no new status row.

**M-4 — Rule B9 says "block import"; the import endpoint checks no cap and spends a metered call first.**
`src/app/api/career/import/route.ts:44-59`, and `src/components/career/import-resume-dialog.tsx:203-292`.

B9 (SPEC Block F): *"≤200 career_items and ≤500 documents rows per user → block import with 'Career base limit reached (200 items). …'"*. The cap is enforced only in `POST /api/career/items` (`assertUnderB9`, `items/route.ts:118`). A user already at 200 items can open the dialog, upload, spend an `import_resume` Haiku call at `max_tokens: 8000`, review the proposals, and only then be refused — repeatedly, at will, until B7's 50/day cap stops them. The UI shows `CAREER.limitReached` only once `selected.length > remaining` (line 288), i.e. after the money is gone.

This also contradicts the handler's own stated ordering principle (`import/route.ts:26-28`): *"cheapest and most protective checks first, so that nothing spends money or reaches a model until it has earned the right to."* A `count` head query is the cheapest check in the file.

**Fix:** call `countCareerItems()` (and, if you want the same symmetry as the save path, `countDocuments()`) after `requireApiUser()` and before `runChatJson`, throwing `CAREER.limitReached` / `ERROR_MESSAGES.DOCUMENT_LIMIT`. Additionally disable the `[Import resume]` trigger with the same copy when `itemCount >= MAX_CAREER_ITEMS` — the dialog already receives `itemCount`.

---

## MINOR

**m-1 — SPEC's declared B7 overshoot bound is understated by one.**
SPEC v2.10 states: *"Every Phase-2 request makes exactly ONE chat call, so nothing passes a ledger yet and the overshoot is zero by call count."* But one *step* can issue two metered requests (the shared retry budget), and `issue()` writes an `llm_calls` row for each of them (`src/lib/chat.ts:151-179`, `logFailure` at `:189`), while `assertUnderDailyCap` runs once before the step (`:239`, `:295`). Starting from 49 committed rows, one import can commit 51. The code is deliberate and correct — SPEC itself argues that refusing a repair retry after taking the user's money would be worse — but the *number* in the declaration is wrong, and this repo treats a declared bound as load-bearing. **Fix:** restate as "zero by user-initiated step; at most +1 per step that spends its second request", in both SPEC and the `CallLedger` doc block.

**m-2 — Two Zod bounds have no message, so raw Zod text is rendered as user-facing copy.**
`src/lib/validation.ts:139` (`.max(MAX_IMPORT_TEXT_CHARS)`) and `:92` (`period: … .max(120)`). Both client components render the API message verbatim (`setError(payload?.error?.message ?? …)`), so a 20,001-character paste surfaces "Too big: expected string to have <=20000 characters" inside the dialog — a string that exists in no SPEC block and in no `lib/copy.ts` constant, in the app's own voice. The `period` case is worse: `fieldErrorsForItem` only maps `title` and `content` (`validation.ts:241`), so a too-long period passes the client gate silently and comes back as that raw message with no field attached. **Fix:** give both bounds constants in `lib/copy.ts`, and extend `ItemFieldErrors` to cover `period`.

**m-3 — The 5 MB promise and the size check do not survive the deploy target.**
`src/app/api/career/import/route.ts:87-98`, `src/lib/copy.ts:118`. Two things: (a) the comment at line 97 says the check refuses an oversized upload *"without ever materialising it as bytes"*, but `await request.formData()` on line 88 has already consumed and buffered the whole body — only `arrayBuffer()` is avoided, and the honest pre-check is `Content-Length`; (b) Vercel's serverless request-body limit is 4.5 MB, below `MAX_PDF_BYTES = 5 MB`, so a 4.6 MB PDF — inside the documented range — is refused by the platform with a non-canonical error, the client's `res.json()` parse fails, and the dialog shows the generic `CAREER.importFailed` rather than "This file is over 5 MB." (edge case L5's exact copy). **Fix:** check `Content-Length` before `formData()`, correct the comment, and reconcile the advertised ceiling with the platform limit before deploy (a task for the vercel-security gate, but the copy is decided here).

**m-4 — Load-bearing pure logic that node:test could import is untested; the branch's most consequential invariant cannot be tested where it lives.**
The two new suites are good (see below), but: `importedResumeText`'s truncation boundary and `isPdfUpload` are pure, non-`server-only`, and untested; `indexWarningFor` (the three-state warning, `items/route.ts:94`) is pure but lives inside a route file, so it is untestable by construction. Most importantly, **the retry budget — "they cap, they never multiply" — has no test**, because `MAX_CHAT_REQUESTS_PER_STEP` and the `Budget` threading live in `server-only` `lib/chat.ts`. That is the same argument that (correctly) moved the price table into `lib/pricing.ts`; it applies with more force to arithmetic that decides how much money one submit can spend. **Fix:** extract `indexWarningFor` into `lib/copy.ts` or a small pure module and test it; extract the budget/ledger arithmetic into a pure `lib/callBudget.ts` that `chat.ts` consumes, and pin "two requests maximum, in either order of exception" with a test.

**m-5 — S6 is asserted nowhere.**
`tests/e2e/career.spec.ts` covers S4 (401 on all four verbs) very well, but the cross-user 404 is cited as the reason for a design decision in three separate places (`careerItems.ts:86`, `errors.ts:54`, `items/[id]/route.ts:22`) and SPEC lists S6 explicitly — with no test. The suite also never exercises D3's `indexWarning` or the `notice` path (which would have caught M-1). **Fix:** add a two-account test that PATCHes and DELETEs user A's item id as user B and asserts 404 + `NOT_FOUND`.

**m-6 — Stale annotations about the test suite.**
`playwright.config.ts:5` still reads *"pulled into Phase 1 for `tests/e2e/auth.spec.ts` only … The rest of the suite lands in Phase 7"*, and SPEC Block A's repo layout still enumerates `tests/e2e/` as *"auth.spec.ts, scan.spec.ts, privacy.spec.ts"*. `career.spec.ts` now ships and appears in neither. This is the stale-annotation class CLAUDE.md's docs/ rule names ("an instruction to the next agent to do the wrong thing"), and Block H item 3's green-suite list is now incomplete. **Fix:** update both lines in the same commit as any fix on this branch.

---

## NIT

- **n-1** `extractedItemSchema.period` is `.nullable()` but not `.optional()` (`validation.ts:92`), so a model that omits the key rather than emitting `null` fails validation and burns the one repair retry on a formatting nit. `.nullish()` with a `?? null` transform spends one metered call instead of two.
- **n-2** `EditDialog` seeds its fields from `useState(item.title)` and is never re-keyed (`career-item-card.tsx:92-94`), so cancelling an edit and re-opening shows the abandoned draft instead of the stored row.
- **n-3** `batchByItem` puts an item with more than `EMBEDDING_BATCH_SIZE` chunks alone in a batch, and `embedFor` then splits it across two requests (`retrieval.ts:128,171`) — defeating the "a batch never splits an item" invariant that the three-state `indexWarning` copy rests on. Unreachable while `MAX_CHUNKS_PER_ITEM = 2`, but the "must fail loudly if the constant changes" argument used for `DOCUMENT_LIMIT` applies here too; an explicit throw or an assertion would keep it honest.
- **n-4** `await res.json()` results are walked untyped in both client components (`payload?.error?.message`, `payload?.items?.length`). No banned `any` appears anywhere in `src/` (verified), and TS strict passes, but a shared `parseApiError(payload)` would keep the Block D shape in one place instead of four.
- **n-5** `career.spec.ts:275` asserts `getByText(\`${firstCount} item\`)`, which is substring matching — "1 item" also matches "11 items". Use an exact/regex matcher.
- **n-6** `fillPrompt` inserts user text verbatim (`prompts.ts:118`), so a CV literally containing `</resume>` closes the data block. S1's design (data tags + Zod on the output) is the accepted containment and the comment defends non-escaping correctly, but stripping the closing tag from interpolated values costs nothing and removes the only cheap way to break out.
- **n-7** `assertUnderB9` maps both ceilings to 400 `VALIDATION_ERROR`. Defensible (Block D has no capacity row) and the copy is exact, but a limit is not a malformed body; worth a line in SPEC if it stays.

---

## What the diff gets right

Recording this because it is the part a later reviewer should not re-litigate.

- **Secrets and the server/client boundary are clean.** `OPENROUTER_API_KEY` is read in exactly one place (`openrouter/server.ts:214`), inside a `server-only` module, and never appears in a log, an error message, a commit message or an HTTP body. No `NEXT_PUBLIC_` on anything secret, no new env var, `.env*` excluded from every search here. `npm run build` succeeding proves no `server-only` module reached a client bundle — the client components import `lib/validation`, `lib/copy`, `lib/limits` and `import type` from `lib/db/types`, which is exactly why `limits.ts` and `pricing.ts` were placed outside `lib/db/` and outside the connection.
- **The chokepoint holds where it is enforced.** Both OpenRouter endpoints are spoken to only from the connection; R5/R6 pass; `chat.ts` and `retrieval.ts` are the only importers; `OpenRouterError` deliberately never escapes the gates, so no handler is ever tempted to import the connection to `instanceof` it. The reasoning for logging `llm_calls` in the gates rather than the connection (`user_id` is NOT NULL and the connection has no identity) is correct and well argued.
- **Auth on every new verb, and 404-not-403.** `requireApiUser()` is line one of all four verbs, before body parsing and before any count query, and the e2e spec asserts all four return 401 with the canonical Block D code — the right thing to test, since middleware excludes `/api` by design and these lines are the only fence. `getUser()` everywhere; `getSession()` appears nowhere in `src/` except in comments explaining why not.
- **RLS untouched and least-privilege intact.** No migration changed, no policy added, no table added. `documents` still has no UPDATE policy and `reindexCareerItem` is delete-then-insert; `DELETE /items/[id]` relies on the FK cascade and makes no embedding call.
- **The re-index ordering fix is the standout piece of engineering in this branch.** Embedding *before* deleting (`retrieval.ts:260-294`) is what makes `CAREER.indexWarning` ("search index will update on next edit") a true statement instead of a lie: the naive order leaves an item with zero `documents` rows on a failed paid call, which later renders as a "gap" — the app reporting a finding about data it never searched. The `docs/supabase-pgvector.md` annotation captures the reasoning for the next reader.
- **B7's counter is an argument, not ambient state, and the mechanism was measured rather than trusted.** The `cache()` probe returning `n = 0` is exactly the "a configured mechanism is not a working one" discipline applied to the reviewer's own convenience. The retry budget genuinely does not multiply: I traced all four orderings through `runChatJson`/`runChatWithin`/`issue` and no path issues a third HTTP request.
- **Three-outcome discipline is applied consistently and for the right reason** — retrieval's `found` / `found_nothing` / `could_not_search`, and `indexWarning`'s saved-and-searchable / not-searchable / partly-searchable, with the copy actually differing per state instead of a boolean reporting one state as another.
- **The two new unit suites pin real properties, not shapes.** `chunking.test.mjs` asserts the title survives in *every* chunk, that no paragraph is ever dropped by the cap (the silent-failure case), that a 4,000-character single paragraph never splits mid-word, and — best of all — `MAX_CAREER_ITEMS * MAX_CHUNKS_PER_ITEM <= MAX_DOCUMENTS` as an executable statement of B9's self-consistency, so the reconciliation cannot rot. `pricing.test.mjs` pins the bare-model-id bug that a live run found, `Math.ceil` over `Math.round` (a sub-micro call must not read as free), exact-match precedence over the normalized fallback, and that in/out rates are not swapped.
- **Privacy holds on every path I checked.** No resume or vacancy content in any log line, error message or HTTP body: the OpenRouter 4xx body is deliberately unread because it echoes the prompt; Zod issues are reduced to path/code/message before logging; `unpdf` errors are logged as `err.name` only; the dev retrieval log prints the item title and a score and never chunk text — which is only possible *because* the title is stored in every chunk. No `dangerouslySetInnerHTML` anywhere; all user and LLM text renders as text nodes.
- **Block E's three states are present on `/career`,** with `loading.tsx` as a Suspense fallback (correctly, since an awaited Server Component has no `loading === true` moment), the exact empty-state copy, and inline-in-dialog import errors. Copy is verbatim where SPEC specifies it, the pluralised `reviewHeading(n)` / `saveToBase(n)` reproduce SPEC's own "Review 14 extracted items" / "Save 14 items to base", and the e2e spec asserts the strings rather than the ids. The `AI_UNAVAILABLE` split from `SCAN.aiUnavailable` (which promises "Your vacancy was saved" — false on an import) is the kind of copy honesty this SPEC keeps asking for.
- **The e2e spec builds its own PDFs with correct xref offsets** rather than committing binaries, so the no-text-layer fixture is provably a PDF with no text operators instead of a file someone hopes is one — and it states plainly what its indexing assertion can and cannot see rather than overclaiming.

**Checked:** secrets ✓ · RLS ✓ (unchanged, least-privilege intact) · chokepoints ✓ (`check.mjs` 13/13; gate *invariant* ✗ — see B-1) · zod ✓ (every new API input and the P4 JSON output) · llm_calls logging ✓ (success, failure, and billed-but-empty, with real usage-derived micro-USD and `fallback_used`)

---

# Addendum — owner-feedback round, ai-architect re-review (2026-09-03)

Branch `phase-2-career-base`, reviewing the code as built for SPEC v2.11: the
`imports` table and provenance, the exact-duplicate guard, the named-import flow,
and the M-2 in-flight locks. Two owner-reported defects from first live use were
the trigger — re-importing the same text produced exact duplicates, and career
items carried no provenance.

## Verdict

**REVISE** — one BLOCKER (a /privacy data-category omission), 7 majors, 7 minors.

The gate's own summary: *"Chokepoints, the DAL boundary and the new table's RLS
story are the strongest part of this round: `imports` ships with all four required
parts (DAL `src/lib/db/imports.ts`, `DAL_FILES` line at `scripts/check.mjs:91`,
S/I/U policies at `supabase/migrations/003_imports.sql:41-44`, SPEC Block C entry),
no new file touches the connection, and nothing new reads a secret. The defects
below are elsewhere: one user-facing privacy claim, several undeclared consequences
of the dedup key, and evidence that tests a different button than the one that was
fixed."*

On the four design questions it was asked:

- **The dedup guard** is correctly ordered — dedup → B9 → `imports` row → items,
  server-side against RLS-scoped rows, first-occurrence-wins, in-batch and stored
  both covered. Its flaws are that it discards a moved `period` invisibly, that it
  depends on model determinism it cannot guarantee, and that its skips are counted
  without being named.
- **The provenance model is sound.** `ON DELETE SET NULL` plus no DELETE policy
  plus a nullable column plus chip-only-when-set, and `patchCareerItemSchema`
  gives the client no vocabulary for `import_id` — so no item can claim a source
  it did not come from. The soft spot is non-unique run names.
- **"Resume N"** cannot skip through the arithmetic, but it can through an
  orphaned run row, and it disagrees with storage after any rename.
- **The ref locks are the right mechanism** and are sufficient against a double
  click on both buttons. The remaining unasked spend is the cancelled-edit draft;
  cross-tab replay is unguarded server-side.
- **No CLAUDE.md chokepoint, gate, embedding, retrieval, DAL, RLS or check.mjs
  rule is broken by this diff.** The violations are the privacy disclosure and
  the evidence rules.

## Disposition

Fixed on this branch:

- **BLOCKER** — `/privacy` listed what is stored as though the list were
  exhaustive and omitted the category this round created: the run name and target
  role the user types, i.e. a stated job aspiration, stored per account. Added to
  the page and to SPEC's `/privacy` content enumeration. This one had to be fixed
  rather than filed: it is a false statement about personal data, on a page whose
  Phase-1 scope is "accurate now".
- The erasure story counted **six owned tables while seven exist** — US-6's
  checkbox, edge case G1, Block H item 6's RLS matrix, the account-deletion
  route's comment and `lib/db/types.ts`. My migration created the seventh and
  updated none of them.
- The **dedup guard's real bound is now declared** in `lib/dedupe.ts` and SPEC:
  the keys are built from model output, not from the document, so re-importing one
  file is an exact duplicate only while the model re-emits identical prose —
  `temperature: 0` makes that normal, not guaranteed, and a fallback-served
  re-parse can defeat it. The guard also makes a save retry idempotent, which was
  worth writing down.
- **Dead code removed** — `countImports()` was unused and its comment described a
  mechanism the app does not use.
- **Backlog hygiene** — M-1 and M-2 were closed by this round but still listed as
  open with prescriptions that no longer matched the code.

Backlogged as `a-1` … `a-6` and `e-1` … `e-4` in `docs/backlog.md`: the silently
discarded `period` change, the four evidence gaps (duplicate-case assertion, the
Edit-save lock, `CAREER.truncated`, target-role end to end), the pre-dedup B9
headroom warning, the non-transactional import+items sequence, run-name
collisions, and the concurrent-save race.

## Open owner action

The gate asks for **eu-compliance-reviewer** on this round, since it touches
personal data. This round's instruction was to run ai-architect only, so it has
not been run. The /privacy wording is corrected; the review is not done.
