/**
 * The rubric decision (SPEC rules B2/B3, prompt P3), as pure arithmetic.
 *
 * NOT `server-only`, for the same reason as `lib/budget.ts` and `lib/pricing.ts`:
 * this is where "the generated resume is acceptable" is decided, and a decision
 * that gates a paid revision and a user-visible verdict has to be testable
 * without a browser or a network. `tests/unit/judge.test.mjs` loads it.
 *
 * THE MODEL'S OWN `verdict` FIELD IS INPUT TO NOTHING. P3 defines the verdict as
 * "revise if grounding fails OR any criterion <= 2", and this file computes both
 * halves from the report's own evidence. Trusting the field would make the rule
 * an instruction in a prompt rather than arithmetic in code — and a model that
 * mislabels its own verdict does not do so selectively, so distrusting it on
 * grounding while believing it about the scores is half a gate.
 */

/** P3's response, after Zod. Structurally identical to `JudgeReport` in lib/db/types.ts. */
export type Rubric = {
  grounding: { verdict: 'pass' | 'fail'; violations: { claim: string; issue: string }[] };
  keywordCoverage: { score: number; missingHonest: string[] };
  relevance: { score: number; evidence: string };
  atsFormat: { score: number; issues: string[] };
  verdict: 'approve' | 'revise';
  feedbackForGenerator: string[];
};

/** A criterion at or below this is a failure in its own right (P3). */
export const WEAK_CRITERION_SCORE = 2;

/**
 * RULE B2 — the grounding GATE. A claim with no career item behind it is a
 * failure that nothing else can compensate for, however high the other three
 * criteria scored.
 *
 * Two signals, either one is enough: the model said `fail`, or it listed a
 * violation. They can disagree, and when they do the answer is still "fail" —
 * both readings say the reviewer found something, and the conservative direction
 * on a grounding question is the only defensible one.
 */
export function groundingFailed(report: Rubric): boolean {
  return report.grounding.verdict === 'fail' || report.grounding.violations.length > 0;
}

/** The criteria that scored at or below `WEAK_CRITERION_SCORE` (P3's other half). */
export function weakCriteria(report: Rubric): string[] {
  const weak: string[] = [];
  if (report.keywordCoverage.score <= WEAK_CRITERION_SCORE) weak.push('keywordCoverage');
  if (report.relevance.score <= WEAK_CRITERION_SCORE) weak.push('relevance');
  if (report.atsFormat.score <= WEAK_CRITERION_SCORE) weak.push('atsFormat');
  return weak;
}

/**
 * THE verdict, computed rather than read (P3, rules B2/B3).
 *
 * Returned as a fresh report so the row written to `resume_versions` carries the
 * verdict the app acted on. Storing the model's own word beside a different
 * decision would leave the audit trail disagreeing with the behaviour.
 */
export function withComputedVerdict(report: Rubric): Rubric {
  const verdict = groundingFailed(report) || weakCriteria(report).length > 0 ? 'revise' : 'approve';
  return { ...report, verdict };
}

/**
 * The specific findings a revision would be given, as lines.
 *
 * EMPTY MEANS NO REVISION. Rule B3 allows one regenerate; it does not require
 * one, and a second Sonnet call carrying "a reviewer found these issues" with no
 * issues after it is a metered call bought with no information. CLAUDE.md's
 * metered rule makes that indefensible, so the pipeline skips it and the card
 * says the reviewer flagged the draft without saying why.
 *
 * `missingHonest` is included and CONSTRAINED IN WORDS by the caller
 * (`revisionFeedbackBlock`), never listed bare: rule B4 lets the generator use a
 * vacancy keyword only where the career items support it, and a list of missing
 * keywords under "fix all of them" is a direct incentive to manufacture that
 * support — which is the grounding violation B2 exists to catch, arriving
 * through the app's own instruction.
 */
export function revisionFindings(report: Rubric): string[] {
  const lines: string[] = [];
  for (const violation of report.grounding.violations) {
    lines.push(
      `Unsupported claim: "${violation.claim}" — ${violation.issue}. Remove it or restate it as the career items actually say it.`,
    );
  }
  for (const note of report.feedbackForGenerator) {
    const trimmed = note.trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }
  for (const issue of report.atsFormat.issues) {
    const trimmed = issue.trim();
    if (trimmed.length > 0) lines.push(`ATS format: ${trimmed}`);
  }
  const missing = report.keywordCoverage.missingHonest.map((k) => k.trim()).filter(Boolean);
  if (missing.length > 0) {
    lines.push(
      `These vacancy keywords are supported by the career items but absent from the resume: ${missing.join(', ')}. ` +
        'Add each one ONLY where a career item already supports it, using that item\'s own facts; where no item supports it, leave it out. ' +
        'Inventing support for a keyword is a worse failure than a missing keyword.',
    );
  }
  return lines;
}

/**
 * Does this report earn a revision, and can one be written?
 *
 * BOTH halves are required. A `revise` verdict with no findings is a reviewer
 * refusing the draft and declining to say why; regenerating against that is the
 * generic "try again" the rules forbid.
 */
export function needsRevision(report: Rubric): boolean {
  return withComputedVerdict(report).verdict === 'revise' && revisionFindings(report).length > 0;
}

/** The three rubric criteria, summed. Used only to compare two versions. */
export function rubricTotal(report: Rubric): number {
  return report.keywordCoverage.score + report.relevance.score + report.atsFormat.score;
}

/**
 * Which of the two drafts the editor opens with when the revision did NOT fix
 * things (SPEC Block D #5: "return the best version anyway with its honest judge
 * card").
 *
 * Grounding first and absolutely — an ungrounded resume with perfect formatting
 * is worse than a grounded one with a weak summary, which is the same asymmetry
 * rule B2 encodes. Only then the rubric total. A tie goes to the REVISION,
 * because it is the draft that was written with the reviewer's findings in hand.
 *
 * Both drafts are rows in `resume_versions` either way; this decides only which
 * one is returned and shown first.
 */
export function bestVersion<T extends { judge: Rubric | null }>(original: T, revision: T): T {
  if (!revision.judge) return original;
  if (!original.judge) return revision;
  const originalGrounded = !groundingFailed(original.judge);
  const revisionGrounded = !groundingFailed(revision.judge);
  if (originalGrounded !== revisionGrounded) return originalGrounded ? original : revision;
  return rubricTotal(revision.judge) >= rubricTotal(original.judge) ? revision : original;
}

/**
 * Which stored version the editor OPENS with, given the rows newest-first.
 *
 * It exists so that a reload shows the same draft the generate response did. The
 * newest row is not the answer: a run that revised inserts `ai` then
 * `ai_revision`, and `bestVersion` may well choose the ORIGINAL — so reading
 * "the latest version" would swap the text under the user between the response
 * and their next visit, with the judge card still describing the other one.
 *
 * The user's own edit wins outright when it is the newest row. It is the only
 * version they wrote, it is what they last saw, and no rubric comparison applies
 * to it — [Check quality] and the export are the two ways it gets there, and
 * both are deliberate acts.
 *
 * Ordering is by `created_at desc`, so the `ai_revision`/`ai` pair of one run are
 * adjacent. Two inserts in the same run could in principle share a timestamp and
 * come back in either order; the pair is then compared the same way whichever way
 * round it arrives, because `bestVersion` is symmetric on grounding and breaks a
 * rubric tie toward the revision.
 */
export function openingVersion<T extends { source: 'ai' | 'ai_revision' | 'user'; judge: Rubric | null }>(
  versionsNewestFirst: readonly T[],
): T | null {
  const newest = versionsNewestFirst[0];
  if (!newest) return null;
  if (newest.source !== 'ai_revision') return newest;
  const previous = versionsNewestFirst[1];
  if (!previous || previous.source !== 'ai') return newest;
  return bestVersion(previous, newest);
}

/**
 * The two Block E category bars the judge owns, as issue counts.
 *
 * `null` is the THIRD state and is not a zero: no judge report means the check
 * has not happened, and an "0 issues" bar there would be a measurement nobody
 * took — the same defect rule B1b prevents for a score with no signal. A version
 * saved by the export path carries `judge: null` and must keep reading
 * "Not checked yet".
 */
export function judgeIssueCounts(report: Rubric | null): {
  atsFormat: number | null;
  quality: number | null;
} {
  if (!report) return { atsFormat: null, quality: null };
  return {
    atsFormat: report.atsFormat.issues.length,
    quality: report.grounding.violations.length + weakCriteria(report).length,
  };
}
