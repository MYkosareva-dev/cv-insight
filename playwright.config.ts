import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright. `tests/e2e/auth.spec.ts` arrived in Phase 1 (SPEC Block F,
 * "Evidence for auth"), `career.spec.ts` in Phase 2 and `scan.spec.ts` in
 * Phase 3; `privacy.spec.ts` is the remaining one, in Phase 7.
 *
 * It drives `npm run dev` rather than a production build: the auth flows are
 * Server Actions whose `$ACTION_REF` encoding cannot be replayed with curl, so a
 * real browser is the only way to observe sign-up, sign-in and the Set-Cookie
 * attributes the session depends on.
 *
 * `E2E_BASE_URL` points the suite at an already-running server, which is how
 * `scan.spec.ts`'s AI-unavailable case runs: that one needs a dev server started
 * with a deliberately invalid model key, since the OpenRouter call is
 * server-side and no browser script can make it fail. See its docblock.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Auth tests share one Supabase project and create/delete real users, so they
  // run one at a time rather than racing each other's sessions.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
