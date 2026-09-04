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
 * CREDENTIALS COME FROM `.env.demo.local`, WHICH ONLY THIS SCRIPT OPENS.
 *
 *     CVI_DEMO_EMAIL      the demonstration account's address
 *     CVI_DEMO_PASSWORD   its password
 *
 * The file sits at the repository root and is git-ignored by `/.env.*`. An
 * already-exported environment variable of the same name still wins, so the
 * shell route keeps working; the file is what makes the run reproducible
 * without one.
 *
 * IT REFUSES TO READ THE FILE UNLESS GIT IGNORES IT. `assertIgnored()` below
 * asks `git check-ignore` before the file is opened, because "it is in
 * .gitignore" is a claim about a PATTERN and this has to be a fact about THIS
 * path. A credential that reaches a repository is not recoverable by deleting
 * the file afterwards, so the check belongs in the mechanism rather than in a
 * reader's memory.
 *
 * Neither value is ever printed, logged or written anywhere: the address is
 * masked in every line of output, because a screenshot run that leaks the
 * account it used into a terminal transcript defeats the point of the run.
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
 *     node scripts/demo-seed.mjs --credentials <file>   # default .env.demo.local
 *
 * It prints the judge's four criteria for the run, which is the measurement
 * `docs/eval/generation-coverage-control.md` is written from.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

const CREDENTIALS_FILE = flag('credentials', '.env.demo.local');

/**
 * Refuse to open a credentials file that git would commit.
 *
 * `git check-ignore` exits 0 when the path is ignored and 1 when it is not, and
 * it answers about THIS path rather than about a pattern someone believes
 * covers it. Exit 1 is the dangerous answer and stops the run. A git that
 * cannot answer is also a stop: "I could not check" is not "it is fine".
 */
function assertIgnored(file) {
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { stdio: 'ignore' });
    ignored = true;
  } catch (err) {
    if (err && err.status === 1) ignored = false;
    else {
      throw new Error(
        `could not ask git whether ${file} is ignored (${err && err.message}). ` +
          'Refusing to read credentials I cannot prove are un-committable.',
      );
    }
  }
  if (!ignored) {
    throw new Error(
      `${file} is NOT ignored by git. Refusing to read it. Add it to .gitignore ` +
        'first — a credential that reaches a repository is not recoverable by ' +
        'deleting the file afterwards.',
    );
  }
}

if (existsSync(CREDENTIALS_FILE)) {
  assertIgnored(CREDENTIALS_FILE);
  // Node's own loader. It does not override variables already exported, so a
  // value set in the shell still wins over the file.
  process.loadEnvFile(CREDENTIALS_FILE);
}

const EMAIL = process.env.CVI_DEMO_EMAIL;
const PASSWORD = process.env.CVI_DEMO_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    'demo-seed: no credentials. Expected CVI_DEMO_EMAIL and CVI_DEMO_PASSWORD in ' +
      `${CREDENTIALS_FILE} (git-ignored), or already exported in the shell. The ` +
      'account is the demonstration one created by hand in the Supabase dashboard — ' +
      'registration is closed, so this script cannot make one.',
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
/**
 * Photograph an element, but stop the frame ABOVE some later element.
 *
 * /quality is 2,500 pixels tall and its last third is a call-by-call log. The
 * dashboard's argument — what each run cost, which model served it, what the
 * reviewer said — is over by then, so the log is length rather than evidence.
 * The cut is expressed as "everything above this heading" instead of a pixel
 * count, so it survives the screen growing.
 */
async function captureUntil(page, locator, name, stopBefore, mustContain = []) {
  await locator.first().waitFor({ state: 'visible', timeout: 30_000 });
  const text = await locator.first().innerText();
  for (const needle of mustContain) {
    if (!text.includes(needle)) {
      throw new Error(`capture ${name}: the framed element does not contain ${JSON.stringify(needle)}`);
    }
  }
  const box = await locator.first().boundingBox();
  const stop = await stopBefore.first().boundingBox();
  if (!box || !stop) throw new Error(`capture ${name}: could not measure the frame`);
  await page.screenshot({
    path: shot(name),
    fullPage: true,
    clip: { x: box.x, y: box.y, width: box.width, height: Math.max(1, stop.y - box.y - 8) },
  });
  captured.push(name);
  console.log(`shot: ${name}.png (cropped above "${await stopBefore.first().innerText()}")`);
}

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
  try {
    await page.waitForURL(/\/(scan|career)$/, { timeout: 30_000 });
  } catch {
    /*
     * A bare "navigation timed out" is the least useful thing this script could
     * say: the four reasons a sign-in does not navigate need four different
     * fixes, and the app already renders exactly which one it was. Report the
     * COPY. It is the app's own words and carries no credential — which is the
     * only reason it can be printed at all.
     */
    const shown = [];
    for (const line of [
      'Email or password is incorrect.',
      'Confirm your email before signing in.',
      'Too many attempts — try again in a minute.',
      'Sign-in is temporarily unavailable. Try again.',
      'Enter a valid email address.',
      'Password must be at least 8 characters.',
    ]) {
      if ((await page.getByText(line).count()) > 0) shown.push(line);
    }
    throw new Error(
      [
        `sign-in did not reach the app. The page says: ${shown.length ? shown.join(' / ') : '(no error copy on screen)'}`,
        `  still on ${new URL(page.url()).pathname}, with the address read as ${maskedEmail}.`,
        '  Neither credential is printed here, or anywhere else — the mask is the domain only.',
        '  "Email or password is incorrect" means the file\u2019s values do not match the account.',
        '  "Confirm your email" means the dashboard user was created without Auto Confirm.',
      ].join(String.fromCharCode(10)),
    );
  }
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

  const extracted = pending(
    page.waitForResponse(
      (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
      { timeout: 180_000 },
    ),
  );
  await dialog.getByPlaceholder('Paste your resume text here.').fill(CASE.resumeText);
  await dialog.getByRole('button', { name: 'Extract items' }).click();
  const proposed = await (await extracted).json();

  const saved = pending(
    page.waitForResponse(
      (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
      { timeout: 180_000 },
    ),
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
  const scanned = pending(
    page.waitForResponse(
      (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
      { timeout: 240_000 },
    ),
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
  // The tab has rendered when its empty state has. Waiting on the thing the
  // screen actually says, rather than on a duration.
  await page.getByText('No tailored resume yet.').waitFor({ timeout: 60_000 });
  const generated = pending(
    page.waitForResponse(
      (res) => res.url().includes('/generate') && res.request().method() === 'POST',
      { timeout: 300_000 },
    ),
  );
  // `.first()` because the label appears on more than one control; without it
  // Playwright's strict mode throws and the run dies pointing at the wrong line.
  await page.getByRole('button', { name: 'Generate tailored resume' }).first().click();
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

/**
 * `waitForResponse` returns a promise that is created BEFORE the click that
 * triggers it. If the click throws, nothing ever awaits that promise, and when
 * the browser closes it rejects on its own — as an unhandled rejection that
 * replaces the real error with "Target page, context or browser has been
 * closed". That is how a strict-mode violation on a button cost one run.
 *
 * Attaching a no-op catch makes the rejection handled without consuming it: the
 * real `await` below still sees the same settled promise, and a failing click
 * now reports the failing click.
 */
function pending(promise) {
  promise.catch(() => {});
  return promise;
}

/*
 * THERE IS NO `GET /api/applications/[id]`, so a per-version rubric cannot be
 * read from an endpoint: the detail page is a Server Component that reads the
 * versions through the DAL, and a script may not touch a DAL (check.mjs R1).
 * An earlier draft of this file asked for one anyway and got a 405.
 *
 * That measurement is not lost, it just lives on a screen: `/quality` counts
 * grounding across EVERY stored verdict — "0 passed · 2 failed" is both
 * versions of one run — and the Versions rail on the detail page labels each
 * version with its own verdict. Both are captured below.
 */

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
  /*
   * The resume is the VALUE of a textarea, and a textarea's value is not part of
   * any ancestor's innerText — so asserting the name against the panel's text
   * fails on an image that is perfectly correct. The fence was right to refuse
   * and the assertion was wrong: the editor is checked through inputValue(),
   * which is where that text actually lives, and the panel is checked for the
   * verdict copy.
   */
  const editor = page.getByRole('textbox', { name: 'Tailored resume' }).first();
  const written = await editor.inputValue();
  if (CASE.displayName && !written.includes(CASE.displayName)) {
    throw new Error(
      `the editor does not contain ${CASE.displayName} — the resume in frame is not this fixture's`,
    );
  }
  await capture(resumeTab, 'judge-verdict', ['Quality check']);

  // 3. The observability dashboard.
  await page.goto(`${BASE_URL}/quality`);
  await page.getByRole('heading', { name: 'Quality', exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await captureUntil(
    page,
    page.locator('main'),
    'quality-dashboard',
    page.getByRole('heading', { name: 'Last 50 AI calls' }),
    ['Total AI cost', 'Served by the fallback model', 'Cost by pipeline step'],
  );

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

  /*
   * THREE ENTRY POINTS, because the two expensive halves fail independently and
   * a re-run should not buy the cheap half twice. Seeding spends an import and a
   * scan; generating spends up to four chat steps. Passing --application skips
   * the first, --shots-only skips both.
   */
  if (!applicationId && !SHOTS_ONLY) {
    await assertBaseIsEmpty(page);
    await saveProfile(page);
    await buildBase(page);
    applicationId = await runScan(page);
  }
  if (!applicationId) {
    throw new Error('--shots-only needs --application <uuid>');
  }
  if (!SHOTS_ONLY) await generate(page, applicationId);

  await captureAll(page, applicationId);
  console.log('');
  console.log(`captured ${captured.length} image(s) into ${OUT_DIR}/`);
  console.log(`application: ${applicationId}`);
  console.log('CHECK EVERY IMAGE BEFORE COMMITTING IT — no real name, address or career item.');
} finally {
  await browser.close();
}
