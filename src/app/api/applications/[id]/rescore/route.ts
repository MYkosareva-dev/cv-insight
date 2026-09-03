import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { RESULT } from '@/lib/copy';
import { editorTextCorpus, scoreAgainstCorpus } from '@/lib/coverage';
import { getApplication } from '@/lib/db/applications';
import { getVacancy } from '@/lib/db/vacancies';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { resumeContentSchema } from '@/lib/validation';

/**
 * POST /api/applications/[id]/rescore — SPEC Block D #6, US-5 step 2.
 *
 * NO CHAT-MODEL CALL. One batched embeddings request (`rescore` step, excluded
 * from rule B7 by its definition), then rule B1's arithmetic. US-5's acceptance
 * line is "Re-score changes the score without any chat-model call, verified in
 * /quality", and the step name is what makes that verifiable there.
 *
 * IT MEASURES THE TEXT IN THE EDITOR, against itself. The requirements and the
 * resume's own units are embedded in the same request and compared in process,
 * so S responds to the edit — which is the whole point. Ranking the requirements
 * against the CAREER BASE again would have spent the same money to recompute a
 * number an edit cannot move: the base is unchanged, so only K would shift and
 * "re-score" would be true by accident. `lib/coverage.ts` carries that argument
 * where the two corpora are defined.
 *
 * SAME SCORING CODE AS THE SCAN. `scoreAgainstCorpus` is rule B1 in one place:
 * the calibrated threshold, the lexical gate, the three statuses, the keyword
 * rows and the 60/40 weighting. Only the corpus differs. A second copy would be
 * two implementations of one measured rule, free to drift while
 * `docs/eval/coverage-thresholds.md` described only one of them.
 *
 * IT WRITES NOTHING, and that is deliberate. `applications.match_score` and
 * `coverage` stay the numbers the SCAN measured, for the reason SPEC v2.12 gives
 * for storing the keyword counts at all: a stored measurement has to keep saying
 * what it measured, at the moment it measured it. A re-score is a live reading of
 * an UNSAVED draft, so the screen shows it as one and says so, and the way an
 * edit becomes durable is the export path, which appends a `source='user'`
 * version.
 */

/**
 * One embeddings run over the requirements plus the resume's units. No chat
 * call, so nothing here can take 60 s twice.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();

    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();

    const application = await getApplication(id);
    if (!application) throw new NotFoundError();

    const vacancy = await getVacancy(application.vacancy_id);
    if (!vacancy) throw new NotFoundError();
    /**
     * Re-scoring needs the STORED parse: the requirements are what the resume is
     * measured against, and re-parsing here would be a second chat call for a
     * posting the app has already read. A draft whose analysis never ran has no
     * parse, and there is nothing to re-score against.
     */
    if (!vacancy.parsed) throw new ValidationError(RESULT.generateNeedsAnalysis);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError(RESULT.emptyEditor);
    }
    const parsed = resumeContentSchema.safeParse(body);
    if (!parsed.success) {
      // US-5's error path: an empty editor blocks the action with its own copy.
      throw new ValidationError(parsed.error.issues[0]?.message ?? RESULT.emptyEditor);
    }

    const { matchScore, coverage } = await scoreAgainstCorpus({
      vacancy: vacancy.parsed,
      vacancyText: vacancy.raw_text,
      // Both the corpus and the scored source: K is counted over the same text
      // the requirements were ranked against, because there is only one text.
      sourceText: parsed.data.content,
      corpus: editorTextCorpus({ content: parsed.data.content, applicationId: id }),
      // Nothing was saved by this request, so the scan's "your vacancy was
      // saved" promise would be beside the point here.
      aiUnavailableMessage: RESULT.rescoreFailed,
    });

    // The same body shape as /api/scan, so one client renderer reads both.
    return NextResponse.json({
      matchScore,
      coverage: coverage.entries,
      keywords: coverage.keywords,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
