/**
 * Match score and coverage math (SPEC rule B1). Pure functions, no I/O — the
 * embeddings that feed them come from the `lib/retrieval.ts` gate.
 *
 *   score = round(100 × (0.6 × S + 0.4 × K))
 *     S = mean over MUST requirements of clamp((bestSimilarity − 0.30) / 0.55, 0, 1)
 *     K = share of vacancy keywords present in the resume text
 *         (case-insensitive, word-boundary)
 *
 * A requirement counts as covered at bestSimilarity ≥ 0.60. When the parse
 * produced 0 requirements the score is null and renders as "—" (edge case N4).
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

/** Returns null when there are no MUST requirements — the caller renders "—". */
export function matchScore(args: {
  mustBestSimilarities: number[];
  resumeText: string;
  keywords: string[];
}): number | null {
  const { mustBestSimilarities, resumeText, keywords } = args;
  if (mustBestSimilarities.length === 0) return null;
  const s =
    mustBestSimilarities.reduce((sum, v) => sum + normalizeSimilarity(v), 0) /
    mustBestSimilarities.length;
  const k = keywordShare(resumeText, keywords);
  return Math.round(100 * (WEIGHT_SIMILARITY * s + WEIGHT_KEYWORDS * k));
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
