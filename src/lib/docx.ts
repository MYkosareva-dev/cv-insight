import 'server-only';

import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';

/**
 * Resume export — SPEC Block A (the `docx` package, server-side) and Block D #9.
 *
 * ATS-FRIENDLY MEANS PLAIN. One column, no tables, no text boxes, no headers or
 * footers, one standard font: those are the things a resume parser drops or
 * scrambles, and P2 rule 4 already asks the generator to write for them. The
 * export has to keep that promise rather than dress the text up again.
 *
 * EVERY LINE IS PLAIN TEXT AND NOTHING IS INTERPRETED (edge case S2). Resume
 * text can contain `<script>`, `&amp;` or a stray `<` — the `docx` package
 * escapes what it writes into the XML, and this module never builds markup by
 * hand. The only formatting decisions are which lines are BOLD — made from the
 * line's own shape, never from anything embedded in it — and the grey of the
 * one line the export appends.
 *
 * Server-side, and `server-only`: the document is built where the version row is
 * read, so the resume text does not make a second trip to the browser to be
 * turned into a file.
 *
 * The filename builder lives in `lib/utils.ts` — it is pure string logic and
 * needs no server guard — and is re-exported here so the export path has one
 * import.
 */

import { exportLines } from '@/lib/utils';

export { exportFilename } from '@/lib/utils';

/**
 * THE CONTACT HEADER NEEDS NO CODE HERE (SPEC v2.20), and that is the point of
 * putting it in the stored text rather than in the exporter. The block is already
 * part of `resume_versions.content` — `withContactHeader` inserted it before the
 * version was judged and saved — so the editor, the judge and this document all
 * read the same lines, and there is no second composition step that could put a
 * different header in the file from the one on screen. The user can also edit it,
 * which is right: the header is part of their resume.
 *
 * The one line the file carries that the editor does not is the AI-generated
 * statement (SPEC v3.0), appended by `exportLines` after the user's text.
 */

/** Word's default body size, in half-points: 11 pt. */
const BODY_HALF_POINTS = 22;

/** The muted style for the appended AI-generated line — `--text-muted` in globals.css. */
const MUTED_COLOR = '6B7280';

/**
 * Build the .docx from `exportLines`, which bolds headings by shape, keeps blank
 * lines as empty paragraphs so the document looks like the editor did, and
 * appends the AI-generated line. That line is a body paragraph in grey, not a
 * footer: headers and footers are what an ATS drops.
 */
export async function resumeToDocx(content: string): Promise<Uint8Array> {
  const paragraphs = exportLines(content).map(
    (line) =>
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [
          new TextRun({
            text: line.text,
            bold: line.bold,
            size: BODY_HALF_POINTS,
            ...(line.muted ? { color: MUTED_COLOR } : {}),
          }),
        ],
      }),
  );

  const doc = new Document({
    // One section, one column. Anything else is what an ATS mis-reads.
    sections: [{ properties: {}, children: paragraphs }],
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: BODY_HALF_POINTS } },
      },
    },
  });

  // `toBuffer` is the Node path; the route hands the bytes straight to the
  // Response, so nothing re-encodes the document as text on the way out.
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
