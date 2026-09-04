import 'server-only';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { NAME_PLACEHOLDER, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { getContacts, getDisplayName } from '@/lib/db/profiles';
import { getLatestResumeVersion, insertResumeVersion } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { exportFilename, resumeToDocx } from '@/lib/docx';
import { contactLines } from '@/lib/resumeHeader';
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
 *
 * THE FILENAME COMES FROM THE PROFILE, NOT FROM THE DOCUMENT (SPEC v2.17). It
 * used to read the resume's first line, which is exactly the line owner testing
 * found holding the vacancy's job title — so a download arrived as
 * `CV_Data_Annotator_….docx`. With no display name saved, the name part is simply
 * absent and the file is `CV_<Company>_<Role>.docx`: dropping a part the app does
 * not know beats inventing one, and `exportFilename` already sanitises every part
 * for the filesystem while keeping non-Latin letters intact.
 *
 * IT ALSO REPORTS A MISSING CONTACT HEADER (v2.20). The block is inserted at
 * GENERATION time, so a resume written before the user saved their contact
 * details has none — and that is precisely the state migration 005 exists to
 * fix. The export cannot graft one on (the text the user edited is what they are
 * downloading), so it says so and names the way out.
 *
 * AND IT REPORTS A PLACEHOLDER RATHER THAN HIDING IT. A file whose name line
 * still reads `[YOUR NAME]` must never look finished: the placeholder is in the
 * document itself, where it cannot be missed, and the response says so in a
 * header the client turns into a warning. The download is not blocked — the file
 * is the user's and refusing it would be the app deciding what they may send.
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

    /**
     * SAME GATE AS `/generate` AND `/judge`, and this endpoint had neither half.
     *
     * It SAVES a `source='user'` version before returning the file, and the
     * detail page mounts `ResultWorkspace` — the only reader of
     * `listResumeVersions` — solely when `coverage !== null`. A match run that
     * failed stores the parse and leaves `coverage` null, so a direct POST here
     * appended a row, on a table with no DELETE policy, to an application whose
     * screen can never show it. Not reachable through the UI, which renders no
     * editor in that state; a route that can only be reached directly is exactly
     * the one whose gate has to be its own.
     */
    if (!vacancy.parsed || application.coverage === null) {
      throw new ValidationError(RESULT.generateNeedsAnalysis);
    }

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

    const displayName = await getDisplayName(user.id);
    /**
     * THE HEADER IS NOT ADDED HERE, AND ITS ABSENCE IS REPORTED.
     *
     * `withContactHeader` runs during GENERATION, so the block is part of the
     * stored version and this route writes the editor's text verbatim — which is
     * the whole point: the document on disk is the text the user saw and edited,
     * not a second composition that could differ from it.
     *
     * The reachable gap is a resume WRITTEN BEFORE the contact details were
     * saved. It has no header, the export cannot honestly graft one on (the user
     * never saw it, never approved it, and the text they edited is what they are
     * downloading), and without this check the download would look finished while
     * the one thing migration 005 exists to fix stayed broken for every
     * application they already had.
     *
     * So it is a WARNING and not a refusal, exactly like the name placeholder
     * below: the file is the user's and the app does not decide what they may
     * send. Detected by asking whether any line the header WOULD have contained
     * is in the text, which is the same function that composes it — so the two
     * cannot hold different opinions about what a header is.
     */
    const contacts = await getContacts(user.id);
    const header = contactLines(contacts);
    const headerMissing = header.length > 0 && !header.some((line) => content.includes(line));

    const bytes = await resumeToDocx(content);
    const filename = exportFilename({
      // The user's own saved name, or nothing. Never the document's first line.
      name: displayName ?? '',
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
        /**
         * The name line is still the placeholder. A boolean header rather than a
         * message: the copy belongs in `lib/copy.ts` with every other string, and
         * a response body is not available on a file download.
         */
        ...(content.includes(NAME_PLACEHOLDER) ? { 'X-Name-Placeholder': '1' } : {}),
        /**
         * The user has contact details saved and this document carries none of
         * them. A boolean header for the same reason as the one above: the copy
         * belongs in `lib/copy.ts` with every other string, and a response body
         * is not available on a file download.
         */
        ...(headerMissing ? { 'X-Missing-Contacts': '1' } : {}),
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
