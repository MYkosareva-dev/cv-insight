import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { newCallLedger } from '@/lib/chat';
import { NAME_PLACEHOLDER, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { getContacts, getDisplayName } from '@/lib/db/profiles';
import { insertResumeVersion } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { listCareerItemCorpus } from '@/lib/db/careerItems';
import { itemsCorpus } from '@/lib/generation';
import { partitionMissingHonest } from '@/lib/judge';
import { resumeTextForModel } from '@/lib/resumeHeader';
import { judgeResume, retrieveItemsFor } from '@/lib/tailoring';
import { resumeContentSchema } from '@/lib/validation';

/**
 * POST /api/applications/[id]/judge — SPEC Block D #7, US-5 step 3.
 *
 * [Check quality] on an edited resume: ONE judge call (P3, Haiku), and the
 * reviewed text is appended as a `source='user'` version with its report.
 *
 * COST: one embeddings request plus at most `MAX_CHAT_REQUESTS_PER_STEP = 2`
 * chat requests — one judge step, with the single repair retry the chat gate
 * allows if the JSON fails Zod. A ledger is created and passed even though there
 * is only one step, because the retry is a second billed call and rule B7 counts
 * billed calls.
 *
 * WHERE THE CAREER ITEMS COME FROM, since P3 calls them "the only permitted
 * source of facts": they are RETRIEVED AGAIN, against the same vacancy query the
 * generation used. Two alternatives were weighed and both are worse. An empty
 * `<items>` block would make every claim in the user's resume ungrounded by
 * construction, so [Check quality] would fail everything and mean nothing.
 * Re-using the generate-time item set would need those ids stored on the row,
 * which `resume_versions` has no column for and this phase adds no migration.
 *
 * The consequence is DECLARED rather than hidden: this judges the CURRENT text
 * against the CURRENT base, so a user who has edited their career base since
 * generating may get a different grounding verdict than the AI draft got. That is
 * the honest reading of the button — "is what I have now supported by what I
 * have now" — but it means the two verdicts are not strictly comparable, and the
 * card does not claim they are.
 *
 * The version is saved whatever the verdict says. A quality check that refuses
 * the text is still a measurement of it, and discarding the row would leave the
 * user's own edit unsaved after they paid to have it reviewed.
 *
 * WHAT IS REVIEWED IS NOT BYTE-FOR-BYTE WHAT IS SAVED, and the difference is
 * exactly one block (owner decision, v2.21): the contact header is stripped on
 * the way to P3 and kept in the stored row. See the call below.
 */

/** One embeddings run and one judge step: 60 s, plus the retry wait. */
export const maxDuration = 120;

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
     * P3 evaluates the resume AGAINST the vacancy requirements; without a parse
     * there is nothing to evaluate it against.
     *
     * `coverage` is checked TOO, and the parse alone is not enough. A match run
     * that failed stores the parse and leaves `coverage` null, and the detail
     * page mounts `ResultWorkspace` — the only reader of `listResumeVersions` —
     * solely when `coverage !== null`. So this endpoint could spend a Haiku call
     * to append an append-only row on a table with no DELETE policy, to an
     * application whose screen will never show it. Same gate as `/generate`,
     * which has always had both halves.
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
      throw new ValidationError(parsed.error.issues[0]?.message ?? RESULT.emptyEditor);
    }

    const ledger = newCallLedger();
    const retrieved = await retrieveItemsFor(vacancy.parsed, id, RESULT.qualityCheckFailed);
    if (retrieved.items.length === 0) {
      // Refused BEFORE the paid judge call: with no items every claim is
      // ungrounded by construction, so the verdict would be decided by the empty
      // corpus rather than by the resume.
      throw new ValidationError(RESULT.generateNeedsBase);
    }

    /**
     * The judge is told the name for the same reason the writer is: it is a fact
     * from the user's profile rather than from a career item, so without it the
     * grounding gate would fire on the resume's own name line and rule B2 would
     * make that failure uncompensatable.
     */
    const displayName = await getDisplayName(user.id);

    /**
     * THE CONTACT HEADER COMES OUT BEFORE THE TEXT GOES TO THE REVIEWER (owner
     * decision, v2.21).
     *
     * This endpoint judges what is in the EDITOR, and a version generated with
     * contact details saved carries the block inline — so without this the user's
     * email address, phone number, city and both profile URLs went to OpenRouter
     * on every [Check quality]. Nothing in P3 needs them: grounding asks whether a
     * claim is supported by a career item, and a phone number is not a claim. The
     * strip is the enforcement, and `ModelResumeText` is what makes forgetting it
     * a build error rather than a silent transfer.
     *
     * WHAT IS STORED IS STILL THE USER'S WHOLE TEXT, header and all. The version
     * has to be the document they had, or [Check quality] would quietly delete
     * their contact details from their own resume — so the row and the prompt
     * differ by exactly the block the reviewer has no use for, which is declared
     * in SPEC v2.21 rather than left for a reader to discover.
     */
    const contacts = await getContacts(user.id);

    const judge = await judgeResume({
      parsed: vacancy.parsed,
      items: retrieved.items,
      resumeText: resumeTextForModel(parsed.data.content, contacts),
      applicationId: id,
      ledger,
      candidateName: displayName ?? NAME_PLACEHOLDER,
    });

    const version = await insertResumeVersion({
      userId: user.id,
      applicationId: id,
      content: parsed.data.content,
      source: 'user',
      judge,
    });

    revalidatePath(`/applications/${id}`);

    return NextResponse.json({
      resumeVersionId: version.id,
      source: version.source,
      content: version.content,
      /**
       * The DATABASE's timestamp (v2.22). The client merges this row into the
       * version list it holds so the rail's category bars move on the action
       * whose whole purpose is to produce a verdict — and the merge sorts by
       * `created_at`, so a timestamp invented in the browser would sort wrongly
       * against the rows beside it.
       */
      createdAt: version.created_at,
      judge,
      // Split against the WHOLE career base — the same corpus the detail page
      // and the generate route use, so one term gets one answer on every render.
      // See the generate route for why the client never receives the raw list.
      judgeTerms: partitionMissingHonest(
        judge.keywordCoverage.missingHonest,
        itemsCorpus(await listCareerItemCorpus()),
      ),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
