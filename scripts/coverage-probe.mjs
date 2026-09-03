#!/usr/bin/env node
/**
 * Coverage-threshold probe — DEVELOPMENT ONLY. The instrument behind
 * `docs/eval/coverage-thresholds.md`.
 *
 * Prints, for one analysed application, every parsed requirement with its
 * best-matching career item and the RAW similarity the embedding model
 * returned, so rule B1's thresholds can be derived from a measured distribution
 * instead of adjusted until a screen looks better.
 *
 * WHY IT DRIVES A BROWSER. The numbers live behind `GET /api/dev/coverage-probe`,
 * which calls `getUser()` and reads through the DALs — so the probe needs a real
 * session, and this repo has exactly one way to get one: sign in through the
 * app. The alternatives are all rules this project does not bend. A script
 * cannot read the tables itself (`.from(` outside `lib/db` fails check.mjs R1),
 * it cannot use the service-role key (R10 pins it to `lib/supabase/admin.ts`),
 * and it cannot embed anything on its own (R5/R6 keep OpenRouter behind the two
 * gates). Playwright is already a devDependency and already signs in this way in
 * `tests/e2e`, so a browser is the cheap option rather than the elaborate one.
 *
 * TWO MODES.
 *
 *   Probe an application you already have, as yourself:
 *     node scripts/coverage-probe.mjs --application <uuid> \
 *       --email you@example.com --password '…'
 *
 *   Build a throwaway case end to end, probe it, then delete the account:
 *     node scripts/coverage-probe.mjs --seed docs/eval/calibration-case.json
 *
 *   Re-index your own base against the current chunker, then probe:
 *     node scripts/coverage-probe.mjs --application <uuid> --reindex
 *       --email you@example.com --password '…'
 *
 * `--reindex` POSTs to /api/dev/reindex before probing. It is what a base
 * written by an earlier chunker needs after SPEC v2.14: rows chunked as one blob
 * per item keep winning comparisons they should lose until they are re-embedded.
 * It spends one embedding request per EMBEDDING_BATCH_SIZE chunks and prints the
 * per-item before/after row counts and each item's write state.
 *
 * `--seed` is what makes a calibration reproducible by someone who does not have
 * the owner's account: one account, one import, one scan, one probe, then the
 * account is removed through the app's own deletion flow (US-6), so the run
 * leaves nothing behind. It SPENDS REAL MONEY — one import_resume call, one
 * parse_vacancy call and the embedding requests for the base and the
 * requirements — which is the point: a threshold calibrated against a mocked
 * embedding would be a threshold for a model this app does not use.
 *
 * WHAT IT PRINTS. Requirement text, career-item TITLE and similarity. Never
 * chunk text: the endpoint does not return it, and printing the user's own
 * resume content to a terminal is the thing CLAUDE.md's retrieval and privacy
 * rules both forbid. Requirement text comes from the posting the caller supplied.
 */
import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? null);
};
const has = (name) => args.includes(`--${name}`);

const BASE_URL = flag('base-url', process.env.E2E_BASE_URL ?? 'http://localhost:3000');
const SEED_FILE = flag('seed');
const APPLICATION = flag('application');
const KEEP = has('keep');
const REINDEX = has('reindex');

if (!SEED_FILE && !APPLICATION) {
  console.error(
    'usage: coverage-probe.mjs --application <uuid> --email <e> --password <p>\n' +
      '       coverage-probe.mjs --seed <case.json> [--keep]',
  );
  process.exit(2);
}

const THROWAWAY_PASSWORD = 'coverage-probe-throwaway';

async function signIn(page, email, password) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(scan|career)$/, { timeout: 30_000 });
}

async function signUp(page, email) {
  await page.goto(`${BASE_URL}/signup`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(THROWAWAY_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/career$/, { timeout: 30_000 });
}

/** Import a resume through the dialog and wait for the save to report indexing. */
async function buildBase(page, resumeText) {
  await page.goto(`${BASE_URL}/career`);
  await page.getByRole('button', { name: 'Import resume' }).first().click();
  const dialog = page.getByRole('dialog');

  const extracted = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await dialog.getByPlaceholder('Paste your resume text here.').fill(resumeText);
  await dialog.getByRole('button', { name: 'Extract items' }).click();
  const proposed = await (await extracted).json();

  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();
  const committed = await (await saved).json();
  console.log(
    `seed: imported ${proposed.items?.length ?? 0} items, saved ${committed.items?.length ?? 0}, indexed ${committed.indexed ?? 0}`,
  );
  if (!committed.indexed) throw new Error('the base is not indexed — matching would find nothing');
}

/** One career-base scan against the supplied posting. */
async function runScan(page, vacancyText) {
  await page.goto(`${BASE_URL}/scan`);
  await page.getByLabel('Job posting').fill(vacancyText);
  const scanned = page.waitForResponse(
    (res) => res.url().includes('/api/scan') && res.request().method() === 'POST',
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: 'Analyze' }).click();
  const response = await scanned;
  const body = await response.json();
  if (response.status() !== 200) {
    throw new Error(`scan failed: ${response.status()} ${JSON.stringify(body)}`);
  }
  console.log(`seed: scan scored ${body.matchScore} for application ${body.applicationId}`);
  return body.applicationId;
}

async function deleteAccount(page) {
  await page.goto(`${BASE_URL}/settings`);
  const trigger = page.getByRole('button', { name: 'Delete account and data' });
  if (!(await trigger.isVisible().catch(() => false))) return;
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('DELETE').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  console.log('seed: throwaway account deleted through the app (US-6)');
}

/** POST /api/dev/reindex and print what it changed, per item. */
async function reindex(page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/reindex`);
  const body = await res.json();
  if (res.status() !== 200) {
    throw new Error(`reindex failed: ${res.status()} ${JSON.stringify(body)}`);
  }
  console.log('');
  console.log(
    `reindex: chunker floor ${body.chunker.floor} / target ${body.chunker.target} / ` +
      `hard max ${body.chunker.hardMax} / cap ${body.chunker.maxChunksPerItem}`,
  );
  console.log(
    `reindex: ${body.careerItems} items, documents ${body.documentsBefore} -> ${body.documentsAfter}, ` +
      `${body.chunksEmbedded} chunks in ${body.embeddingRequests} embedding request(s)`,
  );
  console.log(
    `reindex: ${body.unindexed} item(s) left with NO rows, ` +
      `${body.oldRowsIntact} still searchable on their old chunks`,
  );
  for (const item of body.items) {
    // The state, not a pass/fail mark: "old rows intact" is a working index.
    const mark = { reindexed: ' ', old_rows_intact: '~', unindexed: '!' }[item.state] ?? '?';
    console.log(
      `  ${String(item.before ?? '?').padStart(3)} -> ${String(item.after ?? '?').padStart(3)} rows  ` +
        `${mark} ${item.state.padEnd(15)} ${item.title}`,
    );
  }
  return body;
}

const pad = (value, width) => String(value).padEnd(width).slice(0, width);
const num = (value) => (value === null || value === undefined ? '   —  ' : value.toFixed(4));

function report(probe) {
  console.log('');
  console.log(`application  ${probe.applicationId}  (source: ${probe.resumeSource})`);
  console.log(
    `match score  ${probe.matchScore}   thresholds: floor ${probe.thresholds.floor}, span ${probe.thresholds.span}, covered ${probe.thresholds.covered}`,
  );
  console.log(
    `keywords     ${probe.keywords.length} stored, ${probe.keywordsDropped ?? 'not recorded'} dropped as non-literal (B1a)`,
  );
  console.log('');
  console.log(
    `${pad('kind', 5)} ${pad('stored', 26)} ${pad('best', 7)} ${pad('norm', 7)} ${pad('best-matching career item', 44)} requirement`,
  );
  console.log('-'.repeat(150));

  const rows = [];
  for (const requirement of probe.requirements) {
    const best = requirement.matches[0] ?? null;
    rows.push({ requirement: requirement.requirement, kind: requirement.kind, best });
    console.log(
      `${pad(requirement.kind, 5)} ` +
        `${pad(`${requirement.stored?.status ?? '—'} ${num(requirement.stored?.similarity)}`, 26)} ` +
        `${pad(num(best?.similarity), 7)} ${pad(num(best?.normalized), 7)} ` +
        `${pad(best?.careerItemTitle ?? '(nothing matched)', 44)} ${requirement.requirement}`,
    );
    // The runners-up, indented: a threshold has to separate the best match from
    // the next one, and that spread is invisible in a single column.
    for (const match of requirement.matches.slice(1, 3)) {
      console.log(
        `${pad('', 5)} ${pad('', 26)} ${pad(num(match.similarity), 7)} ${pad('', 7)} ${pad(match.careerItemTitle, 44)}`,
      );
    }
  }

  /**
   * How often ONE chunk is the best match. A blob chunk resembles everything a
   * little and wins comparison after comparison, which is invisible in a column
   * of item titles and obvious in a count of row ids.
   */
  const byChunk = new Map();
  for (const row of rows) {
    if (!row.best) continue;
    const seen = byChunk.get(row.best.chunkId) ?? { n: 0, title: row.best.careerItemTitle };
    seen.n += 1;
    byChunk.set(row.best.chunkId, seen);
  }
  const concentration = [...byChunk.values()].sort((a, b) => b.n - a.n);
  console.log('');
  console.log('best-match concentration (one line per winning chunk):');
  for (const entry of concentration) {
    console.log(`  ${String(entry.n).padStart(2)} x  ${entry.title}`);
  }
  console.log(`  worst case: one chunk won ${concentration[0]?.n ?? 0} of ${rows.length} requirements`);

  const bests = rows.map((row) => row.best?.similarity ?? 0).sort((a, b) => a - b);
  const mean = bests.reduce((sum, value) => sum + value, 0) / (bests.length || 1);
  console.log('');
  console.log(
    `distribution of best similarities: n=${bests.length} min=${num(bests[0])} ` +
      `median=${num(bests[Math.floor(bests.length / 2)])} mean=${num(mean)} max=${num(bests[bests.length - 1])}`,
  );

  const byStep = new Map();
  for (const call of probe.calls) {
    const seen = byStep.get(call.step) ?? { rows: 0, linked: 0, micro: 0 };
    seen.rows += 1;
    seen.linked += call.application_id ? 1 : 0;
    seen.micro += call.cost_usd_micro;
    byStep.set(call.step, seen);
  }
  console.log('');
  console.log('llm_calls rows for this account (rule B8):');
  if (byStep.size === 0) console.log('  (none — nothing was logged)');
  for (const [step, seen] of byStep) {
    console.log(
      `  ${pad(step, 16)} rows=${seen.rows} with_application_id=${seen.linked} cost_usd_micro=${seen.micro}`,
    );
  }
  console.log('');
  console.log(JSON.stringify(probe, null, 2));
}

const browser = await chromium.launch();
const page = await browser.newPage();
let email = null;
try {
  let applicationId = APPLICATION;

  if (SEED_FILE) {
    const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
    if (!seed.resumeText || !seed.vacancyText) {
      throw new Error(`${SEED_FILE} needs { resumeText, vacancyText }`);
    }
    email = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    console.log(`seed: creating throwaway account ${email}`);
    await signUp(page, email);
    await buildBase(page, seed.resumeText);
    applicationId = await runScan(page, seed.vacancyText);
  } else {
    const user = flag('email');
    const secret = flag('password');
    if (!user || !secret) throw new Error('--application needs --email and --password');
    await signIn(page, user, secret);
  }

  if (REINDEX) await reindex(page);

  const res = await page.request.get(
    `${BASE_URL}/api/dev/coverage-probe?applicationId=${applicationId}`,
  );
  const probe = await res.json();
  if (res.status() !== 200) {
    throw new Error(`probe failed: ${res.status()} ${JSON.stringify(probe)}`);
  }
  report(probe);
} finally {
  if (email && !KEEP) await deleteAccount(page).catch((err) => console.error('teardown', err));
  await browser.close();
}
