#!/usr/bin/env node
/**
 * Demonstration seeder and screenshot capture — DEVELOPMENT ONLY, and
 * deliberately NOT part of the Playwright suite (`playwright.config.ts` has
 * `testDir: './tests/e2e'`, so nothing here runs under `npm run test:e2e`).
 *
 * It drives the real product as a signed-in user — Settings, import, scan,
 * generate — and photographs the result. Every image in `docs/images/` comes
 * from this script, so a README screenshot is a picture of the app doing the
 * work rather than a mock-up of it doing the work.
 *
 * WHY IT SIGNS IN INSTEAD OF SIGNING UP. `scripts/coverage-probe.mjs --seed`
 * creates a throwaway account and deletes it again, which was the right shape
 * while registration was open. It is closed now (`docs/deploy.md` step 2), so a
 * script cannot create an account at all: the owner creates one by hand in the
 * Supabase dashboard and this script signs into it.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT AND NOWHERE ELSE.
 *
 *     CVI_DEMO_EMAIL      the demonstration account's address
 *     CVI_DEMO_PASSWORD   its password
 *
 * Set them in the shell that runs this, and nowhere that is written down:
 *
 *     $env:CVI_DEMO_EMAIL='…'; $env:CVI_DEMO_PASSWORD='…'   (PowerShell)
 *     export CVI_DEMO_EMAIL='…' CVI_DEMO_PASSWORD='…'        (bash)
 *
 * This file never opens a `.env` of any kind, never writes either value
 * anywhere, and never prints them — the address is masked in every line of
 * output, because a screenshot run that leaks the account it used into a
 * terminal transcript defeats the point of the run.
 *
 * THE ACCOUNT MUST BE A DEDICATED DEMONSTRATION ACCOUNT, AND THE SCRIPT CHECKS.
 * The images are published in the README, so nothing real may be in them. A
 * career base that already has rows means this is somebody's actual account, and
 * the run REFUSES rather than photographing it. `--allow-existing-base` exists
 * only for re-running against an account this script itself seeded; it does not
 * make it safe to point at a real one.
 *
 * WHAT IT SPENDS. One `import_resume` call, one `parse_vacancy` call, the
 * embedding requests for the base and the requirements, and one generate → judge
 * pair (up to two more if rule B3's single revision fires). Real money, on
 * purpose: a screenshot of a mocked pipeline would be a picture of nothing.
 *
 * USAGE
 *     node scripts/demo-seed.mjs                      # seed, then capture
 *     node scripts/demo-seed.mjs --shots-only         # capture from what is there
 *     node scripts/demo-seed.mjs --case <file.json>   # a different fixture
 *     node scripts/demo-seed.mjs --base-url http://localhost:3000
 *
 * It prints the judge's four criteria for the run, which is the measurement
 * `docs/eval/generation-coverage-control.md` is written from.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? null);
};
const has = (name) => args.includes(`--${name}`);

const BASE_URL = flag('base-url', process.env.E2E_BASE_URL ?? 'http://localhost:3000');
const CASE_FILE = flag('case', 'docs/eval/calibration-case-vinterlys.json');
const OUT_DIR = flag('out', 'docs/images');
const SHOTS_ONLY = has('shots-only');
const ALLOW_EXISTING = has('allow-existing-base');

/**
 * The capture viewport. Fixed, and stated here rather than inherited from a
 * device preset: every image in docs/images/ has to be the same width or the
 * README renders a ragged column, and a screenshot whose size depends on the
 * machine that took it is not reproducible evidence.
 */
const VIEWPORT = { width: 1440, height: 900 };

const EMAIL = process.env.CVI_DEMO_EMAIL;
const PASSWORD = process.env.CVI_DEMO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    'demo-seed: set CVI_DEMO_EMAIL and CVI_DEMO_PASSWORD in your shell first.\n' +
      '           They are the demonstration account created by hand in the Supabase\n' +
      '           dashboard — registration is closed, so this script cannot make one.\n' +
      '           Do not put them in a file; this script reads the environment only.',
  );
  process.exit(2);
}

/**
 * The address, with the local part removed. Enough to tell two accounts apart in
 * a transcript, not enough to be an address — the domain alone identifies
 * nobody, and the alternative (printing it whole) puts a real credential into
 * every log this run touches.
 */
const maskedEmail = `…@${String(EMAIL).split('@')[1] ?? 'unknown'}`;

const CASE = JSON.parse(readFileSync(CASE_FILE, 'utf8'));
if (!CASE.resumeText || !CASE.vacancyText) {
  throw new Error(`${CASE_FILE} needs { resumeText, vacancyText }`);
}

mkdirSync(OUT_DIR, { recursive: true });

const shot = (name) => path.join(OUT_DIR, `${name}.png`);
const captured = [];

/**
 * Photograph ONE element, not the page.
 *
 * A full-page screenshot where the subject is four hundred pixels tall is
 * decoration: the reader has to hunt for the thing the caption promised. Every
 * image here is therefore cropped to the element that IS the point, and the
 * capture asserts that the element actually contains the text it was taken to
 * show — so a layout change breaks the run instead of quietly producing an
 * image of the wrong thing.
 */
async function capture(locator, name, mustContain = []) {
  await locator.first().scrollIntoViewIfNeeded();
  await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
  const text = await locator.first().innerText();
  for (const needle of mustContain) {
    if (!text.includes(needle)) {
      throw new Error(
        `capture ${name}: the framed element does not contain ${JSON.stringify(needle)} — ` +
          'refusing to save an image that does not show what it is for',
      );
    }
  }
  await locator.first().screenshot({ path: shot(name) });
  captured.push(name);
  console.log(`shot: ${name}.png`);
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(scan|career)$/, { timeout: 30_000 });
  console.log(`signed in as ${maskedEmail}`);
}

/**
 * The safety fence. A non-empty career base means this is a real account, and
 * the images from this run end up in a public README.
 */
async function assertBaseIsEmpty(page) {
  await page.goto(`${BASE_URL}/career`);
  /*
   * `isVisible()` is NOT used here, and that is the whole care in this function.
   * It does not auto-wait and it ignores the timeout it is handed, so on a page
   * that has not finished rendering it answers "no" about an element that is
   * simply not there yet — which is how backlog p4-19's guard came to be a test
   * that could only ever pass as a skip. A fence that misreads a slow page is not
   * a fence, and this one decides whether to photograph somebody's account.
   */
  const empty = page.getByText('Your career base is empty');
  const importTrigger = page.getByRole('button', { name: 'Import resume' }).first();
  await Promise.race([
    empty.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    importTrigger.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);
  if ((await empty.count()) > 0) return;
  if (ALLOW_EXISTING) {
    console.log('career base is NOT empty — continuing because --allow-existing-base was passed');
    return;
  }
  throw new Error(
    'the career base on this account already has items.\n' +
      '  This script publishes its screenshots, so it will not photograph an account that\n' +
      '  holds real data. Use a dedicated demonstration account with an empty base, or pass\n' +
      '  --allow-existing-base if this is an account this script seeded itself.',
  );
}

/** The invented identity, saved through the real Settings forms. */
async function saveProfile(page) {
  if (!CASE.displayName) return;
  await page.goto(`${BASE_URL}/settings`);
  await page.getByLabel('Your name').fill(CASE.displayName);
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByText('Name saved.').waitFor({ timeout: 30_000 });

  const c = CASE.contacts ?? {};
  if (c.contactEmail) await page.getByLabel('Contact email').fill(c.contactEmail);
  if (c.phone) await page.getByLabel('Phone').fill(c.phone);
  if (c.location) await page.getByLabel('Location').fill(c.location);
  if (c.linkedin) await page.getByLabel('LinkedIn URL').fill(c.linkedin);
  if (c.github) await page.getByLabel('GitHub URL').fill(c.github);
  if (c.openToRemote) await page.getByLabel('Open to remote work').check();
  await page.getByRole('button', { name: 'Save contact details' }).click();
  await page.getByText('Contact details saved.').waitFor({ timeout: 30_000 });
  console.log(`profile: saved the invented identity (${CASE.displayName})`);
}

/** Import the fixture resume through the dialog and save it to the base. */
async function buildBase(page) {
  await page.goto(`${BASE_URL}/career`);
  await page.getByRole('button', { name: 'Import resume' }).first().click();
  const dialog = page.getByRole('dialog');

  const extracted = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await dialog.getByPlaceholder('Paste your resume text here.').fill(CASE.resumeText);
  await dialog.getByRole('button', { name: 'Extract items' }).click();
  const proposed = await (await extracted).json();

  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();
  const committed = await (await saved).json();
  await dialog
    .getByRole('button', { name: 'Done' })
    .click()
    .catch(() => {});
  console.log(
    `base: extracted ${proposed.items?.length ?? 0}, saved ${committed.items?.length ?? 0}, ` +
      `indexed ${committed.indexed ?? 0}`,
  );
  if (!committed.indexed) throw new Error('the base is not indexed — matching would find nothing');
}

/** One career-base scan against the fixture posting. */
async function runScan(page) {
  await page.goto(`${BASE_URL}/scan`);
  await page.getByLabel('Job posting').fill(CASE.vacancyText);
  const scanned = page.waitForResponse(
    (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
    { timeout: 240_000 },
  );
  await page.getByRole('button', { name: 'Analyze' }).click();
  const response = await scanned;
  const body = await response.json();
  if (response.status() !== 200) {
    throw new Error(`scan failed: ${response.status()} ${JSON.stringify(body)}`);
  }
  console.log(`scan: score ${body.matchScore}, application ${body.applicationId}`);
  reportCoverage(body);
  return body.applicationId;
}

/** The coverage decision, per requirement — the fixture's own acceptance check. */
function reportCoverage(body) {
  const entries = body.coverage ?? [];
  console.log('');
  console.log('coverage (this is what the fixture was built to produce):');
  for (const entry of entries) {
    const missing = entry.missingTerm ? `   GATE MISSING: ${entry.missingTerm}` : '';
    console.log(
      `  ${String(entry.status).padEnd(32)} ${String(entry.similarity ?? '—').toString().slice(0, 6).padStart(6)}  ` +
        `${entry.requirement}${missing}`,
    );
  }
  const covered = entries.filter((e) => e.status === 'covered').length;
  const gated = entries.filter((e) => e.missingTerm).length;
  console.log(
    `  => ${covered} covered of ${entries.length}; ${gated} turned into a gap by the lexical gate`,
  );
  console.log('');
}

/** Generate, and let the judge run. Returns the rubric for the eval file. */
async function generate(page, applicationId) {
  await page.goto(`${BASE_URL}/applications/${applicationId}`);
  await page.getByRole('tab', { name: 'Tailored resume' }).click();
  const generated = page.waitForResponse(
    (res) => res.url().includes('/generate') && res.request().method() === 'POST',
    { timeout: 300_000 },
  );
  await page.getByRole('button', { name: 'Generate tailored resume' }).click();
  const response = await generated;
  const body = await response.json();
  if (response.status() !== 200) {
    throw new Error(`generate failed: ${response.status()} ${JSON.stringify(body)}`);
  }
  reportRubric(body);
  return body;
}

/**
 * The p5-16 measurement, printed rather than inferred from a screenshot.
 * Grounding first, because that is the question this fixture exists to answer.
 */
function reportRubric(body) {
  const j = body.judge;
  console.log('');
  console.log('JUDGE — the p5-16 measurement for this run:');
  if (!j) {
    console.log('  the judge did not run (the card says so on screen too)');
    return;
  }
  console.log(`  source            ${body.source}   autoRevised=${body.autoRevised === true}`);
  console.log(
    `  grounding         ${j.grounding?.verdict}  violations=${j.grounding?.violations?.length ?? 0}`,
  );
  for (const v of j.grounding?.violations ?? []) console.log(`      - ${v.claim} :: ${v.issue}`);
  console.log(
    `  keywordCoverage   ${j.keywordCoverage?.score}/5  missingHonest=${(j.keywordCoverage?.missingHonest ?? []).length}` +
      ((j.keywordCoverage?.missingHonest ?? []).length
        ? ` (${j.keywordCoverage.missingHonest.join(', ')})`
        : ''),
  );
  console.log(`  relevance         ${j.relevance?.score}/5`);
  console.log(
    `  atsFormat         ${j.atsFormat?.score}/5  issues=${(j.atsFormat?.issues ?? []).length}`,
  );
  console.log(`  verdict           ${j.verdict}`);
  console.log('');
}

/** The four README images. Each one framed on the thing it is there to show. */
async function captureAll(page, applicationId) {
  // 1. The scan result: the requirement table, with Covered rows AND a row the
  //    lexical gate turned into a gap. The gate is the most distinctive thing
  //    this product does, so the assertion below is on the gate's own copy.
  await page.goto(`${BASE_URL}/applications/${applicationId}`);
  await page.getByRole('tab', { name: 'Analysis' }).click();
  const coverage = page.locator('table').first();
  await capture(coverage, 'scan-coverage', ['Covered', 'no mention of']);

  // 2. The tailored resume WITH the judge's verdict panel. The whole tab panel,
  //    because the point is the two of them together — a verdict photographed
  //    away from the text it judged is an assertion, not evidence. The name line
  //    is asserted as well, which is what proves the resume itself is in frame.
  await page.getByRole('tab', { name: 'Tailored resume' }).click();
  await page.getByRole('heading', { name: 'Quality check' }).waitFor({ timeout: 60_000 });
  const resumeTab = page.getByRole('tabpanel');
  await capture(resumeTab, 'judge-verdict', ['Quality check', CASE.displayName ?? 'Versions']);

  // 3. The observability dashboard.
  await page.goto(`${BASE_URL}/quality`);
  await page.getByRole('heading', { name: 'Quality', exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await capture(page.locator('main'), 'quality-dashboard', ['Total AI cost']);

  // 4. The career base the whole pipeline reads from.
  await page.goto(`${BASE_URL}/career`);
  await page.waitForTimeout(1_000);
  await capture(page.locator('main'), 'career-base', []);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
try {
  await signIn(page);

  let applicationId = flag('application');
  if (!SHOTS_ONLY) {
    await assertBaseIsEmpty(page);
    await saveProfile(page);
    await buildBase(page);
    applicationId = await runScan(page);
    await generate(page, applicationId);
  }
  if (!applicationId) {
    throw new Error('--shots-only needs --application <uuid>');
  }

  await captureAll(page, applicationId);
  console.log('');
  console.log(`captured ${captured.length} image(s) into ${OUT_DIR}/`);
  console.log(`application: ${applicationId}`);
  console.log('CHECK EVERY IMAGE BEFORE COMMITTING IT — no real name, address or career item.');
} finally {
  await browser.close();
}
