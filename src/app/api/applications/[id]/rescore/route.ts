import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { RESULT } from '@/lib/copy';
import { editorTextCorpus, scoreAgainstCorpus } from '@/lib/coverage';
import { renderableScore } from '@/lib/scoring';
import { getApplication } from '@/lib/db/applications';
import { getContacts } from '@/lib/db/profiles';
import { getVacancy } from '@/lib/db/vacancies';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { resumeTextForModel } from '@/lib/resumeHeader';
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
 * IT SENDS NO CONTACT DETAILS (owner decision, v2.21). An embeddings request is
 * still a request leaving to a third party, so the contact header is stripped out
 * of the editor's text before anything is embedded or counted — nothing in rule
 * B1 can use a phone number, and the stripped text is also the more honest corpus
 * to score.
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
 * The requirements and the resume's units, embedded together. USUALLY one
 * request and not guaranteed to be: `embedFor` splits at
 * `EMBEDDING_BATCH_SIZE`, so a long resume or a many-requirement posting costs a
 * second — which is a second `rescore` row in `llm_calls`, and the reason to say
 * so rather than to write "one" and be wrong on a big input. No chat call
 * either way, so nothing here can take 60 s twice.
 */
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // The verified user is needed now: the contact header is read from their own
    // profile so it can be taken back out before the text is embedded.
    const user = await requireApiUser();

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

    /**
     * THE CONTACT HEADER COMES OUT BEFORE ANY OF THIS (owner decision, v2.21).
     *
     * A re-score is an EMBEDDINGS call, which is still a request to OpenRouter
     * carrying the text — so a version generated with contact details saved sent
     * the user's email address, phone number, city and both profile URLs to a
     * third party every time they pressed [Re-score], for a measurement that
     * cannot use them: rule B1 ranks requirements against the resume's claims,
     * and a phone number answers no requirement.
     *
     * IT IS ALSO THE MORE HONEST NUMBER. The stripped text is what gets embedded
     * AND what K is counted over, so the score measures the resume rather than
     * the resume plus a header — a vacancy keyword that happened to appear in a
     * contact field would otherwise have counted as coverage the resume does not
     * have.
     */
    const contacts = await getContacts(user.id);
    const scored = resumeTextForModel(parsed.data.content, contacts);

    const { matchScore, coverage } = await scoreAgainstCorpus({
      vacancy: vacancy.parsed,
      vacancyText: vacancy.raw_text,
      // Both the corpus and the scored source: K is counted over the same text
      // the requirements were ranked against, because there is only one text.
      sourceText: scored,
      corpus: editorTextCorpus({ content: scored, applicationId: id }),
      // Nothing was saved by this request, so the scan's "your vacancy was
      // saved" promise would be beside the point here.
      aiUnavailableMessage: RESULT.rescoreFailed,
    });

    /**
     * RULE B1b, THROUGH THE SAME FUNCTION EVERY OTHER SCREEN USES. `matchScore`
     * returns a hard 0 when there are no MUST requirements AND no keywords —
     * arithmetic, not a judgement — and B1b says that 0 must RENDER as "—",
     * because the app measured nothing. SPEC v2.12 note 10 states the client
     * contract in as many words: a caller reading `matchScore` applies
     * `renderableScore()` rather than printing it.
     *
     * Applied HERE rather than in the browser, so the endpoint cannot hand a
     * client a number the rest of the app would refuse to show. Without it the
     * ring flips from "—" to a red 0% on [Re-score] for a nice-only posting with
     * no keywords — the app reporting a measurement it did not take, which is
     * the exact defect B1b exists to prevent, and a second rule for a score that
     * Block E says must render by one.
     */
    // The same body shape as /api/scan, so one client renderer reads both.
    return NextResponse.json({
      matchScore: renderableScore({ match_score: matchScore, coverage }),
      coverage: coverage.entries,
      keywords: coverage.keywords,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
