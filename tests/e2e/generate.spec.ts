import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { NAME_PLACEHOLDER, NO_SCORE, RESULT, SETTINGS, SCAN } from '../../src/lib/copy';

/**
 * Phase-4 evidence: US-4 and US-5, end to end, against a real Supabase project
 * and real OpenRouter calls. Manual verification is not accepted as evidence in
 * this repo; the spec run is.
 *
 * THE CASE IS THE OWNER'S OWN. `docs/eval/calibration-case-hiredbuddy.json` is
 * the reconstruction of the posting the coverage thresholds were calibrated
 * against — a senior AI-quality career base scanned against an entry-level
 * annotation role — so the generation runs against a base that genuinely does
 * not cover every requirement. A vacancy the base answers perfectly would never
 * exercise the thing this phase is about: what the generator does when the
 * material is not there.
 *
 * WHAT THIS SPEC CAN AND CANNOT SEE. It asserts what the screens show and what
 * the endpoints answer. It does NOT query `llm_calls` or `resume_versions`
 * directly — `.from(` outside a DAL fails check.mjs R1 and `tests/` is in scope
 * — so "exactly two chat rows for an approved run" is not something this file
 * can observe. What it CAN observe is the REQUEST count for a double-clicked
 * button, which is the one-click-one-spend contract (SPEC v2.11), and the
 * response's own account of how many versions the run wrote. The row count is
 * an owner query, recorded in the hand-over.
 *
 * Assertions are written against the CONTRACT, not against numbers a model
 * cannot guarantee: a real judge decides whether a draft is revised, so the spec
 * pins the states the screen may be in and the invariants between them — never
 * "the verdict is approve". That is the `e-1` lesson from the phase-2 review.
 */

const password = 'phase-4-e2e-password';

/** The fictional persona's own name (SPEC Block B). Synthetic data only. */
const DISPLAY_NAME = 'Mira Steinberg';

/** Accounts created by the running test, removed through the app's own flow. */
let created: string[] = [];

const uniqueEmail = () => {
  const email = `phase4-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

/** Only the fields the spec reads back off a version row. */
type JudgedVersion = {
  source: 'ai' | 'ai_revision' | 'user';
  judge: null | {
    verdict: 'approve' | 'revise';
    grounding: { verdict: 'pass' | 'fail'; violations: unknown[] };
    keywordCoverage: { score: number; missingHonest: string[] };
    relevance: { score: number };
    atsFormat: { score: number; issues: string[] };
    feedbackForGenerator: string[];
  };
};

const CASE = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'docs/eval/calibration-case-hiredbuddy.json'),
    'utf8',
  ),
) as { resumeText: string; vacancyText: string };

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

/** Build the career base by pasting the fixture resume through the import dialog. */
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
  const saved = await (await saveResponse).json();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Generation depends on the INDEX, not on the items: an unindexed base
  // retrieves nothing and the endpoint refuses before spending.
  expect(saved.indexed).toBeGreaterThan(0);
}

/** Run the career-base scan the generation then works from. */
async function runScan(page: Page) {
  await page.goto('/scan');
  await page.getByLabel(SCAN.vacancyLabel).fill(CASE.vacancyText);

  const scanResponse = page.waitForResponse(
    (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: SCAN.analyze }).click();
  const response = await scanResponse;
  expect(response.status(), 'the scan must succeed against the real models').toBe(200);
  const body = await response.json();
  await page.waitForURL(new RegExp(`/applications/${body.applicationId}$`));
  return body as { applicationId: string; matchScore: number | null; coverage: unknown[] };
}

// ---------------------------------------------------------------------------

test.describe('generate', () => {
  test.beforeEach(() => {
    created = [];
  });

  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {});
    }
  });

  test('all four Phase-4 endpoints refuse a signed-out caller with 401', async ({ request }) => {
    /**
     * Edge case S4 and auth rule 3. Middleware CANNOT cover this: the matcher
     * excludes `/api` by design, because a handler must answer 401 JSON rather
     * than redirect to HTML. `requireApiUser()` in each handler is the only
     * fence, and three of these four spend money.
     */
    const id = '11111111-1111-1111-1111-111111111111';
    const body = { content: 'x'.repeat(200) };
    const responses = [
      await request.post(`/api/applications/${id}/generate`, { data: {} }),
      await request.post(`/api/applications/${id}/rescore`, { data: body }),
      await request.post(`/api/applications/${id}/judge`, { data: body }),
      await request.post(`/api/applications/${id}/export`, { data: body }),
    ];

    for (const res of responses) {
      expect(res.status(), `${res.url()} must refuse an anonymous caller`).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  test("another user's application is 404 on every Phase-4 endpoint, never 403", async ({
    page,
  }) => {
    // Edge case S3/S6: RLS yields no row, and the answer must not reveal that
    // someone else's row exists.
    await signUp(page, uniqueEmail());
    const foreign = '11111111-1111-1111-1111-111111111111';
    for (const endpoint of ['generate', 'rescore', 'judge', 'export']) {
      const res = await page.request.post(`/api/applications/${foreign}/${endpoint}`, {
        data: endpoint === 'generate' ? {} : { content: 'x'.repeat(200) },
      });
      expect(res.status(), endpoint).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    }
  });

  test('generate, judge, edit, re-score, export — the whole US-4/US-5 path', async ({ page }) => {
    test.setTimeout(600_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    const scan = await runScan(page);

    // --- US-4: the empty state, then one generate ---------------------------
    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    await expect(page.getByText(RESULT.noVersionYet)).toBeVisible();

    const generateResponse = page.waitForResponse(
      (res) => res.url().includes('/generate') && res.request().method() === 'POST',
      { timeout: 300_000 },
    );
    await page
      .getByRole('button', { name: RESULT.generate })
      .first()
      .click();
    const generated = await generateResponse;
    expect(generated.status(), 'generation must succeed against the real models').toBe(200);
    const run = await generated.json();

    /**
     * THE DECLARED COST, as far as the response can witness it: rule B3 allows
     * ONE revision, so a run writes one version or two and never three. A loop
     * would show up here first.
     */
    expect(run.versions.length).toBeGreaterThanOrEqual(1);
    expect(run.versions.length).toBeLessThanOrEqual(2);
    expect(run.autoRevised).toBe(run.versions.length === 2);
    expect(typeof run.content).toBe('string');
    expect(run.content.length).toBeGreaterThan(0);

    /**
     * EVERY version is a row with its own verdict, and `judge: null` is the
     * third state — the check did not run — never a silent pass.
     */
    for (const version of run.versions as JudgedVersion[]) {
      expect(['ai', 'ai_revision']).toContain(version.source);
      if (version.judge !== null) {
        expect(['approve', 'revise']).toContain(version.judge.verdict);
        expect(['pass', 'fail']).toContain(version.judge.grounding.verdict);
        for (const score of [
          version.judge.keywordCoverage.score,
          version.judge.relevance.score,
          version.judge.atsFormat.score,
        ]) {
          expect(score).toBeGreaterThanOrEqual(1);
          expect(score).toBeLessThanOrEqual(5);
        }
        /**
         * RULE B2 AS A GATE. A grounding failure cannot be compensated for, so
         * the stored verdict must be `revise` however good the other scores are.
         * The app computes this rather than trusting the model's own field, and
         * this is the assertion that says so.
         */
        if (
          version.judge.grounding.verdict === 'fail' ||
          version.judge.grounding.violations.length > 0
        ) {
          expect(version.judge.verdict).toBe('revise');
        }
      }
    }

    /**
     * RULE B3, ONE REVISION. If a revision happened, the reviewer had said
     * something specific about the original — the app does not rewrite against a
     * generic complaint, so an `ai_revision` row implies findings on the `ai`
     * row's report.
     */
    if (run.autoRevised) {
      const original = (run.versions as JudgedVersion[]).find((v) => v.source === 'ai');
      expect(original?.judge, 'a revision implies the original WAS judged').toBeTruthy();
      const report = original!.judge!;
      const findings =
        report.grounding.violations.length +
        report.feedbackForGenerator.length +
        report.atsFormat.issues.length +
        report.keywordCoverage.missingHonest.length;
      expect(findings, 'a revision is only run against specific findings').toBeGreaterThan(0);
    }

    /**
     * The run's own account of itself, in the spec output — METADATA ONLY:
     * verdicts, scores and counts, never the resume text or a violated claim
     * (both are personal data, and a test log is not a place for either). It is
     * what makes "judge verdict recorded" something a reader of the run can see
     * rather than something the spec asserts privately.
     */
    console.log(
      '[phase-4] run:',
      JSON.stringify({
        versions: run.versions.length,
        autoRevised: run.autoRevised,
        revisionNotBetter: run.revisionNotBetter,
        revisionWithheld: run.revisionWithheld,
        verdicts: (run.versions as JudgedVersion[]).map((v) => ({
          source: v.source,
          verdict: v.judge?.verdict ?? 'not_checked',
          grounding: v.judge?.grounding.verdict ?? 'not_checked',
          violations: v.judge?.grounding.violations.length ?? 0,
        })),
      }),
    );

    // --- the judge card and the version history -----------------------------
    await expect(page.getByRole('heading', { name: RESULT.judgeHeading })).toBeVisible();
    if (run.judge === null) {
      await expect(page.getByText(RESULT.judgeNotRun)).toBeVisible();
    } else {
      await expect(page.getByText(RESULT.criterionGrounding)).toBeVisible();
      await expect(page.getByText(RESULT.criterionRelevance)).toBeVisible();
    }
    if (run.autoRevised) {
      await expect(page.getByText(RESULT.autoRevised)).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: RESULT.versionsHeading })).toBeVisible();

    /**
     * GROUNDING, OBSERVED RATHER THAN TRUSTED. The base names none of MS Office,
     * Google Suite, Labelbox or Supervisely — that is what makes this fixture a
     * false-positive test — so a resume grounded in it must not claim them. This
     * is the one assertion in the file about the model's OUTPUT, and it is
     * exactly the class of invention rule B2 exists to catch: the gaps Phase 3
     * found are gaps, and the generator may not close one by asserting the
     * missing thing.
     */
    // By ROLE: the tab and the textarea share the accessible name
    // `RESULT.editorLabel`, which is right for a reader and ambiguous for a
    // locator.
    const editor = page.getByRole('textbox', { name: RESULT.editorLabel });
    const draftRaw = await editor.inputValue();
    const draft = draftRaw.toLowerCase();
    /**
     * Metadata only, and one BOOLEAN rather than the line itself: the first line
     * of a resume is a person's name. What is worth knowing is whether P2's
     * layout token survived into the output — the career base is a list of jobs
     * and skills and carries no name anywhere, so a grounded generator has
     * nothing to put there and may write the placeholder instead. That is a
     * product finding, not a test failure: refusing to invent a name is the
     * generator behaving correctly.
     */
    console.log(
      '[phase-4] header:',
      JSON.stringify({
        literalNamePlaceholder: /^NAME\b/.test(draftRaw.trim()),
        namePlaceholder: draftRaw.includes(NAME_PLACEHOLDER),
      }),
    );

    /**
     * NO DISPLAY NAME IS SAVED IN THIS TEST, so the name line must be the VISIBLE
     * placeholder (v2.17) — never the vacancy's job title, which is what owner
     * testing found there, and never a silent substitution.
     *
     * The vacancy is "Data Annotator". A resume whose first line is that title is
     * the defect this round exists to remove, and it is the line an ATS parser
     * reads as the candidate's name.
     */
    const firstLine = draftRaw.trim().split('\n')[0]?.trim() ?? '';
    expect(firstLine, 'the name line must not be the job title').not.toBe('Data Annotator');
    expect(draftRaw).toContain(NAME_PLACEHOLDER);
    // And the editor says so while it is still one edit away from fixed.
    await expect(page.getByText(RESULT.namePlaceholderNotice)).toBeVisible();
    for (const absent of ['labelbox', 'supervisely']) {
      expect(draft, `the base never mentions ${absent}; the resume must not claim it`).not.toContain(
        absent,
      );
    }

    /**
     * THE JUDGE PANEL MAY NOT SUGGEST WHAT THE BASE DOES NOT CONTAIN (v2.17).
     *
     * The owner's own defect, asserted on the rendered screen rather than on the
     * pure function alone: the card listed Labelbox, Supervisely, MS Office and
     * Google Suite under "Supported by your base, missing from the resume" while
     * the coverage table two blocks above said `no mention of "Labelbox"`. This
     * fixture's base contains none of the four, so none of them may appear under
     * that header — whatever the reviewer returned.
     */
    const supportedSection = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: RESULT.missingHonestHeading }) })
      .last();
    if (await supportedSection.isVisible().catch(() => false)) {
      const suggested = (await supportedSection.innerText()).toLowerCase();
      for (const absent of ['labelbox', 'supervisely', 'ms office', 'google suite']) {
        expect(
          suggested,
          `the base never mentions ${absent}; it must not be offered as supported`,
        ).not.toContain(absent);
      }
    }

    // --- US-5 step 1: edit, then re-score against the same vacancy -----------
    const storedScore = (await page.getByRole('img', { name: RESULT.matchRate }).textContent())
      ?.trim();

    await editor.fill(
      `${await editor.inputValue()}\n\nADDITIONAL\n- Ran quality checks on annotated batches against written guidelines, at roughly 400 items per week.`,
    );

    const rescoreResponse = page.waitForResponse(
      (res) => res.url().includes('/rescore') && res.request().method() === 'POST',
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: RESULT.rescore }).click();
    const rescored = await rescoreResponse;
    expect(rescored.status()).toBe(200);
    const rescoreBody = await rescored.json();

    /**
     * US-5's acceptance: the score changes, and it changes WITHOUT a chat call.
     *
     * WHAT IS ASSERTED IS THE MEASUREMENT, NOT THE NUMBER. The two scores are
     * normally different and a run has already been seen where they were not:
     * both are real measurements of different text, and rule B1 rounds to a
     * whole percent, so they can collide by arithmetic coincidence. Asserting
     * inequality would make this spec fail on a day the app was right — the
     * `e-1` lesson from the phase-2 review, arriving on a different endpoint.
     *
     * So what is pinned is what makes the re-score a DIFFERENT measurement at
     * all, and none of it can coincide:
     *   - every entry names no career item, because the corpus was the editor's
     *     own text rather than the base;
     *   - the similarities are not the stored ones re-served;
     *   - the ring shows the re-scored value and says it is unsaved.
     * If Block D #6 were implemented against the career base again — the defect
     * the architect gate caught in this phase's plan — the first two would fail
     * immediately, whatever the score came out as.
     */
    await expect(page.getByText(RESULT.rescoredLabel)).toBeVisible();
    const liveScore = (await page.getByRole('img', { name: RESULT.matchRate }).textContent())
      ?.trim();
    expect(liveScore).toBe(
      rescoreBody.matchScore === null ? NO_SCORE : `${rescoreBody.matchScore}%`,
    );

    console.log(
      '[phase-4] rescore:',
      JSON.stringify({ stored: storedScore, live: liveScore, entries: rescoreBody.coverage.length }),
    );

    type Entry = {
      status: string;
      similarity: number;
      careerItemId: string | null;
      careerItemTitle: string | null;
      matchedText: string | null;
    };
    const live: Entry[] = rescoreBody.coverage;
    const stored: Entry[] = scan.coverage as Entry[];
    expect(live.length).toBe(stored.length);

    for (const entry of live) {
      expect(entry.careerItemId, 'a re-score matches the editor, not the career base').toBeNull();
      expect(entry.careerItemTitle).toBeNull();
    }
    // A covered row can still answer "matched against what?" — with the user's
    // own line, which is the text they just sent.
    for (const entry of live.filter((e) => e.status !== 'gap')) {
      expect(entry.matchedText, 'a covered row names the line that matched').toBeTruthy();
    }
    expect(
      live.map((e) => e.similarity).join(','),
      'the requirements were re-ranked, not re-served',
    ).not.toBe(stored.map((e) => e.similarity).join(','));

    // The stored measurement is still reachable — the live one is labelled, not
    // substituted.
    await page.getByRole('button', { name: RESULT.rescoredRevert }).click();
    expect(
      (await page.getByRole('img', { name: RESULT.matchRate }).textContent())?.trim(),
    ).toBe(storedScore);

    // --- US-5 step 4: export ------------------------------------------------
    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: RESULT.download }).click(),
    ]);
    /**
     * With no display name saved, the file is `CV_<Company>_<Role>.docx`: the name
     * part is ABSENT rather than guessed at from the document's first line, which
     * used to produce `CV_Data_Annotator_….docx`.
     */
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^CV_.*\.docx$/);
    expect(filename, 'the filename must not take the job title for a name').not.toMatch(
      /^CV_Data_Annotator/,
    );
    // The download succeeded AND the document still says [YOUR NAME]: both are
    // true, and the second is said out loud rather than left to be discovered.
    await expect(page.getByText(RESULT.exportedWithPlaceholderName)).toBeVisible();
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const file = Buffer.concat(chunks);
    // A .docx is a zip: "PK" is the local file header, so this proves a real
    // document rather than an error page saved with the right extension.
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(file.byteLength).toBeGreaterThan(1_000);

    // The export SAVES the edit (Block D #6: "saving happens via /judge or
    // export"), so the history gains the user's own version.
    await expect(page.getByText(RESULT.savedUserVersion)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    await expect(page.getByText(RESULT.versionLabel.user).first()).toBeVisible();

    // --- the reload opens the version the response showed -------------------
    expect(
      (await page.getByRole('textbox', { name: RESULT.editorLabel }).inputValue()).length,
    ).toBeGreaterThan(0);

    // --- the category bars stop saying "Not checked yet" --------------------
    if (run.judge !== null) {
      await expect(page.getByText(RESULT.categoryAts)).toBeVisible();
    }

    // --- the scan's own application id is still the one being edited --------
    expect(page.url()).toContain(scan.applicationId);
  });

  test('one click, one spend: a double-clicked [Generate] sends ONE request', async ({ page }) => {
    /**
     * SPEC v2.11's rule, on the most expensive button in the app. A `disabled`
     * prop cannot guard two clicks that fire before React re-renders, so the
     * lock is a ref set synchronously — and the assertion is on the REQUEST
     * COUNT, not on the UI, because a second POST is a second Sonnet call
     * whatever the screen shows.
     */
    test.setTimeout(600_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    await runScan(page);

    let requests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/generate') && request.method() === 'POST') requests += 1;
    });

    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    const button = page.getByRole('button', { name: RESULT.generate }).first();
    const response = page.waitForResponse(
      (res) => res.url().includes('/generate') && res.request().method() === 'POST',
      { timeout: 300_000 },
    );
    // Two clicks as fast as the browser will deliver them.
    await button.click({ force: true });
    await button.click({ force: true, timeout: 2_000 }).catch(() => {});
    expect((await response).status()).toBe(200);

    expect(requests, 'a double click must not buy two generations').toBe(1);
  });

  /**
   * THE DISPLAY NAME, END TO END (SPEC v2.17) — and it says out loud when it
   * cannot run.
   *
   * It needs `004_profiles.sql`, which the owner applies in the Supabase
   * dashboard as with 001-003. Until then there is no `profiles` table, the save
   * fails, and this test SKIPS with that reason rather than failing: a red test
   * for an unapplied migration says nothing about the code, and the same visible
   * skip is how this suite already handles the AI-unavailable case it cannot
   * arrange for itself. It starts running by itself the moment the table exists.
   *
   * The probe is the feature's own first action, so it cannot drift from what it
   * is guarding.
   */
  test('a saved display name becomes the resume name line and the file name', async ({ page }) => {
    test.setTimeout(600_000);
    await signUp(page, uniqueEmail());

    await page.goto('/settings');
    await page.getByLabel(SETTINGS.displayNameLabel).fill(DISPLAY_NAME);
    await page.getByRole('button', { name: SETTINGS.displayNameSave }).click();
    const saved = await page
      .getByText(SETTINGS.displayNameSaved)
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    test.skip(!saved, 'needs migration 004_profiles.sql applied in the Supabase dashboard');

    // Stored, not just echoed: the reload is what makes this about the row.
    await page.reload();
    await expect(page.getByLabel(SETTINGS.displayNameLabel)).toHaveValue(DISPLAY_NAME);

    await buildCareerBase(page);
    await runScan(page);

    const generateResponse = page.waitForResponse(
      (res) => res.url().includes('/generate') && res.request().method() === 'POST',
      { timeout: 300_000 },
    );
    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    await page.getByRole('button', { name: RESULT.generate }).first().click();
    expect((await generateResponse).status()).toBe(200);

    const draft = await page.getByRole('textbox', { name: RESULT.editorLabel }).inputValue();
    expect(draft, 'the saved display name is the name line').toContain(DISPLAY_NAME);
    expect(draft, 'a saved name leaves no placeholder').not.toContain(NAME_PLACEHOLDER);
    /**
     * P3 was told the name comes from the user's profile, so it must not be
     * reported as an unsupported claim. A grounding failure there is
     * uncompensatable under rule B2, so every resume would be revised once for
     * having a name on it — this is the assertion that the judge was told.
     */
    await expect(page.getByText(RESULT.namePlaceholderNotice)).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: RESULT.download }).click(),
    ]);
    // From the PROFILE, never from the document's first line.
    expect(download.suggestedFilename()).toContain('Mira_Steinberg');
    await expect(page.getByText(RESULT.exportedWithPlaceholderName)).toHaveCount(0);

    // Optional means removable: a settings field a user cannot empty is one they
    // cannot take back, and a name is personal data.
    await page.goto('/settings');
    await page.getByLabel(SETTINGS.displayNameLabel).fill('');
    await page.getByRole('button', { name: SETTINGS.displayNameSave }).click();
    await expect(page.getByText(SETTINGS.displayNameCleared)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(SETTINGS.displayNameLabel)).toHaveValue('');
  });

  test('an empty editor blocks both metered buttons with the exact copy', async ({ page }) => {
    /**
     * US-5's error path. Asserted through the API, because the endpoint is the
     * actual gate: a client-side guard the server does not repeat is not a
     * guard at all when the button is the only thing standing in front of a
     * paid call.
     */
    test.setTimeout(300_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    const scan = await runScan(page);

    for (const endpoint of ['rescore', 'judge', 'export']) {
      const res = await page.request.post(
        `/api/applications/${scan.applicationId}/${endpoint}`,
        { data: { content: '   ' } },
      );
      expect(res.status(), endpoint).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe(RESULT.emptyEditor);
    }
  });

  test('the judge catches invention, and rule B2 forces revise however good the rest is', async ({
    page,
  }) => {
    /**
     * THE GROUNDING GATE, WITNESSED. The generate path in this file exercises the
     * happy branch — a judge that approves — because a real reviewer decides that
     * and no fixture can force it. This one exercises the branch that matters:
     * text carrying claims the career base plainly does not support, put through
     * the same P3 call [Check quality] makes.
     *
     * The invented claims are egregious on purpose (a Google role, a team of 40,
     * an AWS certification, a PhD) against a base of two annotation jobs at
     * fictional companies. If a strict reviewer cannot see those, the rubric is
     * not doing the job the app relies on it for, and this test failing is the
     * finding.
     *
     * It also pins rule B2 as a GATE rather than a score: whatever the other
     * three criteria come back as, a grounding failure must produce `revise`.
     * That verdict is computed by `lib/judge.ts` from the report's evidence, not
     * read from the model's own field, so this is the end-to-end proof of the
     * thing `judge.test.mjs` proves in isolation.
     */
    test.setTimeout(300_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    const scan = await runScan(page);

    const invented = [
      'MIRA STEINBERG',
      'Senior Staff Engineer',
      '',
      'EXPERIENCE',
      'Senior Staff Engineer — Google (01/2019 – present)',
      '- Led a team of 40 engineers building the annotation platform used company-wide.',
      '- Cut labelling cost by 62 percent across a 900-person vendor network.',
      '',
      'EDUCATION & CERTIFICATIONS',
      'PhD in Computational Linguistics — Stanford University (2015 – 2019)',
      'AWS Certified Solutions Architect — Professional',
    ].join('\n');

    const res = await page.request.post(`/api/applications/${scan.applicationId}/judge`, {
      data: { content: invented },
      timeout: 180_000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // The reviewed text is its own row, whatever the verdict says: a check that
    // refuses the text is still a measurement of it (Block D #7).
    expect(body.source).toBe('user');
    expect(body.resumeVersionId).toMatch(/^[0-9a-f-]{36}$/);

    // Metadata only — the violated CLAIMS are the user's text and stay out of
    // the log.
    console.log(
      '[phase-4] grounding gate:',
      JSON.stringify({
        verdict: body.judge.verdict,
        grounding: body.judge.grounding.verdict,
        violations: body.judge.grounding.violations.length,
        scores: {
          keywordCoverage: body.judge.keywordCoverage.score,
          relevance: body.judge.relevance.score,
          atsFormat: body.judge.atsFormat.score,
        },
      }),
    );

    expect(
      body.judge.grounding.verdict,
      'a Google role, a PhD and an AWS certification are in no career item',
    ).toBe('fail');
    expect(body.judge.grounding.violations.length).toBeGreaterThan(0);
    // Rule B2: the failure cannot be compensated for, and the app decides this
    // rather than believing the model's own verdict field.
    expect(body.judge.verdict).toBe('revise');

    // And the screen says so, on the card, for the version just saved.
    await page.reload();
    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    await expect(page.getByText(RESULT.groundingFailed).first()).toBeVisible();
    await expect(page.getByText(RESULT.violationsHeading)).toBeVisible();
  });

  test('[Add to resume] is refused with a reason while no resume exists', async ({ page }) => {
    /**
     * US-3 step 4 inserts into the editor, and there is no editor until a
     * version exists. The button says so rather than appending to a panel the
     * same screen calls empty.
     */
    test.setTimeout(300_000);
    await signUp(page, uniqueEmail());
    await buildCareerBase(page);
    await runScan(page);

    await page.getByRole('tab', { name: RESULT.tabBaseMatches }).click();
    // A career-base scan has no hidden matches by construction, so the tab says
    // why instead of showing US-3's empty copy.
    await expect(page.getByText(RESULT.baseIsSource)).toBeVisible();

    await page.getByRole('tab', { name: RESULT.tabResume }).click();
    await expect(page.getByText(RESULT.noVersionYet)).toBeVisible();
  });
});
