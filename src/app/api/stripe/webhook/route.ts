import 'server-only';

import { NextResponse } from 'next/server';

import { handleStripeWebhook } from '@/lib/billing/webhook';
import { appendFromStripeEvent, userIdForCustomer } from '@/lib/db/subscriptionEvents';
import { stripeClient, webhookSecret } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/stripe/webhook — SPEC Block D #13 (v3.0). PUBLIC: Stripe carries no
 * session. The ONLY writer of `subscription_events`, and the SECOND consumer of
 * the service-role client (check.mjs R10 names both).
 *
 * Outside the middleware fence through the matcher's existing `api` exclusion,
 * which already covers every route handler — so no pattern of its own is added
 * (a second, narrower exclusion would be dead regex). This handler is its own
 * fence, and the fence is the signature.
 *
 * WHY THE SERVICE ROLE, and only after verification: the table has no INSERT
 * policy for any user role, so the write has to come from something that is not
 * the user; and the customer-id lookup has no session for RLS to scope, so under
 * any other client it would find nobody. The admin client is constructed lazily,
 * inside the callbacks, so an unverified request never builds one.
 *
 * The decisions — signature first, the three event types, attribution order,
 * replay-as-200 — live in `lib/billing/webhook.ts`, where unit fixtures pin them.
 * This file is the wiring: the RAW body, the secrets, the clients.
 *
 * No model call, no embeddings, no other side effect; `maxDuration` is not raised.
 */
export async function POST(request: Request) {
  // 1. The RAW body. A parsed body cannot be verified, so this is the one route
  //    in the app that does not go through the Zod boundary first.
  const raw = await request.text();

  let admin: ReturnType<typeof createAdminClient> | null = null;
  const serviceRole = () => (admin ??= createAdminClient());

  try {
    const stripe = stripeClient();
    const secret = webhookSecret();
    const result = await handleStripeWebhook(raw, request.headers.get('stripe-signature'), {
      verify: (body, signature) => stripe.webhooks.constructEvent(body, signature, secret),
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
      userIdForCustomer: (customerId) => userIdForCustomer(serviceRole(), customerId),
      append: (row) => appendFromStripeEvent(serviceRole(), row),
      // Event id only — never a payload field, never an email address.
      warn: (message, eventId) => console.warn(message, { eventId }),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    // Misconfiguration (a missing secret, a live key): names the error class only.
    console.error('[stripe] webhook could not run', {
      name: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Something went wrong.' } },
      { status: 500 },
    );
  }
}
