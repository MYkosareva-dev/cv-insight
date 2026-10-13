import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { SETTINGS } from '@/lib/copy';
import { ServerError, apiErrorResponse } from '@/lib/errors';
import { proPriceId, stripeClient } from '@/lib/stripe/server';

/**
 * POST /api/billing/checkout — SPEC Block D #11 (v3.0). Member.
 *
 * Creates a Stripe Checkout Session for the Pro price and answers `{ url }`.
 * The CLIENT then navigates with `window.location.assign(url)`.
 *
 * NOTHING IS WRITTEN. No `pending` row, no "awaiting payment" state, nothing to
 * clean up: a user who closes the Stripe tab leaves no trace in this database,
 * and the first ledger row is the webhook's `checkout.session.completed`.
 *
 * JSON + CLIENT NAVIGATION, NOT A 303. The CSP sets `form-action 'self'`, and
 * Chromium applies it to the redirect a form submission is answered with — a
 * 303 to checkout.stripe.com would be blocked by the app's own policy. A
 * navigation the page performs itself is not a form action, so the CSP stays
 * exactly as inventoried.
 *
 * A Pro caller is NOT refused here: that would be a plan decision in a route
 * handler, which rule B11 forbids. Stripe's "limit customers to one
 * subscription" setting is the fence, and Settings never shows [Upgrade] to Pro.
 *
 * `cancel_url` is /pricing: a cancelled Checkout lands back on the plans it was
 * opened from, with nothing written on either side.
 */

/** The shortest Checkout lifetime Stripe accepts (30 minutes to 24 hours). */
const CHECKOUT_LIFETIME_S = 30 * 60;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const origin = new URL(request.url).origin;

    let url: string | null;
    try {
      const session = await stripeClient().checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: proPriceId(), quantity: 1 }],
        // The two attribution keys the webhook reads. Neither is a credential.
        client_reference_id: user.id,
        customer_email: user.email,
        subscription_data: { metadata: { user_id: user.id } },
        success_url: `${origin}/settings?checkout=success`,
        cancel_url: `${origin}/pricing`,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_LIFETIME_S,
      });
      url = session.url;
    } catch (err) {
      // Metadata only: a Stripe error can echo request fields, the email included.
      console.error('[billing] checkout session could not be created', {
        name: err instanceof Error ? err.name : typeof err,
      });
      throw new ServerError(SETTINGS.checkoutFailed);
    }
    if (!url) throw new ServerError(SETTINGS.checkoutFailed);

    return NextResponse.json({ url });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
