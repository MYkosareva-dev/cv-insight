import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { SETTINGS } from '@/lib/copy';
import { latestForUser } from '@/lib/db/subscriptionEvents';
import { NotFoundError, ServerError, apiErrorResponse } from '@/lib/errors';
import { stripeClient } from '@/lib/stripe/server';

/**
 * POST /api/billing/portal — SPEC Block D #12 (v3.0). Member.
 *
 * Opens a Stripe Customer Portal session for the caller's own customer and
 * answers `{ url }`; the client navigates, as for #11.
 *
 * The customer id comes from the caller's OWN latest ledger row, read under
 * their session — never from the request, so a caller cannot open someone
 * else's portal. No row, or no customer on it → 404 NOT_FOUND: a Free user has
 * no customer object to manage, and 404-not-403 is the house rule.
 *
 * It gates on the CUSTOMER, not on the plan. A `past_due` user is Free by rule
 * B11 and still has a subscription to fix (edge case P11), and the portal is
 * where they fix it.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const origin = new URL(request.url).origin;

    const latest = await latestForUser(user.id);
    if (!latest?.stripe_customer_id) throw new NotFoundError();

    let url: string;
    try {
      const session = await stripeClient().billingPortal.sessions.create({
        customer: latest.stripe_customer_id,
        return_url: `${origin}/settings`,
      });
      url = session.url;
    } catch (err) {
      console.error('[billing] portal session could not be created', {
        name: err instanceof Error ? err.name : typeof err,
      });
      throw new ServerError(SETTINGS.portalFailed);
    }

    return NextResponse.json({ url });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
