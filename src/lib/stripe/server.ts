import 'server-only';

import Stripe from 'stripe';

/**
 * THE Stripe client (SPEC v3.0, M12). The one module that reads
 * `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO`, and it is
 * imported by exactly the three billing route handlers — `scripts/check.mjs` R10
 * fails the build on a fourth importer.
 *
 * Built the way `lib/supabase/admin.ts` is, for the same reasons:
 *  - FUNCTIONS, not module-level constants, so no secret is read at import or
 *    build time — only inside a request that has already passed its own fence
 *    (a verified user for checkout and portal, a verified signature for the
 *    webhook).
 *  - Errors name the VARIABLE, never its value.
 *
 * TEST MODE IS NOT A FLAG IN THIS APP — IT IS THE KEY. A `sk_test_` key cannot
 * move money, and CLAUDE.md requires one on every environment this project
 * deploys to. The guard below makes that a mechanism rather than a sentence: a
 * live key refuses to build a client at all, so no billing route can run on it.
 * The day this app is meant to take real payments, this guard is removed in the
 * same change that puts the operator's postal address on /impressum.
 *
 * The API version is the one this SDK release pins (`new Stripe(key)` with no
 * override), so the shapes the webhook reads are the shapes its types describe.
 * The webhook endpoint in the Stripe dashboard must be created on the same
 * version — see docs/deploy.md.
 *
 * No Stripe script is ever loaded in the browser: Checkout and the Customer
 * Portal are Stripe-hosted pages, so the CSP is untouched (SPEC Block F).
 */

const TEST_KEY_PREFIX = 'sk_test_';

function required(name: 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET' | 'STRIPE_PRICE_PRO'): string {
  const value =
    name === 'STRIPE_SECRET_KEY'
      ? process.env.STRIPE_SECRET_KEY
      : name === 'STRIPE_WEBHOOK_SECRET'
        ? process.env.STRIPE_WEBHOOK_SECRET
        : process.env.STRIPE_PRICE_PRO;
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** The Stripe client, on a test-mode key or not at all. */
export function stripeClient(): Stripe {
  const key = required('STRIPE_SECRET_KEY');
  if (!key.startsWith(TEST_KEY_PREFIX)) {
    // Names the rule, never the value.
    throw new Error('STRIPE_SECRET_KEY is not a test-mode key; this deployment runs Stripe in test mode only');
  }
  return new Stripe(key);
}

/** The webhook endpoint's signing secret. Differs between `stripe listen` and the deployment. */
export function webhookSecret(): string {
  return required('STRIPE_WEBHOOK_SECRET');
}

/** The one recurring Pro price in the test-mode dashboard. */
export function proPriceId(): string {
  return required('STRIPE_PRICE_PRO');
}
