import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { ERROR_CODES, ERROR_MESSAGES, QUALITY, RESULT, SCAN } from '../../src/lib/copy';

/**
 * Gating is tested at the GATE, not at the screen (SPEC v3.0, Block H item 13).
 *
 * Every case is a DIRECT POST, because the screen never offers a Pro control to
 * a Free user — a hidden button is a courtesy, and the request it would have
 * sent is what the gate has to refuse. The refusals are asserted on the body
 * shape Block D gives them: `{ error: { code, message, plan, feature } }`.
 *
 * WHAT THIS FILE DOES NOT DO, AND WHY (SPEC amendment in this branch). Block H
 * item 13 has the test insert a ledger row "through the service role" so that a
 * Pro caller can be shown to proceed. That cannot be written here: `tests/` is
 * in scope for check.mjs R1 (`.from(` outside a DAL), R10 (the service-role key
 * and client) and R7 (reading the webhook's signing secret to forge an event),
 * and renaming a variable to slip past a rule is not a fix. The Pro half —
 * `mode: "agentic"` proceeding for a Pro account — is NOT WITNESSED YET. It is to
 * be witnessed on the deployment run (SPEC Block H item 12), through a real
 * test-mode Checkout, the same path a user takes; the local half recorded in
 * docs/eval/billing-webhook-evidence.md does not include it. It is marked
 * `fixme` below so the gap is visible in the report rather than absent from it.
 *
 * Synthetic data only: the career base and the posting are the calibration
 * fixture the other specs use.
 */

const password = 'plan-gating-e2e-password';

let created: string[] = [];

const uniqueEmail = () => {
  const email = `plan-gating-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

const CASE = JSON.parse(
  readFileSync(path.join(process.cwd(), 'docs/eval/calibration-case-hiredbuddy.json'), 'utf8'),
) as { resumeText: string; vacancyText: string };

/** Any well-formed id: the plan refusal precedes the application read. */
const SOME_APPLICATION = '9f2a6c1e-4b7d-4f7a-9e2b-3c8d1a5e7f90';

async function signUp(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/career$/);
}

async function deleteAccountViaUi(page: Page, email: string) {
  await page.goto('/settings');
  const trigger = page.getByRole('button', { name: 'Delete account and data' });
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
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

async function buildCareerBase(page: Page) {
  await page.goto('/career');
  await page.getByRole('button', { name: 'Import resume' }).first().click();
  const dialog = page.getByRole('dialog');
  const importResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await dialog.getByPlaceholder('Paste your resume text here.').fill(CASE.resumeText);
  await dialog.getByRole('button', { name: 'Extract items' }).click();
  expect((await (await importResponse).json()).items.length).toBeGreaterThan(0);
  const saveResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();
  expect((await (await saveResponse).json()).indexed).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
}

async function runScan(page: Page): Promise<string> {
  await page.goto('/scan');
  await page.getByLabel(SCAN.vacancyLabel).fill(CASE.vacancyText);
  const scanResponse = page.waitForResponse(
    (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: SCAN.analyze }).click();
  const response = await scanResponse;
  expect(response.status()).toBe(200);
  return ((await response.json()) as { applicationId: string }).applicationId;
}

test.describe('plan gating — at the gate', () => {
  test.beforeEach(() => {
    created = [];
  });

  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {});
    }
  });

  test('a Free account asking for `agentic` is refused 403 PLAN_REQUIRED, and nothing is spent (L7)', async ({
    page,
  }) => {
    await signUp(page, uniqueEmail());

    const res = await page.request.post(`/api/applications/${SOME_APPLICATION}/generate`, {
      data: { mode: 'agentic' },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: ERROR_CODES.PLAN_REQUIRED,
        message: ERROR_MESSAGES.PLAN_REQUIRED,
        plan: 'free',
        feature: 'agentic',
      },
    });

    /**
     * "Writes no llm_calls row." This spec cannot read the table (R1), so it
     * reads the screen built from it. The account is fresh — signed up, nothing
     * imported or scanned — so ANY row would be the refused call's. /quality
     * renders its empty state exactly when the caller has zero rows, and no
     * tiles at all then, so this is the whole-table assertion. (It used to look
     * for a "0 / 50" tile, which the empty state never draws — the first run
     * against the live project, docs/eval/e2e-go-public-run.txt, found that.)
     */
    await page.goto('/quality');
    await expect(page.getByText(QUALITY.empty, { exact: true })).toBeVisible();
  });

  test('a body with any field but `mode` is a 400, before the gate spends a read', async ({
    page,
  }) => {
    await signUp(page, uniqueEmail());
    for (const data of [{ mode: 'agentic', role: 'system' }, { mode: 'turbo' }, { prompt: 'x' }]) {
      const res = await page.request.post(`/api/applications/${SOME_APPLICATION}/generate`, {
        data,
      });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
  });

  test('a signed-out caller is 401 before any plan is read', async ({ request }) => {
    const res = await request.post(`/api/applications/${SOME_APPLICATION}/generate`, {
      data: { mode: 'agentic' },
    });
    expect(res.status()).toBe(401);
  });

  test('a Free account’s SECOND resume in 24 h is 429 with the Free copy; the first is untouched (L6)', async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    const applicationId = await runScan(page);

    const first = await page.request.post(`/api/applications/${applicationId}/generate`, {
      data: {},
      timeout: 300_000,
    });
    expect(first.status(), 'the day’s one resume is generated').toBe(200);
    expect(((await first.json()) as { resumeVersionId: string }).resumeVersionId).toBeTruthy();

    const second = await page.request.post(`/api/applications/${applicationId}/generate`, {
      data: {},
    });
    expect(second.status()).toBe(429);
    expect(await second.json()).toEqual({
      error: {
        code: ERROR_CODES.DAILY_LIMIT,
        message: RESULT.dailyLimitFree,
        plan: 'free',
        feature: 'generate',
      },
    });

    // The refusal came from `authorizeGenerate()`, before the lock and before
    // retrieval, so it cannot have appended a version: `resume_versions` is
    // written only after a run's chat steps return.
  });

  test.fixme('after a ledger row makes the account Pro, the same `agentic` call proceeds', async () => {
    // Not writable under check.mjs R1/R7/R10 — see the header. NOT witnessed
    // yet: it belongs to the deployment run, SPEC Block H item 12.
  });
});
