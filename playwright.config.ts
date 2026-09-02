import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright, pulled into Phase 1 for `tests/e2e/auth.spec.ts` only (SPEC Block F,
 * "Evidence for auth"). The rest of the suite lands in Phase 7.
 *
 * It drives `npm run dev` rather than a production build: the auth flows are
 * Server Actions whose `$ACTION_REF` encoding cannot be replayed with curl, so a
 * real browser is the only way to observe sign-up, sign-in and the Set-Cookie
 * attributes the session depends on.
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
