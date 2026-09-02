import 'server-only';

/**
 * Resume export — phase 0 stub.
 *
 * Server-side only. Produces an ATS-friendly single-column .docx from the
 * editor content, written as PLAIN TEXT: resume text may contain HTML-looking
 * characters and must never be interpreted (edge case S2).
 *
 * The filename builder lives in `lib/utils.ts` — it is pure string logic and
 * needs no server guard — and is re-exported here so the export path has one
 * import.
 */

export { exportFilename } from '@/lib/utils';

export async function resumeToDocx(_content: string): Promise<Uint8Array> {
  throw new Error('resumeToDocx is a phase-0 stub — implemented with the export phase.');
}
