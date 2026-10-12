import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import Stripe from 'stripe';

import { handleStripeWebhook } from '../../src/lib/billing/webhook.ts';

/**
 * Endpoint #13's decisions against recorded fixtures (SPEC v3.0, Block H item
 * 13): three event deliveries, one replay, and a signature made with the wrong
 * secret.
 *
 * THE SIGNATURE CHECK IS THE REAL ONE. `verify` here is the Stripe SDK's own
 * `constructEvent` over the raw body, and the header is produced by the SDK's
 * own test helper — so "a wrong secret is refused" is a statement about the
 * library the route actually calls, not about a stub that says no.
 *
 * Both secrets below are FIXTURES that authorise nothing: the key is never used
 * to make a request (no network call happens in this file), and the signing
 * secret is invented here. Neither is read from the environment.
 */

const stripe = new Stripe('sk_test_unit_fixture_not_a_real_key');
const SECRET = 'whsec_unit_fixture_secret';
const WRONG_SECRET = 'whsec_some_other_endpoint';

const USER = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = 'cus_RkT9yQ2pL0mN4v';
const SUBSCRIPTION = 'sub_1QzK3kLq8xNpT2cRf7Gh2Vd3';
const PERIOD_END_ISO = '2026-11-12T10:14:02.000Z';
const PERIOD_END_S = Date.parse(PERIOD_END_ISO) / 1000;

/** SPEC §13's fixture, trimmed to what the handler reads. */
const checkoutCompleted = {
  id: 'evt_1QzK3mLq8xNpT2cR0vY7wHsA',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_a1B2c3D4e5F6g7H8i9J0kL',
      client_reference_id: USER,
      customer: CUSTOMER,
      subscription: SUBSCRIPTION,
      mode: 'subscription',
      payment_status: 'paid',
      status: 'complete',
    },
  },
};

/**
 * The subscription as Stripe returns it on the pinned API version: the billing
 * period lives on the ITEM, and the subscription-level field does not exist.
 */
const subscription = (overrides = {}) => ({
  id: SUBSCRIPTION,
  object: 'subscription',
  customer: CUSTOMER,
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: { user_id: USER },
  items: { object: 'list', data: [{ id: 'si_1', current_period_end: PERIOD_END_S }] },
  ...overrides,
});

const subscriptionEvent = (id, type, object) => ({ id, type, data: { object } });

const signed = (event, secret = SECRET) => {
  const payload = JSON.stringify(event);
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret }) };
};

/** A fake ledger with the one property the real one guarantees: stripe_event_id is unique. */
function harness({ current = subscription(), ledgerCustomers = {}, append } = {}) {
  const rows = [];
  const calls = { retrieve: 0, lookup: 0, append: 0, warn: [] };
  const deps = {
    verify: (raw, signature) => stripe.webhooks.constructEvent(raw, signature, SECRET),
    retrieveSubscription: async (id) => {
      calls.retrieve += 1;
      assert.equal(id, SUBSCRIPTION);
      if (current instanceof Error) throw current;
      return current;
    },
    userIdForCustomer: async (customerId) => {
      calls.lookup += 1;
      return ledgerCustomers[customerId] ?? null;
    },
    append:
      append ??
      (async (row) => {
        calls.append += 1;
        if (rows.some((r) => r.stripe_event_id === row.stripe_event_id)) return 'duplicate';
        rows.push(row);
        return 'inserted';
      }),
    warn: (message, eventId) => calls.warn.push({ message, eventId }),
  };
  return { deps, rows, calls };
}

describe('POST /api/stripe/webhook — three recorded deliveries', () => {
  test('checkout.session.completed writes the row SPEC §13 shows', async () => {
    const { deps, rows } = harness();
    const { payload, header } = signed(checkoutCompleted);
    const result = await handleStripeWebhook(payload, header, deps);
    assert.deepEqual(result, { status: 200, body: { received: true } });
    assert.deepEqual(rows, [
      {
        user_id: USER,
        stripe_event_id: 'evt_1QzK3mLq8xNpT2cR0vY7wHsA',
        stripe_event_type: 'checkout.session.completed',
        stripe_customer_id: CUSTOMER,
        stripe_subscription_id: SUBSCRIPTION,
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: PERIOD_END_ISO,
      },
    ]);
  });

  test('customer.subscription.updated with cancel_at_period_end appends a NEW row (P7)', async () => {
    const cancelling = subscription({ cancel_at_period_end: true });
    const { deps, rows } = harness({ current: cancelling });
    const { payload, header } = signed(
      subscriptionEvent('evt_updated_1', 'customer.subscription.updated', cancelling),
    );
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cancel_at_period_end, true);
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].user_id, USER, 'attributed by subscription.metadata.user_id');
  });

  test('a Portal cancellation carried by `cancel_at` with the old flag FALSE reads as cancelling', async () => {
    /**
     * The shape a local run actually received (docs/eval/billing-webhook-evidence.md):
     * on the pinned API version, "cancel at period end" in the Customer Portal
     * sets `cancel_at` and leaves `cancel_at_period_end` false. Reading the flag
     * alone stored "not cancelling", and Settings said "Renews" for a
     * subscription Stripe showed as ending.
     */
    const scheduled = subscription({ cancel_at_period_end: false, cancel_at: PERIOD_END_S });
    const { deps, rows } = harness({ current: scheduled });
    const { payload, header } = signed(
      subscriptionEvent('evt_portal_cancel', 'customer.subscription.updated', scheduled),
    );
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(rows[0].cancel_at_period_end, true, 'cancel_at alone means cancel-scheduled');
    assert.equal(rows[0].status, 'active', 'still Pro until the end');
    assert.equal(rows[0].current_period_end, PERIOD_END_ISO);
  });

  test('when `cancel_at` is set it IS the end, even before the billing period would close', async () => {
    const early = PERIOD_END_S - 5 * 24 * 60 * 60;
    const scheduled = subscription({ cancel_at: early });
    const { deps, rows } = harness({ current: scheduled });
    const { payload, header } = signed(
      subscriptionEvent('evt_cancel_early', 'customer.subscription.updated', scheduled),
    );
    await handleStripeWebhook(payload, header, deps);
    assert.equal(rows[0].current_period_end, new Date(early * 1000).toISOString());
    assert.equal(rows[0].cancel_at_period_end, true);
  });

  test('customer.subscription.deleted appends the final row', async () => {
    const ended = subscription({ status: 'canceled' });
    const { deps, rows } = harness({ current: ended });
    const { payload, header } = signed(
      subscriptionEvent('evt_deleted_1', 'customer.subscription.deleted', ended),
    );
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'canceled');
    assert.equal(rows[0].stripe_event_type, 'customer.subscription.deleted');
  });

  test('every row records Stripe’s CURRENT state, so a late redelivery cannot resurrect Pro', async () => {
    // An old `updated(active)` redelivered after the subscription was cancelled:
    // the event body says active, Stripe now says canceled, and the row says
    // what Stripe says now.
    const { deps, rows, calls } = harness({ current: subscription({ status: 'canceled' }) });
    const { payload, header } = signed(
      subscriptionEvent('evt_old_update', 'customer.subscription.updated', subscription()),
    );
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(calls.retrieve, 1);
    assert.equal(rows[0].status, 'canceled');
  });
});

describe('idempotency — the unique stripe_event_id', () => {
  test('a replayed event answers 200 and leaves ONE row, not two (P4)', async () => {
    const { deps, rows, calls } = harness();
    const { payload, header } = signed(checkoutCompleted);
    const first = await handleStripeWebhook(payload, header, deps);
    const replay = await handleStripeWebhook(payload, header, deps);
    assert.equal(first.status, 200);
    assert.deepEqual(replay, { status: 200, body: { received: true } });
    assert.equal(calls.append, 2, 'the replay reached the database');
    assert.equal(rows.length, 1, 'and the database kept one row');
  });
});

describe('the signature comes first', () => {
  test('a body signed with a DIFFERENT secret is 400 and touches nothing (P5)', async () => {
    const { deps, rows, calls } = harness();
    const { payload, header } = signed(checkoutCompleted, WRONG_SECRET);
    const result = await handleStripeWebhook(payload, header, deps);
    assert.equal(result.status, 400);
    assert.equal(rows.length, 0);
    assert.deepEqual(
      { retrieve: calls.retrieve, lookup: calls.lookup, append: calls.append, warn: calls.warn.length },
      { retrieve: 0, lookup: 0, append: 0, warn: 0 },
      'nothing read, nothing written, nothing logged',
    );
  });

  test('a missing signature header is 400', async () => {
    const { deps, calls } = harness();
    const result = await handleStripeWebhook(JSON.stringify(checkoutCompleted), null, deps);
    assert.equal(result.status, 400);
    assert.equal(calls.append, 0);
  });

  test('a body altered after signing is 400 — the RAW body is what is verified', async () => {
    const { deps, calls } = harness();
    const { payload, header } = signed(checkoutCompleted);
    const tampered = payload.replace(USER, '22222222-2222-2222-2222-222222222222');
    assert.equal((await handleStripeWebhook(tampered, header, deps)).status, 400);
    assert.equal(calls.append, 0);
  });

  test('an unsigned event of an UNHANDLED type is still 400: verification precedes the type switch', async () => {
    const { deps } = harness();
    const result = await handleStripeWebhook(
      JSON.stringify({ id: 'evt_x', type: 'charge.refunded', data: { object: {} } }),
      't=1,v1=deadbeef',
      deps,
    );
    assert.equal(result.status, 400);
  });
});

describe('what is answered 200 and written nowhere', () => {
  test('an event type this app does not use (P13: charge.refunded)', async () => {
    const { deps, calls } = harness();
    const { payload, header } = signed({ id: 'evt_refund', type: 'charge.refunded', data: { object: {} } });
    assert.deepEqual(await handleStripeWebhook(payload, header, deps), {
      status: 200,
      body: { received: true },
    });
    assert.deepEqual([calls.retrieve, calls.append], [0, 0]);
  });

  test('a Checkout Session that is not a subscription', async () => {
    const { deps, calls } = harness();
    const oneOff = structuredClone(checkoutCompleted);
    oneOff.data.object.mode = 'payment';
    const { payload, header } = signed(oneOff);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.deepEqual([calls.retrieve, calls.append], [0, 0]);
  });

  test('an event no account can be attributed to: 200 and a warn with the event id only (P6)', async () => {
    const anonymous = subscription({ metadata: {} });
    const { deps, calls } = harness({ current: anonymous });
    const { payload, header } = signed(
      subscriptionEvent('evt_orphan', 'customer.subscription.updated', anonymous),
    );
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(calls.lookup, 1, 'the ledger lookup by customer id was the last resort');
    assert.equal(calls.append, 0);
    assert.deepEqual(calls.warn.map((w) => w.eventId), ['evt_orphan']);
  });

  test('an account deleted since (FK violation): 200 and a warn, not three days of retries (P12)', async () => {
    const { deps, calls } = harness({ append: async () => 'unknown_user' });
    const { payload, header } = signed(checkoutCompleted);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(calls.warn.length, 1);
  });
});

describe('attribution order', () => {
  test('client_reference_id wins over metadata', async () => {
    const other = '33333333-3333-3333-3333-333333333333';
    const { deps, rows } = harness({ current: subscription({ metadata: { user_id: other } }) });
    const { payload, header } = signed(checkoutCompleted);
    await handleStripeWebhook(payload, header, deps);
    assert.equal(rows[0].user_id, USER);
  });

  test('a non-UUID client_reference_id is ignored, and metadata attributes instead', async () => {
    const { deps, rows } = harness();
    const odd = structuredClone(checkoutCompleted);
    odd.data.object.client_reference_id = 'not-a-uuid';
    const { payload, header } = signed(odd);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 200);
    assert.equal(rows[0].user_id, USER);
  });

  test('with neither, the ledger’s record of the customer attributes the event', async () => {
    const known = '44444444-4444-4444-4444-444444444444';
    const { deps, rows } = harness({
      current: subscription({ metadata: {} }),
      ledgerCustomers: { [CUSTOMER]: known },
    });
    const { payload, header } = signed(
      subscriptionEvent('evt_by_customer', 'customer.subscription.updated', subscription({ metadata: {} })),
    );
    await handleStripeWebhook(payload, header, deps);
    assert.equal(rows[0].user_id, known);
  });
});

describe('what is answered non-2xx, so Stripe redelivers and the dashboard shows it', () => {
  test('the subscription cannot be read: 500, nothing written', async () => {
    const { deps, calls } = harness({ current: new Error('stripe unavailable') });
    const { payload, header } = signed(checkoutCompleted);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 500);
    assert.equal(calls.append, 0);
  });

  test('a subscription with no period end on its items: 500, never a row that reads as Free', async () => {
    // The pinned API version carries the period on the item. A shape without it
    // must not become `current_period_end: null`, which rule B11 reads as Free —
    // a paying user silently downgraded.
    const { deps, calls } = harness({ current: subscription({ items: { data: [] } }) });
    const { payload, header } = signed(checkoutCompleted);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 500);
    assert.equal(calls.append, 0);
  });

  test('the database fails for a reason that is not the replay: 500', async () => {
    const { deps } = harness({
      append: async () => {
        throw Object.assign(new Error('connection reset'), { code: '08006' });
      },
    });
    const { payload, header } = signed(checkoutCompleted);
    assert.equal((await handleStripeWebhook(payload, header, deps)).status, 500);
  });
});
