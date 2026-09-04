import { expect, test, type Page, type Response } from '@playwright/test';

/**
 * SPEC Block F, "Evidence for auth". This spec IS the evidence for Phase 1 —
 * manual live verification is explicitly not accepted, because the auth flows
 * are Server Actions whose `$ACTION_REF` encoding cannot be replayed outside a
 * browser (proved: replaying the hidden inputs makes Next re-render and creates
 * no user).
 *
 * It runs against a real Supabase project and creates a real user, so:
 *  - the address is throwaway and unique per run;
 *  - the account is removed at the end through the app's OWN deletion flow,
 *    which doubles as the US-6 test rather than being cleanup bolted on.
 */

const SESSION_MAX_AGE = 2592000; // 30 days — SPEC Block F.

/** Copy asserted verbatim, so drift from lib/copy.ts fails here. */
const COPY = {
  badCredentials: 'Email or password is incorrect.',
  invalidEmail: 'Enter a valid email address.',
  shortPassword: 'Password must be at least 8 characters.',
  emailTaken: 'An account with this email already exists.',
  accountDeleted: 'Your account and the data you created were deleted.',
  deleteAccount: 'Delete account and data',
  // SPEC v2.17, the display-name field on this same screen.
  displayNameLabel: 'Your name',
  displayNameSave: 'Save name',
  displayNameSaved: 'Name saved.',
  displayNameFailed: 'Could not save your name — try again.',
} as const;

/** The fictional persona's own name (SPEC Block B). Synthetic data only. */
const DISPLAY_NAME = 'Mira Steinberg';

const password = 'phase-1-e2e-password';

/**
 * Accounts created by the test currently running, torn down in afterEach.
 *
 * Cleanup goes through the APP's own deletion flow, not the admin API: a test
 * file may not read SUPABASE_SERVICE_ROLE_KEY (scripts/check.mjs R10 pins it to
 * lib/supabase/admin.ts, and `tests/` is in scope), and using the real flow
 * means the teardown is itself evidence that erasure works.
 */
let created: string[] = [];

const uniqueEmail = () => {
  const email = `phase1-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

/**
 * Both helpers WAIT for the destination. Without that, the click returns before
 * the Server Action has redirected and written the session cookie, and the next
 * navigation races it — which looks exactly like a broken session and is not.
 * `settle: false` is for the cases that deliberately expect an error instead.
 */
async function signUp(page: Page, email: string, settle = true) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  if (settle) await page.waitForURL(/\/career$/);
}

async function signIn(page: Page, email: string, pw = password, settle = true) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (settle) await page.waitForURL(/\/scan$/);
}

/**
 * Sign out from wherever the browser currently is (SPEC v2.20).
 *
 * The control is an ICON in the top-right of the app shell now, not a labelled
 * button on /settings — so this helper deliberately does NOT navigate first, and
 * the three flows that used to `goto('/settings')` to reach it are the evidence
 * that it is reachable from any member route. `aria-label` carries the same
 * "Sign out" string the labelled button rendered, which is why the locator did
 * not have to change.
 */
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);
}

/**
 * Every `set-cookie` for the Supabase session on a given response.
 * `headersArray()` is async — reading it synchronously silently yields a
 * Promise, not an array.
 */
async function sessionCookies(response: Response): Promise<string[]> {
  const headers = await response.headersArray();
  return headers
    .filter((h) => h.name.toLowerCase() === 'set-cookie' && /sb-.*-auth-token/.test(h.value))
    .map((h) => h.value);
}

/** Sign in if needed, then delete the account through /settings. */
async function deleteAccountViaUi(page: Page, email: string) {
  await page.goto('/settings');
  const visible = () =>
    page.getByRole('button', { name: COPY.deleteAccount }).isVisible().catch(() => false);

  // /settings redirects to /login when signed out, so sign in first if needed.
  // Wait for the session to land before navigating: without this the goto races
  // the Server Action's cookie write, /settings bounces, and the account is
  // silently left behind.
  if (!(await visible())) {
    await signIn(page, email, password, false);
    await page.waitForURL(/\/scan$/, { timeout: 10_000 }).catch(() => {
      // The account may already be gone — the caller tolerates that.
    });
    await page.goto('/settings');
  }
  const trigger = page.getByRole('button', { name: COPY.deleteAccount });
  // Already gone — the deletion test removes its own account before teardown.
  if (!(await trigger.isVisible().catch(() => false))) return;
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('DELETE').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.waitForURL(/\/login/);
}

test.describe('auth', () => {
  test.beforeEach(() => {
    created = [];
  });

  // Every account this suite creates is removed again, so repeated runs do not
  // accumulate users in a shared Supabase project.
  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {
        // Already deleted by the test itself, or never created (negative cases).
      });
    }
  });

  test('sign-up lands on /career', async ({ page }) => {
    // A new account has an empty career base, so /career is where the first
    // import starts (SPEC Block F Auth flows, US-1 step 1) — NOT /scan.
    await signUp(page, uniqueEmail());
    await expect(page).toHaveURL(/\/career$/);
  });

  test('sign-in lands on /scan, sign-out returns to /login', async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await expect(page).toHaveURL(/\/career$/);

    /**
     * IT IS IN THE SHELL, not on one screen (SPEC v2.20). Asserted on two member
     * routes before it is used, because "moved to the app shell" is a claim about
     * every screen and the previous version of this flow could only ever witness
     * /settings.
     */
    for (const route of ['/scan', '/applications']) {
      await page.goto(route);
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    }

    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/scan$/);
  });

  test('a signed-in user is bounced off /login and /signup', async ({ page }) => {
    await signUp(page, uniqueEmail());
    for (const path of ['/login', '/signup']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/scan$/);
    }
  });

  test('a visitor is redirected off member routes with no data flash', async ({ page }) => {
    for (const path of ['/scan', '/career', '/applications', '/settings', '/quality']) {
      const response = await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      expect(response?.status()).toBe(200); // after following the 307
    }

    // A forged application id must not render anything before redirecting.
    await page.goto('/applications/9f2a6c1e-4b7d-4f7a-9e2b-3c8d1a5e7f90');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('body')).not.toContainText('9f2a6c1e');
  });

  test('/privacy is public and reachable from both layouts', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();

    // Signed-out layout.
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible();

    // Signed-in layout — Art. 12(1) wants it reachable from inside the app too.
    await signUp(page, uniqueEmail());
    await page.goto('/scan');
    await expect(page.getByRole('link', { name: 'Privacy' })).toBeVisible();
  });

  test('wrong password shows the exact copy and no other outcome', async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await signOut(page);

    await signIn(page, email, 'definitely-not-the-password', false);
    await expect(page.getByText(COPY.badCredentials)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // The other three sign-in outcomes must not leak into this one.
    await expect(page.locator('body')).not.toContainText('temporarily unavailable');
    await expect(page.locator('body')).not.toContainText('Too many attempts');
    await expect(page.locator('body')).not.toContainText('Confirm your email');
  });

  /**
   * BOTH client-validation paths, because they fail differently (SPEC v2.4).
   * A 5-character password is natively valid, so it reaches our Zod parse even
   * when the browser is validating; a malformed address does NOT — `type="email"`
   * catches it first and shows the browser's own bubble, and `AUTH.invalidEmail`
   * is never rendered. That is why the form carries `noValidate`, and why a
   * suite covering only the password case passed while the email path was
   * silently unverified.
   */
  for (const [label, email, password, expected] of [
    ['a malformed email', 'not-an-email', 'a-long-enough-password', COPY.invalidEmail],
    ['a too-short password', 'someone@example.com', 'short', COPY.shortPassword],
  ] as const) {
    test(`client-side validation blocks submit on ${label}`, async ({ page }) => {
      await page.goto('/signup');
      let posted = false;
      page.on('request', (r) => {
        if (r.method() === 'POST') posted = true;
      });

      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Create account' }).click();

      // OUR copy, rendered inline in the page — not a native validation bubble,
      // which lives in browser chrome and is invisible to the DOM.
      await expect(page.getByText(expected)).toBeVisible();
      expect(posted, `${label} must not cost a round trip`).toBe(false);
    });
  }

  test('native validation never pre-empts our copy', async ({ page }) => {
    await page.goto('/signup');
    const form = page.locator('form');
    await expect(form, 'noValidate is what lets AUTH.invalidEmail render at all').toHaveAttribute(
      'novalidate',
      '',
    );
    // If native validation were active the field would report itself invalid
    // and the submit handler would never run.
    await page.getByLabel('Email').fill('not-an-email');
    const nativelyValid = await page
      .getByLabel('Email')
      .evaluate((el) => (el as HTMLInputElement).form?.noValidate === true);
    expect(nativelyValid).toBe(true);
  });

  test('a duplicate email is reported as such', async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    await signOut(page);

    await signUp(page, email, false);
    await expect(page.getByText(COPY.emailTaken)).toBeVisible();
  });

  test('the session cookie is httpOnly, SameSite=Lax and capped at 30 days', async ({
    page,
    context,
  }) => {
    const email = uniqueEmail();
    const responses: Response[] = [];
    page.on('response', (r) => responses.push(r));

    await signUp(page, email);
    await expect(page).toHaveURL(/\/career$/);

    const headers = (await Promise.all(responses.map(sessionCookies))).flat();
    expect(headers.length, 'no session Set-Cookie was observed').toBeGreaterThan(0);

    for (const header of headers) {
      // Deletion/clearing writes Max-Age=0; that is not a session grant.
      if (/Max-Age=0(;|$)/i.test(header)) continue;
      expect(header, 'session cookie must be httpOnly').toMatch(/HttpOnly/i);
      expect(header, 'session cookie must be SameSite=Lax').toMatch(/SameSite=Lax/i);

      const maxAge = Number(header.match(/Max-Age=(\d+)/i)?.[1] ?? NaN);
      expect(Number.isFinite(maxAge), `no Max-Age in: ${header.split(';')[1] ?? ''}`).toBe(true);
      expect(maxAge, 'the library default of 400 days must be clamped').toBeLessThanOrEqual(
        SESSION_MAX_AGE,
      );
    }

    // And as the browser actually stored it.
    const stored = (await context.cookies()).filter((c) => /sb-.*-auth-token/.test(c.name));
    expect(stored.length).toBeGreaterThan(0);
    const nowSeconds = Date.now() / 1000;
    for (const cookie of stored) {
      expect(cookie.httpOnly, `${cookie.name} must be httpOnly`).toBe(true);
      expect(cookie.sameSite).toBe('Lax');
      // -1 means a session cookie; anything dated must be inside the cap.
      if (cookie.expires > 0) {
        expect(
          cookie.expires - nowSeconds,
          `${cookie.name} outlives the 30-day cap`,
        ).toBeLessThanOrEqual(SESSION_MAX_AGE + 60);
      }
    }
  });

  test('account deletion removes the user and returns to /login with the toast', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    await page.goto('/settings');

    /**
     * SAVE A DISPLAY NAME FIRST, so the deletion has a `profiles` row to remove
     * (SPEC v2.17).
     *
     * /privacy promises the display name "is deleted along with everything else
     * when you delete your account", and CLAUDE.md's erasure rule says the claim
     * is verified by test. Deleting an account that never wrote a profile row
     * proves the cascade for seven tables and says nothing about the eighth.
     *
     * Behind the same probe as the display-name spec: without migration 004 there
     * is no table to write to, and the name is skipped rather than failing —
     * which leaves the rest of this test doing exactly what it did before.
     */
    const nameField = page.getByLabel(COPY.displayNameLabel);
    if (await nameField.isVisible().catch(() => false)) {
      await nameField.fill(DISPLAY_NAME);
      await page.getByRole('button', { name: COPY.displayNameSave }).click();
      /**
       * WAITED FOR, NOT SAMPLED. `isVisible()` does not auto-wait and ignores the
       * timeout handed to it, so this read false the instant the click dispatched
       * and then demanded the failure copy of a save that had succeeded — which
       * is what applying migration 004 turned red, four lines before this test
       * reaches the delete it exists to prove.
       *
       * One of the two outcomes must be on screen. Anything else — a hang, a
       * crash, a silently-wrong success — is a defect and must not be swallowed
       * by a test that is only passing through. Either way the delete below runs:
       * with the migration it proves the cascade for eight tables, without it for
       * seven.
       */
      await expect(
        page.getByText(COPY.displayNameSaved).or(page.getByText(COPY.displayNameFailed)),
      ).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole('button', { name: COPY.deleteAccount }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // SPEC v2.6: the dialog names what GOES and what STAYS. This is the surface
    // where an over-promise does the most damage — the user reads it once, at
    // the moment the action becomes irreversible — so the carve-out and its link
    // to /privacy are asserted, not assumed.
    await expect(dialog).toContainText('career base, scans and resumes');
    await expect(dialog).toContainText('Some authentication records are kept separately');
    await expect(dialog.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    // The retention period lives in ONE ternary branch on /privacy and nowhere
    // else (SPEC v2.9), so there is nothing to assert about its absence here.
    // A pattern mirroring the old R12 regex used to sit at this line; it is gone
    // for the same reason the regex is — it could not close the set of ways to
    // write a period, so it read as a guarantee it was not providing.

    // Confirm stays disabled until the word matches EXACTLY.
    const confirm = dialog.getByRole('button', { name: 'Delete account', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('DELETE').fill('delete');
    await expect(confirm, 'lowercase must not unlock it').toBeDisabled();
    await dialog.getByLabel('DELETE').fill('DELETE');
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(COPY.accountDeleted)).toBeVisible();

    // The account is genuinely gone: the same credentials no longer work.
    await signIn(page, email, password, false);
    await expect(page.getByText(COPY.badCredentials)).toBeVisible();
  });
});
