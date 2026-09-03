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
  return keywordCount(resumeText, keyword) > 0;
}

/**
 * The B1a boundary as a regex, built once and used by both the presence test and
 * the count. `flags` is the only difference between them, so the boundary rule
 * cannot drift between "does it appear" and "how often".
 *
 * Returns null for a blank keyword — there is nothing to look for.
 */
function keywordRegex(keyword: string, flags: string): RegExp | null {
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = /^\w/.test(trimmed) ? '\\b' : '';
  const tail = /\w$/.test(trimmed) ? '\\b' : '';
  return new RegExp(`${lead}${escaped}${tail}`, flags);
}

/**
 * How many times a keyword appears — the Block E keywords table's two columns
 * ("In resume", "In vacancy"), under the SAME B1a boundary rule as `keywordPresent`,
 * so a keyword can never count 0 occurrences while reading as present.
 *
 * Non-overlapping matches, which is what `g` gives and what a reader of the
 * table expects: "AI" in "AI/AI" is two, and there is no case in this app where
 * counting one occurrence twice would be the honest number.
 */
export function keywordCount(text: string, keyword: string): number {
  const pattern = keywordRegex(keyword, 'gi');
  if (!pattern) return 0;
  return (text.match(pattern) ?? []).length;
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
  /**
   * Only the LENGTH is read — "were any keywords extracted at all" — so the
   * element type is deliberately open: callers hold either the parser's plain
   * strings or the stored keyword rows, and neither should have to be reshaped
   * to ask this question.
   */
  keywords: readonly unknown[];
}): boolean {
  return args.mustBestSimilarities.length === 0 && args.keywords.length === 0;
}

/**
 * The Block D coverage status for one requirement, from the two things that
 * decide it: what the career base returned, and whether the requirement's
 * keyword is in the resume SOURCE the user chose.
 *
 *   covered                        base covers it AND the source resume says so
 *   gap_in_resume_covered_by_base  base covers it, the source resume does not
 *   gap                            the base does not cover it
 *
 * `sourceIsBase` collapses the middle status, and that is not a shortcut: when
 * the career base IS the scan's source, a requirement covered by the base cannot
 * be missing from the source, because they are the same body of text. US-3's
 * "hidden matches" are hidden relative to a DIFFERENT resume; against the base
 * itself there is nothing to hide.
 *
 * Pure and here rather than in the route, because it is rule B1's coverage
 * threshold applied to rule B1a's keyword test — both of which live in this file.
 */
export function coverageStatusFor(args: {
  bestSimilarity: number;
  keyword: string;
  sourceText: string;
  sourceIsBase: boolean;
}): 'covered' | 'gap_in_resume_covered_by_base' | 'gap' {
  const { bestSimilarity, keyword, sourceText, sourceIsBase } = args;
  if (!isCovered(bestSimilarity)) return 'gap';
  if (sourceIsBase) return 'covered';
  /**
   * P1 can return a requirement with an empty `keyword`. There is then nothing
   * to search the resume for, and "covered by your base but missing from your
   * resume" would be a claim about a test that never ran — so the middle status
   * is withheld rather than asserted. The base covered the requirement; that
   * much was measured.
   */
  if (keyword.trim().length === 0) return 'covered';
  return keywordPresent(sourceText, keyword) ? 'covered' : 'gap_in_resume_covered_by_base';
}

/**
 * THE score a screen may render, decided in one place (Block E: "Same rule
 * everywhere a score renders").
 *
 * Three inputs, three ways to end up with no number:
 *   - `matchScore === null` — the parse produced 0 requirements (N4), or the
 *     analysis never ran at all (a draft).
 *   - rule B1b — 0 MUST requirements AND 0 keywords extracted, so the stored 0
 *     means "measured nothing" rather than "measured, scored zero".
 * Everything else is a real number and renders with its band colour.
 *
 * It takes the STORED coverage map, so `/applications` and `/applications/[id]`
 * cannot disagree: the list would otherwise need the vacancy's keyword list to
 * apply B1b and would show a red 0 next to the detail page's "—".
 */
export function renderableScore(application: {
  match_score: number | null;
  coverage: {
    entries: { kind: 'must' | 'nice'; similarity: number }[];
    keywords: unknown[];
  } | null;
}): number | null {
  const { match_score: score, coverage } = application;
  if (score === null || coverage === null) return null;
  const mustBestSimilarities = coverage.entries
    .filter((entry) => entry.kind === 'must')
    .map((entry) => entry.similarity);
  if (insufficientSignal({ mustBestSimilarities, keywords: coverage.keywords })) {
    return null;
  }
  return score;
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
