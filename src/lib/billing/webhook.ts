import { z } from 'zod';

import type { NewSubscriptionEvent, AppendOutcome } from '@/lib/db/subscriptionEvents';

/**
 * The Stripe webhook's decisions, as a PURE function (SPEC v3.0, endpoint #13).
 *
 * The route handler (`src/app/api/stripe/webhook/route.ts`) owns the secrets and
 * the service-role client and passes them in as functions; this module owns the
 * ORDER of everything and every answer it gives. Split this way because the
 * route must import `server-only` modules, which `node --test` cannot load — and
 * the order (signature first, then type, then attribution, then the write) is
 * the part worth pinning with fixtures.
 *
 * It imports nothing at runtime but Zod: the DAL import above is `import type`,
 * erased before Node or the bundler ever sees it.
 */

/** The three event types this app subscribes to; any other is a 200 that writes nothing. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type WebhookDeps = {
  /**
   * `stripe.webhooks.constructEvent` over the RAW body with the endpoint's
   * signing secret. Throws on a missing, malformed or wrong signature.
   */
  verify: (raw: string, signature: string) => unknown;
  /** `stripe.subscriptions.retrieve(id)` — Stripe's CURRENT state of the subscription. */
  retrieveSubscription: (id: string) => Promise<unknown>;
  /** The ledger's own answer to "whose customer is this?", through the service role. */
  userIdForCustomer: (customerId: string) => Promise<string | null>;
  /** One INSERT through the service role; a replay is `duplicate`, a deleted account `unknown_user`. */
  append: (row: NewSubscriptionEvent) => Promise<AppendOutcome>;
  /** One line, event id only — never a payload, never an email address. */
  warn: (message: string, eventId: string) => void;
};

export type WebhookResult = { status: number; body: unknown };

const RECEIVED: WebhookResult = { status: 200, body: { received: true } };

/** Generic bodies: nothing about why, so a prober learns nothing from the answer. */
const BAD_SIGNATURE: WebhookResult = {
  status: 400,
  body: { error: { code: 'VALIDATION_ERROR', message: 'Webhook signature could not be verified.' } },
};
const FAILED: WebhookResult = {
  status: 500,
  body: { error: { code: 'SERVER_ERROR', message: 'Something went wrong.' } },
};

/**
 * The shape Postgres's `uuid` type accepts — any 8-4-4-4-12 hex — and not Zod's
 * RFC-strict `uuid()`, which also checks version and variant bits. The question
 * here is "would the insert accept this id?", and a stricter answer would turn a
 * valid id into an unattributed event.
 */
const Uuid = z.guid();

/** The envelope, read only AFTER `constructEvent` has verified it. */
const Envelope = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.unknown() }),
});

/** The fields of a Checkout Session the handler uses — nothing else is parsed. */
const CheckoutSession = z.object({
  mode: z.string(),
  client_reference_id: z.string().nullish(),
  customer: z.string().nullish(),
  subscription: z.string().nullish(),
});

const SubscriptionId = z.object({ id: z.string().min(1) });

/**
 * The fields of a Subscription the ledger records.
 *
 * `current_period_end` IS READ OFF THE ITEMS, NOT THE SUBSCRIPTION. On the API
 * version this SDK pins (2026-08-26), Stripe carries the billing period on each
 * subscription item; the subscription-level field SPEC §13 names no longer
 * exists there. Reading it would write `null` for every paying user — and a null
 * period end is Free by rule B11, silently. With one price there is one item; the
 * latest period end across items is taken so a second item could never shorten
 * the period.
 */
const Subscription = z.object({
  id: z.string().min(1),
  customer: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]),
  status: z.string().min(1),
  cancel_at_period_end: z.boolean(),
  cancel_at: z.number().int().positive().nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
  items: z.object({
    data: z.array(z.object({ current_period_end: z.number().int().positive() })).min(1),
  }),
});

type Snapshot = {
  subscriptionId: string;
  customerId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
  metadataUserId: string | null;
};

function snapshotOf(raw: unknown): Snapshot | null {
  const parsed = Subscription.safeParse(raw);
  if (!parsed.success) return null;
  const sub = parsed.data;
  const periodEnd = Math.max(...sub.items.data.map((item) => item.current_period_end));
  /**
   * A SCHEDULED CANCELLATION IS CARRIED BY `cancel_at`, NOT BY THE FLAG. On the
   * pinned API version (flexible billing mode), cancelling "at period end" in the
   * Customer Portal sets `cancel_at` to a timestamp and leaves
   * `cancel_at_period_end` false — witnessed in a local run, where both
   * `updated` rows read "not cancelling" and Settings said "Renews" for a
   * subscription Stripe showed as ending (docs/eval/billing-webhook-evidence.md).
   * Either signal therefore means cancel-scheduled, and when `cancel_at` is set
   * it IS the end: Pro lasts until then, and no later.
   */
  const cancelAt = sub.cancel_at ?? null;
  const end = cancelAt ?? periodEnd;
  const metadataUserId = sub.metadata?.user_id;
  return {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end || cancelAt !== null,
    currentPeriodEnd: new Date(end * 1000).toISOString(),
    metadataUserId: metadataUserId && Uuid.safeParse(metadataUserId).success ? metadataUserId : null,
  };
}

/**
 * Handle one delivery. In order, and the order is the design:
 *
 *  1. VERIFY the raw body's signature. Missing or invalid → 400, nothing
 *     written, nothing logged: verification precedes everything, including the
 *     event-type switch.
 *  2. An event type this app does not use → 200, nothing written. Stripe
 *     retries non-2xx, and an unused event must not be retried at it.
 *  3. Read the subscription's CURRENT state from Stripe, for every handled
 *     event — not only for Checkout, which does not carry it. Stripe does not
 *     deliver in order and redelivers failed deliveries for a limited window,
 *     so a late copy of an old
 *     `updated(active)` would otherwise land after `deleted` and hand Pro back.
 *     Reading the subscription at receipt makes every row record what Stripe
 *     says NOW, whichever event announced it. A failed read → 500 and nothing
 *     written, so Stripe redelivers.
 *  4. ATTRIBUTE: `client_reference_id`, then `subscription.metadata.user_id`,
 *     then the ledger's own record of the customer. Ids that are not UUIDs are
 *     ignored rather than written — a malformed id would fail the insert, answer
 *     500 and be redelivered to no purpose. No user → 200 and a warn line with
 *     the event id, and no redelivery: only read, parse and insert failures
 *     answer 500 and are redelivered (SPEC M12, "no reconciliation job").
 *  5. APPEND one row. A replay is a unique violation, caught in the DAL and
 *     answered 200 — the idempotency is the database's. A deleted account
 *     (foreign-key violation) is unattributable, not a failure → 200 and a warn.
 *  6. Anything unexpected → 500 with a generic body, nothing about the payload.
 *
 * A verified event whose fields do not parse is a 500, not a silent 200: it is
 * visible in the Stripe dashboard's webhook log, which is where an operator
 * looks when a paid upgrade has not arrived (edge case P15).
 */
export async function handleStripeWebhook(
  raw: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  if (!signature) return BAD_SIGNATURE;
  let verified: unknown;
  try {
    verified = deps.verify(raw, signature);
  } catch {
    return BAD_SIGNATURE;
  }

  const envelope = Envelope.safeParse(verified);
  if (!envelope.success) return FAILED;
  const event = envelope.data;
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) return RECEIVED;

  try {
    let subscriptionId: string;
    let referenceUserId: string | null = null;

    if (event.type === 'checkout.session.completed') {
      const session = CheckoutSession.safeParse(event.data.object);
      if (!session.success) return FAILED;
      // A one-off payment, or a session with no subscription, is not a plan.
      if (session.data.mode !== 'subscription' || !session.data.subscription) return RECEIVED;
      subscriptionId = session.data.subscription;
      const ref = session.data.client_reference_id;
      referenceUserId = ref && Uuid.safeParse(ref).success ? ref : null;
    } else {
      const sub = SubscriptionId.safeParse(event.data.object);
      if (!sub.success) return FAILED;
      subscriptionId = sub.data.id;
    }

    const snapshot = snapshotOf(await deps.retrieveSubscription(subscriptionId));
    if (!snapshot) return FAILED;

    const userId =
      referenceUserId ??
      snapshot.metadataUserId ??
      (await deps.userIdForCustomer(snapshot.customerId));
    if (!userId) {
      deps.warn('[stripe] event could not be attributed to an account', event.id);
      return RECEIVED;
    }

    const outcome = await deps.append({
      user_id: userId,
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_customer_id: snapshot.customerId,
      stripe_subscription_id: snapshot.subscriptionId,
      status: snapshot.status,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      current_period_end: snapshot.currentPeriodEnd,
    });
    if (outcome === 'unknown_user') {
      deps.warn('[stripe] event names an account that no longer exists', event.id);
    }
    return RECEIVED;
  } catch {
    // The event id is enough to find the delivery in Stripe's log; the error
    // itself could carry payload fields, so it is not printed.
    deps.warn('[stripe] event handling failed; Stripe will redeliver', event.id);
    return FAILED;
  }
}
