# ai-architect — feature/agentic-retrieval, phase gate BEFORE implementation

Date: 2026-10-12 · Scope: SPEC v3.0 agentic retrieval (owner brief items 1–6). Saved verbatim.

---

ai-architect: phase-gate review of feature/agentic-retrieval (before implementation)

Plan reviewed: C:\Users\Margo\AppData\Local\Temp\claude\d--Claude-BAI-3-sprint-mkosar-AFA-BAI-3-8\83519d3b-9b52-4d59-8f41-cdd381282dd7\scratchpad\agentic-plan.md
Sources read: SPEC.md (only the sections named in the task: §5 v3.0 note at 948–957, Block E v3.0 at 1212–1217, B7/B11/B12 at 1377–1383, the M-block v3.0 tool-calling note at 1497, L6–L9 at 1682–1685, DoD 10–17 at 1748–1755); CLAUDE.md in full; src/lib/chat.ts, budget.ts, plan.ts, tailoring.ts, generation.ts, retrieval.ts, openrouter/server.ts, quality.ts (parts), db/llmCalls.ts (parts), copy.ts:1261; src/app/api/applications/[id]/generate/route.ts; supabase/migrations/001_init.sql:82, 006_subscription_events.sql:57–64; docs/eval/tool-calling-probe.md.
Scope check: supabase/migrations/ contains 001–006 (six files), so 007 is the next free number. The probe file exists and names gpt-5.4, which meets DoD 10's precondition.

```
VERDICT: APPROVE WITH CHANGES
```
There are no BLOCKERs. Nothing in the plan breaks a chokepoint, adds a table, moves a secret toward the client or deviates silently. The plan is still not ready to code as written. Six MAJOR findings (2–7 below) would each ship a CLAUDE.md rule break or a B7 hole, and two of them have to be settled before merge: the A3 amendment to CLAUDE.md, which only the owner can make, and migration 007, which has to be applied and witnessed. Fold in the changes below, then implement.

---

## Rulings requested

### A1: `llm_calls.step` CHECK is missing 'generate_agentic': AGREED, migration 007 required (with changes)
The diagnosis is correct. 001_init.sql:82 would refuse every agentic row, and because `logLlmCall` is fire-and-forget the loss would be silent. B8 and DoD 14 would both be false without anyone seeing it. Corrections to the proposal:
- Drop the constraint by its explicit name and leave out `if exists`: `alter table llm_calls drop constraint llm_calls_step_check; alter table llm_calls add constraint llm_calls_step_check check (step in ('import_resume','parse_vacancy','generate','judge','embed','rescore','generate_agentic'));`. Postgres names an inline column CHECK `<table>_<column>_check`. With `if exists`, a wrong name turns the drop into a silent no-op, and the old CHECK keeps refusing the new value. That is the exact failure 007 is meant to fix, moved to a different place. A loud error is better. The DO-block lookup is not needed, and if kept it must RAISE when it finds nothing.
- Put a verification query in the migration header: `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'llm_calls'::regclass and contype = 'c';`
- A configured mechanism is not a working one. The branch needs evidence of one real `generate_agentic` row with `ok=true` in llm_calls, recorded in docs/eval/agentic-vs-single-shot.md or its own evidence note. Applying the migration in the SQL editor is not that evidence.
- Ordering: docs/deploy.md gains "apply 007 before deploying this code". DoD 15 changes from "001–006" to "001–007". Block C gets the 007 entry. No RLS or policy change is needed, and none should be made.
- The code vocabulary has to grow in the same branch (see finding 3): `LlmStep` / `ChatStep` (openrouter/server.ts:52–71), the step union in `lib/db/types`, `CHAT_STEPS` (db/llmCalls.ts:27), and `LLM_STEP_LABEL` (copy.ts:1261).

### A2: agentic request ceiling, 8 vs 12: RULED 12. SPEC §5 items 4 and 9 are wrong and must be amended in-branch
The plan's arithmetic is right, and SPEC's 8 is short even before the fall-through. `MAX_TOOL_ROUNDS + 2 × 2` counts the judge and the revision but not the SECOND judge, so the normal agentic path already reaches 4 + 2 + 2 + 2 = 10. The round_error fall-through adds a writer step on top: 4 + 2 (fall-through writer) + 2 + 2 + 2 = 12.
- Constant: `MAX_CHAT_REQUESTS_PER_GENERATE_BY_PATH = { single: GENERATE_CHAT_STEPS × MAX_CHAT_REQUESTS_PER_STEP /*8*/, agentic: MAX_TOOL_ROUNDS + GENERATE_CHAT_STEPS × MAX_CHAT_REQUESTS_PER_STEP /*12*/ }`. The comment beside it must say what the four steps are on the agentic path: fall-through writer (spent only on round_error), judge, revision, judge. On the normal path the writer step is replaced by the rounds, so the reachable total is 10. The ceiling is 12.
- Amend §5 item 4 (the formula), item 9 (worst case 12 chat rows; embeddings 1 seed + 6 searches = 7, since the fall-through reuses the seed and does not re-embed) and Block E's `regenerateDialogCostAgentic` copy so they all state the same numbers. budget.test.mjs pins 8 and 12.
- Declare the B7 overshoot that follows: one agentic run admitted at committed = 49 can end at 61. The v2.10/B7 note currently declares the single-path bound. Add the agentic one.
- The rejected alternative (round_error fails the run with AI_UNAVAILABLE) was correctly rejected. It contradicts §5 item 4 and B12.

### A3: pure loop module vs "the loop is a `while` in `lib/chat.ts`": DESIGN APPROVED, needs an owner amendment to CLAUDE.md before merge (MAJOR, merge-gating)
CLAUDE.md ("Agentic retrieval guardrails") says "The loop is a `while` in `lib/chat.ts`", and SPEC B12 says "counted in the loop in `lib/chat.ts`". B12's acceptance column also requires `tests/unit/agentic.test.mjs` with a stub model, and tests cannot load a `server-only` module. Both cannot hold literally. The proposed shape keeps the property the rule protects:
- `runAgentLoop` in `lib/agentic.ts` is pure. It has no fetch, no `process.env`, no DAL and no gate imports. Its only imports are pure modules (`lib/generation.ts`, `lib/budget.ts`, types).
- It can spend only through the two effects it is handed. `requestRound` is built inside `lib/chat.ts` and closes over `issue()`/logging after `getUser()` → `currentPlan()` → grant check. `search` is a `lib/retrieval.ts` export, which runs its own `getUser()`.
- The connection stays reachable only from the two gates, so R6 is unchanged.

This is still a deviation from CLAUDE.md's wording. CLAUDE.md outranks SPEC, and an agent's hand-over note does not amend it. I cannot authorize it either: the owner has to edit CLAUDE.md, and SPEC B12 needs a matching `> Decision:` before the PR is opened. Suggested wording: "The loop's control flow is a bounded `while` in the pure `lib/agentic.ts`; `lib/chat.ts` is its only caller and supplies both effects (the metered round request and the gated search)." If the owner declines, the fallback is to keep the `while` in `lib/chat.ts`, move each per-round decision into pure helpers in `lib/agentic.ts` (next `tool_choice`, answering a batch of tool calls against the remaining budget, classifying a round, appending items) and unit-test those. That does not satisfy B12's "stub model" wording, so B12 would need amending in that case too.
On enforcement: SPEC says repeatedly that "the 13 [check rules] stay frozen", and the plan proposes a new check.mjs rule. v3.0's precedent is sub-rules (R10b/R10c). Make it R6b (`lib/agentic.ts` imports nothing from openrouter/, supabase/, db/, chat, retrieval; only `src/lib/chat.ts` imports `@/lib/agentic`), and declare it in SPEC as a sub-rule of R6 rather than a fourteenth rule. Separately, the unit test loading `lib/agentic.ts` under `node --test` already proves it pulls in no `server-only` import.

### C: maxDuration: RULED keep 300, add a run deadline in the loop, correct the existing arithmetic
- The current figure is already wrong. route.ts:57 reads "Two 60 s attempts plus a 2 s retry wait, four times over, is ~248 s". 4 × (60 + 2 + 60) = 488 s, which exceeds 300 on the single path today. Correct the comment and declare it.
- Agentic theoretical worst case, with every request hitting its 60 s timeout: 1 seed embed + 4 rounds + 6 search embeds + fall-through 122 + 3 × 122 is well over 1,000 s. Raising maxDuration does not fix that, and 300 is the plan ceiling Block D records (v2.24).
- Required: `AGENTIC_LOOP_DEADLINE_MS` in `lib/budget.ts`, checked in the pure loop against an injected clock. Before a non-closing round, if elapsed ≥ deadline, send that round as the closing round (`tool_choice: 'none'`). Before executing a search, if elapsed ≥ deadline, answer the call with a refused tool message whose reason is distinct from the budget refusal (see finding 9). The deadline can only REMOVE spend, never add a request, so it stays inside the metered-call rules. Size it so loop + judge + revision + judge fits in 300 s on typical latencies (for example 90–120 s), and say in SPEC that this is a judgement, not a derivation. Unit-test it with a stub clock.
- Declare the residual: if the platform kills the function, no version is saved, and `after()`-written llm_calls rows can be lost with it (a B8 gap that exists on both paths). The deadline is what makes this rare. `LOCK_TTL_MS` stays ≥ maxDuration (300 000, unchanged).

### E: cost-per-run attribution by application plus time window: ACCEPTED with conditions
The ordering argument holds. Versions are inserted during the request, and `logLlmCall` writes through `after()`, so a run's llm_calls rows land after its own version rows. Conditions:
1. A window opens at a run's `ai` row and closes at the next `ai` row or `user` row of the same application. It does not close at that run's own `ai_revision`. If the window closes only on `ai` rows, an on-demand `/judge` (which appends a `user` version, with its judge row written after it) or an export lands in the preceding run's window.
2. The step filter is `generate`, `generate_agentic`, `judge`, `embed`. `rescore` and `parse_vacancy` stay out.
3. The `after()` ordering is now load-bearing for a dashboard number. Say so in a comment in `logLlmCall` (db/llmCalls.ts:180) and in `quality.ts`, so a future change to inline logging knows what it breaks. Pin it with a unit-test fixture.
4. Declared imprecisions, all three on the tile's `*Source` line and in SPEC: (a) a re-scan's `embed` rows between two runs land in the preceding window (already in the plan); (b) a run that FAILED (502, no version rows) bills rows that fall into the previous run's window or, with none, are dropped, and agentic rounds make this case more expensive than before; (c) the first run's seed embed row is written after its versions, so it is correctly inside.
5. Path classification: `ai` row with `retrieval_log !== null` means agentic. That counts round_error fall-throughs as agentic, which is correct for cost (they spent agentic money).
Alternative the owner may prefer, since 007 already touches `llm_calls`: a nullable `run_id uuid` column written by both paths makes attribution exact and removes conditions 1–4. It is more schema, so the window method is acceptable if declared. Either way, document the choice under the E note.

---

## Findings

1. [MAJOR] CLAUDE.md "Agentic retrieval guardrails" ("The loop is a `while` in `lib/chat.ts`") and SPEC.md:1383 (B12): A3 deviation. → Owner amends CLAUDE.md and SPEC B12 gets a `> Decision:` before the PR. Use an R6b sub-rule, not a new rule (SPEC "the 13 stay frozen").

2. [MAJOR] supabase/migrations/001_init.sql:82: CHECK refuses `generate_agentic`, so every agentic row is silently lost. → Migration 007 as ruled in A1: explicit constraint name, no `if exists`, verification query, deploy order, evidence of one real row, Block C entry, DoD 15 changed to 001–007.

3. [MAJOR] src/lib/db/llmCalls.ts:27: `CHAT_STEPS = ['import_resume','parse_vacancy','generate','judge']`. The plan never mentions it. Without `generate_agentic`, rule B7's `countCallsInLast24h` (line 151) does not see any agentic round, so the 50-row cap undercounts every Pro run by up to 4 rows. → Add it. Also add it to `LLM_STEP_LABEL` (copy.ts:1261, and make that map `satisfies Record<LlmStep, string>` so the next step is a build error), to the `lib/db/types` step union, and to /quality's step table (StepSummary, fallback alert).

4. [MAJOR] src/lib/openrouter/server.ts:167, 320–324, 343, 394: the plan does not specify connection changes, and the current connection cannot carry a tool round. `ChatMessage.role` is `'system' | 'user'` only. `ChatResponse` has no `tool_calls`. A tool-call round's `content` is null, so line 394 throws `OpenRouterUsageError('no content')` on every searching round. `temperature: step === 'generate' ? 0.4 : 0` would give the agentic writer temperature 0. → Add a separate connection export (e.g. `chatCompletionWithTools`) that takes the widened message union (`assistant` with `tool_calls`, `tool` with `tool_call_id`), sends `tools` plus `tool_choice` with no `response_format`, and returns `{ content: string | null, toolCalls[], …usage }`. In that export, "no content AND no tool_calls" is the empty-response error. Keep `chatCompletion`'s existing signature and its 394 check for the four existing steps. The `search_career_base` tool literal (SPEC 1497) is server-built in `lib/prompts.ts` or the connection, never client-supplied. Choose and state the temperature for `generate_agentic` (0.4, matching `generate`, keeps the comparison in item 8 about retrieval). Add `generate_agentic` to `MODEL_BY_STEP` and `MAX_TOKENS_BY_STEP` (total maps, as the plan says).

5. [MAJOR] Plan §B "Search execution" (could_not_search → "logged entry with chunks 0"), together with Block E 1214 (`researchFound(n)`): a dead search would render as "0 found" on the research section. That is the third retrieval outcome reported as the second, which CLAUDE.md "Retrieval → Three retrieval outcomes, never two" forbids. → Add `failed: true` (or `chunks: null`) to the log entry, render it with a new `RESULT.researchFailed` ("search could not run"), and amend SPEC §5 item 6's entry shape. The model-side handling (`{"error":"search unavailable"}`, loop continues) is acceptable and is ruled here explicitly: a failed agentic search does not fail the run, because the seed baseline is intact and nothing is rendered as a gap.

6. [MAJOR] Plan §B outcome 3 (round_error), together with SPEC L9 / Block E `researchNone`: when round 1 errors, `retrieval_log = []`, which matches L9's no_tool_calls state exactly. The screen would then say "The agent used the initial retrieval and ran no extra searches" about a run whose agent never wrote anything (the single-shot fall-through wrote it). `agenticFallback` lives only in the transient response and `console.error`, so after a reload the fallback leaves no trace on the version. CLAUDE.md requires it to be "logged as a fallback, never a silent one". → Persist it: on round_error append a terminal entry (e.g. `{ round, ended: 'round_error' }`) and render `RESULT.researchInterrupted`. Amend §5 item 6's shape. L9 keeps `[]` exactly as SPEC says. The failed round's `ok=false` `generate_agentic` llm_calls row stays as the spend record.

7. [MAJOR] src/lib/chat.ts:264–278 and 302: two gate mechanics the plan leaves implicit. (a) `assertStepAllowed` requires a grant only for `step === 'generate'`, so a `generate_agentic` step would fall to the else branch and be cap-checked only. → Require `GenerateGrant.isGrant(ledger?.grant) && ledger.grant.path === 'agentic'` for `generate_agentic` (a ServerError otherwise), widen `GeneratePath` to `'single' | 'agentic'`, and have `authorizeGenerate` (line 216) issue `'agentic'` only when `mode === 'agentic' && PLAN_LIMITS[plan].agentic`. (b) `issue()` refuses once `budget.spent >= MAX_CHAT_REQUESTS_PER_STEP`, so a single loop `Budget` dies on round 3, and per-round `Budget`s would make the cap meaningless. → Give `issue()` an explicit cap parameter. The loop uses one loop-level budget capped at `MAX_TOOL_ROUNDS` and never goes through `runChatWithin` (no network retry inside the loop, per CLAUDE.md). Put the exemption comment beside `MAX_CHAT_REQUESTS_PER_STEP` in budget.ts:31, as the plan says.

8. [MINOR] Plan §B: new `searchCareerBase` in src/lib/retrieval.ts. It is the agentic feature's spend, and B11 says the gate refuses a feature not in the plan. → After `requireMember()`, refuse with PlanRequiredError unless `PLAN_LIMITS[plan].agentic`. This is defence in depth: a future caller cannot buy agentic searches on Free.

9. [MINOR] Plan §B "invalid arguments" refusal: the log entry gets `refused: true`, and Block E renders `refused` as "search budget reached", which is untrue for malformed arguments (and for the deadline refusal in ruling C). → Store a refusal reason (`'budget' | 'invalid_arguments' | 'deadline'`) and render each honestly. Store the query field as `''` for unparseable arguments, never the raw argument string.

10. [MINOR] Plan §B outcome 3: on round_error the fall-through writer uses the SEED items, but the plan has the judge and revision run "on the assembled items". → The judge and the revision get exactly the set the writer of that draft saw: seed on round_error, assembled on the normal path. Otherwise P3's grounding corpus and the writer's corpus diverge.

11. [MINOR] Plan §E `agenticSummary`: count searches from the `ai` row only (the revision row carries the same log), and handle an orphan `ai_revision` at the window boundary the way `classifyRuns` does (quality.ts:356–373). Otherwise the agentic tile and the run buckets have different denominators, which is the defect that note documents.

12. [MINOR] Plan §D "RESULT.dailyLimitFree copy: keep as is (no /pricing in scope)" and §G "README unchanged": Block E 1217 (the /pricing link) and DoD 16 (README pipeline section gains the Pro path) are SPEC requirements. → List both under "not done / deferred" in the hand-over (CLAUDE.md Process: silence is a defect).

13. [NOTE] src/app/api/applications/[id]/generate/route.ts:57: the "~248 s" figure is wrong (it should be 488 s). Correct it with ruling C.

14. [NOTE] Execute searches sequentially in tool-call order, never `Promise.all`, so `MAX_SEARCH_CALLS` is counted deterministically against what was actually sent. A search that returned `could_not_search` was executed and counts toward the budget.

15. [NOTE] Privacy: only the development-only log line may print the query (SPEC §5 item 6). The `console.warn`/`console.error` fallback lines carry metadata only: round, step, error name. They never carry the query, tool arguments, content, or the messages array. The in-memory transcript is never logged or persisted, and tool messages carry item rows, never chunk text. The plan already says this; keep it.

16. [NOTE] src/lib/db/llmCalls.ts:110 and src/lib/quality.ts:548 (`generationProvenance`) filter `step === 'generate'`. New versions get the per-version `model`. Make sure the per-version line also says when it was a fallback (compare against `MODEL_BY_STEP[step]` the same way `writtenByFallback` does), or "This version was written by gemini-2.5-flash" will read as neutral.

17. [NOTE] The probe sent `tool_choice: 'auto'` only. Nothing records whether `'none'` is honoured on the closing round. The plan treats a disobeyed `'none'` as round_error, which is the correct handling. Mention it in docs/eval/agentic-vs-single-shot.md if it is ever observed.

18. [NOTE] A client that loaded the page as Pro and lapsed before clicking gets 403 PLAN_REQUIRED, which renders the generic error. SPEC 1217 says that refusal is reachable only by direct POST, which is slightly too strong. A one-clause note there is enough. No code is needed.

---

## Per-item verdicts
- A1: APPROVE WITH CHANGES (ruling A1; findings 2 and 3)
- A2: APPROVE. The ceiling is 12 and SPEC items 4 and 9 must be amended (ruling A2)
- A3: APPROVE the design, CONDITIONAL on the owner amending CLAUDE.md before merge; use an R6b sub-rule (finding 1)
- B, the loop: APPROVE WITH CHANGES (findings 4, 5, 6, 7, 9, 10, 14, 15)
- C, route: APPROVE WITH CHANGES (ruling C, finding 7a, finding 13). Adding `model` and `retrievalLog` on insert only is consistent with append-only `resume_versions` and with 006:57–64. `path` and `agenticFallback` in the response are fine.
- D, screen: APPROVE (findings 5, 6, 9, 12, 16, 18 change the copy it renders)
- E, /quality: APPROVE WITH CONDITIONS (ruling E, finding 11)
- F, tests: APPROVE. Also add: deadline with an injected clock; the plan's parallel-batch split, extended to 3 calls at 5 searches spent (one executed, two refused); invalid arguments; `could_not_search` producing a `failed` entry; tool_calls on the `'none'` round becoming round_error; round_error items consistency; no `query` and no chunk text in any console call (stubbed console).
- G, docs: APPROVE WITH ADDITIONS (deferred items from finding 12; the evidence of a real `generate_agentic` row)

Deviations needing a SPEC/CLAUDE amendment:
- CLAUDE.md "Agentic retrieval guardrails": the loop's location (A3). OWNER amendment required before merge.
- SPEC B12 ("counted in the loop in lib/chat.ts") plus a `> Decision:` for the pure-loop shape and the R6b sub-rule.
- SPEC §5 item 4 and item 9, and Block E `regenerateDialogCostAgentic`: ceiling 12 (normal path 10), embeddings 7.
- SPEC B7 / v2.10 note: agentic overshoot bound.
- SPEC Block C: migration 007. DoD 15: 001–007. docs/deploy.md: apply 007 before deploy.
- SPEC §5 item 6 and Block E 1214: `retrieval_log` entry shape gains `failed`, a refusal reason, and a terminal `ended: 'round_error'` entry; new copy `researchFailed` and `researchInterrupted`.
- SPEC Block D "Function duration" / §5: `AGENTIC_LOOP_DEADLINE_MS`, the corrected single-path worst case, and the declared residual on a killed function.
- SPEC §5 (E note): the cost-attribution method and its declared imprecisions (or the `run_id` alternative if the owner chooses it).
