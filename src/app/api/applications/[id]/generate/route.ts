import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { MAX_CHAT_REQUESTS_PER_GENERATE, withinBudget } from '@/lib/budget';
import { newCallLedger } from '@/lib/chat';
import { ERROR_MESSAGES, NAME_PLACEHOLDER, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { getDisplayName } from '@/lib/db/profiles';
import { insertResumeVersion } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import type { ResumeVersion } from '@/lib/db/types';
import {
  AlreadyRunningError,
  NotFoundError,
  ServerError,
  ValidationError,
  apiErrorResponse,
} from '@/lib/errors';
import { listCareerItemCorpus } from '@/lib/db/careerItems';
import { itemsCorpus } from '@/lib/generation';
import { bestVersion, partitionMissingHonest } from '@/lib/judge';
import { type Draft, generateWithJudge, retrieveItemsFor } from '@/lib/tailoring';

/**
 * POST /api/applications/[id]/generate — SPEC Block D #5, US-4.
 *
 * Retrieve the career items → generate (P2, Sonnet) → judge (P3, Haiku) → at
 * most ONE revision fed the judge's specific findings → append the versions.
 * The request body is `{}`: every input lives server-side, so a caller cannot
 * substitute a vacancy, a resume or a corpus between the auth check and the
 * spend.
 *
 * THE DECLARED COST OF ONE RUN, which is what the ledger is here to make true:
 *
 *     2 `llm_calls` chat rows   the judge approves the first draft
 *     4                         approved after rule B3's one revision
 *     8                         worst case — each of the four steps spends its
 *                               single owner-approved retry
 *   + 1 embeddings row (`embed` step), excluded from rule B7 by its definition
 *
 * ONE `CallLedger` is created here and passed to every chat call, because rule
 * B7 is otherwise blind to its own request: `countCallsInLast24h` reads
 * COMMITTED rows and `logLlmCall` writes through `after()`, so a four-call
 * request would check the same pre-request count four times and overshoot the
 * daily cap by three. `lib/budget.ts` holds the ceiling that follows, and the
 * assertion below is a DEFECT TRAP for the day someone adds a fifth step: the
 * chat gate's per-step cap already makes it unreachable, so if it ever fires,
 * the number in the hand-over and the number the code can reach have diverged.
 */

/** Two 60 s attempts plus a 2 s retry wait, four times over, is ~248 s. */
export const maxDuration = 300;

/**
 * The in-flight lock's crash backstop (edge case N6, corrected in v2.16).
 *
 * N6 gave the TTL as 120 s against a pipeline that could not run that long. It
 * can now: `maxDuration` is 300, so a 120 s TTL would expire MID-RUN and hand a
 * second POST a free lock — up to eight more metered requests and a second pair
 * of versions, which is precisely the duplicate spend the lock exists to refuse.
 * The TTL is therefore at least `maxDuration`, and the normal release is the
 * `finally` below; this only covers a process that dies holding the lock.
 */
const LOCK_TTL_MS = 300_000;

/**
 * Per-INSTANCE, per-application. It is not a distributed lock and does not
 * pretend to be one: two serverless instances can each hold their own, so this
 * closes the case that actually happens — a double click, or a second tab — and
 * not a concurrent-invocation race. The client's synchronous ref guard is the
 * first line; this is what survives a page reload between the two clicks.
 */
const inFlight = new Map<string, number>();

function acquireLock(applicationId: string): boolean {
  const held = inFlight.get(applicationId);
  if (held !== undefined && Date.now() - held < LOCK_TTL_MS) return false;
  inFlight.set(applicationId, Date.now());
  return true;
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let locked: string | null = null;
  try {
    const user = await requireApiUser();

    const { id } = await params;
    // The segment's SHAPE before Postgres sees it: a non-UUID is 404, not the
    // 500 an `invalid input syntax for type uuid` produces.
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();

    // Read under the user's own session, so another account's id yields no row
    // and the answer is 404 rather than 403 (edge case S3).
    const application = await getApplication(id);
    if (!application) throw new NotFoundError();

    const vacancy = await getVacancy(application.vacancy_id);
    if (!vacancy) throw new NotFoundError();

    /**
     * A resume can only be tailored to a posting the app has PARSED. Without the
     * parse there are no requirements to write against and no keywords to
     * measure, so the generator would be asked to tailor to nothing — an
     * expensive way to produce a generic resume. The screen offers [Run
     * analysis] for exactly this state.
     */
    if (!vacancy.parsed || application.coverage === null) {
      throw new ValidationError(RESULT.generateNeedsAnalysis);
    }

    // The lock is taken AFTER the cheap refusals and BEFORE the first spend, so
    // a 404 or a 400 never blocks a legitimate run behind it.
    if (!acquireLock(id)) throw new AlreadyRunningError(ERROR_MESSAGES.ALREADY_RUNNING);
    locked = id;

    const ledger = newCallLedger();

    // One embeddings request. Its `llm_calls` row carries this application id,
    // so a run's embedding spend is attributable to it (SPEC v2.16, p3-8).
    const retrieved = await retrieveItemsFor(vacancy.parsed, id, RESULT.generationFailed);
    if (retrieved.items.length === 0) {
      /**
       * Edge case D7 on the generation path. An empty corpus is not a smaller
       * version of a good one: every claim in the resume would be ungrounded by
       * construction, the judge would fail all of them, and the app would have
       * spent a Sonnet call to produce something it is about to reject. Refused
       * before the spend, with the copy that names the cause.
       */
      throw new ValidationError(RESULT.generateNeedsBase);
    }

    /**
     * THE NAME LINE (SPEC v2.17). The career base holds no person's name, so the
     * app supplies one — and when the user has not saved one, it supplies a
     * VISIBLE PLACEHOLDER rather than a substitute. Owner testing found the
     * generator filling that line with the vacancy's job title, which is what an
     * ATS parser reads as the candidate's name.
     *
     * Read under the user's own session through the DAL, so RLS scopes it; a
     * missing profile is a normal answer and not an error.
     */
    const displayName = await getDisplayName();

    const outcome = await generateWithJudge({
      parsed: vacancy.parsed,
      items: retrieved.items,
      applicationId: id,
      ledger,
      candidateName: displayName ?? NAME_PLACEHOLDER,
    });

    if (!withinBudget(ledger, MAX_CHAT_REQUESTS_PER_GENERATE)) {
      // Unreachable: the chat gate refuses a third request within a step. If it
      // ever fires, a step was added without the ceiling being updated, and the
      // declared cost is no longer the true one.
      console.error('[generate] the run exceeded its declared chat budget', {
        requests: ledger.chat,
        ceiling: MAX_CHAT_REQUESTS_PER_GENERATE,
      });
      throw new ServerError();
    }

    /**
     * BOTH DRAFTS BECOME ROWS, in the order they were written.
     *
     * `resume_versions` is append-only, so this is also the whole record: what
     * the AI wrote first, what the reviewer said, and what the rewrite produced.
     * Storing only the winner would leave the "Auto-revised once" badge as a
     * claim with nothing behind it.
     */
    const original = await save(user.id, id, outcome.original, 'ai');
    const revision = outcome.revision
      ? await save(user.id, id, outcome.revision, 'ai_revision')
      : null;

    /**
     * WHICH ONE THE EDITOR OPENS WITH. Block D #5: if the second judge still says
     * revise, return the best version anyway with its honest card. Grounding
     * decides first and absolutely (rule B2); only then the rubric total.
     */
    const shown = revision ? bestVersion(original, revision) : original;

    revalidatePath(`/applications/${id}`);

    return NextResponse.json({
      resumeVersionId: shown.id,
      source: shown.source,
      autoRevised: revision !== null,
      /** True when the rewrite ran and the FIRST draft is still the better one. */
      revisionNotBetter: revision !== null && shown.id === original.id,
      /** True when a rewrite was earned and the reviewer gave nothing to act on. */
      revisionWithheld: outcome.revisionWithheld,
      content: shown.content,
      judge: shown.judge,
      /**
       * The reviewer's `missingHonest`, SPLIT against the career base before it
       * reaches a screen (SPEC v2.17). The stored report keeps the reviewer's own
       * words — it is the record of what the review said — and the client is
       * handed the partition rather than the raw list, so no render site can
       * print "supported by your base" over a term the base does not contain.
       *
       * THE WHOLE BASE, not the retrieved items, and it is the same corpus the
       * detail page uses on reload. Two corpora would be two answers to one
       * question: a term the base holds but retrieval did not surface would
       * render under "not in your career base" now and under "supported by your
       * base" after a refresh — this round's own defect, moved from two blocks
       * to two renders. The heading says "your career base", so the base is what
       * decides it. The REVISION prompt keeps the narrower corpus, because that
       * asks a different question: what the writer could honestly reach for.
       */
      judgeTerms: partitionMissingHonest(
        shown.judge?.keywordCoverage.missingHonest ?? [],
        itemsCorpus(await listCareerItemCorpus()),
      ),
      versions: [original, revision].filter((v): v is ResumeVersion => v !== null),
    });
  } catch (err) {
    return apiErrorResponse(err);
  } finally {
    // Released here and not on a timer: the TTL above is a crash backstop, and a
    // lock that outlives its run is a button the user cannot press.
    if (locked) inFlight.delete(locked);
  }
}

/** Append one draft. `judge: null` means the check did not run — not that it passed. */
function save(
  userId: string,
  applicationId: string,
  draft: Draft,
  source: ResumeVersion['source'],
): Promise<ResumeVersion> {
  return insertResumeVersion({
    userId,
    applicationId,
    content: draft.content,
    source,
    judge: draft.judge,
  });
}
