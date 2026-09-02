import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
