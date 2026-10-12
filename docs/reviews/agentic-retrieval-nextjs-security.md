# nextjs-security — feature/agentic-retrieval, scoped audit — 2026-10-12

Saved verbatim. Scope: src/lib/agentic.ts, src/lib/retrievalLog.ts, src/lib/chat.ts, src/lib/retrieval.ts, src/app/api/applications/[id]/generate/route.ts, and the `Research` component in src/components/applications/resume-editor.tsx. Questions: can the model's tool call reach anything other than the caller's own rows; can the loop be made to spend beyond its arithmetic budgets.

---

nextjs-security — scoped audit, branch `feature/agentic-retrieval`

**VERDICT: PASS for Question 1 (isolation). CONDITIONAL PASS for Question 2 (budgets): one MAJOR finding should be fixed before merge.**

Boundary map: gates ✓ (both gates call `getUser()` then `currentPlan()` before any spend), server-only imports ✓ (`chat.ts`, `retrieval.ts`, the route, `openrouter/server.ts` and the DALs all have them; `agentic.ts` and `retrievalLog.ts` are pure, and the client imports only `retrievalLog`), middleware coverage: not in scope. The route checks the user itself through `requireApiUser` → `getUser()`.

Scope: the six files named in the task, read in full. I followed calls into `openrouter/server.ts`, `prompts.ts`, `db/documents.ts`, `db/careerItems.ts`, `budget.ts`, `tailoring.ts`, `db/resumeVersions.ts`, and migrations 001, 006 and 007. I did not run `npm run build` or the unit tests: this was a reading audit. I read no `.env*` file and not WORKLOG.md.

---

## Question 1 — Can the model's tool call reach anything other than the caller's own rows?

**Answer: No.** Evidence:

- **Tool schema has one parameter.** `src/lib/prompts.ts:254-267` declares only `query: string`, `required: ['query']`, `additionalProperties: false`. There is no user id, item id, limit or filter. The declaration is built on the server and passed in at `src/lib/chat.ts:546`; no client value reaches it.
- **Argument parsing.** `src/lib/agentic.ts:142-155` (`queryOf`):
  - Returns null if the tool name is wrong or the JSON is invalid.
  - Reads only `.query`, requires a string, trims it and cuts it to `MAX_SEARCH_QUERY_CHARS` (500).
  - Ignores any other key, so even an extra key the provider lets through cannot become an id, limit or filter.
- **How the query reaches the database.** `src/lib/chat.ts:602` calls `searchCareerBase(query, args.applicationId)`. `applicationId` is the route's UUID, already read under the caller's own session (`route.ts:131,146`), and is used only to attribute `llm_calls` rows. Then:
  - `src/lib/retrieval.ts` `searchCareerBase` runs `requireMember()` itself (`getUser` → `currentPlan`) and refuses off-plan.
  - It calls `matchDocuments(query, AGENTIC_SEARCH_LIMIT, 'embed', applicationId)`. The match count is a server constant (6, `budget.ts`).
  - `matchDocuments` (`retrieval.ts:637-668`) embeds the query and calls the documents DAL, `src/lib/db/documents.ts:106-117`. The RPC uses the cookie-session `createClient()`, not the admin client.
- **`match_documents` is filtered twice.** `supabase/migrations/001_init.sql:134-143`:
  - It is a plain `language sql` function with no `security definer`, so it defaults to security invoker, and R3 forbids `definer` anywhere under `supabase/`.
  - It filters `where d.user_id = auth.uid()` inside the function.
  - RLS on `documents` is enabled with an owner-only select policy (`001_init.sql:105-123`).
- **Chunk ids resolve to rows under RLS.** `src/lib/db/careerItems.ts:63-69` (`listCareerItemsByIds`) uses the session client. `career_items` select RLS is `auth.uid() = user_id`. The ids come from rows that were already owner-filtered, so this is a second fence.
- **What the model gets back.** `src/lib/agentic.ts:158-163,262-267`: type/title/period/content of the caller's own items, plus three counters. No ids, no `user_id`, no similarity details beyond the log.
- **Prompt injection** through vacancy text (third-party authored) or career-item text can only change which query strings the model sends. Every query is still scoped by `auth.uid()` plus RLS, so the worst injection chooses which of the caller's own items come back.
- **Log and client exposure.**
  - `retrievalLog.ts:21-30`: each entry holds the query, counts, best score and item titles, never chunk text or item content.
  - Item titles come from `result.items`, which are the caller's own RLS-scoped rows (`agentic.ts:256`).
  - The log is stored on the caller's own `resume_versions` row and returned only to that caller (`route.ts:290`).
- **Research component** (`src/components/applications/resume-editor.tsx:458-500`): renders only React text nodes (`{RESULT.researchQuery(entry.query)}`, `{title}`, copy strings). No `dangerouslySetInnerHTML` anywhere in `src/` (grep: one hit, a comment in `result-tabs.tsx:349`). It shows no chunk text and no item content: the log has none to show. It imports only `@/lib/retrievalLog` (no imports) and `@/lib/copy`; `@/lib/quality` and `@/lib/db/types` are `import type` only, so nothing server-side reaches the client bundle.

### Question 1 findings

- **[NOTE] `src/lib/agentic.ts:267`** (and the existing `tailoring.ts:190-198`) — `JSON.stringify` does not escape `<` or `>`. A career item whose text contains `</items>` can close the tagged data block early in the tool message, as it already can in P2/P3. This crosses no account: tool results only ever hold the caller's own items. → Fix (hardening, both sites): escape `<` as `\u003c` in the JSON put inside `<items>`, e.g. `.replace(/</g, '\\u003c')`.
- **[MINOR] `src/lib/retrieval.ts`, `searchCareerBase` development log** (`console.log(\`[retrieval] agentic search ${JSON.stringify(query)} …\`)`) — prints the model-written query verbatim. The query often paraphrases vacancy or career-item content. This is development only (`NODE_ENV === 'development'`), but CLAUDE.md's acceptance log allows titles and scores per chunk and says to log metadata only, never content. → Fix: print `query.length` plus the round/search index instead of the query text. The query is already kept in `retrieval_log`, which is where it belongs.

---

## Question 2 — Can the loop be made to spend beyond its arithmetic budgets?

**Answer: Not in metered requests.** Every count is enforced in code, and I found no way past them. One MAJOR issue: a paid run can still be lost to a 500, because one part of the log has no size bound.

What holds:

- **MAX_TOOL_ROUNDS = 4** is enforced in two places:
  - The loop's `for (round = 1; round <= MAX_TOOL_ROUNDS)` (`agentic.ts:270`).
  - `issueToolRound`'s own `LoopBudget` (`chat.ts:535`), which refuses a fifth request even if the loop were wrong.
  - The last round is sent with `tool_choice: 'none'` (`agentic.ts:274,278`). Tool calls on a closing round end the loop (`agentic.ts:314`) instead of being executed.
- **MAX_SEARCH_CALLS = 6 with parallel calls.** Calls are answered one at a time in a `for…of` with `await`, never `Promise.all` (`agentic.ts:319-322`). `searches` is incremented before the search runs (`agentic.ts:214`) and checked first (`agentic.ts:209`). Each search is one `embed` request (`embedFor` with one input). A round after the budget is spent becomes the closing round (`agentic.ts:274`).
- **Deadline.** `pastDeadline()` can only refuse a search or make the next round the closing one (`agentic.ts:210,274`). It never adds a request.
- **No retries inside the loop.** `issueToolRound` makes one call to `chatCompletionWithTools` with no retry wrapper (`chat.ts:541-569`). The connection makes a single `fetch` (`openrouter/server.ts`, `chatCompletionWithTools`); the fallback model is OpenRouter's `models` routing inside that same request. Errors become `RoundFailedError`, which ends the loop (`agentic.ts:280`). Other errors propagate instead of being silently swallowed.
- **Fall-through writer, judge and revision.** These go through `runChat` / `runChatJson` with `MAX_CHAT_REQUESTS_PER_STEP = 2` each. The declared worst case is 4 + 4×2 = 12 (`budget.ts`, `MAX_CHAT_REQUESTS_PER_GENERATE_BY_PATH`). `route.ts:222-233` re-checks the ledger total after the run as a defect trap.
- **Grant cannot be forged.**
  - `GenerateGrant` has a `#private` brand and only its type is exported (`chat.ts:177-191`).
  - `assertStepAllowed` requires an `isGrant` check for `generate` and additionally `path === 'agentic'` for `generate_agentic` (`chat.ts:281-292`).
  - `runAgenticGenerate` re-runs `requireMember()` and that check before the loop (`chat.ts:593-594`).
- **Free cannot reach the agentic path by direct POST.** It is blocked three times:
  - `authorizeGenerate` returns 403 before the lock or any spend (`chat.ts:223-225`, `route.ts:142`).
  - The grant path check (`chat.ts:289`).
  - `searchCareerBase`'s own plan check.
- **Request body.** `z.strictObject({ mode: z.enum([...]).optional() })` (`route.ts:107`): an unknown key is a 400, so no `role`, prompt fragment, model name or user id can be sent. The read happens after `requireApiUser()` (`route.ts:126,133`).
- **In-flight lock.** Taken after the cheap refusals and before the first spend, released in `finally`, TTL 300 s ≥ `maxDuration` (`route.ts:83-99,165,297`). It is per instance; that is declared in the comment at `route.ts:85-91` and not a new issue.
- **B7 daily ceiling placement.**
  - Checked at admission (`chat.ts:226`) and once before the loop with the ledger (`chat.ts:296`), but not per round. This is declared (`chat.ts:577-579`), so the overshoot is at most MAX_TOOL_ROUNDS − 1 = 3 above the cap.
  - Judge and revision re-check with the ledger and degrade to "check did not run" (`tailoring.ts:630-633`).

### Question 2 findings

- **[MAJOR] `src/lib/agentic.ts:190-209` together with `supabase/migrations/006_subscription_events.sql` (the `retrieval_log` 64 KB CHECK) and `src/lib/budget.ts` (comment on `MAX_SEARCH_QUERY_CHARS`).**
  - **The defect.** Refused tool calls each get a log entry, and the number of tool calls per round has no limit. Budget and deadline refusals store the query (up to 500 chars). Invalid-argument refusals store about 120 bytes each.
  - **Rough sizes (estimates, not measured).** With `max_tokens: 2500` per round (`openrouter/server.ts`, `MAX_TOKENS_BY_STEP.generate_agentic`):
    - Rounds 1–3 can each emit hundreds of minimal `search_career_base({})` calls. About 10 tokens per call gives roughly 250 per round, 750 entries, about 94 KB.
    - Or about 19 calls per round with 500-char queries, refused for budget: about 36 KB ASCII, and more with multi-byte text, on top of the six real searches. Six searches with six 200-char titles each can alone reach about 41 KB in 4-byte UTF-8.
  - **Why it matters.** The `budget.ts` comment says six queries plus titles is "a few kilobytes". That is true only for executed searches, not refused ones. Instructions injected into a pasted job posting (third-party text) can trigger the flood.
  - **Impact.** The run spends its full budget (loop rounds, judge, possibly revision and second judge). Then `insertResumeVersion` (`route.ts:243` → `db/resumeVersions.ts`) hits the CHECK, and `apiErrorResponse` returns 500 SERVER_ERROR. Nothing is saved, and the paid run is lost. Spend does not exceed the declared ceiling, but its whole value is destroyed. It is the "unbounded log growth turning a paid run into a 500" case the task asked about.
  - **Fix**, in this order:
    1. Cap the calls answered per round. Answer at most `MAX_SEARCH_CALLS` calls per round with a full log entry. Further calls still get a refused `tool` message, so the transcript stays well-formed, but they are not logged one by one: one entry per round carries a `refusedCount`, or the refusals are counted on the next entry.
    2. Store `''` instead of the query for `budget` and `deadline` refusals, matching what `invalid_arguments` already does. The Research section only needs to show that a refusal happened.
    3. Before insert, add a byte-size guard in `tailoring.ts` or the route, e.g. `new TextEncoder().encode(JSON.stringify(log)).length`. If the log is too big, truncate it to the executed searches and add a terminal `{ ended: 'log_truncated' }` entry, so a version is still saved.
    4. Add a unit test in `tests/unit/agentic.test.mjs`: a stub model returning 300 calls per round must produce a log under 64 KB.
- **[MINOR] `src/lib/tailoring.ts`, `agenticFirstDraft` (the `round_error` → `generateResume` fall-through) together with `src/lib/chat.ts:296`.**
  - **The defect.** The fall-through writer is a `generate` step, so `assertStepAllowed` re-runs `assertUnderTotalCap(plan, ledger)` with the loop's rounds already in `ledger.chat`.
  - **Example.** A Pro user at cap − 1 committed calls is admitted. Round 1 is billed and round 2 errors. The fall-through writer is then refused with DailyLimitError. Nothing catches it on the first-draft path, so the response is 429 after paid rounds, with no version saved.
  - **Why it matters.** This contradicts the stated reason for checking once per step (`chat.ts:231-237`: "the cap decides whether a step may start, not whether it may finish"). The fall-through belongs to the agentic step that was already admitted. Spend stays bounded; the problem is lost work and a misleading status.
  - **Fix.** Either let the fall-through writer skip the total-cap re-check when it carries an agentic grant (it is still capped at 2 requests), or require headroom for the loop's worst case at admission: `committed + ledger.chat + MAX_TOOL_ROUNDS + MAX_CHAT_REQUESTS_PER_STEP <= limit`. The second option also removes the declared overshoot of up to 3.
- **[NOTE] `src/lib/chat.ts:177-191`.** The brand cannot be forged by an object literal or by importing the class. However, code that already holds a `single` grant could write `new (grant.constructor as any)('agentic')` and get a branded agentic grant. That needs deliberate in-repo code, and `searchCareerBase` re-checks the plan anyway, so this is defence in depth only. → Optional fix: make the constructor check a module-private token argument, e.g. `constructor(token: typeof ISSUE, path)` with `const ISSUE = Symbol()` not exported, or freeze `GenerateGrant.prototype.constructor`.
- **[NOTE] `src/lib/retrieval.ts`, `searchCareerBase`.** A `PlanRequiredError` or `UnauthorizedError` thrown mid-loop (plan lapsed or session expired between admission and a search) is not a `RoundFailedError`, so it propagates as 403/401 after billed rounds. This is correct for the refusal itself, and the window is narrow. No change needed. Recorded so the behaviour is a known one.
- **[NOTE] `src/lib/retrievalLog.ts:8-9`.** The comment says "the plan module can load a server-only DAL", but `src/lib/plan.ts:1` imports only a type. This is harmless and the conclusion (log shape kept in a module with no imports) still holds. → Reword or drop the sentence.

---

## Verdicts

- **Question 1, isolation: PASS.** The tool has one parameter, parsing keeps only `query`, the server sets the limit, the identity comes from the session, `match_documents` is security invoker with an `auth.uid()` filter plus RLS on `documents`, and ids resolve to `career_items` under RLS. The client sees only its own titles and queries, rendered as text nodes. Two hardening items: one MINOR (development log prints the query) and one NOTE (`</items>` escaping).
- **Question 2, budgets: CONDITIONAL PASS.** The counts for rounds, searches, retries, per-step caps, grant, plan and body all hold in code. Fix before merge: the MAJOR above (no bound on refused-call log entries can exceed the 64 KB `retrieval_log` CHECK and turn a fully paid run into a 500). The MINOR (fall-through writer refused by the daily ceiling after paid rounds) can follow.

Files referenced (absolute):
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\agentic.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\retrievalLog.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\chat.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\retrieval.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\budget.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\tailoring.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\prompts.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\openrouter\server.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\documents.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\careerItems.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\resumeVersions.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\applications\[id]\generate\route.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\applications\resume-editor.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\001_init.sql
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\007_agentic_step.sql
