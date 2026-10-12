/**
 * The metered-request budget, as arithmetic.
 *
 * Deliberately NOT `server-only`, for the reason that moved the price table into
 * `lib/pricing.ts`: `tests/` is in scope for check.mjs R6, so no unit test may
 * import `lib/chat.ts` or the connection module, and the budget was therefore
 * the one piece of load-bearing arithmetic in the metered path with no test at
 * all (backlog `m-4`). Nothing in this file may ever read `process.env` or grow
 * a server import — it is plain numbers and predicates, and that is the whole
 * reason it can be tested.
 *
 * `lib/chat.ts` re-exports `MAX_CHAT_REQUESTS_PER_STEP`, so every existing
 * importer is unaffected and there is still exactly one source for the number.
 *
 * Its one import is `lib/plan.ts`, which is pure for the same reason this file
 * is: the per-plan limits table lives there (SPEC v3.0, rule B7).
 */
import { type MeteredStep, PLAN_LIMITS, type PlanId } from '@/lib/plan';

/**
 * Hard ceiling on metered HTTP requests per user-initiated STEP: the first
 * attempt plus AT MOST ONE of the two owner-approved exceptions (CLAUDE.md,
 * "AI model calls").
 *
 * THE TWO EXCEPTIONS ARE ALTERNATIVES, NOT MULTIPLIERS. A repair retry nested
 * around a network retry issues 2 × 2 = 4 metered requests for one submit, which
 * is a retry ladder however it is spelled. Both draw from this one budget, so a
 * step that spends its second request reconnecting has none left for a repair,
 * and vice versa.
 *
 * ONE STEP IS EXEMPT: `generate_agentic` (SPEC v3.0 §5 item 4, rule B12). This
 * cap exists to stop RETRIES multiplying inside a step; the agentic loop is a
 * bounded sequence of DISTINCT requests, each carrying new evidence, with its own
 * arithmetic budget below (`MAX_TOOL_ROUNDS`, `MAX_SEARCH_CALLS`). Neither of the
 * two retries applies inside the loop: a round that errors ends it. Parse, judge
 * and the single-shot generate keep this cap, and so does the single-shot writer
 * an agentic run falls through to.
 */
export const MAX_CHAT_REQUESTS_PER_STEP = 2;

/**
 * The chat STEPS one `POST /api/applications/[id]/generate` may run:
 * generate → judge → (revision) generate → judge.
 *
 * FOUR, and never more, because rule B3 caps the auto-revision at one. This is a
 * fixed second pass, not a loop: there is no arrangement of judge verdicts that
 * produces a fifth step.
 */
export const GENERATE_CHAT_STEPS = 4;

/**
 * The whole run's ceiling: 8 chat requests, hence at most 8 `llm_calls` rows.
 *
 * The multiplication is across STEPS, which is the shape the rule permits —
 * four sequential steps each allowed one retry. What the rule forbids is
 * multiplication INSIDE a step, and `MAX_CHAT_REQUESTS_PER_STEP` is what stops
 * that. Stating both numbers here is what lets the route assert the total
 * instead of asserting a comment.
 *
 * The declared costs of one generate-with-judge, in rows:
 *   2  the judge approves the first draft (the common case)
 *   4  approved after one revision
 *   8  worst case — every one of the four steps spends its single retry
 * Plus exactly one embeddings run (`embed` step), which rule B7 excludes by its
 * own definition and which is not chat.
 */
export const MAX_CHAT_REQUESTS_PER_GENERATE = GENERATE_CHAT_STEPS * MAX_CHAT_REQUESTS_PER_STEP;

// ---------------------------------------------------------------------------
// The agentic loop (SPEC v3.0 §5, rule B12) — arithmetic in code, never a prompt
// ---------------------------------------------------------------------------

/**
 * Model requests one agentic loop may make, the closing writing round included.
 * The last one is sent with `tool_choice: "none"`, so the model must write.
 */
export const MAX_TOOL_ROUNDS = 4;

/**
 * Tool EXECUTIONS per run, counted per call and not per round: the probe found
 * four of five models issuing two calls in one round. A call past this budget is
 * still answered — with a refusal — because a dangling tool call is a malformed
 * transcript.
 */
export const MAX_SEARCH_CALLS = 6;

/** Chunks one search asks `match_documents` for, before they resolve to items. */
export const AGENTIC_SEARCH_LIMIT = 6;

/**
 * A query longer than this is truncated before it is embedded or stored. It
 * bounds `resume_versions.retrieval_log` (64 KB CHECK in 006) with room to spare:
 * six queries of this size plus item titles is a few kilobytes.
 */
export const MAX_SEARCH_QUERY_CHARS = 500;

/**
 * The loop's wall-clock budget. Past it, the next round is the closing round and
 * any further search is refused with reason `deadline`.
 *
 * A JUDGEMENT, NOT A DERIVATION. `maxDuration` is 300 s (the deployment plan's
 * ceiling, Block D v2.24) and after the loop the run still has a judge, possibly a
 * revision and a second judge — typically 60–90 s together. 120 s leaves that
 * room on typical latencies. It can only REMOVE spend (an earlier closing round,
 * a refused search), never add a request, so it sits inside the metered-call
 * rules. A run whose every request hits its 60 s timeout still exceeds 300 s;
 * nothing short of fewer requests fixes that, and it is declared in SPEC.
 */
export const AGENTIC_LOOP_DEADLINE_MS = 120_000;

/**
 * The run's chat ceiling, per retrieval path (SPEC v3.0 §5 item 4, ruled 12 by
 * the architect: the SPEC's original `MAX_TOOL_ROUNDS + 2 × 2 = 8` left out the
 * second judge and the fall-through writer).
 *
 *   single   generate → judge → revision → judge, 2 requests each        = 8
 *   agentic  up to MAX_TOOL_ROUNDS loop requests, then four capped steps:
 *            the fall-through writer (spent ONLY when a round errors),
 *            judge, revision, judge                                     = 4 + 8 = 12
 *
 * On the normal agentic path the rounds replace the writer step, so the
 * reachable total is 10; the ceiling is 12 because a round that errors after
 * three good ones still buys a single-shot writer.
 */
/**
 * Must this chat step pass rule B7's overall ceiling before it starts?
 *
 * Yes, with ONE exception (security review, minor): the single-shot writer an
 * agentic run falls through to when a round errors. That writer is not a new
 * piece of work — it is the first draft of a run `authorizeGenerate()` already
 * admitted, and by then the loop's rounds are paid for. Refusing it on the cap
 * would turn those paid rounds into a 429 with nothing saved, which is the
 * outcome "the cap decides whether a step may start, not whether it may finish"
 * exists to prevent. It is still capped at MAX_CHAT_REQUESTS_PER_STEP and still
 * counted on the ledger, so the run's ceiling of 12 holds.
 *
 * The revision and the judges after it are NOT covered: they re-check as
 * before, and a refusal there saves the draft with an honest card.
 */
export function totalCapApplies(step: string, coveredFallThrough: boolean): boolean {
  return !(step === 'generate' && coveredFallThrough);
}

export const MAX_CHAT_REQUESTS_PER_GENERATE_BY_PATH = {
  single: MAX_CHAT_REQUESTS_PER_GENERATE,
  agentic: MAX_TOOL_ROUNDS + GENERATE_CHAT_STEPS * MAX_CHAT_REQUESTS_PER_STEP,
} as const;

/**
 * Has this request stayed inside the ceiling it declared?
 *
 * A DEFECT TRAP, not a control. By the time it can answer `false` the money is
 * already spent — `issue()` in `lib/chat.ts` refuses the request that would
 * break the per-step cap, so this can only fire if the pipeline grows a step
 * nobody counted. That is exactly the change worth failing loudly on: the number
 * in the hand-over and the number the code can reach must be the same one, and a
 * comment cannot enforce that.
 */
export function withinBudget(ledger: { chat: number }, max: number): boolean {
  return ledger.chat <= max;
}

// ---------------------------------------------------------------------------
// The two DAILY ceilings (backlog p4-30, ruled by the owner)
// ---------------------------------------------------------------------------

/**
 * Both numbers lived in `src/lib/db/llmCalls.ts` until Phase 5, and that file
 * imports `server-only` — so check.mjs R6 kept `tests/` away from them and rule
 * B7's 50 and rule B7a's 100 were untestable BY CONSTRUCTION, exactly as
 * `MAX_CHAT_REQUESTS_PER_STEP` was until backlog `m-4` moved it here.
 *
 * That precedent is the whole argument: the untestable file is where the
 * arithmetic bug hides. The QUERIES stay in the DAL, where a query belongs —
 * only the ceilings and the comparisons against them moved, which is why this is
 * a re-export plus a test rather than a redesign.
 *
 * They were deliberately kept TOGETHER rather than split so that one became
 * testable and the other did not; moving both is what closes the item.
 */

/**
 * PER PLAN FROM v3.0. The numbers live in `lib/plan.ts`, keyed by `PlanId`, and
 * every comparison below takes the plan as its first argument — so a caller
 * cannot ask "is this under the cap?" without saying whose cap.
 */

/** SPEC rule B7: non-embedding calls per user per rolling 24 h, every step together. */
export const dailyCallLimit = (plan: PlanId): number => PLAN_LIMITS[plan].dailyChatCalls;

/**
 * SPEC rule B7a (v2.18; per plan from v3.0 — Free 20, Pro 100): the RE-SCORE
 * ceiling, in `rescore` rows per rolling 24 h.
 *
 * Rule B7 excludes embeddings by definition, and for every embedding spend the
 * app had until Phase 4 that was right: indexing is a side effect of a write
 * already bounded by rule B9's item cap and skipped when nothing changed, and a
 * scan's embeddings are a limb of a request whose chat call B7 already capped.
 * `/rescore` is neither. It makes NO chat call — that is its whole selling point
 * — so it passed through the only ledger in the app, and its entire purpose is a
 * spend the user repeats one click at a time. The client-side one-click ref is
 * not a fence: a signed-in caller can POST it in a loop.
 *
 * COUNTED IN REQUESTS, NOT CLICKS, because the request is what costs money.
 * `embedFor` splits at EMBEDDING_BATCH_SIZE, so one re-score is 2 rows on a
 * measured run and up to 7 on the largest input rule B1 and the chunker permit
 * (200 requirements + 200 resume units). 100 rows is therefore ~50 typical
 * re-scores a day on Pro — deliberately the same order as B7's 50 chat calls, since a
 * re-score is one user action of the same kind.
 */
export const dailyRescoreLimit = (plan: PlanId): number => PLAN_LIMITS[plan].dailyRescoreRequests;

/**
 * Rule B7's comparison: may another chat request START?
 *
 * `committed + ledger` and not `committed` alone, because `countCallsInLast24h`
 * reads COMMITTED rows and `logLlmCall` writes through `after()` — a multi-call
 * request would otherwise read the same pre-request count every time and
 * overshoot the cap by the number of extra calls it makes.
 *
 * The boundary is EXCLUSIVE at the ceiling: the 50th committed call is the last
 * one allowed, so a user sitting on 50 is refused rather than sold a 51st. That
 * is the one line of this rule nothing had ever asserted, and it is the line
 * where an off-by-one either gives away a call or refuses one that was paid for.
 */
export function underDailyCallCap(plan: PlanId, committed: number, ledgerChat = 0): boolean {
  return committed + ledgerChat < dailyCallLimit(plan);
}

/**
 * Rule B7's PER-STEP comparison (Free, v3.0): may another RUN of this step start?
 *
 * Counted in SUCCESSFUL rows of that step, committed only, and both halves are
 * decisions rather than accidents:
 *  - Successful (`ok = true`): a scan or a generate that died with a 502 spent
 *    the user nothing they can use, so it does not consume the day's allowance.
 *  - No ledger: the check is made once per RUN. A scan has one parse step; a
 *    generate run is admitted once by `authorizeGenerate()` in `lib/chat.ts`,
 *    and its rule-B3 revision is part of the run it belongs to, not a second
 *    resume — so it is never re-measured against the allowance it already
 *    passed.
 * A step with no allowance on this plan is always under it; rule B7's overall
 * ceiling still applies to it.
 *
 * DECLARED IMPRECISION: a parse that spends its one repair retry writes two
 * successful rows and so uses two of Free's three scans. Rows, not intentions,
 * are what the ledger can count without a second source of truth.
 */
export function underStepCap(plan: PlanId, step: string, committedOk: number): boolean {
  const limit = PLAN_LIMITS[plan].perStep[step as MeteredStep];
  return limit === undefined || committedOk < limit;
}

/** Does this plan carry a per-step allowance for this step? */
export function hasStepCap(plan: PlanId, step: string): step is MeteredStep {
  return PLAN_LIMITS[plan].perStep[step as MeteredStep] !== undefined;
}

/**
 * Rule B7a's comparison: may another re-score embedding run START?
 *
 * COMMITTED ROWS ONLY, with no ledger, and the asymmetry with `underDailyCallCap`
 * is deliberate rather than an omission. A re-score makes no chat call, so it
 * holds no `CallLedger`; its own batches are invisible to its own check, and the
 * declared consequence is an overshoot bounded by the batch count minus one.
 * Re-checking mid-run would refuse a re-score whose first batch was already
 * billed, which buys a half-measured score with money already spent.
 */
export function underRescoreCap(plan: PlanId, committed: number): boolean {
  return committed < dailyRescoreLimit(plan);
}
