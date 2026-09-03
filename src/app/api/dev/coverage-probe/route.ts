import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { titleOf } from '@/lib/chunking';
import { getApplication } from '@/lib/db/applications';
import { listRecentLlmCalls } from '@/lib/db/llmCalls';
import { getVacancy } from '@/lib/db/vacancies';
import {
  AiUnavailableError,
  NotFoundError,
  ValidationError,
  apiErrorResponse,
} from '@/lib/errors';
import { matchDocumentsForTexts } from '@/lib/retrieval';
import {
  COVERAGE_THRESHOLD,
  SIMILARITY_FLOOR,
  SIMILARITY_SPAN,
  isCovered,
  normalizeSimilarity,
} from '@/lib/scoring';

/**
 * GET /api/dev/coverage-probe?applicationId=… — DEVELOPMENT ONLY.
 *
 * The instrument behind `docs/eval/coverage-thresholds.md`. It answers one
 * question the app deliberately cannot: for each requirement of an analysed
 * scan, WHICH career item matched best and at what raw similarity — including
 * the requirements the scan called gaps, whose matched item the coverage map
 * throws away on purpose (a gap names no item, because printing one beside a
 * gap would suggest it covered the requirement).
 *
 * Why it exists at all: rule B1's thresholds (floor 0.30, span 0.55, covered at
 * 0.60) were chosen before any of them had been measured against this embedding
 * model. Owner testing then found a scan where every requirement read "Gap"
 * with best similarities of 0.20–0.43, including one — "0-2 years of experience
 * in data entry, data annotation, or similar role" — that the career base
 * plainly covers. Lowering the numbers until the screen looks better would be
 * calibrating to a feeling; this route produces the distribution the numbers can
 * be calibrated AGAINST, which is the difference between a threshold and a
 * guess.
 *
 * NOT A FEATURE, and four things keep it from becoming one:
 *   1. `NODE_ENV === 'production'` answers 404 before anything else runs, so it
 *      cannot be reached on a deployment even though it ships in the bundle.
 *   2. `requireApiUser()` on the next line: it is a metered path (one batched
 *      embeddings run per call), and the gate rules apply to it exactly as they
 *      apply to /api/scan.
 *   3. Everything it reads goes through the DALs, so RLS scopes it to the
 *      caller's own rows — a probe cannot look at another account's base.
 *   4. CHUNK TEXT IS NEVER RETURNED. Career-item titles and similarity scores
 *      only, which is the same line the development match log is allowed to
 *      print (CLAUDE.md, Retrieval) and the same pair the result screen already
 *      shows. A probe that dumped chunks would be logging the user's own resume
 *      content outside the rows they own.
 *
 * It re-runs the match rather than reading the stored map, so the numbers are
 * the model's current answer for the base as it stands now; `stored` carries the
 * scan's own similarity beside it so drift between the two is visible.
 *
 * It also returns the caller's own recent `llm_calls` rows as METADATA (step,
 * model, ok, tokens, cost, latency, application_id — never content). That is the
 * second question owner testing raised: a query found one `parse_vacancy` row
 * for a scan and no `embed` rows, and the app had no way to show otherwise
 * because /quality is Phase 6. `listRecentLlmCalls` is the `llm_calls` DAL and
 * its SELECT policy is owner-scoped, so this reads the caller's rows and no
 * one else's — no service-role key, no `.from(` outside a DAL.
 */

/** One batched embeddings run plus one RPC per requirement — the scan's budget. */
export const maxDuration = 120;

/** How many chunks to rank per requirement. The scan itself keeps the best one. */
const PROBE_MATCH_COUNT = 5;

export async function GET(request: Request) {
  try {
    // Before auth, before the query string: on a deployment this endpoint does
    // not exist, and saying so first means no dev-only code path can be reached
    // in production by any argument.
    if (process.env.NODE_ENV === 'production') throw new NotFoundError();

    await requireApiUser();

    const applicationId = new URL(request.url).searchParams.get('applicationId');
    if (!z.uuid().safeParse(applicationId).success) throw new NotFoundError();

    const application = await getApplication(applicationId!);
    if (!application) throw new NotFoundError();
    const vacancy = await getVacancy(application.vacancy_id);
    if (!vacancy) throw new NotFoundError();

    const parsed = vacancy.parsed;
    if (!parsed || parsed.requirements.length === 0) {
      // Nothing to probe is not an error in the app's sense, but it is not a
      // result either: a probe that answered with an empty table would read as
      // "no requirements matched anything".
      throw new ValidationError('This application has no parsed requirements to probe.');
    }

    const outcome = await matchDocumentsForTexts(parsed.requirements.map((r) => r.text));
    if (outcome.status === 'could_not_search') {
      // The third outcome, here as everywhere: an empty table would claim a
      // search that never ran.
      throw new AiUnavailableError('The probe could not search — no numbers to report.');
    }

    const stored = application.coverage;

    /**
     * Rule B8's own witness until /quality is built. `embed` rows carry
     * `application_id: null` by design (indexing is not tied to an application)
     * — which is why a query filtered on an application id finds the
     * `parse_vacancy` row and none of the embedding rows. Backlog p3-8.
     */
    const calls = (await listRecentLlmCalls(25)).map((call) => ({
      step: call.step,
      model: call.model,
      ok: call.ok,
      fallback_used: call.fallback_used,
      tokens_in: call.tokens_in,
      tokens_out: call.tokens_out,
      cost_usd_micro: call.cost_usd_micro,
      cost_known: call.cost_known,
      latency_ms: call.latency_ms,
      application_id: call.application_id,
      created_at: call.created_at,
    }));

    return NextResponse.json({
      applicationId: application.id,
      resumeSource: application.resume_source,
      matchScore: application.match_score,
      // Read from lib/scoring, never retyped: a probe printing its own copy of
      // the numbers would report the thresholds a recalibration replaced.
      thresholds: {
        floor: SIMILARITY_FLOOR,
        span: SIMILARITY_SPAN,
        covered: COVERAGE_THRESHOLD,
      },
      keywordsDropped: stored?.keywordsDropped ?? null,
      keywords: stored?.keywords ?? [],
      calls,
      requirements: parsed.requirements.map((requirement, index) => {
        const searched = outcome.outcomes[index];
        const chunks = searched && searched.status === 'found' ? searched.chunks : [];
        const ranked = [...chunks]
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, PROBE_MATCH_COUNT)
          .map((chunk) => ({
            // Title, row id and score only. Never `chunk.content`.
            //
            // The id is the `documents` row's own id, and it is what makes chunk
            // CONCENTRATION measurable: with one chunk per item a blob wins many
            // requirements at once, and counting item titles cannot show that
            // while counting rows can. It identifies a row, not its text.
            chunkId: chunk.id,
            careerItemTitle: titleOf(chunk.content),
            similarity: chunk.similarity,
            normalized: normalizeSimilarity(chunk.similarity),
            covered: isCovered(chunk.similarity),
          }));
        const storedEntry = stored?.entries[index] ?? null;
        return {
          requirement: requirement.text,
          kind: requirement.kind,
          keyword: requirement.keyword,
          // v2.15: what evidence the requirement demands, and the verbatim names
          // that would prove it — without these the lexical gate's decisions are
          // not auditable, which is the whole job of this endpoint.
          evidence: requirement.evidence ?? 'general',
          terms: requirement.terms ?? [],
          stored: storedEntry
            ? {
                status: storedEntry.status,
                similarity: storedEntry.similarity,
                missingTerm: storedEntry.missingTerm ?? null,
              }
            : null,
          matches: ranked,
        };
      }),
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
