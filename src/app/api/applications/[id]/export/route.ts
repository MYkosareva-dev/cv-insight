import 'server-only';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { getLatestResumeVersion, insertResumeVersion } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { exportFilename, resumeToDocx } from '@/lib/docx';
import { resumeName } from '@/lib/generation';
import { resumeContentSchema } from '@/lib/validation';

/**
 * POST /api/applications/[id]/export — SPEC Block D #9, US-5 step 4.
 *
 * The editor's content in, `CV_<Name>_<Company>_<Role>.docx` out. NO MODEL CALL:
 * this is document assembly, so nothing here is metered and nothing is logged to
 * `llm_calls`.
 *
 * IT SAVES THE EDIT FIRST, and that is the point rather than a side effect.
 * Block D #6 says a re-score "does NOT save a version — saving happens via
 * /judge or export", and without this half the reachable state is: the user
 * edits, downloads the file, reloads, and the editor shows the AI draft again —
 * the document on their disk corresponding to no row in `resume_versions` and no
 * record of what they actually sent to an employer. `resume_versions` is
 * append-only, so saving means appending a `source='user'` row, and the `judge`
 * is null on it: this path runs no quality check, and a copied verdict would
 * attach a review of one text to a different one.
 *
 * IT DOES NOT APPEND A DUPLICATE. Downloading the same text twice is one
 * version, not two — the second click changed nothing, and a row per click would
 * turn the version history into a download log. The comparison is against the
 * LATEST version only, because that is what "unchanged since I last saved" means;
 * re-exporting an older text is a real edit and gets its own row.
 */

/** Document assembly only — no model call, so no long budget to reserve. */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();

    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();

    const application = await getApplication(id);
    if (!application) throw new NotFoundError();

    const vacancy = await getVacancy(application.vacancy_id);
    if (!vacancy) throw new NotFoundError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError(RESULT.emptyEditor);
    }
    const parsed = resumeContentSchema.safeParse(body);
    if (!parsed.success) {
      // An empty editor blocks the action with US-5's own copy, rather than
      // writing a blank document that looks like a working export.
      throw new ValidationError(parsed.error.issues[0]?.message ?? RESULT.emptyEditor);
    }
    const content = parsed.data.content;

    const latest = await getLatestResumeVersion(id);
    if (!latest || latest.content !== content) {
      await insertResumeVersion({
        userId: user.id,
        applicationId: id,
        content,
        source: 'user',
        // No quality check ran on this path. Null is "not checked", which the
        // judge card and the category bars both render as its own state.
        judge: null,
      });
      revalidatePath(`/applications/${id}`);
    }

    const bytes = await resumeToDocx(content);
    const filename = exportFilename({
      // The resume's own first line — P2 rule 4 puts NAME there, so this reads
      // what the document says rather than guessing at an identity.
      name: resumeName(content),
      company: vacancy.company,
      role: vacancy.title,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        /**
         * `filename*` in UTF-8 as well as the plain `filename`, because a name
         * survives `exportFilename` with its accents and non-Latin letters
         * intact and a bare `filename` header is Latin-1. Without it a browser
         * saves someone's own name as mojibake on their own resume.
         */
        'Content-Disposition': `attachment; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(bytes.byteLength),
        // A resume is personal data and there is nothing to gain from caching it.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * The Latin-1 half of the header, for clients that ignore `filename*`.
 *
 * Non-ASCII is replaced rather than dropped, so a fully non-Latin name still
 * yields a usable `CV_..._..._.docx` instead of an empty quoted string.
 */
function asciiFallback(filename: string): string {
  return filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
}
