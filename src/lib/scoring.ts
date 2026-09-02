/**
 * Match score and coverage math (SPEC rule B1). Pure functions, no I/O — the
 * embeddings that feed them come from the `lib/retrieval.ts` gate.
 *
 *   score = round(100 × (0.6 × S + 0.4 × K))
 *     S = mean over MUST requirements of clamp((bestSimilarity − 0.30) / 0.55, 0, 1)
 *     K = share of vacancy keywords present in the resume text
 *         (case-insensitive, word-boundary — see B1a and `keywordPresent`)
 *
 * A requirement counts as covered at bestSimilarity ≥ 0.60.
 *
 * Two degenerate parses, and they are NOT the same case (SPEC v1.9 B1):
 *   - 0 requirements TOTAL → null, rendered "—" (edge case N4).
 *   - ≥1 requirement but 0 MUST → S has nothing to average, so it is dropped
 *     and the score is round(100 × K). A nice-only posting still gets a real
 *     number; reporting "—" there would hide a score we can actually compute.
 */

export const SIMILARITY_FLOOR = 0.3;
export const SIMILARITY_SPAN = 0.55;
export const COVERAGE_THRESHOLD = 0.6;
export const WEIGHT_SIMILARITY = 0.6;
export const WEIGHT_KEYWORDS = 0.4;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

/** clamp((bestSimilarity − 0.30) / 0.55, 0, 1) */
export function normalizeSimilarity(bestSimilarity: number): number {
  return clamp((bestSimilarity - SIMILARITY_FLOOR) / SIMILARITY_SPAN);
}

export function isCovered(bestSimilarity: number): boolean {
  return bestSimilarity >= COVERAGE_THRESHOLD;
}

/**
 * Case-insensitive, word-boundary presence of a keyword in the resume text
 * (rule B1). The boundary is applied only on the sides where the keyword
 * actually starts/ends with a word character: `\bC\+\+\b` can never match,
 * because `+` is not a word char, so keywords like "C++", "C#" and ".NET"
 * would silently never count toward K.
 */
export function keywordPresent(resumeText: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = /^\w/.test(trimmed) ? '\\b' : '';
  const tail = /\w$/.test(trimmed) ? '\\b' : '';
  return new RegExp(`${lead}${escaped}${tail}`, 'i').test(resumeText);
}

export function keywordShare(resumeText: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const hits = keywords.filter((k) => keywordPresent(resumeText, k)).length;
  return hits / keywords.length;
}

/**
 * SPEC B1. Returns null ONLY when the parse produced 0 requirements in total —
 * that is the single case the UI renders as "—" (edge case N4).
 *
 * `requirementCount` is the TOTAL from the parse (must + nice), not the length
 * of `mustBestSimilarities`: a posting can have requirements that are all
 * "nice", and that case scores round(100 × K) rather than "—".
 */
export function matchScore(args: {
  /** Total requirements the parser returned, must + nice. */
  requirementCount: number;
  /** Best similarity per MUST requirement; empty for a nice-only posting. */
  mustBestSimilarities: number[];
  resumeText: string;
  keywords: string[];
}): number | null {
  const { requirementCount, mustBestSimilarities, resumeText, keywords } = args;

  if (requirementCount === 0) return null;

  const k = keywordShare(resumeText, keywords);

  // No MUST requirements: S is undefined, so drop it and score on K alone.
  //
  // RULE B1b — read this before rendering the return value. When there is also
  // nothing to compute K from (0 keywords extracted), this returns a hard 0,
  // and that 0 is arithmetic, not a judgement: the app measured nothing. The
  // /scan result UI must show NO_SCORE ("—") from lib/copy.ts for that case,
  // exactly as it does for the null above. B1b puts that decision in the UI
  // (Phase 3), not here, so the stored score stays a number. See
  // `insufficientSignal` below for the predicate.
  if (mustBestSimilarities.length === 0) return Math.round(100 * k);

  const s =
    mustBestSimilarities.reduce((sum, v) => sum + normalizeSimilarity(v), 0) /
    mustBestSimilarities.length;
  return Math.round(100 * (WEIGHT_SIMILARITY * s + WEIGHT_KEYWORDS * k));
}

/**
 * RULE B1b — "the app measured nothing", as opposed to "the app measured zero".
 *
 * True when S is undefined (no MUST requirements) AND K has nothing to work
 * from (no keywords extracted). `matchScore` still returns 0 for this case by
 * design; the /scan result UI (Phase 3) calls this and renders `NO_SCORE` from
 * lib/copy.ts instead of the number, the same as it does for a null score.
 *
 * The condition lives here because it is B1 arithmetic; the RENDERING decision
 * is the UI's, which is what B1b specifies.
 */
export function insufficientSignal(args: {
  mustBestSimilarities: number[];
  keywords: string[];
}): boolean {
  return args.mustBestSimilarities.length === 0 && args.keywords.length === 0;
}

export type ScoreBand = 'low' | 'mid' | 'high';

/** <40 → low, 40–69 → mid, ≥70 → high. Same rule everywhere a score renders. */
export function scoreBand(score: number): ScoreBand {
  if (score < 40) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}

export const SCORE_BAND_VAR: Record<ScoreBand, string> = {
  low: 'var(--score-low)',
  mid: 'var(--score-mid)',
  high: 'var(--score-high)',
};
