import 'server-only';

/**
 * Resume export — phase 0 stub.
 *
 * Server-side only. Produces an ATS-friendly single-column .docx from the
 * editor content, written as PLAIN TEXT: resume text may contain HTML-looking
 * characters and must never be interpreted (edge case S2).
 *
 * Filename: CV_<Name>_<Company>_<Role>.docx
 */

export function exportFilename(args: {
  name: string;
  company: string | null;
  role: string | null;
}): string {
  const slug = (value: string | null) =>
    (value ?? '')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
  return ['CV', slug(args.name), slug(args.company), slug(args.role)]
    .filter(Boolean)
    .join('_')
    .concat('.docx');
}

export async function resumeToDocx(_content: string): Promise<Uint8Array> {
  throw new Error('resumeToDocx is a phase-0 stub — implemented with the export phase.');
}
