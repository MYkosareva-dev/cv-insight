import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  GENERATE_CHAT_STEPS,
  MAX_CHAT_REQUESTS_PER_GENERATE,
  MAX_CHAT_REQUESTS_PER_STEP,
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
