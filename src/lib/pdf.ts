import 'server-only';

import { extractText, getDocumentProxy } from 'unpdf';

import { CAREER } from '@/lib/copy';
import { UnreadablePdfError } from '@/lib/errors';

/**
 * PDF text extraction (SPEC v2.10; Block A names `unpdf` as the extractor).
 *
 * The counterpart to `lib/docx.ts` on the export side: one module owns one file
 * format, and route handlers stay free of format handling. Server-only — PDF
 * parsing never happens in the browser.
 *
 * PDF is the ONLY import format in the MVP. DOCX and Markdown import are on the
 * Prohibited list, which is why the caller checks the extension and type before
 * anything reaches this module.
 */

/**
 * Below this many characters, the "PDF" is treated as having no text layer.
 *
 * A scanned page is not always zero characters: a PDF of images routinely yields
 * a handful of stray glyphs from a header, a page number or an embedded logo's
 * metadata. Zero is therefore the wrong threshold — it would send a scan down the
 * happy path, spend a metered call on approximately nothing, and return "No
 * career items found — is this a resume?", which blames the user's document for
 * the app's misdetection. A real one-page resume is thousands of characters, so
 * this bound sits far below any true positive and well above the scan noise.
 */
export const MIN_PDF_TEXT_CHARS = 200;

/**
 * Bytes → the resume's text.
 *
 * Throws `UnreadablePdfError` (422, exact US-1 copy) for BOTH failure shapes,
 * because the user's situation is identical in each and so is the fix:
 *  - D1: parsed fine, but there is no text layer (a scan);
 *  - D2: corrupt or password-protected, so `unpdf` throws.
 * Letting D2 escape would surface a library stack trace as a 500 — telling the
 * user the app broke, when what happened is that their file cannot be read.
 *
 * Nothing is saved and no model call has happened yet on either path: extraction
 * runs before any spend, so an unreadable upload costs nothing.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: true });
    text = Array.isArray(extracted.text) ? extracted.text.join('\n\n') : extracted.text;
  } catch (err) {
    // Metadata only. A pdf.js error message can quote document content, and a
    // resume's content is personal data (CLAUDE.md, Privacy).
    console.error('[pdf] extraction threw — treating as unreadable', {
      name: err instanceof Error ? err.name : typeof err,
    });
    throw new UnreadablePdfError(CAREER.unreadablePdf);
  }

  const normalized = normalizeExtractedText(text);
  if (normalized.length < MIN_PDF_TEXT_CHARS) {
    throw new UnreadablePdfError(CAREER.unreadablePdf);
  }
  return normalized;
}

/**
 * Tidy the extractor's output before it becomes a prompt.
 *
 * pdf.js emits text per positioned run, so a two-column or table-ish resume
 * arrives with ragged spacing and stray blank lines. Collapsing those is not
 * cosmetic: whitespace is billed as tokens, and the paragraph structure that
 * survives here is the same structure `lib/chunking.ts` later splits on.
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Non-breaking and other exotic spaces come out of PDFs constantly.
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    // Three or more newlines carry no more meaning than a paragraph break.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
