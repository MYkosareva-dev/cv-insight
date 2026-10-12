import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { currentPlan, planFromLatestRow, planViewOf } from '../../src/lib/plan.ts';

/**
 * Rule B11 — the plan is a QUERY over the ledger, and these are its states
 * (SPEC v3.0, Block H item 13: empty / active / `cancel_at_period_end` before
 * and after the period end / `past_due` / `canceled`).
 *
 * The derivation is pure and tested directly; `currentPlan()` is tested with an
 * injected reader, which is how its one impure edge — a read that fails — is
 * reachable without a database. The default reader is the ledger DAL, loaded
 * lazily so this file never pulls `server-only` in.
 */

const NOW = new Date('2026-10-12T12:00:00Z');
const FUTURE = '2026-11-12T10:14:02Z';
const PAST = '2026-10-01T00:00:00Z';

const row = (status, current_period_end, cancel_at_period_end = false) => ({
  status,
  current_period_end,
  cancel_at_period_end,
});

describe('planFromLatestRow — the ledger states', () => {
  test('no row at all is Free', () => {
    assert.equal(planFromLatestRow(null, NOW), 'free');
  });

  test('active with a future period end is Pro', () => {
    assert.equal(planFromLatestRow(row('active', FUTURE), NOW), 'pro');
  });

  test('trialing with a future period end is Pro — the other status read as Pro', () => {
    assert.equal(planFromLatestRow(row('trialing', FUTURE), NOW), 'pro');
  });

  test('cancel_at_period_end BEFORE the period end is still Pro (edge case P7)', () => {
    assert.equal(planFromLatestRow(row('active', FUTURE, true), NOW), 'pro');
  });

  test('cancel_at_period_end AFTER the period end is Free, with no further event needed', () => {
    assert.equal(planFromLatestRow(row('active', PAST, true), NOW), 'free');
  });

  test('active but the period has ended is Free', () => {
    assert.equal(planFromLatestRow(row('active', PAST), NOW), 'free');
  });

  test('the boundary is exclusive: a period ending exactly now is over', () => {
    assert.equal(planFromLatestRow(row('active', NOW.toISOString()), NOW), 'free');
  });

  test('past_due is Free — only active and trialing are Pro (edge case P11)', () => {
    assert.equal(planFromLatestRow(row('past_due', FUTURE), NOW), 'free');
  });

  test('canceled is Free even with a future period end', () => {
    assert.equal(planFromLatestRow(row('canceled', FUTURE), NOW), 'free');
  });

  test('every other Stripe status, stored verbatim, is Free', () => {
    for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused', 'ACTIVE', '']) {
      assert.equal(planFromLatestRow(row(status, FUTURE), NOW), 'free', status);
    }
  });

  test('a null or unparseable period end is Free — Pro until an unknown date is not inferred', () => {
    assert.equal(planFromLatestRow(row('active', null), NOW), 'free');
    assert.equal(planFromLatestRow(row('active', 'not a date'), NOW), 'free');
  });
});

describe('currentPlan — the gates’ reader', () => {
  const userId = '11111111-1111-1111-1111-111111111111';

  test('answers from the latest row the reader returns', async () => {
    assert.equal(await currentPlan(userId, async () => row('active', '2999-01-01T00:00:00Z')), 'pro');
    assert.equal(await currentPlan(userId, async () => null), 'free');
  });

  test('passes the verified id to the reader and nothing else', async () => {
    let seen;
    await currentPlan(userId, async (id) => {
      seen = id;
      return null;
    });
    assert.equal(seen, userId);
  });

  test('a FAILED read is Free, and it does not throw (edge case P10)', async () => {
    // 006 not applied: PostgREST answers PGRST205. The gates must still run,
    // and the indexing path — which calls this — must never fail a save.
    const missingTable = Object.assign(new Error('relation does not exist'), { code: 'PGRST205' });
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(
        await currentPlan(userId, async () => {
          throw missingTable;
        }),
        'free',
      );
    } finally {
      console.error = originalError;
    }
  });
});

describe('planViewOf — the Settings Plan block, from one read', () => {
  test('a failed read is `unavailable`, never a plain Free card', () => {
    assert.deepEqual(planViewOf({ ok: false }, NOW), { kind: 'unavailable', plan: 'free' });
  });

  test('no row is the Free card', () => {
    assert.deepEqual(planViewOf({ ok: true, row: null }, NOW), { kind: 'free', plan: 'free' });
  });

  test('a Pro row carries its period end and whether it is cancelling', () => {
    assert.deepEqual(planViewOf({ ok: true, row: row('active', FUTURE, true) }, NOW), {
      kind: 'pro',
      plan: 'pro',
      periodEnd: FUTURE,
      cancelAtPeriodEnd: true,
    });
  });

  test('past_due is its own card — Free, with a customer to manage', () => {
    assert.deepEqual(planViewOf({ ok: true, row: row('past_due', FUTURE) }, NOW), {
      kind: 'pastDue',
      plan: 'free',
    });
  });

  test('a lapsed Pro row reads as the Free card, agreeing with the gates', () => {
    const view = planViewOf({ ok: true, row: row('active', PAST) }, NOW);
    assert.equal(view.kind, 'free');
    assert.equal(view.plan, planFromLatestRow(row('active', PAST), NOW));
  });
});
