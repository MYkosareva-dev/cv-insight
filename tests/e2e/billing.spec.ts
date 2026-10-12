import { expect, test, type Page } from '@playwright/test';

import { ERROR_CODES, SETTINGS } from '../../src/lib/copy';

/**
 * Billing, end to end against the app and Stripe's TEST MODE (SPEC v3.0, Block
 * H item 13).
 *
 * Needs a server whose `.env.local` carries the three Stripe test-mode names
 * (`STRIPE_SECRET_KEY` a `sk_test_` key, `STRIPE_WEBHOOK_SECRET`,
 * `STRIPE_PRICE_PRO`) and migration 006 applied. It reads none of them itself:
 * `tests/` is in scope for check.mjs R7/R10, and nothing here needs a secret —
 * every assertion is about what the app answers.
 *
 * WHAT IS NOT HERE. The Pro half of item 13 — `/api/billing/portal` answering a
 * `billing.stripe.com` URL for a Pro account — needs a ledger row, which only
 * the webhook may write and which this file cannot forge without the signing
 * secret (R7). It is witnessed through a real test-mode Checkout in
 * docs/eval/billing-webhook-evidence.md and marked `fixme` below.
 */

const password = 'billing-e2e-password';

let created: string[] = [];

const uniqueEmail = () => {
  const email = `billing-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

async function signUp(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/career$/);
}

async function deleteAccountViaUi(page: Page, email: string) {
  await page.goto('/settings');
  const trigger = page.getByRole('button', { name: 'Delete account and data' });
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/scan$/, { timeout: 15_000 }).catch(() => {});
    await page.goto('/settings');
  }
  const confirmTrigger = page.getByRole('button', { name: 'Delete account and data' });
  if (!(await confirmTrigger.isVisible().catch(() => false))) return;
  await confirmTrigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('DELETE').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.waitForURL(/\/login/);
}

test.describe('billing', () => {
  test.beforeEach(() => {
    created = [];
  });

  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {});
    }
  });

  test('both member billing endpoints refuse a signed-out caller with 401', async ({ request }) => {
    for (const endpoint of ['checkout', 'portal']) {
      const res = await request.post(`/api/billing/${endpoint}`, { data: {} });
      expect(res.status(), endpoint).toBe(401);
    }
  });

  test('[Upgrade] answers a checkout.stripe.com URL as JSON, not a redirect', async ({ page }) => {
    await signUp(page, uniqueEmail());
    const res = await page.request.post('/api/billing/checkout', { data: {}, maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).hostname).toBe('checkout.stripe.com');
  });

  test('the portal is 404 for a Free account — there is no customer to manage', async ({ page }) => {
    await signUp(page, uniqueEmail());
    const res = await page.request.post('/api/billing/portal', { data: {} });
    expect(res.status()).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  test('Settings shows the Free card with [Upgrade to Pro]', async ({ page }) => {
    await signUp(page, uniqueEmail());
    await page.goto('/settings');
    await expect(page.getByText(SETTINGS.planFree, { exact: true })).toBeVisible();
    await expect(page.getByText(SETTINGS.planFreeLimits, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: SETTINGS.upgrade })).toBeVisible();
  });

  test('`?checkout=success` with no ledger row is never a fact: pending, and no second [Upgrade] (P3)', async ({
    page,
  }) => {
    await signUp(page, uniqueEmail());
    await page.goto('/settings?checkout=success');
    await expect(page.getByText(SETTINGS.planFree, { exact: true })).toBeVisible();
    await expect(page.getByText(SETTINGS.upgradePending, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: SETTINGS.upgrade })).toHaveCount(0);
  });

  test('the webhook refuses a delivery with no signature, or a forged one, with 400 (P5)', async ({
    request,
  }) => {
    const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: {} } });
    const unsigned = await request.post('/api/stripe/webhook', {
      data: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(unsigned.status()).toBe(400);

    const forged = await request.post('/api/stripe/webhook', {
      data: body,
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    });
    expect(forged.status()).toBe(400);
  });

  test.fixme('a Pro account’s portal call answers a billing.stripe.com URL', async () => {
    // Needs a webhook-written ledger row — see the header. Witnessed in
    // docs/eval/billing-webhook-evidence.md.
  });
});
