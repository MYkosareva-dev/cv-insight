# AI Code Review — feature/agentic-retrieval — 2026-10-12

Saved verbatim from the ai-code-reviewer run on `git diff main...HEAD` (HEAD 235511e).

---

Verdict: REVISE

There are no blockers. Two MAJOR findings need fixing first: a metered run can be aborted after it has already spent, and README is now false. After those two, and the MINORs you choose to take, this is APPROVE.

Scope: `git diff main...HEAD` (9 commits, 8c95532..235511e, 34 files, +2777/−82). I checked the scope: all files named in the task are in the diff. The suspect files I also read are `src/lib/retrieval.ts` (`matchDocuments`, `requireMember`), `src/lib/plan.ts` (`currentPlan` failure path), `src/lib/db/resumeVersions.ts`, `supabase/migrations/006_subscription_events.sql:63-64`, `README.md:688-691`, `scripts/tool-calling-probe.mjs` and `tests/e2e/plan-gating.spec.ts`. From SPEC I read only the v3.0 and v3.0b notes under endpoint #5, B12, L8–L9 and Block H items 10–17. I did not read `.env*` or WORKLOG.md.

Tooling results, run on HEAD 235511e:
- `node scripts/check.mjs` → "Check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; … createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; …"
- `npm test` → 485 tests, 485 pass, 0 fail.
- `npx tsc --noEmit` → exit 0.
- `npx eslint src` → no findings.

## Blockers
None.

## Majors

**M1. A search effect that throws aborts a run that has already been billed. A Pro user can get a 403 "not in your plan" for a transient read failure.**
- Where: `src/lib/retrieval.ts:754-757` (`searchCareerBase`) and `src/lib/chat.ts:602` (`search: (query) => searchCareerBase(...)`), with `src/lib/agentic.ts:216` (`await args.search(query)`, not guarded).
- What happens: `searchCareerBase` calls `requireMember()` on every search, which is `getUser()` plus `currentPlan()`. `currentPlan()` returns `'free'` when the ledger read fails (`plan.ts`, "ledger read failed; treating the caller as free"). One transient read failure on search N therefore throws `PlanRequiredError`. The same goes for an `UnauthorizedError` from a flaky `getUser()`, and for `matchDocuments`, which runs `requireMember()` a second time (retrieval.ts:643).
- `runAgentLoop` only catches errors from `requestRound`, so the throw goes through `runAgenticGenerate` to the route. The run fails with 403 or 401 after paying for up to 3 rounds and N−1 searches. No version is saved.
- Why it matters: SPEC v3.0b note 5 says "A dead search … does not fail the run", and CLAUDE.md's three-outcomes rule says could-not-search must not be reported as something else. Here it is reported as a plan refusal.
- Fix: keep the off-plan refusal, which issues no embed call, so the defence in depth stays. Return `{ status: 'could_not_search' }` from `searchCareerBase` when the refusal happens inside an admitted run, with a metadata-only `console.error` (error name, no query). For example, wrap the `requireMember()` and plan check in a try/catch that maps `PlanRequiredError` and `UnauthorizedError` to `could_not_search`. Or do the conversion in the chat.ts search effect, so the gate keeps throwing for any other caller.
- Separately (efficiency): pass the already-verified user into the match call, or call the internal embed and RPC directly, so each search does one `getUser` and one `currentPlan` instead of two of each (up to 12 extra auth and ledger reads per run).
- Add a unit case in `tests/unit/agentic.test.mjs` for a search stub that returns `could_not_search`. One already exists (line 265), so the remaining work is pinning that the production effect never throws for these two error classes.

**M2. README now says the feature this branch ships does not exist. This is an undeclared deviation from DoD 16.**
- Where: `README.md:688-691`: "**Specified in SPEC v3.0 and not yet built:** Free and Pro plans with Stripe test-mode billing, and agentic retrieval as the Pro generation path. Until they are, the deployment has neither…"
- After this branch merges, that sentence is false for agentic retrieval. It was already false for billing.
- Architect pre-review finding 12 required the README update (DoD 16) to be either done or listed under "not done / deferred". Nothing in the branch declares the deferral: there is no backlog entry and no SPEC note. CLAUDE.md Process says "Silence is a defect, not a deferral."
- Fix, either of:
  - (a) Update the README pipeline section with the Pro path and the plan split, and remove the "not yet built" paragraph.
  - (b) Rewrite those four lines so they are true now, and record the remaining DoD 16 items as a backlog entry referenced from the hand-over.
- The same applies to the `/pricing` link and the "Pro removes the daily limits" copy. SPEC Block E (the `dailyLimitFree` paragraph, which this branch edited to add the v3.0b lapse clause) still mandates that copy. `src/lib/copy.ts` deliberately keeps "upgrade to Pro in Settings for higher daily limits". Either amend that SPEC sentence to the shipped copy or declare it deferred. As things stand, SPEC prescribes a claim that the code comment calls untrue.

## Minors
- **m1. `retrieval_log` can exceed the 64 KB CHECK, which turns a paid run into a 500.** `src/lib/agentic.ts:192-207` and `:319`; constraint at `supabase/migrations/006_subscription_events.sql:63-64`. Every tool call gets a log entry, including refused ones, and a refused-for-budget entry stores the query (up to `MAX_SEARCH_QUERY_CHARS = 500`). Nothing limits the number of tool calls per round except `max_tokens` (2500). A model that emits around 100 parallel calls per round over three rounds (an item text that injects instructions could cause this) produces a log over 65 536 bytes. `insertResumeVersion` then fails the CHECK after the whole run has been billed.
  - Fix: cap the logged entries per run, e.g. log the first `MAX_SEARCH_CALLS + k` refusals and then a single `{round, ended:'refusals_truncated', count}` entry. Or store `query: ''` on budget refusals. Pin it with a test of 200 calls in one round.
- **m2. The cost-by-path tile hides unpriced rows and can count runs at $0.** `src/lib/quality.ts:677-681`, `src/app/(app)/quality/page.tsx:213-224`, `src/lib/copy.ts:1254`. Two problems:
  - `pathSummary` computes `unknownPricing` but the tile never shows it, so the per-run cost is silently understated when a model has no price entry.
  - The versions window (1 000 rows) and the calls window (1 000 rows) cover very different time spans, because a run is 5–15 call rows. Older `ai` rows in the versions window have no calls inside the calls window, count as $0 runs, and pull the average down.
  - Fix: show `unknownPricing` on the tile's source line. Also either drop runs whose `ai.created_at` is older than the oldest call in the window, or state this third imprecision on the tile and in SPEC v3.0b note 10.
- **m3. The cost copy understates the agentic worst case and contradicts itself.** `src/lib/copy.ts:953`, `:978`, `:989`.
  - `regenerateDialogCostAgentic` and `generateHelpAgentic` say "up to four AI calls … then one for the reviewer, two more with a rewrite". When a round errors, the fall-through writer adds a call that the copy does not mention. Writer-side calls can reach 5, and the declared ceiling is 12.
  - `regenerateHelpAgentic` leaves out the rewrite entirely ("then the review").
  - Fix: make the three strings say the same thing, and add "one more if the research stops on an error" or similar, so the stated bill is not lower than one the user can actually be charged.
- **m4. The development log prints the model-written query.** `src/lib/retrieval.ts:765-768` prints `JSON.stringify(query)`. SPEC v3.0 note 6 sanctions this, and it is dev-only behind `NODE_ENV`. But a query can paraphrase vacancy or resume text, and CLAUDE.md (Privacy: "Never log resume or vacancy CONTENT…") outranks SPEC.
  - Fix: print the query's length and the round instead (the acceptance purpose is chunk count and score). Or get an explicit owner ruling recorded in CLAUDE.md that dev-only query lines are allowed.
- **m5. Phase-gate reviewers have not run on this branch.** Only `docs/reviews/agentic-retrieval-architect-pre.md` exists. This feature sends more of the career base to the model, and stores model-written queries and item titles on `resume_versions`. Per CLAUDE.md Process, eu-compliance-reviewer (personal data) and nextjs-security (after feature phases) are due. Run both and save their reports to `docs/reviews/` before merge.
- **m6. One acceptance item for the Pro path is still unwitnessed.** `tests/e2e/plan-gating.spec.ts:202` is `test.fixme('after a ledger row makes the account Pro, the same agentic call proceeds')`. DoD 13 lists that case. The file header declares it, so this is not silent, but DoD 13 is not done. Either keep it listed as open in the hand-over, or un-fixme it now that the loop exists.

## Nits
- n1. `src/lib/openrouter/server.ts:555-560`: the tool-call filter does not check `call.type === 'function'`. Add the check so the transcript echoed back only ever holds the declared shape.
- n2. `scripts/tool-calling-probe.mjs:37`: the script duplicates the tool literal from `SEARCH_CAREER_BASE_TOOL` (`src/lib/prompts.ts`). It is an owner-run dev script on synthetic data, with v2.23 as precedent, so this is not a chokepoint finding. But the two copies can drift. Add a comment saying the probe must be re-run if the declaration changes, or a unit assertion that the two match.
- n3. `src/lib/copy.ts:10` imports a type from `server-only` `lib/db/types` into a client-safe module. `import type` is erased at build, so this is safe, but a pure step-name union in a dependency-free module would remove the trap for the next edit that drops `type`.

## Architect pre-review findings: were they addressed?
- A1 / finding 2 (migration 007): **done.** It drops the constraint by explicit name with no `if exists`, includes the verification query, and `docs/deploy.md` gains the ordering step. A real `generate_agentic` row is witnessed (commit 235511e, `docs/eval/agentic-vs-single-shot.md`).
- A2 (ceiling 12 / normal path 10): **done.** `budget.ts` `MAX_CHAT_REQUESTS_PER_GENERATE_BY_PATH`, pinned in budget.test. The route uses the per-path ceiling. SPEC items 4 and 9 and the B7 overshoot (49 → 61) are amended.
- A3 / finding 1 (pure loop): **done.** CLAUDE.md is amended (owner decision recorded in SPEC v3.0b note 1). R6b is implemented as an import allow-list plus a `runAgentLoop` reference check, and is unit-tested in check-rules.test.
- Ruling C (deadline): **done.** `AGENTIC_LOOP_DEADLINE_MS` uses an injected clock and has a test. The 488 s figure is corrected and backlog ag-1 is filed.
- Ruling E (cost attribution): **done.** Window closes on the next `ai`/`user` row, uses `RUN_STEPS`, and the `after()` ordering comment is in `logLlmCall`. The two imprecisions are on the tile. See m2 for a third that is not.
- Finding 3 (`CHAT_STEPS`, labels, types): **done.** `LLM_STEP_LABEL` now `satisfies Record<…>`.
- Finding 4 (separate connection export, temperature 0.4, total maps): **done.**
- Finding 5 (`failed` entry, `researchFailed`): **done.**
- Finding 6 (terminal `round_error` entry, `researchInterrupted`): **done.**
- Finding 7a (agentic grant): **done.** `chat.ts:286-292`.
- Finding 7b (loop budget not via `issue()`): **done.** `issueToolRound` has its own `LoopBudget`, never calls `runChatWithin`, and does no retry.
- Finding 8 (off-plan refusal in `searchCareerBase`): **done.** As built it creates M1.
- Findings 9, 10, 14, 15, 16, 17: **done.** Refusal reasons; judge and revision read `first.items`; sequential execution; metadata-only console lines (pinned by a stubbed-console test); per-version fallback via `fallbackModels`; disobeyed `none` → round_error.
- Finding 11 (searches counted from the `ai` row only): **done.**
- Finding 12 (README, /pricing deferral): **NOT done and NOT declared.** See M2.
- Finding 18 (lapsed-plan note): **done** in the SPEC Block E paragraph.

## Pass-by-pass notes
- **Secrets:** the diff adds no `NEXT_PUBLIC_` variable and no new env variable. The only `process.env.OPENROUTER_API_KEY` read is in the dev script, and it prints the name, never the value. No `.env*` file is in the diff.
- **Chokepoints:**
  - The connection is reached only from `lib/chat.ts` (`chatCompletionWithTools`) and `lib/retrieval.ts`.
  - `lib/agentic.ts` imports only `budget`, `generation` and `retrievalLog`.
  - The tool declaration is server-built in `lib/prompts.ts` and has one `query` parameter.
  - The route body is still `{ mode? }` only. plan-gating.spec covers a `role` key being refused.
- **RLS:** 007 changes only the CHECK; there are no policy changes. `resume_versions` gets `model` and `retrieval_log` on insert only, through the existing DAL, so append-only holds. There is no `.from(` outside `lib/db`.
- **Metered-call budget:**
  - At most `MAX_TOOL_ROUNDS = 4` rounds, enforced twice: by the loop and by `issueToolRound`'s `LoopBudget`.
  - At most `MAX_SEARCH_CALLS = 6` executions, counted before each search runs, and searches execute one at a time in call order.
  - There is no retry inside the loop. The fall-through writer, the judge and the revision keep the cap of 2 per step.
  - Rule B7's ceiling is checked once for the loop, and agentic rounds are counted through `CHAT_STEPS`.
- **Privacy:**
  - Chunk text is never logged and never sent to the client. Tool messages carry item rows (the same four fields as the seed) to the model only.
  - `retrieval_log` holds the query, counts, the score and titles.
  - The Research section renders from the log as text nodes only, with no `dangerouslySetInnerHTML`.
  - Fallback `console.warn` lines are metadata only.
  - The one exception is m4.
- **Three retrieval outcomes:** a could-not-search result is logged as `failed: true, chunks: null` and rendered as `researchFailed`, never as "0 found". The seed retrieval failing still raises AI_UNAVAILABLE (tailoring.ts:124-127). The one gap is the thrown-error case in M1.
- **llm_calls:**
  - Every round is logged as `generate_agentic`, with `ok=true` or `ok=false` through `logFailure`.
  - The model logged is the one that served the round, with `fallback_used` from the response and usage-derived integer `cost_usd_micro`.
  - Searches log `embed` rows attributed to the application.
  - L9 (no tool calls) is a fallback recorded in the response, the console and `retrieval_log = []`.
- **Zod:** the route body is validated as before. The tool arguments are model output and are validated by hand in `queryOf` (strict: object with a non-empty string `query`, truncated). That is adequate for one field, but `z.object({ query: z.string() }).strict()` would match the project convention (NIT-level, not counted above).
- **Quality:** strict TypeScript passes. No `any`. No new dependencies. The one e2e change (`generate.spec.ts:527`, now matching the per-version "This version was written by") follows the new provenance line.

Checked: secrets ✓, RLS ✓, chokepoints ✓ (R6b enforced), zod ✓, llm_calls logging ✓
