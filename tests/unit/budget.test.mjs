import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  DAILY_CALL_LIMIT,
  DAILY_RESCORE_LIMIT,
  GENERATE_CHAT_STEPS,
  MAX_CHAT_REQUESTS_PER_GENERATE,
  MAX_CHAT_REQUESTS_PER_STEP,
  underDailyCallCap,
  underRescoreCap,
  withinBudget,
} from '../../src/lib/budget.ts';

/**
 * The metered-request budget is the arithmetic that decides how much money one
 * button press can spend, and it had no test at all until this file (backlog
 * `m-4`): it lived in `lib/chat.ts`, which is `server-only` and therefore
 * unimportable by anything under `tests/` (check.mjs R6). The one piece of
 * load-bearing arithmetic in the metered path being the one piece with no test
 * is exactly how the price-lookup bug reached a live run, and this is the same
 * fix applied a second time.
 *
 * What these cases pin is the SHAPE of the rule, not just the numbers. The rule
 * CLAUDE.md states is that the two owner-approved retry exceptions share ONE
 * budget per step and never nest — 2 requests maximum, in either order of
 * exception — and that a multi-step request multiplies across STEPS only. So the
 * generate ceiling has to be steps × per-step and nothing else; a number typed
 * in twice would let the two drift and the hand-over's declared cost stop being
 * the true one.
 */

describe('the per-step budget', () => {
  test('is the first attempt plus at most ONE exception', () => {
    assert.equal(MAX_CHAT_REQUESTS_PER_STEP, 2);
  });

  test('does not permit a repair retry NESTED inside a network retry', () => {
    // 2 x 2 = 4 is the retry ladder CLAUDE.md names as a defect. The ceiling is
    // the arithmetic that makes it unreachable.
    assert.ok(MAX_CHAT_REQUESTS_PER_STEP < 4);
  });
});

describe('one generate-with-judge run', () => {
  test('runs four chat steps: generate, judge, and rule B3 one revision pair', () => {
    assert.equal(GENERATE_CHAT_STEPS, 4);
  });

  test('costs at most steps x per-step requests, and the ceiling is DERIVED', () => {
    // Derived rather than declared, so a fifth step cannot be added while the
    // ceiling silently keeps describing four.
    assert.equal(MAX_CHAT_REQUESTS_PER_GENERATE, GENERATE_CHAT_STEPS * MAX_CHAT_REQUESTS_PER_STEP);
    assert.equal(MAX_CHAT_REQUESTS_PER_GENERATE, 8);
  });

  test('the declared costs are the reachable ones', () => {
    // 2 = approved first pass, 4 = approved after the revision, 8 = every step
    // spends its single retry. Nothing between is excluded and nothing above is
    // reachable.
    for (const spent of [2, 4, 8]) {
      assert.ok(withinBudget({ chat: spent }, MAX_CHAT_REQUESTS_PER_GENERATE), `${spent} is legal`);
    }
    assert.equal(withinBudget({ chat: 9 }, MAX_CHAT_REQUESTS_PER_GENERATE), false);
  });
});

describe('withinBudget', () => {
  test('a run that spent nothing is inside any ceiling', () => {
    assert.equal(withinBudget({ chat: 0 }, 0), true);
  });

  test('is inclusive at the ceiling and false above it', () => {
    assert.equal(withinBudget({ chat: 2 }, 2), true);
    assert.equal(withinBudget({ chat: 3 }, 2), false);
  });
});

// ---------------------------------------------------------------------------
// The two daily ceilings (backlog p4-30)
// ---------------------------------------------------------------------------

/**
 * Neither boundary had ever been asserted, and neither COULD be: both numbers
 * were declared in `src/lib/db/llmCalls.ts`, which imports `server-only`, so
 * check.mjs R6 forbids anything under `tests/` from importing them. That is the
 * same shape as backlog `m-4` — the untestable file is where the arithmetic bug
 * hides — and rule B7a arrived in v2.18 with the defect already known.
 *
 * What is pinned is the COMPARISON at limit-1, limit and limit+1, because those
 * three points are where an off-by-one either gives a user a call they were not
 * sold or refuses one they already paid for. The numbers themselves are pinned
 * too: they are quoted verbatim in `ERROR_MESSAGES.DAILY_LIMIT` ("50 calls"), so
 * a change to one without the other would put a wrong number in the user's face.
 */

describe('rule B7 — the daily chat cap', () => {
  test('is 50 calls, the number the refusal copy states', () => {
    assert.equal(DAILY_CALL_LIMIT, 50);
  });

  test('admits at limit-1, refuses AT the limit and above', () => {
    assert.equal(underDailyCallCap(DAILY_CALL_LIMIT - 1), true);
    assert.equal(underDailyCallCap(DAILY_CALL_LIMIT), false);
    assert.equal(underDailyCallCap(DAILY_CALL_LIMIT + 1), false);
  });

  test('counts the ledger as well as the committed rows', () => {
    // The whole reason a ledger exists: `logLlmCall` writes through `after()`, so
    // a four-call request that read committed rows alone would check the same
    // pre-request count four times and overshoot by three.
    assert.equal(underDailyCallCap(48, 1), true);
    assert.equal(underDailyCallCap(48, 2), false);
    assert.equal(underDailyCallCap(0, DAILY_CALL_LIMIT), false);
  });

  test('a generate run at the boundary is refused mid-pipeline, not before it', () => {
    /**
     * The state SPEC v2.16 notes 9 and 13 are about, as arithmetic: a user at 48
     * committed calls passes the generate step (48+0), passes the judge (48+1)
     * and is refused on the rewrite (48+2). Those two notes exist because the
     * refusal must not discard a resume already generated and billed twice.
     */
    assert.equal(underDailyCallCap(48, 0), true, 'generate may start');
    assert.equal(underDailyCallCap(48, 1), true, 'the judge may start');
    assert.equal(underDailyCallCap(48, 2), false, 'the rewrite is refused');
  });

  test('a run with no ledger is the single-call case, and the default says so', () => {
    // Every request in the app but /generate makes exactly one chat call and
    // passes no ledger; the default of 0 is what makes that call site correct.
    assert.equal(underDailyCallCap(49), true);
    assert.equal(underDailyCallCap(49, 1), false);
  });
});

describe('rule B7a — the daily re-score cap', () => {
  test('is 100 rescore rows, ~50 typical re-scores a day', () => {
    assert.equal(DAILY_RESCORE_LIMIT, 100);
  });

  test('admits at limit-1, refuses AT the limit and above', () => {
    assert.equal(underRescoreCap(DAILY_RESCORE_LIMIT - 1), true);
    assert.equal(underRescoreCap(DAILY_RESCORE_LIMIT), false);
    assert.equal(underRescoreCap(DAILY_RESCORE_LIMIT + 1), false);
  });

  test('is committed rows only — a re-score holds no ledger', () => {
    /**
     * The asymmetry with B7 is deliberate and worth pinning as behaviour rather
     * than leaving as a comment: `/rescore` makes no chat call, so there is no
     * `CallLedger` for it to draw on, and the declared overshoot is bounded by
     * its own batch count. A second argument here would be a silent no-op that
     * a future caller would read as a working fence.
     */
    assert.equal(underRescoreCap.length, 1);
  });

  test('is the same ORDER as B7, because a re-score is one user action too', () => {
    // Not the same number: a re-score is counted in embedding REQUESTS and one
    // click makes two on a measured run. Two ceilings that drifted an order
    // apart would make one of the two rules meaningless.
    assert.ok(DAILY_RESCORE_LIMIT >= DAILY_CALL_LIMIT);
    assert.ok(DAILY_RESCORE_LIMIT <= DAILY_CALL_LIMIT * 4);
  });
});
