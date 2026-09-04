import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { runChatJson } from '@/lib/chat';
import { ERROR_MESSAGES, FILE_TOO_LARGE, MAX_PDF_BYTES, NOT_PDF, SCAN } from '@/lib/copy';
import { careerBaseCorpus, scoreAgainstCorpus } from '@/lib/coverage';
import { listCareerItems } from '@/lib/db/careerItems';
import {
  getApplication,
  insertApplication,
  updateApplication,
} from '@/lib/db/applications';
import { getVacancy, insertVacancy, setVacancyParsed } from '@/lib/db/vacancies';
import type { Application, ParsedVacancy } from '@/lib/db/types';
import {
  AiUnavailableError,
  FileTooLargeError,
  NotFoundError,
  ServerError,
  ValidationError,
  apiErrorResponse,
} from '@/lib/errors';
import { extractPdfText } from '@/lib/pdf';
import { P1_PARSE_VACANCY, fillPrompt } from '@/lib/prompts';
import {
  isPdfUpload,
  isRescanBody,
  parsedVacancySchema,
  rescanSchema,
  scanResumeText,
  scanSchema,
} from '@/lib/validation';

/**
 * POST /api/scan — SPEC Block D #4, US-2/US-3.
 *
 * Vacancy text + a resume source → one P1 parse, one batched embedding run, one
 * `match_documents` per requirement, a rule-B1 score, and an `applications` row
 * the result screen renders.
 *
 * EXACTLY ONE CHAT CALL per scan. Everything else on this path is embeddings
 * (excluded from rule B7 by its own definition) or SQL. No ledger is passed:
 * `lib/chat.ts` documents the ledger as the mechanism for a request making
 * SEVERAL chat calls, and passing one here would tell the next reader this route
 * is multi-call while changing nothing — a mechanism that looks configured and
 * does nothing. Phase 4's /generate is the first legitimate holder.
 *
 * Order, and why each step is where it is:
 *
 *   1. requireApiUser() — 401 or a verified user, before the body is read.
 *      Middleware excludes /api by design (a handler must answer 401 JSON, not
 *      redirect to HTML), so this line is the only fence (auth rule 3, S4).
 *   2. Zod, and for an upload the .pdf / size / text-layer checks — every
 *      refusal lands before any spend (S7, L5, D1/D2).
 *   3. The vacancy row, then the DRAFT application row, BOTH before the parse
 *      (SPEC v2.12). US-2 step 5 promises "your vacancy was saved" on failure,
 *      and rule B7's cap is checked inside the chat gate — i.e. after this
 *      point — so a 429 would otherwise leave an orphan `vacancies` row that no
 *      screen can reach and no policy can delete. It also lets the
 *      `parse_vacancy` log row carry `application_id`, which `llm_calls` could
 *      never be given afterwards (append-only).
 *   4. ONE model call through the chat gate, which owns the daily cap and the
 *      single repair retry.
 *   5. Matching through the retrieval gate, batched.
 *   6. Score and coverage, committed onto the draft with an UPDATE.
 *
 * THREE RETRIEVAL OUTCOMES. A run that could not search fails the scan with
 * AI_UNAVAILABLE and leaves `coverage` null. It never renders as gaps: telling
 * someone a requirement is missing because an embeddings call died is the app
 * lying about data it never checked (CLAUDE.md, Retrieval).
 */

/**
 * Worst case on this route: one 60 s chat attempt, the 2 s network-retry wait, a
 * second 60 s attempt, then the embedding requests and one RPC per requirement.
 * A platform timeout below that budget kills the request before `after()` runs,
 * which drops the `llm_calls` row for a call that WAS billed — rule B8 would
 * stop holding with /quality as the only witness. Stated here so the deployment
 * cap is checked against a number rather than guessed at.
 */
export const maxDuration = 120;

/**
 * Ceiling on a multipart scan body, checked off `Content-Length` before the body
 * is buffered. The 64 KB of slack above the PDF ceiling covers the vacancy field
 * and multipart framing; the file's own 4 MB limit is still checked separately
 * off `file.size`, so this is the outer bound, not a replacement for it.
 */
const MAX_SCAN_BODY_BYTES = MAX_PDF_BYTES + 64 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const plan = await readScanRequest(request, user.id);
    return NextResponse.json(await runScan(plan));
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * Everything the AI steps need, with the rows they will write into already
 * created. Built by `readScanRequest` from either a fresh request body or an
 * existing draft.
 */
type ScanPlan = {
  vacancyId: string;
  applicationId: string;
  vacancyText: string;
  resumeSource: Application['resume_source'];
  /**
   * The text rule B1's K is counted over: the pasted or uploaded resume, or the
   * whole career base when the base is the source.
   */
  sourceText: string;
  sourceIsBase: boolean;
  /**
   * The CAREER BASE as one body of text — the corpus rule B1's coverage decision
   * is made against, and therefore the corpus its lexical gate searches
   * (SPEC v2.15).
   *
   * Separate from `sourceText` on purpose. For a career-base scan they are the
   * same string and no second query is made; for a pasted or uploaded resume
   * they are DIFFERENT bodies of text, and this is the one the retrieval ran
   * over. Searching the paste instead would refuse a tool the base really holds
   * because the one page the user pasted did not mention it — the gate lying in
   * the other direction.
   */
  baseText: string;
  /** A non-blocking notice for the client (a truncated PDF extraction). */
  notice: string | null;
};

/** The AI half, shared by a first scan and a re-run of a draft. */
async function runScan(plan: ScanPlan) {
  const parsed = await parseAndScore(plan);
  return {
    applicationId: plan.applicationId,
    vacancy: { title: parsed.vacancy.title, company: parsed.vacancy.company },
    matchScore: parsed.matchScore,
    coverage: parsed.coverage.entries,
    keywords: parsed.coverage.keywords,
    notice: plan.notice,
  };
}

async function parseAndScore(plan: ScanPlan) {
  try {
    // ONE chat call. `applicationId` links the log row to the run (rule B8).
    const { data } = await runChatJson({
      step: 'parse_vacancy',
      applicationId: plan.applicationId,
      schema: parsedVacancySchema,
      messages: [
        // A server-built template with the posting inside the <vacancy> block P1
        // marks as DATA. No `role` and no prompt fragment is ever accepted from
        // the client (edge case S1).
        { role: 'user', content: fillPrompt(P1_PARSE_VACANCY, { vacancyText: plan.vacancyText }) },
      ],
    });

    const vacancy: ParsedVacancy = data;
    await setVacancyParsed(plan.vacancyId, vacancy);

    /**
     * RULE B1, THROUGH THE SHARED MODULE. The keyword guard, the lexical gate,
     * the three statuses and the 60/40 weighting all live in `lib/coverage.ts`
     * from v2.16, because `/api/applications/[id]/rescore` computes the same map
     * against a different corpus. Two copies of a CALIBRATED rule would be two
     * things free to drift a hundredth apart while
     * `docs/eval/coverage-thresholds.md` described only one of them.
     *
     * The corpus here is the CAREER BASE — the body of text the retrieval
     * searched, and therefore the one rule B1's lexical gate reads (SPEC v2.15).
     * `sourceIsBase` decides whether US-3's hidden-match status can exist at all.
     */
    const { matchScore, coverage } = await scoreAgainstCorpus({
      vacancy,
      vacancyText: plan.vacancyText,
      sourceText: plan.sourceText,
      corpus: careerBaseCorpus({
        baseText: plan.baseText,
        corpusIsSource: plan.sourceIsBase,
        applicationId: plan.applicationId,
      }),
      // This endpoint's own message: the draft row already exists, which is what
      // makes "Your vacancy was saved — retry from Applications." a true
      // sentence here and a lie on an endpoint that saves nothing.
      aiUnavailableMessage: SCAN.aiUnavailable,
    });

    const committed = await updateApplication(plan.applicationId, { matchScore, coverage });
    if (!committed) {
      // The row was inserted moments ago under this same session, so a miss here
      // is not a 404 to report — it is the server failing to write its own row.
      throw new ServerError();
    }

    return { vacancy, matchScore, coverage };
  } catch (err) {
    /**
     * The parse's own AI failures still get the endpoint's message. The coverage
     * module already raises with it, so this covers the chat half.
     */
    if (err instanceof AiUnavailableError) throw new AiUnavailableError(SCAN.aiUnavailable);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Request → plan
// ---------------------------------------------------------------------------

/**
 * Read the request, resolve the resume source, and create (or find) the rows the
 * AI steps commit into.
 *
 * Two shapes: a fresh scan (JSON, or multipart for the Upload PDF tab), and a
 * re-run of an existing draft, whose body is the application id and nothing
 * else — every other input comes from the stored row, so a "retry" cannot
 * quietly analyse something different from what it claims to be retrying.
 */
async function readScanRequest(request: Request, userId: string): Promise<ScanPlan> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    return freshPlan(userId, await readUpload(request));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError(SCAN.vacancyRequired);
  }

  /**
   * The two shapes are told apart BEFORE either schema runs, rather than by a
   * Zod union: a union reports its failure as one "Invalid input" issue and
   * would replace every Block F message on this endpoint, which edge case S7
   * requires to be exact.
   */
  if (isRescanBody(body)) {
    const retry = rescanSchema.safeParse(body);
    if (!retry.success) throw new NotFoundError();
    return rerunPlan(retry.data.applicationId);
  }

  const parsed = scanSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? SCAN.vacancyRequired);
  }
  return freshPlan(userId, parsed.data);
}

/** The multipart branch: a PDF plus the vacancy field, in one body. */
async function readUpload(request: Request) {
  /**
   * Checked off the header BEFORE the body is buffered, because `formData()`
   * reads the whole request into memory — a size check after it has already
   * paid the cost it was meant to avoid.
   *
   * It is a SHORTCUT, not the fence: an absent or unparseable `Content-Length`
   * falls through to the buffered read, and the actual limits are `file.size`
   * below (4 MB, L5) plus whatever the platform enforces on a request body.
   * Refusing a body that declares no length is recorded as p3-9 rather than
   * done here, since it would also refuse a legitimate chunked upload.
   */
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SCAN_BODY_BYTES) {
    throw new FileTooLargeError(ERROR_MESSAGES.REQUEST_TOO_LARGE);
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ValidationError(NOT_PDF);
  // Block F upload rule 1. Without it a .docx reaches unpdf, throws, and the
  // user is told their non-PDF "may be scanned".
  if (!isPdfUpload(file)) throw new ValidationError(NOT_PDF);
  // `file.size` is metadata: this refuses an oversized upload without
  // materialising it as bytes (L5).
  if (file.size > MAX_PDF_BYTES) throw new FileTooLargeError(FILE_TOO_LARGE);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Throws 422 UNREADABLE_PDF for a scan or a corrupt file (D1/D2), before any
  // spend. The extracted text is truncated at the scan's own 15,000-character
  // bound and the cut is REPORTED, never silent.
  const extracted = await extractPdfText(bytes);
  const { text, truncated } = scanResumeText(extracted);

  const vacancyText = form.get('vacancyText');
  const parsed = scanSchema.safeParse({
    vacancyText: typeof vacancyText === 'string' ? vacancyText : '',
    resumeSource: 'file',
    sourceResumeText: text,
    resumeVersionId: null,
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? SCAN.vacancyRequired);
  }

  return { ...parsed.data, notice: truncated ? SCAN.resumeTruncated : null };
}

type FreshScan = {
  vacancyText: string;
  resumeSource: Application['resume_source'];
  sourceResumeText: string | null;
  notice?: string | null;
};

/** A first scan: resolve the source text, then write the vacancy and the draft. */
async function freshPlan(userId: string, input: FreshScan): Promise<ScanPlan> {
  const source = await resolveSource(input.resumeSource, input.sourceResumeText);

  const vacancy = await insertVacancy(userId, input.vacancyText);
  const application = await insertApplication({
    userId,
    vacancyId: vacancy.id,
    resumeSource: input.resumeSource,
    // Null for a career-base scan, by design (Block C): the base is not a
    // resume text, and copying it onto the row would store a second copy of
    // data the user already owns in `career_items`.
    sourceResumeText: source.isBase ? null : source.text,
  });

  return {
    vacancyId: vacancy.id,
    applicationId: application.id,
    vacancyText: input.vacancyText,
    resumeSource: input.resumeSource,
    sourceText: source.text,
    sourceIsBase: source.isBase,
    baseText: source.baseText,
    notice: input.notice ?? null,
  };
}

/**
 * A re-run of an existing draft — what US-2's "retry from Applications" means.
 *
 * Reads under the user's own session, so another user's id simply yields no row
 * and the answer is 404, never 403 (S3). It re-uses the vacancy and the
 * application rather than creating new ones, so retrying a scan leaves one row
 * per job rather than a trail of abandoned drafts.
 */
async function rerunPlan(applicationId: string): Promise<ScanPlan> {
  const application = await getApplication(applicationId);
  if (!application) throw new NotFoundError();

  /**
   * An UNANALYSED draft only.
   *
   * Without this the endpoint would silently re-analyse a finished scan and
   * overwrite `match_score` and `coverage` — including the stored keyword
   * counts, whose whole purpose is to stay the numbers this run measured, while
   * `created_at` went on reporting the original date. Re-scoring an edited
   * resume is a different feature with its own endpoint (Block D #6, Phase 5).
   */
  if (application.coverage !== null) throw new ValidationError(SCAN.alreadyAnalysed);

  const vacancy = await getVacancy(application.vacancy_id);
  if (!vacancy) throw new NotFoundError();

  const source = await resolveSource(application.resume_source, application.source_resume_text);

  return {
    vacancyId: vacancy.id,
    applicationId: application.id,
    vacancyText: vacancy.raw_text,
    resumeSource: application.resume_source,
    sourceText: source.text,
    sourceIsBase: source.isBase,
    baseText: source.baseText,
    notice: null,
  };
}

/**
 * The text rule B1's K is counted over.
 *
 * For the career base it is every item's title and content — the same text that
 * was chunked into the search index, so the keyword count and the similarity
 * search are looking at one body of text rather than two.
 */
async function resolveSource(
  resumeSource: Application['resume_source'],
  sourceResumeText: string | null,
): Promise<{ text: string; isBase: boolean; baseText: string }> {
  if (resumeSource === 'resume_version') {
    // A valid value of the column's CHECK constraint whose rows do not exist
    // yet: `resume_versions` and the tailored-resume editor land in Phase 4.
    throw new ValidationError(SCAN.savedVersionUnavailable);
  }

  if (resumeSource === 'career_base') {
    const items = await listCareerItems();
    if (items.length === 0) throw new ValidationError(SCAN.emptyBase);
    const base = careerBaseText(items);
    // One query: for this source the scored text IS the base corpus.
    return { text: base, isBase: true, baseText: base };
  }

  if (!sourceResumeText) {
    // Unreachable through the schema for a paste, and through the insert for an
    // upload. If a stored row ever lacks its own source text, that is the server
    // having written something it cannot score — not a request to blame.
    throw new ServerError();
  }
  /**
   * The base is loaded even though it is not what gets scored: rule B1's lexical
   * gate asks whether the BASE names a tool, because the base is what the
   * retrieval searched. An empty base yields an empty corpus, which is honest —
   * nothing was found because there is nothing there, and the similarity half of
   * the decision already says so.
   */
  return {
    text: sourceResumeText,
    isBase: false,
    baseText: careerBaseText(await listCareerItems()),
  };
}

/**
 * The career base as one body of text: every item's title and content, in the
 * order the DAL returns them.
 *
 * One definition, used for both jobs it has — the text a career-base scan is
 * scored against, and the corpus rule B1's lexical gate searches. Two spellings
 * of "the base as text" would be two things to keep in step.
 */
function careerBaseText(items: { title: string; content: string }[]): string {
  return items.map((item) => `${item.title}\n${item.content}`).join('\n\n');
}
