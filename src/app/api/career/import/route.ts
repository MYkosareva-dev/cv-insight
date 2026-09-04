import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { runChatJson } from '@/lib/chat';
import { CAREER, MAX_PDF_BYTES } from '@/lib/copy';
import { FileTooLargeError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { extractPdfText } from '@/lib/pdf';
import { P4_IMPORT_RESUME, fillPrompt } from '@/lib/prompts';
import {
  extractedItemsSchema,
  importTextSchema,
  importedResumeText,
  isPdfUpload,
} from '@/lib/validation';

/**
 * POST /api/career/import — SPEC Block D #1, US-1 steps 2–3.
 *
 * PDF or pasted text → typed career items for review. NOTHING IS SAVED HERE.
 * The user edits the proposals, unchecks what they do not want, and only then
 * POSTs to /api/career/items. That split is what US-1 means by "review" and it
 * is also why this handler touches no DAL at all.
 *
 * Order is load-bearing, cheapest and most protective checks first, so that
 * nothing spends money or reaches a model until it has earned the right to:
 *
 *   1. requireApiUser() — verified user or 401. Middleware excludes /api by
 *      design (a handler must answer 401 JSON, not redirect to HTML), so this
 *      line is the ONLY fence in front of this endpoint (auth rule 3, edge case
 *      S4). It comes before body parsing: reading a 4 MB upload for an
 *      anonymous caller is work done for someone with no right to ask.
 *   2. Format and size — `.pdf` only, ≤4 MB, checked off `file.size` BEFORE
 *      `arrayBuffer()`, so an oversized upload is refused without being read
 *      into memory (edge case L5).
 *   3. Extraction — a scan or a corrupt file is 422 with the exact US-1 copy,
 *      still before any spend (D1/D2).
 *   4. Length bound — edge case S7: oversized input is rejected or trimmed
 *      before the LLM, never after.
 *   5. ONE model call, through the chat gate, which owns the daily cap and the
 *      single repair retry.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const { text: resumeText, truncated } = await readResumeText(request);

    const { data } = await runChatJson({
      step: 'import_resume',
      applicationId: null,
      schema: extractedItemsSchema,
      messages: [
        // One user message carrying a server-built template. No `role` and no
        // prompt fragment is ever accepted from the client, and the resume sits
        // inside the <resume> block P4 marks as DATA (edge case S1).
        { role: 'user', content: fillPrompt(P4_IMPORT_RESUME, { resumeText }) },
      ],
    });

    // Edge case D5: valid text that is not a resume (a cover letter) parses fine
    // and yields nothing. That is a 200 with an empty list and a dialog notice,
    // not an error — the request worked, the document just was not a resume.
    // The user id is used for nothing but the gate's own auth; no row is written.
    void user;

    return NextResponse.json({
      items: data.items,
      // Two different things a user needs told, in priority order: nothing was
      // found at all, or something was found but the input was cut short.
      notice: data.items.length === 0 ? CAREER.noItemsFound : truncated ? CAREER.truncated : null,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * The two branches of the request body, reduced to one string.
 *
 * multipart → a PDF upload; JSON → pasted text. Anything else is a 400 rather
 * than a crash on a missing field.
 */
/**
 * Ceiling on a multipart import body, checked off `Content-Length` before the
 * body is buffered — the same shape and the same 64 KB of slack as
 * `MAX_SCAN_BODY_BYTES` in the scan route, for the same reason. Import carries
 * only the file and the two short metadata fields, so the slack is generous
 * here; it is kept identical rather than tuned, because two endpoints that
 * refuse uploads at subtly different sizes is a bug report waiting to happen.
 */
const MAX_IMPORT_BODY_BYTES = MAX_PDF_BYTES + 64 * 1024;

async function readResumeText(request: Request): Promise<{ text: string; truncated: boolean }> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    /**
     * THE DECLARED BODY SIZE, BEFORE THE BODY IS BUFFERED (v2.25, gate finding
     * `ns-5`, closing backlog `m-3`).
     *
     * `formData()` reads the whole upload into memory; `file.size` below then
     * refuses it. That ordering means an oversized import was fully buffered
     * before being rejected — the exact cost /api/scan added this pre-check to
     * avoid, and the two endpoints should not disagree about it.
     *
     * `Content-Length` is a claim by the client and is treated as one: it can
     * be absent or a lie, so this only turns away a request that ADMITS being
     * too large, and `file.size` remains the real check.
     */
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMPORT_BODY_BYTES) {
      throw new FileTooLargeError(CAREER.fileTooLarge);
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError(CAREER.notPdf);

    // Block F rule 1. Without it a .docx reaches unpdf, throws, and the user is
    // told their non-PDF "may be scanned" — and DOCX import is prohibited.
    if (!isPdfUpload(file)) throw new ValidationError(CAREER.notPdf);

    // `file.size` is metadata: this refuses an oversized upload without ever
    // materialising it as bytes (L5).
    if (file.size > MAX_PDF_BYTES) throw new FileTooLargeError(CAREER.fileTooLarge);

    const bytes = new Uint8Array(await file.arrayBuffer());
    return importedResumeText(await extractPdfText(bytes));  // reports truncation
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError(CAREER.importFailed);
  }

  const parsed = importTextSchema.safeParse(body);
  if (!parsed.success) {
    // The schema's own message, which is the Block F copy the field renders.
    throw new ValidationError(parsed.error.issues[0]?.message ?? CAREER.importFailed);
  }
  // A paste is bounded by the schema itself, so it is never truncated here: an
  // over-long paste is a 400 the user can act on, and only the PDF branch has an
  // input the user did not type.
  return { text: parsed.data.text, truncated: false };
}
