import { expect, test, type Page } from '@playwright/test';

/**
 * Phase-2 evidence: US-1, end to end, against a real Supabase project and real
 * OpenRouter calls. Manual verification is not accepted as evidence in this
 * repo; the spec run is.
 *
 * The two PDFs are built here rather than committed as binaries, so the
 * fixtures are readable and the "no text layer" case is provably a PDF with no
 * text operators rather than a file someone hopes is one.
 *
 * WHAT THIS SPEC CAN AND CANNOT SEE. It asserts the app's own report that N
 * items were indexed, and does NOT query `documents` directly — deliberately:
 * `.from(` outside a DAL fails check.mjs R1, `SUPABASE_SERVICE_ROLE_KEY`
 * outside `lib/supabase/admin.ts` fails R10, and `tests/` is in scope for both.
 * Bending either to make a test more convenient would break the boundary the
 * rules exist to hold. What the report proves is stated at the assertion.
 */

const password = 'phase-2-e2e-password';

/** Accounts created by the running test, removed through the app's own flow. */
let created: string[] = [];

const uniqueEmail = () => {
  const email = `phase2-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  created.push(email);
  return email;
};

/** Copy asserted verbatim, so drift from lib/copy.ts fails here. */
const COPY = {
  emptyTitle: 'Your career base is empty',
  emptyBody:
    'Your career base is empty. Import your resume — CV Insight will split it into reusable career items.',
  importResume: 'Import resume',
  tabUpload: 'Upload PDF',
  tabPaste: 'Paste text',
  unreadablePdf:
    "We couldn't read text from this PDF. It may be scanned — paste the text instead.",
  deleteAccount: 'Delete account and data',
  pastePlaceholder: 'Paste your resume text here.',
  extract: 'Extract items',
} as const;

// ---------------------------------------------------------------------------
// Minimal PDF construction
// ---------------------------------------------------------------------------

/**
 * Assemble a PDF from numbered objects, computing the real xref byte offsets.
 *
 * pdf.js can often reconstruct a broken xref table, which is exactly why the
 * offsets are computed properly: a fixture that only works because the parser
 * repaired it is not testing the parser this app actually ships.
 */
function buildPdf(objects: string[]): Buffer {
  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];

  objects.forEach((object, i) => {
    offsets.push(header.length + body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}

/** Escape the three characters that terminate or nest a PDF literal string. */
const pdfString = (text: string) => text.replace(/([\\()])/g, '\\$1');

/** A PDF whose page carries a real text layer: Tj operators in a font. */
function textLayerPdf(lines: string[]): Buffer {
  const content =
    `BT\n/F1 10 Tf\n40 750 Td\n12 TL\n` +
    lines.map((line) => `(${pdfString(line)}) Tj T*\n`).join('') +
    `ET\n`;

  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]);
}

/**
 * A PDF with NO text operators at all — the "scanned page" case (edge case D1).
 *
 * It draws a filled rectangle and declares no font, so there is nothing for a
 * text extractor to find. This is what an image-only scan looks like to
 * `unpdf`: a structurally valid PDF that yields no characters.
 */
function scannedPdf(): Buffer {
  const content = '0.6 0.6 0.6 rg\n40 40 500 700 re\nf\n';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]);
}

/**
 * The fictional persona's resume (SPEC Block B). Synthetic data only — the
 * reference deployment processes no real personal data.
 */
const RESUME_LINES = [
  'MIRA STEINBERG',
  'AI Quality Analyst — Hamburg, Germany',
  '',
  'EXPERIENCE',
  'AI Prompt Evaluator — Nordlicht Digital (01/2025 – present)',
  'Evaluated and annotated Russian and English LLM data: prompt-response pairs',
  'and multi-turn dialogues, following project guidelines and scoring rubrics.',
  'Performed side-by-side evaluation and ranking of model responses.',
  'Maintained an average QA quality score of 98 percent across all batches.',
  '',
  'IT Product Manager — BotWorks Labs (05/2024 – 08/2024)',
  'Delivered an AI chatbot prototype end to end: requirements, roadmap, testing.',
  'Coordinated two developers. Built a voice-enabled Telegram bot in Python',
  'integrating speech-to-text and text-to-speech.',
  '',
  'SKILLS',
  'BPMN process modeling, requirements elicitation and documentation,',
  'as-is/to-be analysis, stakeholder workshops, Python, SQL.',
  '',
  'EDUCATION',
  'BSc Business Informatics — Universitaet Hamburg (2016 – 2020)',
];

/**
 * A DIFFERENT resume, for the "a second import adds" case.
 *
 * It has to be genuinely different content now that the duplicate guard exists:
 * the old fixture imported the same text under a second filename, which added
 * items only because nothing compared them. Same fictional persona, a different
 * part of her history — so the items it yields share no title or body with the
 * first resume and the guard has nothing to skip.
 */
const RESUME_LINES_SECOND = [
  'MIRA STEINBERG',
  'Business Analyst — Hamburg, Germany',
  '',
  'EXPERIENCE',
  'Junior Business Analyst — Hafenlicht Consulting (03/2021 - 12/2023)',
  'Mapped as-is and to-be procurement processes in BPMN for three client',
  'programmes, and ran requirements workshops with up to twelve stakeholders.',
  'Documented forty user stories with acceptance criteria for a warehouse',
  'management rollout, cutting rework in the first sprint by a third.',
  '',
  'Working Student, Data Operations — Elbstrom Analytics (09/2019 - 02/2021)',
  'Cleaned and reconciled monthly logistics datasets in SQL and Excel.',
  'Built the weekly KPI report the operations lead presented to management.',
  '',
  'CERTIFICATIONS',
  'IREB Certified Professional for Requirements Engineering, Foundation Level (2022)',
  'Scrum Alliance Certified Scrum Product Owner (2023)',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Sign-up lands on /career, which is this phase's screen.
  await page.waitForURL(/\/career$/);
}

/** Open the import dialog. The empty state has its own trigger, so scope it. */
async function openImportDialog(page: Page) {
  await page.getByRole('button', { name: COPY.importResume }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function deleteAccountViaUi(page: Page, email: string) {
  await page.goto('/settings');
  const trigger = page.getByRole('button', { name: COPY.deleteAccount });
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/scan$/, { timeout: 15_000 }).catch(() => {});
    await page.goto('/settings');
  }
  const confirmTrigger = page.getByRole('button', { name: COPY.deleteAccount });
  if (!(await confirmTrigger.isVisible().catch(() => false))) return;
  await confirmTrigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('DELETE').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.waitForURL(/\/login/);
}

// ---------------------------------------------------------------------------

test.describe('career base', () => {
  test.beforeEach(() => {
    created = [];
  });

  // Every account this suite creates is removed again, through the app's own
  // erasure flow, so repeated runs leave nothing behind in a shared project.
  test.afterEach(async ({ page }) => {
    for (const email of created) {
      await deleteAccountViaUi(page, email).catch(() => {});
    }
  });

  test('every career endpoint refuses a signed-out caller with 401', async ({ request }) => {
    /**
     * Edge case S4 and auth rule 3. This is the assertion that matters most in
     * this file, because middleware CANNOT cover it: the matcher excludes
     * `/api` by design, since a handler must answer 401 JSON rather than
     * redirect to an HTML page. That makes `requireApiUser()` in each handler
     * the ONLY fence in front of these endpoints, and a fence that exists in
     * exactly one place should be tested rather than read.
     *
     * `request` is a fresh API context with no session cookie.
     */
    const id = '11111111-1111-1111-1111-111111111111';
    const responses = [
      await request.post('/api/career/import', { data: { text: 'x'.repeat(200) } }),
      await request.post('/api/career/items', { data: { items: [] } }),
      await request.patch(`/api/career/items/${id}`, { data: { title: 'x' } }),
      await request.delete(`/api/career/items/${id}`),
    ];

    for (const res of responses) {
      expect(res.status(), `${res.url()} must refuse an anonymous caller`).toBe(401);
      // The canonical Block D shape, not an incidental framework error page.
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  test('a new account sees the exact empty state', async ({ page }) => {
    await signUp(page, uniqueEmail());
    await expect(page.getByRole('heading', { name: COPY.emptyTitle })).toBeVisible();
    await expect(page.getByText(COPY.emptyBody)).toBeVisible();
  });

  test('a scanned PDF shows the exact 422 copy, pre-opens the paste tab, and saves nothing', async ({
    page,
  }) => {
    await signUp(page, uniqueEmail());
    const dialog = await openImportDialog(page);
    // v2.11: Paste is the default tab, so reach Upload deliberately.
    await dialog.getByRole('tab', { name: COPY.tabUpload }).click();

    const response = page.waitForResponse(
      (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    );
    await dialog.getByLabel('Choose a .pdf file').setInputFiles({
      name: 'scan.pdf',
      mimeType: 'application/pdf',
      buffer: scannedPdf(),
    });

    // Edge case D1: 422 UNREADABLE_PDF, with the code the UI branches on.
    const res = await response;
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe('UNREADABLE_PDF');

    await expect(dialog.getByRole('alert')).toHaveText(COPY.unreadablePdf);

    // US-1 step 6: the error arrives with the paste tab pre-opened, because the
    // error is only actionable through the other tab.
    await expect(dialog.getByRole('tab', { name: COPY.tabPaste })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Nothing was saved: the empty state is still the whole page.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: COPY.emptyTitle })).toBeVisible();
  });

  test('a text-layer PDF imports, reviews and saves, and a second import ADDS', async ({
    page,
  }) => {
    // Real OpenRouter calls: one import_resume per import, plus embeddings.
    test.setTimeout(180_000);
    await signUp(page, uniqueEmail());

    const firstCount = await importAndSave(page, 'mira_cv_2026.pdf', RESUME_LINES);
    expect(firstCount).toBeGreaterThan(0);

    // US-1: "Saved items appear in the career base list without page reload."
    // No reload happens between the save and this assertion.
    await expect(page.getByText(`${firstCount} item`)).toBeVisible({ timeout: 15_000 });

    // A second import ADDS, never overwrites (the last US-1 checkbox).
    const secondCount = await importAndSave(page, 'mira_ba_cv_2023.pdf', RESUME_LINES_SECOND);
    expect(secondCount).toBeGreaterThan(0);

    const total = firstCount + secondCount;
    await expect(page.getByText(`${total} items`)).toBeVisible({ timeout: 15_000 });

    // And the first import's items are still on the page.
    await expect(page.getByRole('article')).toHaveCount(total);

    /**
     * v2.11 provenance: each run got its OWN row and its items carry its chip.
     * Two distinct chips is the assertion that matters — one would mean the
     * second import had been folded into the first source.
     */
    await expect(page.getByText('from: Resume 1').first()).toBeVisible();
    await expect(page.getByText('from: Resume 2').first()).toBeVisible();
  });

  test('re-importing the SAME text saves nothing and reports every skip', async ({ page }) => {
    /**
     * The owner's defect, from first live use: importing the same text twice
     * produced an exact second copy of every item. Pasted rather than uploaded,
     * so the input is byte-identical by construction and the assertion is about
     * the guard rather than about PDF extraction being deterministic.
     */
    test.setTimeout(180_000);
    await signUp(page, uniqueEmail());

    const first = await pasteAndSave(page, RESUME_LINES.join('\n'));
    expect(first.saved).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);

    // Same text, second run.
    const second = await pasteAndSave(page, RESUME_LINES.join('\n'));
    expect(second.saved).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    // No run row for an import that contributed nothing.
    expect(second.import).toBeNull();

    // The base did not grow, and the dialog says why rather than looking broken.
    await expect(page.getByRole('article')).toHaveCount(first.saved);
  });

  test('a metered Save spends once even when double-clicked', async ({ page }) => {
    /**
     * M-2 from the phase-2 review. Two clicks can fire before React re-renders,
     * so `disabled` alone cannot be the guard — a ref is.
     *
     * The assertion counts REQUESTS and nothing else. That is the only thing
     * that means anything here: a second POST would be a second embedding spend
     * and a second `imports` row, whatever the UI happened to show. Asserting on
     * the saved step instead made this test depend on a locator whose accessible
     * name changes to "Saving…" mid-flight.
     */
    test.setTimeout(180_000);
    await signUp(page, uniqueEmail());

    const dialog = await openImportDialog(page);
    const importResponse = page.waitForResponse(
      (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
      { timeout: 90_000 },
    );
    await dialog.getByPlaceholder(COPY.pastePlaceholder).fill(RESUME_LINES.join('\n'));
    await dialog.getByRole('button', { name: COPY.extract }).click();
    await importResponse;

    let saveRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/career/items') && req.method() === 'POST') saveRequests += 1;
    });
    const saveResponse = page.waitForResponse(
      (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
      { timeout: 90_000 },
    );

    const save = dialog.getByRole('button', { name: /^Save \d+ items? to base$/ });
    // Two clicks as fast as Playwright can deliver them, with no wait between.
    // The second is given a short timeout on purpose: once the first click lands
    // the button relabels to "Saving…", so this locator stops matching — which is
    // itself part of the guard, and should fail fast rather than stall the test.
    await save.click({ noWaitAfter: true });
    await save.click({ noWaitAfter: true, force: true, timeout: 2_000 }).catch(() => {
      // Already disabled or relabelled — exactly the intended outcome.
    });

    await saveResponse;
    // Settle, so a late second request would still be counted before asserting.
    await page.waitForTimeout(2_000);
    expect(saveRequests, 'one click, one spend').toBe(1);
  });
});

/**
 * Paste a resume, review, save — the paste branch of the same flow.
 * Returns what the save reported.
 */
async function pasteAndSave(
  page: Page,
  text: string,
): Promise<{ saved: number; skipped: number; import: unknown }> {
  const dialog = await openImportDialog(page);

  const importResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByPlaceholder(COPY.pastePlaceholder).fill(text);
  await dialog.getByRole('button', { name: COPY.extract }).click();
  const imported = await (await importResponse).json();
  expect(imported.items.length).toBeGreaterThan(0);

  const saveResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();
  const saved = await (await saveResponse).json();

  // The saved step reports both halves of the outcome.
  if (saved.items.length === 0) {
    await expect(dialog.getByText(/^Nothing new to save/)).toBeVisible();
  } else {
    await expect(dialog.getByText(/^Saved \d+ items?/)).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Done' }).click();

  return { saved: saved.items.length, skipped: saved.skipped, import: saved.import };
}

/**
 * Import a resume PDF, review, save — and assert what the save reports.
 * Returns how many items were saved.
 */
async function importAndSave(page: Page, filename: string, lines: string[]): Promise<number> {
  const dialog = await openImportDialog(page);
  await dialog.getByRole('tab', { name: COPY.tabUpload }).click();

  const importResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/import') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByLabel('Choose a .pdf file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: textLayerPdf(lines),
  });

  const imported = await (await importResponse).json();
  expect(Array.isArray(imported.items)).toBe(true);
  expect(imported.items.length).toBeGreaterThan(0);

  // The review list is shown and NOTHING is saved yet — the import endpoint
  // writes no rows at all.
  const heading = dialog.getByRole('heading', {
    name: new RegExp(`Review ${imported.items.length} extracted item`),
  });
  await expect(heading).toBeVisible();

  const saveResponse = page.waitForResponse(
    (res) => res.url().includes('/api/career/items') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await dialog.getByRole('button', { name: /^Save \d+ items? to base$/ }).click();

  const saved = await (await saveResponse).json();
  expect(saved.items.length).toBe(imported.items.length);

  /**
   * The indexing evidence.
   *
   * `indexed === N` with a null warning is the app reporting that every saved
   * item's chunks reached `documents`. That is a stronger claim than it looks,
   * because of what had to be true for the count to reach N:
   *   - the embeddings call returned a vector per chunk, and the connection
   *     asserts every one is exactly 1536 long before any insert;
   *   - `documents.embedding` is `vector(1536) not null`, so Postgres itself
   *     rejects any other width — an accepted row IS a 1536-dim row;
   *   - `insertDocuments` throws on error and `indexCareerItems` counts a throw
   *     as a FAILED item, so a count of N cannot include a failed write.
   * The title prefix on each chunk is covered by tests/unit/chunking.test.mjs,
   * which asserts it on the exact function that produces `documents.content`.
   */
  expect(saved.indexed).toBe(saved.items.length);
  expect(saved.indexWarning).toBeNull();

  // v2.11: provenance. The run row exists and carries the name the dialog
  // defaulted, and every saved item points at it.
  expect(saved.import).not.toBeNull();
  expect(saved.import.name).toMatch(/^Resume \d+$/);
  for (const item of saved.items) expect(item.import_id).toBe(saved.import.id);

  // Step 3 of the indicator, with the summary copy.
  await expect(dialog.getByText(/^Saved \d+ items?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  return saved.items.length;
}
