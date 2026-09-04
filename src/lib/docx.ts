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
 * hand. The only formatting decision made here is which lines are BOLD, and it
 * is made from the line's own shape, never from anything embedded in it.
 *
 * Server-side, and `server-only`: the document is built where the version row is
 * read, so the resume text does not make a second trip to the browser to be
 * turned into a file.
 *
 * The filename builder lives in `lib/utils.ts` — it is pure string logic and
 * needs no server guard — and is re-exported here so the export path has one
 * import.
 */

import { FIELD_SEPARATOR } from '@/lib/resumeHeader';

export { exportFilename } from '@/lib/utils';

/**
 * THE CONTACT HEADER NEEDS NO CODE HERE (SPEC v2.20), and that is the point of
 * putting it in the stored text rather than in the exporter. The block is already
 * part of `resume_versions.content` — `withContactHeader` inserted it before the
 * version was judged and saved — so the editor, the judge and this document all
 * read the same lines, and there is no second composition step that could put a
 * different header in the file from the one on screen. The user can also edit it,
 * which is right: the header is part of their resume.
 */

/** Word's default body size, in half-points: 11 pt. */
const BODY_HALF_POINTS = 22;

/**
 * A SECTION HEADING is a short line in capitals — the shape P2 rule 4 asks for
 * ("SUMMARY", "EXPERIENCE", "SKILLS"), and the shape every resume parser looks
 * for. Detected rather than configured, because the user can edit the text and a
 * hard-coded list of headings would stop matching their version of it.
 *
 * The length bound is what stops a shouted sentence inside a bullet from being
 * promoted to a heading.
 *
 * WHAT IT GETS WRONG, said here rather than left for a user to find in a
 * downloaded document: any all-caps line of 40 characters or fewer is bolded, so
 * a company name a user typed in capitals on its own line — "ACME LOGISTICS" —
 * comes out as a section heading. The consequence is one wrongly-bold line in a
 * .docx, and it is accepted rather than fixed, because the alternative is a
 * hard-coded list of heading words: that would bold EXPERIENCE and not
 * BERUFSERFAHRUNG, and rule B10 allows a non-English posting to be parsed even
 * though the resume comes out in English. A shape test is wrong about one line;
 * a word list is wrong about whole documents.
 */
const MAX_HEADING_CHARS = 40;

/**
 * Shapes a section heading never has: the contact block's own field separator,
 * an email address, and a URL (v2.20).
 *
 * A section heading is ONE phrase. A line that enumerates fields is not one,
 * whatever its case — and without this a location typed in capitals came out as
 * `HAMBURG, GERMANY · OPEN TO REMOTE`, bolded as a heading in the user's own
 * document: the app's own generated line tripping the app's own shape test.
 *
 * `FIELD_SEPARATOR` is IMPORTED from `lib/resumeHeader.ts` rather than copied,
 * because a second definition of it here would mean changing the separator over
 * there silently disabled this guard.
 *
 * WHAT IT STILL GETS WRONG, and it is the same declared case as `ACME LOGISTICS`
 * two comments up: a profile whose ONLY contact field is a capitalised location
 * produces one short all-caps line with no separator, no `@` and no `://`, and
 * that line is indistinguishable in shape from a section heading. It is bolded.
 * A shape test is wrong about one line; the alternative — passing the header's
 * identity down from the generator — cannot work here at all, because the text
 * this function reads is the text the USER edited and the app no longer knows
 * which lines it wrote.
 */
const NOT_A_HEADING = [FIELD_SEPARATOR.trim(), '@', '://'];

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_CHARS) return false;
  if (NOT_A_HEADING.some((shape) => trimmed.includes(shape))) return false;
  // At least one cased letter, and no lower-case one. `toUpperCase` rather than a
  // Latin-only class, so a heading in another script is not mis-detected by an
  // alphabet this app does not assume.
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase();
}

/**
 * Build the .docx. Blank lines are kept as empty paragraphs so the document
 * looks like the editor did — an ATS reads the text either way, and the person
 * reading it after the ATS does not.
 */
export async function resumeToDocx(content: string): Promise<Uint8Array> {
  const paragraphs = content.split(/\r?\n/).map(
    (line) =>
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: line, bold: isHeading(line), size: BODY_HALF_POINTS }),
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
