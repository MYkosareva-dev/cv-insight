import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { RESULT } from '@/lib/copy';
import { FIELD_SEPARATOR } from '@/lib/resumeHeader';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Characters no common filesystem accepts. */
const FS_UNSAFE = /[<>:"/\|?*]/gu;
/** Control, format and unassigned codepoints — `\p{C}` needs the `u` flag. */
const NON_PRINTABLE = /\p{C}/gu;
/** Runs of whitespace or dots collapse to a single separator. */
const SEPARATORS = /[.\s]+/gu;
/** Keep each part well inside the 255-byte filename limit every OS imposes. */
const MAX_FILENAME_PART = 40;

/**
 * `CV_<Name>_<Company>_<Role>.docx` — the resume export filename.
 *
 * Pure string logic, so it lives here rather than in `lib/docx.ts`: that module
 * is `server-only`, and a guard that exists to keep a SECRET out of the browser
 * should not also be what makes a pure function untestable. `lib/docx.ts`
 * re-exports it for callers of the export path.
 *
 * Unicode letters are KEPT: Müller stays Müller, and a Cyrillic or CJK name
 * survives intact. A `\w`-based filter (no `u` flag) strips every non-ASCII
 * letter, which for a non-Latin name deletes the whole part and collapses the
 * result to `CV_<Company>_<Role>.docx` — the user's own name silently gone from
 * their own resume. Only filesystem-unsafe and non-printable characters are
 * removed; NFC keeps composed accents as single codepoints, so the name
 * compares equal across platforms.
 */
export function exportFilename(args: {
  name: string;
  company: string | null;
  role: string | null;
}): string {
  const slug = (value: string | null) =>
    (value ?? '')
      .normalize('NFC')
      .replace(NON_PRINTABLE, '')
      .replace(FS_UNSAFE, '')
      .replace(SEPARATORS, '_')
      .replace(/_+/gu, '_')
      .replace(/^_+|_+$/gu, '')
      .slice(0, MAX_FILENAME_PART);
  return ['CV', slug(args.name), slug(args.company), slug(args.role)]
    .filter(Boolean)
    .join('_')
    .concat('.docx');
}

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

export function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_CHARS) return false;
  if (NOT_A_HEADING.some((shape) => trimmed.includes(shape))) return false;
  // At least one cased letter, and no lower-case one. `toUpperCase` rather than a
  // Latin-only class, so a heading in another script is not mis-detected by an
  // alphabet this app does not assume.
  if (!/\p{L}/u.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase();
}

/** One paragraph of the exported document, before `lib/docx.ts` renders it. */
export type ExportLine = { text: string; bold: boolean; muted: boolean };

/**
 * The exported document as a list of lines — the pure half of `resumeToDocx`,
 * kept here for the same reason as `exportFilename`: `lib/docx.ts` is
 * `server-only` and its logic should still be testable.
 *
 * Every line of the user's text, in order, blank lines kept as empty paragraphs
 * so the document looks like the editor did. Then ONE more paragraph:
 * `RESULT.aiGeneratedLine`, muted, never bold (SPEC v3.0, Block G G5). It is
 * appended HERE and nowhere else — not stored in the version row — so the
 * editor's text stays the user's and the sentence cannot be removed from the
 * file by deleting it in the editor. If the user pastes the sentence into the
 * editor themselves, the file carries it twice; that case is accepted.
 */
export function exportLines(content: string): ExportLine[] {
  const lines: ExportLine[] = content
    .split(/\r?\n/)
    .map((line) => ({ text: line, bold: isHeading(line), muted: false }));
  lines.push({ text: RESULT.aiGeneratedLine, bold: false, muted: true });
  return lines;
}
