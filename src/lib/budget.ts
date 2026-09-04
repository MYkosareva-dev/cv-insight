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
 */

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

/** SPEC rule B7: 50 non-embedding calls per user per rolling 24 h. */
export const DAILY_CALL_LIMIT = 50;

/**
 * SPEC rule B7a (v2.18): the RE-SCORE ceiling, in `rescore` rows per rolling 24 h.
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
 * re-scores a day — deliberately the same order as B7's 50 chat calls, since a
 * re-score is one user action of the same kind.
 */
export const DAILY_RESCORE_LIMIT = 100;

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
export function underDailyCallCap(committed: number, ledgerChat = 0): boolean {
  return committed + ledgerChat < DAILY_CALL_LIMIT;
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
export function underRescoreCap(committed: number): boolean {
  return committed < DAILY_RESCORE_LIMIT;
}
