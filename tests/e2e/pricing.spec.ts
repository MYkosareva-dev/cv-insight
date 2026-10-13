import { expect, test } from '@playwright/test';

import { PRICING } from '../../src/lib/copy';

/**
 * /pricing, signed out (SPEC v3.0, Block E; US-7 step 2).
 *
 * The page is public and matcher-excluded as an exact path, so a visitor must
 * get the page itself — not a redirect to /login — with both plans and the
 * visitor variant of the one session-dependent control. The button label is
 * asserted as a literal rather than through `PRICING`, so a copy change that
 * drifts from SPEC fails here instead of passing with it.
 */
test('signed-out /pricing renders both plans and offers sign-in to upgrade', async ({ page }) => {
  const response = await page.goto('/pricing');
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/pricing');

  await expect(page.getByRole('region', { name: 'Free', exact: true })).toBeVisible();
  const pro = page.getByRole('region', { name: 'Pro', exact: true });
  await expect(pro).toBeVisible();

  const signIn = pro.getByRole('link', { name: 'Sign in to upgrade' });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href', '/login');

  // No member control reaches a visitor.
  await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0);

  await expect(pro.getByText(PRICING.testModeLine)).toBeVisible();
});
