import 'server-only';

import { MAX_EPHEMERAL_CHUNKS, chunkContent, titleOf } from '@/lib/chunking';
import { ERROR_MESSAGES } from '@/lib/copy';
import type { CoverageEntry, CoverageMap, KeywordRow, ParsedVacancy } from '@/lib/db/types';
import { AiUnavailableError, DailyLimitError, ServerError } from '@/lib/errors';
import {
  type SearchedOutcome,
  embedTexts,
  matchDocumentsForTexts,
} from '@/lib/retrieval';
import {
  cosineSimilarity,
  coverageStatusFor,
  keywordCount,
  literalKeywords,
  matchScore as computeMatchScore,
} from '@/lib/scoring';

/**
 * RULE B1, ONCE — the coverage map and the match score, for every screen that
 * shows one.
 *
 * It was inside `src/app/api/scan/route.ts` through Phase 3 and moved here when
 * a SECOND caller appeared: `POST /api/applications/[id]/rescore` measures the
 * same requirements against a different body of text, and a second copy of B1's
 * arithmetic would have been two implementations of one calibrated rule, free to
 * drift a hundredth apart while `docs/eval/coverage-thresholds.md` went on
 * describing only one of them.
 *
 * WHAT VARIES BETWEEN THE TWO CALLERS IS THE CORPUS, AND NOTHING ELSE. A scan
 * matches the vacancy's requirements against the CAREER BASE, through
 * `match_documents` and pgvector. A re-score matches them against the resume in
 * the EDITOR — text that has never been stored and must not be, since the whole
 * point is to read an unsaved draft. So the corpus is an argument: it says what
 * text the lexical gate reads, whether that text is also the scored source, and
 * how to rank the requirements against it. Everything downstream — the
 * threshold, the lexical gate, the three statuses, the keyword rows, the 60/40
 * weighting — is this file, run once.
 *
 * THE THIRD RETRIEVAL OUTCOME SURVIVES THE ABSTRACTION. A corpus reports
 * `could_not_search` at the RUN level and has no per-requirement way to say it,
 * so a caller mapping requirements to statuses has no third case to forget: a
 * dead embeddings call fails the whole request and never renders as a gap
 * (CLAUDE.md, Retrieval — three outcomes, never two).
 */

/** What the corpus found for ONE requirement, or null when it found nothing. */
export type RequirementMatch = {
  similarity: number;
  /** The career item behind the match, when the corpus is the career base. */
  careerItemId: string | null;
  careerItemTitle: string | null;
  /**
   * The line of the SCORED TEXT that matched, when the corpus is the editor's
   * own resume. Never a career-base chunk: those are data for a model call and
   * are never echoed to the client.
   */
  matchedText: string | null;
};

export type CorpusOutcome =
  | { status: 'searched'; matches: (RequirementMatch | null)[] }
  | { status: 'could_not_search'; error: string };

export type CoverageCorpus = {
  /**
   * The text rule B1's LEXICAL GATE searches (SPEC v2.15). It is always the
   * corpus the ranking ran over, and that identity is the rule: the gate asks
   * "does the body of text this decision is made against actually NAME the
   * thing", so pointing it at any other text would make it answer a different
   * question. For a scan that is the career base; for a re-score it is the
   * edited resume.
   */
  corpusText: string;
  /**
   * True when the corpus and the scored source are the SAME text.
   *
   * It collapses `gap_in_resume_covered_by_base`, and not as a shortcut: that
   * status means "your base covers this and the resume you chose does not", and
   * when the two are one body of text there is nothing for the resume to be
   * missing. True for a career-base scan, true for every re-score (the editor's
   * text is both the corpus and the source), false for a pasted or uploaded
   * resume — the only case where US-3's hidden matches can exist.
   */
  corpusIsSource: boolean;
  match(requirementTexts: string[]): Promise<CorpusOutcome>;
};

/**
 * The career base, through pgvector — the Phase 3 path, unchanged.
 *
 * The requirements are embedded in ONE batched call — `embedFor` splits at
 * `EMBEDDING_BATCH_SIZE`, so a posting whose parse exceeds that many
 * requirements costs a second request rather than one per requirement, which is
 * what the batching exists to prevent. Then one `match_documents` RPC per
 * requirement: a database call, not a spend.
 */
export function careerBaseCorpus(args: {
  baseText: string;
  corpusIsSource: boolean;
  applicationId: string | null;
}): CoverageCorpus {
  return {
    corpusText: args.baseText,
    corpusIsSource: args.corpusIsSource,
    async match(requirementTexts) {
      const outcome = await matchDocumentsForTexts(
        requirementTexts,
        5,
        'embed',
        args.applicationId,
      );
      if (outcome.status === 'could_not_search') return outcome;
      return {
        status: 'searched',
        matches: outcome.outcomes.map((searched) => {
          const best = bestChunk(searched);
          if (!best) return null;
          return {
            similarity: best.similarity,
            careerItemId: best.careerItemId,
            // The title is the chunk's own first line, stored there so naming a
            // match costs no extra query and leaks no resume content.
            careerItemTitle: titleOf(best.content),
            matchedText: null,
          };
        }),
      };
    },
  };
}

/**
 * The resume in the EDITOR — the re-score path (SPEC Block D #6, v2.16).
 *
 * Block D #6 says the edited text's bullets are embedded and the requirements
 * scored against THEM, and that is the half of it that matters: an edit changes
 * the resume, so a re-score that ranked requirements against the career base
 * again would spend a metered call to recompute a number arithmetically
 * incapable of responding to the edit. Only K would move, and US-5's "Re-score
 * changes the score" would be true by accident.
 *
 * ONE embeddings run covers both sides — the resume's units and the
 * requirements go out in the same batched request — and the comparison is
 * `cosineSimilarity` in process, on the same scale `match_documents` returns, so
 * rule B1's calibrated thresholds mean what they were measured to mean.
 *
 * NOTHING IS STORED. `documents` holds the career base and only the career base;
 * writing the editor's draft into it would put an unsaved, unreviewed text into
 * the index every later scan searches. The vectors live for the length of this
 * request.
 *
 * The splitter is `chunkContent` — the same semantic units the career base is
 * indexed with (SPEC v2.14), so a requirement is compared against one claim on
 * each side rather than against a whole document on one and a bullet on the
 * other. It is given `MAX_EPHEMERAL_CHUNKS` and NOT the chunker's default:
 * `MAX_CHUNKS_PER_ITEM` is rule B9's storage ceiling divided by the item cap,
 * and applying a storage bound to a corpus that is never stored would force
 * 400–750-character chunks on a long resume — coarse enough, by v2.14's own
 * measurement, to win comparisons it should lose, and to make a long resume
 * score differently from a short one for no reason at all.
 */
export function editorTextCorpus(args: {
  content: string;
  applicationId: string | null;
}): CoverageCorpus {
  return {
    corpusText: args.content,
    // The editor's text IS the scored source: there is no second resume for a
    // requirement to be "hidden" from.
    corpusIsSource: true,
    async match(requirementTexts) {
      const units = chunkContent(args.content, MAX_EPHEMERAL_CHUNKS);
      if (units.length === 0) {
        // A measured emptiness, not a failure: there is nothing in the editor to
        // match against, so every requirement is honestly a gap at similarity 0.
        return { status: 'searched', matches: requirementTexts.map(() => null) };
      }

      let vectors: number[][];
      try {
        vectors = await embedTexts(
          [...requirementTexts, ...units],
          'rescore',
          args.applicationId,
        );
      } catch (err) {
        /**
         * A REFUSAL IS NOT A FAILED SEARCH. Rule B7a means the embeddings call
         * was never attempted, so reporting it as `could_not_search` would raise
         * the 502 "AI service is unavailable. Try again." for a quota that will
         * refuse the retry identically — the app describing its own budget
         * decision as an outage, and telling the user to do the one thing that
         * cannot work. It travels as the 429 it is.
         */
        if (err instanceof DailyLimitError) throw err;
        return { status: 'could_not_search', error: err instanceof Error ? err.name : 'embed failed' };
      }
      if (vectors.length !== requirementTexts.length + units.length) {
        // Mis-aligned vectors would score one requirement against another's
        // neighbourhood — a wrong number, which is worse than no number.
        return { status: 'could_not_search', error: 'embeddings did not cover every input' };
      }

      const unitVectors = vectors.slice(requirementTexts.length);
      const matches = requirementTexts.map((_, index) => {
        const requirementVector = vectors[index]!;
        let best: RequirementMatch | null = null;
        for (let u = 0; u < units.length; u += 1) {
          const similarity = cosineSimilarity(requirementVector, unitVectors[u]!);
          if (!best || similarity > best.similarity) {
            best = {
              similarity,
              // No career item is involved: the match is a line of the user's own
              // edited resume, echoed back to the browser that just sent it.
              careerItemId: null,
              careerItemTitle: null,
              matchedText: units[u]!,
            };
          }
        }
        return best;
      });
      return { status: 'searched', matches };
    },
  };
}

/**
 * The coverage map and the score for one vacancy against one corpus.
 *
 * `aiUnavailableMessage` is the caller's own copy for a failed search, because
 * the two callers promise different things: a scan has already saved the
 * vacancy and says so, while a re-score has saved nothing. One message for both
 * would be false on one of them.
 */
export async function scoreAgainstCorpus(args: {
  vacancy: ParsedVacancy;
  /** The posting, for rule B1a's literal-span guard on keywords and terms. */
  vacancyText: string;
  /** The text rule B1's K is counted over. */
  sourceText: string;
  corpus: CoverageCorpus;
  aiUnavailableMessage: string;
}): Promise<{ matchScore: number | null; coverage: CoverageMap }> {
  const { vacancy, vacancyText, sourceText, corpus } = args;

  /**
   * Rule B1a's literal-span guard (SPEC v2.13), applied AFTER Zod and BEFORE
   * anything counts or renders. A keyword the vacancy does not contain would
   * render an "In vacancy" count of 0 — the app measuring the absence of a term
   * it says it found — and would drag K down for a requirement the posting never
   * made. The drop is recorded, not silent.
   */
  const { kept: vacancyKeywords, dropped } = literalKeywords(vacancyText, vacancy.keywords);
  if (dropped.length > 0) {
    // Metadata only: counts, never the spans — they are fragments of the posting.
    console.warn('[coverage] dropped non-literal keywords from the parse', {
      dropped: dropped.length,
      kept: vacancyKeywords.length,
    });
  }

  const keywords: KeywordRow[] = vacancyKeywords.map((keyword) => ({
    keyword,
    inResume: keywordCount(sourceText, keyword),
    inVacancy: keywordCount(vacancyText, keyword),
  }));

  const { entries, termsDropped } = await coverageEntries(
    vacancy,
    vacancyText,
    sourceText,
    corpus,
    args.aiUnavailableMessage,
  );

  /**
   * NULL only when the parse produced 0 requirements in total (edge case N4).
   * That is the one case rule B1 has no number for, and it is not the same as a
   * zero — which is why it stays null all the way to the column rather than
   * being rounded into one on the way past.
   */
  const matchScore = computeMatchScore({
    // The TOTAL from the parse, not the number of MUST requirements: a nice-only
    // posting scores round(100 × K) rather than "—" (rule B1).
    requirementCount: vacancy.requirements.length,
    mustBestSimilarities: entries
      .filter((entry) => entry.kind === 'must')
      .map((entry) => entry.similarity),
    resumeText: sourceText,
    // K is counted over the KEPT keywords: a phantom keyword is not a
    // requirement the resume failed to meet.
    keywords: vacancyKeywords,
  });

  return {
    matchScore,
    coverage: { entries, keywords, keywordsDropped: dropped.length, termsDropped },
  };
}

/**
 * One coverage entry per requirement (edge cases D4, D7).
 *
 * For the career base the career item is DENORMALIZED on write — its title and
 * its id — so the result page never joins live and deleting an item later leaves
 * the historical coverage intact (D4). Chunk TEXT never leaves this function.
 */
async function coverageEntries(
  vacancy: ParsedVacancy,
  vacancyText: string,
  sourceText: string,
  corpus: CoverageCorpus,
  aiUnavailableMessage: string,
): Promise<{ entries: CoverageEntry[]; termsDropped: number }> {
  // N4: nothing to search for, so nothing is embedded and nothing is spent. The
  // empty map is a MEASURED result — "we parsed the posting and it stated no
  // requirements" — which is a different thing from `coverage: null`.
  if (vacancy.requirements.length === 0) return { entries: [], termsDropped: 0 };

  const outcome = await corpus.match(vacancy.requirements.map((r) => r.text));
  if (outcome.status === 'could_not_search') {
    // The third outcome. Never rendered as gaps.
    console.error('[coverage] match run failed', { error: outcome.error });
    throw new AiUnavailableError(aiUnavailableMessage);
  }
  if (outcome.matches.length !== vacancy.requirements.length) {
    // A corpus that returns a different number of matches than it was asked for
    // would silently mis-align requirements with results. It is the corpus's
    // contract to return one per query, so this is the server failing its own
    // invariant rather than a request to blame.
    throw new ServerError();
  }

  let termsDropped = 0;

  const entries = vacancy.requirements.map((requirement, index) => {
    const best = outcome.matches[index] ?? null;

    /**
     * RULE B1a APPLIED TO `terms`, not only to `keywords`. P1 is told to copy
     * terms verbatim and a prompt is not a guarantee; a generalized term FLIPS a
     * coverage status, and it flips it toward the false gap v2.15 was built to
     * remove. Same guard, same boundary rule, same conservative direction: a
     * term the VACANCY does not contain is dropped, and a requirement left with
     * no terms withholds the gate rather than refusing on an empty search.
     */
    const { kept: literalTerms, dropped } = literalKeywords(vacancyText, requirement.terms ?? []);
    termsDropped += dropped.length;

    const similarity = best?.similarity ?? 0;
    const { status, missingTerm } = coverageStatusFor({
      bestSimilarity: similarity,
      keyword: requirement.keyword,
      sourceText,
      sourceIsBase: corpus.corpusIsSource,
      evidence: requirement.evidence,
      terms: literalTerms,
      // The lexical gate reads the corpus the ranking ran over — see
      // `CoverageCorpus.corpusText`.
      baseText: corpus.corpusText,
    });

    // A gap keeps the similarity it measured but names no match: the best unit
    // did NOT cover the requirement, and printing its title beside a gap would
    // suggest it did. That holds for a lexical gap too.
    const attributed = status === 'gap' ? null : best;
    return {
      requirement: requirement.text,
      kind: requirement.kind,
      status,
      careerItemId: attributed?.careerItemId ?? null,
      careerItemTitle: attributed?.careerItemTitle ?? null,
      similarity,
      missingTerm,
      matchedText: attributed?.matchedText ?? null,
    };
  });

  if (termsDropped > 0) {
    console.warn('[coverage] dropped non-literal requirement terms from the parse', {
      dropped: termsDropped,
    });
  }

  return { entries, termsDropped };
}

/**
 * The highest-scoring chunk of a searched outcome, or null when the search found
 * nothing.
 *
 * `match_documents` already orders by distance, so this is a re-assertion rather
 * than a fix — cheap, and it means the "best match" column cannot silently
 * become "first row the RPC happened to return" if that ordering ever changes.
 *
 * A MISSING outcome is not "found nothing". The gate guarantees one outcome per
 * query and refuses the whole run otherwise, so this cannot happen — and if it
 * ever does, returning null would turn a requirement nobody searched into a
 * measured zero and a gap, which is the exact hole the run-level outcome type
 * exists to close.
 */
function bestChunk(outcome: SearchedOutcome | undefined) {
  if (!outcome) throw new ServerError();
  if (outcome.status === 'found_nothing') return null;
  return outcome.chunks.reduce((best, chunk) =>
    chunk.similarity > best.similarity ? chunk : best,
  );
}

/** Re-exported so a caller needs one import for the failure message it passes. */
export const DEFAULT_AI_UNAVAILABLE = ERROR_MESSAGES.AI_UNAVAILABLE;
