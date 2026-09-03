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
