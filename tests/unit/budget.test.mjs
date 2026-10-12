import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  GENERATE_CHAT_STEPS,
  MAX_CHAT_REQUESTS_PER_GENERATE,
  MAX_CHAT_REQUESTS_PER_STEP,
  dailyCallLimit,
  dailyRescoreLimit,
  hasStepCap,
  underDailyCallCap,
  underRescoreCap,
  underStepCap,
  withinBudget,
} from '../../src/lib/budget.ts';
import { PLAN_LIMITS } from '../../src/lib/plan.ts';

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
// The daily ceilings, PER PLAN (backlog p4-30; SPEC v3.0 rule B7 / B7a)
// ---------------------------------------------------------------------------

/**
 * Every boundary below runs ONCE PER PLAN (SPEC v3.0, rule B7: "its boundary
 * tests run once per plan"). The comparisons take the plan as their first
 * argument, so a caller cannot ask "is this under the cap?" without naming
 * whose cap — and a test cannot either.
 *
 * What is pinned is the COMPARISON at limit-1, limit and limit+1, because those
 * three points are where an off-by-one either gives a user a call they were not
 * sold or refuses one they already paid for. The 50 is pinned as a number too:
 * it is quoted verbatim in `ERROR_MESSAGES.DAILY_LIMIT` ("50 calls").
 */
const PLANS = ['free', 'pro'];

describe('the plan table', () => {
  test('names exactly the two plans', () => {
    assert.deepEqual(Object.keys(PLAN_LIMITS).sort(), ['free', 'pro']);
  });

  test('Free is a strict subset of Pro on every dimension', () => {
    // The per-step allowances are ADDED to the overall ceiling, not swapped for
    // it — otherwise the on-demand judge and the import, which no allowance
    // names, would have no ceiling on the plan anyone can sign up for.
    assert.ok(PLAN_LIMITS.free.dailyChatCalls <= PLAN_LIMITS.pro.dailyChatCalls);
    assert.ok(PLAN_LIMITS.free.dailyRescoreRequests <= PLAN_LIMITS.pro.dailyRescoreRequests);
    assert.equal(PLAN_LIMITS.free.agentic, false);
    assert.equal(PLAN_LIMITS.pro.agentic, true);
  });

  test('carries the figures SPEC and the Settings copy state', () => {
    assert.equal(PLAN_LIMITS.free.perStep.parse_vacancy, 3, '"3 scans … per day"');
    assert.equal(PLAN_LIMITS.free.perStep.generate, 1, '"1 tailored resume per day"');
    assert.deepEqual(PLAN_LIMITS.pro.perStep, {});
    assert.equal(dailyRescoreLimit('free'), 20);
    assert.equal(dailyRescoreLimit('pro'), 100);
  });
});

for (const plan of PLANS) {
  const callLimit = dailyCallLimit(plan);
  const rescoreLimit = dailyRescoreLimit(plan);

  describe(`rule B7 — the daily chat cap (${plan})`, () => {
    test('is 50 calls, the number the refusal copy states', () => {
      assert.equal(callLimit, 50);
    });

    test('admits at limit-1, refuses AT the limit and above', () => {
      assert.equal(underDailyCallCap(plan, callLimit - 1), true);
      assert.equal(underDailyCallCap(plan, callLimit), false);
      assert.equal(underDailyCallCap(plan, callLimit + 1), false);
    });

    test('counts the ledger as well as the committed rows', () => {
      // `logLlmCall` writes through `after()`, so a four-call request that read
      // committed rows alone would check the same count four times.
      assert.equal(underDailyCallCap(plan, 48, 1), true);
      assert.equal(underDailyCallCap(plan, 48, 2), false);
      assert.equal(underDailyCallCap(plan, 0, callLimit), false);
    });

    test('a generate run at the boundary is refused mid-pipeline, not before it', () => {
      // SPEC v2.16 notes 9 and 13: the refusal must not discard a resume already
      // generated and billed.
      assert.equal(underDailyCallCap(plan, 48, 0), true, 'generate may start');
      assert.equal(underDailyCallCap(plan, 48, 1), true, 'the judge may start');
      assert.equal(underDailyCallCap(plan, 48, 2), false, 'the rewrite is refused');
    });

    test('a run with no ledger is the single-call case, and the default says so', () => {
      assert.equal(underDailyCallCap(plan, 49), true);
      assert.equal(underDailyCallCap(plan, 49, 1), false);
    });
  });

  describe(`rule B7a — the daily re-score cap (${plan})`, () => {
    test('admits at limit-1, refuses AT the limit and above', () => {
      assert.equal(underRescoreCap(plan, rescoreLimit - 1), true);
      assert.equal(underRescoreCap(plan, rescoreLimit), false);
      assert.equal(underRescoreCap(plan, rescoreLimit + 1), false);
    });

    test('is committed rows only — a re-score holds no ledger', () => {
      // Plan + committed, and no third argument: `/rescore` makes no chat call,
      // so there is no ledger for it to draw on. A third parameter here would be
      // a silent no-op a future caller would read as a working fence.
      assert.equal(underRescoreCap.length, 2);
    });
  });
}

describe('rule B7 — Free per-step allowances (v3.0)', () => {
  test('a scan: the 3rd successful parse is admitted, the 4th refused', () => {
    assert.equal(underStepCap('free', 'parse_vacancy', 2), true);
    assert.equal(underStepCap('free', 'parse_vacancy', 3), false);
    assert.equal(underStepCap('free', 'parse_vacancy', 4), false);
  });

  test('a resume: the first run is admitted, the second refused (edge case L6)', () => {
    assert.equal(underStepCap('free', 'generate', 0), true);
    assert.equal(underStepCap('free', 'generate', 1), false);
  });

  test('a step with no allowance on the plan is always under it', () => {
    for (const step of ['judge', 'import_resume']) {
      assert.equal(hasStepCap('free', step), false, step);
      assert.equal(underStepCap('free', step, 10_000), true, step);
    }
  });

  test('Pro has no per-step allowance; only the overall ceiling binds it', () => {
    for (const step of ['parse_vacancy', 'generate', 'judge', 'import_resume']) {
      assert.equal(hasStepCap('pro', step), false, step);
      assert.equal(underStepCap('pro', step, 10_000), true, step);
    }
  });

  test('Free per-step allowances sit INSIDE the overall ceiling, never above it', () => {
    for (const limit of Object.values(PLAN_LIMITS.free.perStep)) {
      assert.ok(limit < PLAN_LIMITS.free.dailyChatCalls);
    }
  });
});
