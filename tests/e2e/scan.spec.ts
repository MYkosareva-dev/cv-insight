import { expect, test, type Page } from '@playwright/test';

import {
  APPLICATIONS,
  APPLICATION_STATUS_LABEL,
  NO_SCORE,
  RESULT,
  SCAN,
  VACANCY_LENGTH,
} from '../../src/lib/copy';

/**
 * Phase-3 evidence: US-2 and US-3, end to end, against a real Supabase project
 * and real OpenRouter calls. Manual verification is not accepted as evidence in
 * this repo; the spec run is.
 *
 * WHAT THIS SPEC CAN AND CANNOT SEE. It asserts what the SCREENS show and what
 * the endpoints answer. It does NOT query `llm_calls` or `applications`
 * directly — deliberately, and for the same reason `career.spec.ts` says so:
 * `.from(` outside a DAL fails check.mjs R1, `SUPABASE_SERVICE_ROLE_KEY`
 * outside `lib/supabase/admin.ts` fails R10, and `tests/` is in scope for both.
 * So "exactly one `parse_vacancy` row per scan" is not something this file can
 * observe; what it CAN observe is that one scan produces one redirect and one
 * rendered result, and the single call site plus the R5/R6 gate rules are what
 * make the row count structural. The owner's own check is in the hand-over.
 *
 * Assertions are written against the CONTRACT, not against numbers a model
 * cannot guarantee: a real parse decides how many requirements a posting has
 * and a real embedding decides which are covered, so the spec pins the states
 * the screen may be in and the invariants between them — never "the score is
 * 68". That is the `e-1` lesson from the phase-2 review.
 */

const password = 'phase-3-e2e-password';

/** Accounts created by the running test, removed through the app's own flow. */
let created: string[] = [];

const uniqueEmail = () => {
  const email = `phase3-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

/**
 * The fictional persona's career base (SPEC Block B). Synthetic data only.
 *
 * The BASE is broad — the LLM-evaluation role AND the business-analysis skills.
 */
const BASE_RESUME = [
  'MIRA STEINBERG',
  'AI Quality Analyst — Hamburg, Germany',
  '',
  'EXPERIENCE',
  'AI Prompt Evaluator — Nordlicht Digital (01/2025 – present)',
  'Evaluated and annotated LLM data: prompt-response pairs and multi-turn',
  'dialogues, following project guidelines and scoring rubrics.',
  'Performed side-by-side evaluation and ranking of model responses.',
  'Maintained an average QA quality score of 98 percent across all batches.',
  '',
  'Business Analyst — BotWorks Labs (05/2024 – 08/2024)',
  'Mapped as-is and to-be procurement processes in BPMN for three client',
  'programmes and ran requirements workshops with up to twelve stakeholders.',
  'Documented forty user stories with acceptance criteria for a warehouse',
  'management rollout.',
  '',
  'SKILLS',
  'BPMN process modeling, requirements elicitation and documentation,',
  'as-is/to-be analysis, stakeholder workshops, Python, SQL.',
  '',
  'EDUCATION',
  'BSc Business Informatics — Universitaet Hamburg (2016 – 2020)',
].join('\n');

/**
 * The pasted SOURCE resume is deliberately NARROWER than the base: it carries
 * the LLM-evaluation role only, with no BPMN, no Python and no SQL.
 *
 * That gap is the whole point of US-3 — a requirement the career base covers and
 * the chosen resume does not is exactly what the Base matches tab is for. A
 * source resume identical to the base could never produce one.
 */
const NARROW_RESUME = [
  'MIRA STEINBERG',
  'AI Quality Analyst — Hamburg, Germany',
  '',
  'EXPERIENCE',
  'AI Prompt Evaluator — Nordlicht Digital (01/2025 – present)',
  'Evaluated and annotated LLM prompt-response pairs and multi-turn dialogues',
  'against written scoring rubrics, and ranked model responses side by side.',
  'Maintained an average QA quality score of 98 percent across all batches.',
  'Wrote the annotation guidelines the rest of the team worked from.',
].join('\n');

/** A synthetic posting with must-haves, nice-to-haves, and one clear gap. */
const VACANCY = [
  'DataMinds GmbH is hiring an AI Quality Analyst in Hamburg (hybrid).',
  '',
  'What you will do:',
  '- Evaluate and annotate LLM outputs against rubrics, and rank model responses.',
  '- Write and maintain annotation guidelines for a growing team.',
  '- Model our review processes in BPMN and keep the documentation current.',
  '',
  'Requirements (must have):',
  '- Hands-on experience with LLM evaluation and annotation quality assurance.',
  '- Strong written English and the ability to author scoring rubrics.',
  '',
  'Nice to have:',
  '- BPMN process modeling and requirements documentation.',
  '- Python for small data-wrangling scripts, and SQL for reporting.',
  '- Docker and Kubernetes for running evaluation harnesses locally.',
  '',
  'We offer a hybrid contract, 30 days of holiday and a learning budget.',
].join('\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Build the career base by pasting a resume through the import dialog. */
async function buildCareerBase(page: Page, text: string): Promise<number> {
  await page.goto('/career');
  await page.getByRole('button', { name: 'Import resume' }).first().click();
  const dialog = page.getByRole('dialog');

  const importResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByPlaceholder('Paste your resume text here.').fill(text);
  await dialog.getByRole('button', { name: 'Extract items' }).click();
  const imported = await (await importResponse).json();
  expect(imported.items.length).toBeGreaterThan(0);

  const saveResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();
  const saved = await (await saveResponse).json();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Indexing is what matching depends on, so the base is only usable as
  // evidence if the save reported items indexed.
  expect(saved.items.length).toBeGreaterThan(0);
  expect(saved.indexed).toBeGreaterThan(0);
  return saved.items.length;
}

/** Run one scan from /scan and return the endpoint's own answer. */
async function runScan(page: Page, source: 'career_base' | 'paste', resumeText?: string) {
  await page.goto('/scan');
  if (source === 'paste') {
    await page.getByRole('tab', { name: SCAN.tabPaste }).click();
    await page.getByLabel(SCAN.resumeTextLabel).fill(resumeText ?? '');
  }
  await page.getByLabel(SCAN.vacancyLabel).fill(VACANCY);

  const scanResponse = page.waitForResponse(
    (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: SCAN.analyze }).click();
  const response = await scanResponse;
  return { status: response.status(), body: await response.json() };
}

// ---------------------------------------------------------------------------

test.describe('scan', () => {
  test.beforeEach(() => {
    created = [];
  });

  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {});
    }
  });

  test('both scan endpoints refuse a signed-out caller with 401', async ({ request }) => {
    /**
     * Edge case S4 and auth rule 3. Middleware CANNOT cover this: the matcher
     * excludes `/api` by design, because a handler must answer 401 JSON rather
     * than redirect to HTML. `requireApiUser()` in each handler is therefore the
     * only fence in front of these endpoints, and a fence that exists in exactly
     * one place is worth testing rather than reading.
     *
     * It also proves no anonymous POST can spend money: /api/scan is the phase's
     * only metered endpoint.
     */
    const id = '11111111-1111-1111-1111-111111111111';
    const responses = [
      await request.post('/api/scan', {
        data: {
          vacancyText: 'x'.repeat(200),
          resumeSource: 'career_base',
          sourceResumeText: null,
          resumeVersionId: null,
        },
      }),
      await request.patch(`/api/applications/${id}`, { data: { status: 'applied' } }),
    ];

    for (const res of responses) {
      expect(res.status(), `${res.url()} must refuse an anonymous caller`).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  test('an oversized vacancy is refused with the exact copy, before any spend', async ({
    page,
    request,
  }) => {
    /**
     * Edge case S7. The message matters as much as the status: Block D quotes
     * this exact sentence as the canonical error body, and a `z.union` on the
     * request would have replaced it with Zod's own "Invalid input" — which is
     * why the endpoint tells its two body shapes apart before either schema
     * runs. Asserted through the API, since the textarea has no server round
     * trip to reach for a bound the client also blocks.
     */
    await signUp(page, uniqueEmail());
    const res = await request.post('/api/scan', {
      data: {
        vacancyText: 'x'.repeat(20_001),
        resumeSource: 'career_base',
        sourceResumeText: null,
        resumeVersionId: null,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe(VACANCY_LENGTH);
  });

  test('an empty career base blocks the Career-base source with the exact notice', async ({
    page,
  }) => {
    // Block E's EMPTY state for /scan, and the one state that must never reach
    // a model call: there is nothing to match against.
    await signUp(page, uniqueEmail());
    await page.goto('/scan');

    await expect(page.getByText(SCAN.emptyBase)).toBeVisible();
    await expect(page.getByRole('link', { name: SCAN.goToCareerBase })).toBeVisible();
    await expect(page.getByRole('button', { name: SCAN.analyze })).toBeDisabled();
  });

  test('the applications list starts empty with the exact copy', async ({ page }) => {
    await signUp(page, uniqueEmail());
    await page.goto('/applications');
    await expect(page.getByText(APPLICATIONS.emptyTitle)).toBeVisible();
  });

  test('a pasted resume scans, scores, and renders coverage, keywords and base matches', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page, BASE_RESUME);

    // --- the scan itself: one real P1 parse, one batched embedding run -------
    const scan = await runScan(page, 'paste', NARROW_RESUME);
    expect(scan.status, 'the scan must succeed against the real models').toBe(200);
    expect(scan.body.applicationId).toMatch(/^[0-9a-f-]{36}$/);

    // US-2 step 3: redirected to the result screen.
    await page.waitForURL(new RegExp(`/applications/${scan.body.applicationId}$`));

    const { coverage, keywords, matchScore } = scan.body;
    expect(Array.isArray(coverage)).toBe(true);
    expect(Array.isArray(keywords)).toBe(true);

    /**
     * Every parsed requirement appears in the coverage map with a match or a Gap
     * (US-2 acceptance) — and every entry carries a status from the Block D set.
     * A "could not search" run would have failed the scan instead, so no entry
     * can be a gap for want of a search.
     */
    for (const entry of coverage) {
      expect(['covered', 'gap_in_resume_covered_by_base', 'gap']).toContain(entry.status);
      expect(['must', 'nice']).toContain(entry.kind);
      // An entry that names a career item must have cleared the 0.60 threshold;
      // a gap names none.
      if (entry.status === 'gap') expect(entry.careerItemId).toBeNull();
      else expect(entry.similarity).toBeGreaterThanOrEqual(0.6);
    }

    // --- the ring, and the Block E colour rule ------------------------------
    const ring = page.getByRole('img', { name: RESULT.matchRate });
    await expect(ring).toBeVisible();
    const shown = (await ring.textContent())?.trim() ?? '';

    /**
     * Rule B1b is a RENDER rule: the response carries the STORED number, and
     * the screen shows "—" when 0 MUST requirements met 0 keywords, because
     * that 0 means "nothing was measured". So the expectation follows the same
     * rule the app does rather than the raw field.
     */
    const noSignal =
      coverage.every((entry: { kind: string }) => entry.kind !== 'must') && keywords.length === 0;

    if (matchScore === null || noSignal) {
      expect(shown).toBe(NO_SCORE);
    } else {
      expect(shown).toBe(`${matchScore}%`);
      // The colour is asserted against the rule, not against a fixed token:
      // <40 low, 40-69 mid, >=70 high, and the same rule everywhere.
      const expected =
        matchScore < 40 ? 'score-low' : matchScore < 70 ? 'score-mid' : 'score-high';
      const stroke = await ring.locator('circle').nth(1).getAttribute('stroke');
      expect(stroke).toBe(`var(--${expected})`);
    }

    // --- Analysis tab: the coverage table and the keywords table ------------
    if (coverage.length > 0) {
      await expect(page.getByRole('columnheader', { name: RESULT.colRequirement })).toBeVisible();
      const rows = page.getByRole('row');
      // header rows plus one row per requirement, in one or both tables
      expect(await rows.count()).toBeGreaterThan(coverage.length);
    } else {
      // N4: the parse ran and found no requirements. Its own notice, never an
      // empty table.
      await expect(page.getByText(SCAN.noRequirements)).toBeVisible();
    }

    if (keywords.length > 0) {
      await expect(page.getByRole('columnheader', { name: RESULT.colInResume })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: RESULT.colInVacancy })).toBeVisible();

      /**
       * The counts are the app's own measurement of the SOURCE text and the
       * posting, so they are checked against that text rather than against a
       * fixed number: a keyword the pasted resume does not contain must read 0,
       * and every keyword must appear in the posting at least once (it came out
       * of it).
       */
      for (const row of keywords) {
        expect(row.inVacancy).toBeGreaterThan(0);
        const inNarrow = NARROW_RESUME.toLowerCase().includes(row.keyword.toLowerCase());
        if (!inNarrow) expect(row.inResume).toBe(0);
      }
      const missing = keywords.filter((row: { inResume: number }) => row.inResume === 0);
      expect(
        missing.length,
        'the narrow resume omits Python/SQL/BPMN/Docker, so some keyword must be missing',
      ).toBeGreaterThan(0);
    }

    // --- Base matches: US-3 --------------------------------------------------
    await page.getByRole('tab', { name: RESULT.tabBaseMatches }).click();
    const hidden = coverage.filter(
      (entry: { status: string }) => entry.status === 'gap_in_resume_covered_by_base',
    );

    if (hidden.length > 0) {
      // Each suggestion names the career item it came from (US-3 acceptance).
      for (const entry of hidden) {
        expect(entry.careerItemTitle, 'a base match must name its career item').toBeTruthy();
      }
      await expect(
        page.getByText(RESULT.foundInItem(hidden[0].careerItemTitle)).first(),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: RESULT.copyBullet }).first()).toBeVisible();
    } else {
      await expect(page.getByText(RESULT.noHiddenMatches)).toBeVisible();
    }

    // --- Vacancy tab ---------------------------------------------------------
    await page.getByRole('tab', { name: RESULT.tabVacancy }).click();
    // Block E: the raw posting is COLLAPSIBLE, so it starts collapsed and the
    // parsed requirements are what the tab leads with.
    await expect(page.getByText(RESULT.vacancyParsedHeading)).toBeVisible();
    await page.locator('details summary').click();
    await expect(page.getByText('DataMinds GmbH is hiring').first()).toBeVisible();

    // --- Notes (PATCH) -------------------------------------------------------
    const notesResponse = page.waitForResponse(
      (res) => res.url().includes('/api/applications/') && res.request().method() === 'PATCH',
    );
    await page.getByLabel(RESULT.notesLabel).fill('Recruiter: Anna. Follow up Friday.');
    await page.getByRole('button', { name: RESULT.saveNotes }).click();
    expect((await notesResponse).status()).toBe(200);
    await expect(page.getByText(RESULT.notesSaved)).toBeVisible();

    // --- the list, and the status Select (PATCH) -----------------------------
    await page.goto('/applications');
    const statusSelect = page.getByLabel(APPLICATIONS.colStatus).first();
    await expect(statusSelect).toHaveValue('draft');

    const statusResponse = page.waitForResponse(
      (res) => res.url().includes('/api/applications/') && res.request().method() === 'PATCH',
    );
    await statusSelect.selectOption('applied');
    expect((await statusResponse).status()).toBe(200);
    await expect(page.getByText(APPLICATIONS.statusUpdated)).toBeVisible();
    await expect(statusSelect).toHaveValue('applied');

    // Reloaded, so what is asserted is the STORED status rather than the
    // control's own local state — the point of the PATCH.
    await page.reload();
    await expect(page.getByLabel(APPLICATIONS.colStatus).first()).toHaveValue('applied');
    await page.goto(`/applications/${scan.body.applicationId}`);
    await expect(
      page.getByText(APPLICATION_STATUS_LABEL.applied, { exact: false }).first(),
    ).toBeVisible();
  });

  test('a career-base scan says the base is the source, instead of an empty tab', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signUp(page, uniqueEmail());
    const items = await buildCareerBase(page, BASE_RESUME);

    await page.goto('/scan');
    // Block E: "Using all N items of your base".
    await expect(page.getByText(SCAN.usingAllItems(items))).toBeVisible();

    const scan = await runScan(page, 'career_base');
    expect(scan.status).toBe(200);
    await page.waitForURL(new RegExp(`/applications/${scan.body.applicationId}$`));

    /**
     * When the base IS the source, "covered by your base but missing from your
     * resume" is not a state that can exist — so the endpoint never produces it
     * and the tab says why, rather than showing US-3's "your resume already uses
     * everything relevant", which is a different and unmeasured claim.
     */
    for (const entry of scan.body.coverage) {
      expect(entry.status).not.toBe('gap_in_resume_covered_by_base');
    }
    await page.getByRole('tab', { name: RESULT.tabBaseMatches }).click();
    await expect(page.getByText(RESULT.baseIsSource)).toBeVisible();
  });

  /**
   * The AI-unavailable path (US-2 step 5, edge cases N2/N3/N5).
   *
   * It needs a server whose model calls FAIL, which no amount of browser
   * scripting can arrange: the OpenRouter call is server-side, so Playwright
   * cannot intercept it. Run it against a dev server started with a deliberately
   * invalid OPENROUTER_API_KEY:
   *
   *   OPENROUTER_API_KEY=invalid-key-for-the-failure-path npx next dev -p 3100
   *   E2E_AI_DOWN=1 E2E_BASE_URL=http://localhost:3100 npx playwright test scan
   *
   * Skipped otherwise, and visibly so — a test that silently passes when it
   * cannot run is worse than no test.
   */
  test('an AI failure saves the vacancy as a draft and says so', async ({ page }) => {
    test.skip(process.env.E2E_AI_DOWN !== '1', 'needs a server with a failing model key');
    test.setTimeout(180_000);

    await signUp(page, uniqueEmail());
    await page.goto('/scan');
    await page.getByRole('tab', { name: SCAN.tabPaste }).click();
    await page.getByLabel(SCAN.resumeTextLabel).fill(NARROW_RESUME);
    await page.getByLabel(SCAN.vacancyLabel).fill(VACANCY);

    const scanResponse = page.waitForResponse(
      (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: SCAN.analyze }).click();
    const response = await scanResponse;

    // 502 with the endpoint's own message — the one that promises the vacancy
    // was saved, which is true here and false on endpoints that save nothing.
    expect(response.status()).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe('AI_UNAVAILABLE');
    expect(body.error.message).toBe(SCAN.aiUnavailable);
    // Block E's error state for this screen is a TOAST, and only a toast: the
    // inline slot belongs to client-side validation.
    await expect(page.getByText(SCAN.aiUnavailable).first()).toBeVisible();
    await expect(page.getByRole('main').getByText(SCAN.aiUnavailable)).toHaveCount(0);

    // The row exists, as a draft with no score (US-2 step 5).
    await page.goto('/applications');
    const row = page.getByRole('row').filter({ hasText: APPLICATIONS.notAnalysedTitle });
    await expect(row).toBeVisible();
    await expect(row.getByText(NO_SCORE).first()).toBeVisible();
    await expect(page.getByLabel(APPLICATIONS.colStatus).first()).toHaveValue('draft');

    // And the detail screen offers the retry the toast promised, instead of an
    // empty coverage table that would read as "no gaps found".
    await page.getByRole('link', { name: APPLICATIONS.notAnalysedTitle }).click();
    await expect(page.getByText(RESULT.notAnalysed)).toBeVisible();
    await expect(page.getByRole('button', { name: RESULT.runAnalysis })).toBeVisible();

    /**
     * And the retry is wired: one press, one metered request, and against a
     * still-broken service the SAME honest answer rather than a spinner that
     * never resolves or a silently retried ladder. The success case runs the
     * identical server code path as a first scan, which the pasted-resume test
     * above covers against the real models.
     */
    const rerun = page.waitForResponse(
      (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: RESULT.runAnalysis }).click();
    const retried = await rerun;
    expect(retried.status()).toBe(502);
    // The retry body is the id and NOTHING else — no vacancy text and no resume
    // text back over the wire, so a "retry" cannot analyse something different
    // from what it claims to be retrying.
    expect(Object.keys(retried.request().postDataJSON())).toEqual(['applicationId']);
    await expect(page.getByText(RESULT.notAnalysed)).toBeVisible();
  });
});
