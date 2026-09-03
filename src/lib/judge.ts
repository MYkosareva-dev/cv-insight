import { keywordPresent } from '@/lib/scoring';

/**
 * The rubric decision (SPEC rules B2/B3, prompt P3), as pure arithmetic.
 *
 * IT ALSO HOLDS THE BASE GATE ON THE REVIEWER'S OWN OUTPUT. P3 reports
 * `missingHonest` as "vacancy keywords supported by the career items and absent
 * from the resume", and a reviewer can be wrong about the first half — the same
 * way the GENERATOR was wrong when it was handed the keyword list. Every term
 * that reaches a user or a prompt under that description is checked against the
 * career base first, with `keywordPresent`, which is the function rule B1's
 * lexical gate already uses. One source of truth for "is this term in the base",
 * never a second opinion.
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
 * Split what the reviewer called "supported by the career items" into what the
 * base LITERALLY CONTAINS and what it does not (SPEC v2.17).
 *
 * WHY THE REVIEWER'S WORD IS NOT ENOUGH. Owner testing on the live app found the
 * judge panel listing Labelbox, Supervisely, MS Office, Google Suite and
 * "annotation tools" under "Supported by your base, missing from the resume",
 * on a screen that said `no mention of "Labelbox"` two blocks above — rule B1's
 * lexical gate having already proved their absence. The page asserted both that
 * the base lacks a term and that the base supports it, and the second assertion
 * told the user to write it into their resume. That is exactly the keyword
 * stuffing this phase removed from P2, arriving through the reviewer instead of
 * the writer.
 *
 * THE CHECK IS `keywordPresent`, the same function `missingLexicalTerm` uses, so
 * the panel and the coverage gate cannot disagree about one term. It inherits
 * rule B1a's boundary rule, including its known limitation: the gate matches
 * FORMS, so a base saying "Microsoft Office" does not satisfy "MS Office"
 * (backlog p3-23). That error direction is the conservative one here — a term
 * wrongly excluded is a suggestion not made, while a term wrongly included is
 * the app telling someone to claim something they have not done.
 */
export function partitionMissingHonest(
  missingHonest: readonly string[],
  baseText: string,
): { supported: string[]; notInBase: string[] } {
  const supported: string[] = [];
  const notInBase: string[] = [];
  for (const raw of missingHonest) {
    const term = raw.trim();
    if (term.length === 0) continue;
    (keywordPresent(baseText, term) ? supported : notInBase).push(term);
  }
  return { supported, notInBase };
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
 * `missingHonest` is GATED ON THE BASE and then constrained in words, and it
 * needs both. Rule B4 lets the generator use a vacancy keyword only where the
 * career items support it, so a list of missing keywords under "fix all of them"
 * is a direct incentive to manufacture that support — the grounding violation B2
 * exists to catch, arriving through the app's own instruction. The words alone
 * were not enough: a reviewer that reports a term the base never mentions is
 * asking for an invention however politely the request is worded, so the term is
 * dropped before the sentence is built. `baseText` is the retrieved career items
 * — the same corpus P2 and P3 were given — so what survives is a keyword the
 * generator can honestly reach for.
 */
export function revisionFindings(report: Rubric, baseText: string): string[] {
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
  const { supported: missing } = partitionMissingHonest(
    report.keywordCoverage.missingHonest,
    baseText,
  );
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
export function needsRevision(report: Rubric, baseText: string): boolean {
  return (
    withComputedVerdict(report).verdict === 'revise' &&
    revisionFindings(report, baseText).length > 0
  );
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
 * adjacent. THIS RELIES ON THE TWO `created_at` VALUES BEING DISTINCT: the pair
 * is compared only when the revision comes back first, so if the two inserts
 * ever shared a timestamp and arrived ai-first, the original would be returned
 * without the comparison. They are separate transactions and `now()` differs
 * between them, which is why this is a stated dependency rather than a defect —
 * but it is a dependency, not the symmetry an earlier version of this comment
 * claimed.
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
