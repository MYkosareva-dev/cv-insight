import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  SMALL_SAMPLE,
  classifyRuns,
  formatUsdFromMicro,
  rubricDistribution,
  rubricOutcomes,
  share,
  summariseCalls,
} from '../../src/lib/quality.ts';

/**
 * The /quality dashboard is the product's own evidence that quality is MEASURED
 * rather than asserted, which makes untested arithmetic behind it a
 * contradiction: a screen nobody checked, claiming the app checks things.
 *
 * What these cases pin is not the formatting but the two properties the screen
 * is built on:
 *   1. every figure is traceable — a share carries its own denominator, and a
 *      cost is a sum over rows the caller can point at;
 *   2. nothing is invented — no zero where nothing was measured, no state folded
 *      into a neighbouring one, and no percentage off a sample too thin to
 *      support it.
 */

const call = (over = {}) => ({
  step: 'generate',
  model: 'anthropic/claude-sonnet-4.6',
  fallback_used: false,
  ok: true,
  tokens_in: 1_000,
  tokens_out: 500,
  cost_usd_micro: 10_500,
  cost_known: true,
  latency_ms: 4_000,
  application_id: 'app-1',
  created_at: '2026-09-04T10:00:00Z',
  ...over,
});

describe('share — a rate never leaves its denominator behind', () => {
  test('carries the count and the total, not only the percentage', () => {
    assert.deepEqual(share(1, 4), { count: 1, of: 4, percent: 25, thin: true });
  });

  test('a percentage of NOTHING is null, never 0', () => {
    // A "0%" with no observations behind it is a measurement nobody took — the
    // same defect rule B1b prevents for a score with no signal.
    assert.equal(share(0, 0).percent, null);
  });

  test('a sample of NOTHING is not a THIN sample', () => {
    // "Too few runs to read as a rate" is a statement about observations, and
    // there are none to be too few of. `of === 0` has its own rendering.
    assert.equal(share(0, 0).thin, false);
  });

  test('marks a sample too thin to read as a rate', () => {
    assert.equal(share(1, SMALL_SAMPLE - 1).thin, true);
    assert.equal(share(1, SMALL_SAMPLE).thin, false);
  });
});

describe('summariseCalls — every cost is a sum over named rows', () => {
  test('an empty log measures nothing and divides by nothing', () => {
    const summary = summariseCalls([]);
    assert.equal(summary.calls, 0);
    assert.equal(summary.totalCostMicro, 0);
    assert.equal(summary.applicationsWithCalls, 0);
    // Not 0: there is nothing to divide by, and a $0.0000 per-application cost
    // would be a figure about applications that do not exist.
    assert.equal(summary.costPerApplicationMicro, null);
    assert.equal(summary.fallbackShare.percent, null);
  });

  test('the total is the sum of cost_usd_micro over the rows read', () => {
    const summary = summariseCalls([
      call({ cost_usd_micro: 10_000 }),
      call({ cost_usd_micro: 430 }),
    ]);
    assert.equal(summary.totalCostMicro, 10_430);
    assert.equal(summary.calls, 2);
  });

  test('the denominator is distinct APPLICATION ids, and is named for that', () => {
    /**
     * NOT "runs". Since [Regenerate] one application can hold several AI runs,
     * so a cost divided by applications is not the cost of one generation — and
     * two quantities under one word was the defect on a screen whose one rule is
     * traceability. An `llm_calls` row can be attributed to an application and
     * cannot name a `resume_versions` run, so the name follows the arithmetic.
     */
    const summary = summariseCalls([
      call({ application_id: 'app-1', cost_usd_micro: 1_000 }),
      call({ application_id: 'app-1', cost_usd_micro: 3_000 }),
      call({ application_id: 'app-2', cost_usd_micro: 2_000 }),
    ]);
    assert.equal(summary.applicationsWithCalls, 2);
    assert.equal(summary.attributableCostMicro, 6_000);
    assert.equal(summary.costPerApplicationMicro, 3_000);
  });

  test('cost with NO application id is stated apart, never averaged into a run', () => {
    /**
     * An `import_resume` call and a career-item indexing embed carry no
     * application: they are the cost of building the base, not of any one
     * pipeline run. Blending them into a per-run figure would charge a run for
     * work done before it existed.
     */
    const summary = summariseCalls([
      call({ application_id: 'app-1', cost_usd_micro: 4_000 }),
      call({ step: 'import_resume', application_id: null, cost_usd_micro: 9_000 }),
    ]);
    assert.equal(summary.applicationsWithCalls, 1);
    assert.equal(summary.attributableCostMicro, 4_000);
    assert.equal(summary.unattributedCostMicro, 9_000);
    assert.equal(
      summary.costPerApplicationMicro,
      4_000,
      'the import is not in the per-application figure',
    );
    assert.equal(summary.totalCostMicro, 13_000, 'but it IS in the total — it was really spent');
  });

  test('an unpriced call is counted as unknown, not as free', () => {
    // `cost_known = false` means the serving model had no price entry: the row is
    // written with 0, and the screen has to say so or the total reports an
    // unknown spend as nothing.
    const summary = summariseCalls([call({ cost_known: false, cost_usd_micro: 0 })]);
    assert.equal(summary.unknownPricingCalls, 1);
    assert.equal(summary.totalCostMicro, 0);
  });

  test('fallback and failed rows are counted, because both were billed', () => {
    const summary = summariseCalls([
      call({ fallback_used: true }),
      call({ ok: false }),
      call(),
    ]);
    assert.equal(summary.fallbackCalls, 1);
    assert.equal(summary.failedCalls, 1);
    assert.deepEqual(summary.fallbackShare, { count: 1, of: 3, percent: 33, thin: true });
  });

  test('the per-step table sums the same rows, grouped by step', () => {
    const summary = summariseCalls([
      call({ step: 'generate', cost_usd_micro: 10_000, latency_ms: 20_000 }),
      call({ step: 'generate', cost_usd_micro: 12_000, latency_ms: 30_000 }),
      call({ step: 'judge', cost_usd_micro: 900, latency_ms: 5_000, ok: false }),
    ]);
    const [generate, judge] = summary.byStep;
    // Most-used step first, so the table reads as a pipeline profile.
    assert.equal(generate.step, 'generate');
    assert.equal(generate.calls, 2);
    assert.equal(generate.costUsdMicro, 22_000);
    assert.equal(generate.meanLatencyMs, 25_000);
    assert.equal(judge.failed, 1);
    // The step sums add back up to the total: nothing is double-counted and
    // nothing is dropped.
    assert.equal(
      summary.byStep.reduce((sum, step) => sum + step.costUsdMicro, 0),
      summary.totalCostMicro,
    );
  });

  test('the step order is stable for one set of rows', () => {
    // Two renders of the same data must not reorder the table; the name breaks
    // the tie on call count.
    const rows = [call({ step: 'judge' }), call({ step: 'embed' })];
    assert.deepEqual(
      summariseCalls(rows).byStep.map((s) => s.step),
      summariseCalls([...rows].reverse()).byStep.map((s) => s.step),
    );
  });
});

// ---------------------------------------------------------------------------
// The rubric outcome of each run
// ---------------------------------------------------------------------------

const report = (over = {}) => ({
  grounding: { verdict: 'pass', ...(over.grounding ?? {}) },
  keywordCoverage: { score: over.keywordCoverage ?? 4 },
  relevance: { score: over.relevance ?? 5 },
  atsFormat: { score: over.atsFormat ?? 5 },
  verdict: over.verdict ?? 'approve',
});

let clock = 0;
/** Distinct, increasing timestamps — the pipeline's own two inserts differ. */
const at = () => new Date(Date.UTC(2026, 8, 4, 10, 0, (clock += 1))).toISOString();

const version = (over = {}) => ({
  id: `v-${clock}-${Math.random().toString(36).slice(2, 7)}`,
  application_id: 'app-1',
  source: 'ai',
  judge: report(),
  created_at: at(),
  ...over,
});

describe('classifyRuns — a run is one ai row plus its own rewrite', () => {
  test('an approved first draft is one run, approved first', () => {
    assert.deepEqual(classifyRuns([version()]), ['approved_first']);
  });

  test('a draft plus its revision is ONE run, not two', () => {
    const draft = version({ judge: report({ verdict: 'revise' }) });
    const revision = version({ source: 'ai_revision' });
    assert.deepEqual(classifyRuns([draft, revision]), ['revised_approved']);
  });

  test('a rewrite that was still refused is its own outcome', () => {
    const draft = version({ judge: report({ verdict: 'revise' }) });
    const revision = version({ source: 'ai_revision', judge: report({ verdict: 'revise' }) });
    assert.deepEqual(classifyRuns([draft, revision]), ['revised_still_revise']);
  });

  test('a refusal with NO rewrite is not a failed rewrite', () => {
    /**
     * SPEC v2.16 notes 7 and 13: the reviewer listed nothing specific to act on,
     * or the cap or the service refused the rewrite step. Folding this into
     * "still failed after the rewrite" would report a rewrite that never ran.
     */
    assert.deepEqual(classifyRuns([version({ judge: report({ verdict: 'revise' }) })]), [
      'revise_no_rewrite',
    ]);
  });

  test('judge null is NOT CHECKED — never a pass and never a failure', () => {
    assert.deepEqual(classifyRuns([version({ judge: null })]), ['not_checked']);
  });

  test('a revision nobody judged makes the RUN not checked', () => {
    // The rewrite ran and the second judge step was refused, so nobody measured
    // the text that was kept.
    const draft = version({ judge: report({ verdict: 'revise' }) });
    const revision = version({ source: 'ai_revision', judge: null });
    assert.deepEqual(classifyRuns([draft, revision]), ['not_checked']);
  });

  test('a REGENERATE on the same application is a second run', () => {
    // The whole reason an application is not the unit: v2.20 lets one application
    // hold several ai rows, and grouping by application would merge two runs
    // into one verdict.
    const first = version();
    const second = version({ judge: report({ verdict: 'revise' }) });
    assert.deepEqual(classifyRuns([first, second]), ['approved_first', 'revise_no_rewrite']);
  });

  test('user rows are not AI runs and are excluded', () => {
    // A [Check quality] on the user's own edit is a verdict, not a generate run.
    assert.deepEqual(classifyRuns([version({ source: 'user' })]), []);
  });

  test('rows arriving newest first are classified the same way', () => {
    // The DAL returns newest first; the pairing rule needs oldest first, and
    // doing that inside the function is what makes the caller's order irrelevant.
    const draft = version({ judge: report({ verdict: 'revise' }) });
    const revision = version({ source: 'ai_revision' });
    assert.deepEqual(classifyRuns([revision, draft]), ['revised_approved']);
  });

  test('an ORPHAN rewrite is still a run, judged by the verdict that was kept', () => {
    /**
     * Reachable at the WINDOW BOUNDARY: the read is newest-first, so truncation
     * cuts the oldest rows and can take a draft while leaving its rewrite. The
     * first version of `classifyRuns` only started a run at an `ai` row, so that
     * run vanished from all five buckets — while the same row went on being
     * counted in `rubricDistribution`, leaving two denominators disagreeing with
     * nothing on screen to say a row had been dropped.
     */
    const orphan = version({ source: 'ai_revision' });
    assert.deepEqual(classifyRuns([orphan]), ['revised_approved']);

    const refused = version({ source: 'ai_revision', judge: report({ verdict: 'revise' }) });
    assert.deepEqual(classifyRuns([refused]), ['revised_still_revise']);

    const unjudged = version({ source: 'ai_revision', judge: null });
    assert.deepEqual(classifyRuns([unjudged]), ['not_checked']);
  });

  test('a rewrite that HAS its draft is not counted twice', () => {
    // The orphan branch must not fire for a revision whose `ai` row is present,
    // or one run would be reported as two.
    const draft = version({ judge: report({ verdict: 'revise' }) });
    const revision = version({ source: 'ai_revision' });
    assert.equal(classifyRuns([draft, revision]).length, 1);
  });

  test('two applications are two runs, and neither borrows the other rewrite', () => {
    const a = version({ application_id: 'app-a', judge: report({ verdict: 'revise' }) });
    const b = version({ application_id: 'app-b' });
    const outcomes = classifyRuns([a, b]);
    assert.equal(outcomes.length, 2);
    assert.ok(outcomes.includes('revise_no_rewrite'));
    assert.ok(outcomes.includes('approved_first'));
  });
});

describe('rubricOutcomes — the shares the screen shows', () => {
  test('every run lands in exactly one bucket', () => {
    const outcomes = rubricOutcomes([
      version(),
      version({ application_id: 'app-b', judge: null }),
      version({ application_id: 'app-c', judge: report({ verdict: 'revise' }) }),
    ]);
    assert.equal(outcomes.runs, 3);
    const total =
      outcomes.approvedFirst.count +
      outcomes.revisedApproved.count +
      outcomes.revisedStillRevise.count +
      outcomes.reviseNoRewrite.count +
      outcomes.notChecked.count;
    assert.equal(total, outcomes.runs, 'the five buckets partition the runs');
  });

  test('with no runs every share is null rather than 0%', () => {
    const outcomes = rubricOutcomes([]);
    assert.equal(outcomes.runs, 0);
    for (const key of [
      'approvedFirst',
      'revisedApproved',
      'revisedStillRevise',
      'reviseNoRewrite',
      'notChecked',
    ]) {
      assert.equal(outcomes[key].percent, null, key);
    }
  });

  test('a single run is reported as thin', () => {
    // "100% first-attempt pass rate" off one run is a coincidence with a percent
    // sign on it.
    assert.equal(rubricOutcomes([version()]).approvedFirst.thin, true);
  });
});

describe('rubricDistribution — the scores, per criterion', () => {
  test('counts each 1-5 score against its criterion', () => {
    const distribution = rubricDistribution([
      version({ judge: report({ keywordCoverage: 3, relevance: 5, atsFormat: 4 }) }),
      version({ judge: report({ keywordCoverage: 3, relevance: 4, atsFormat: 4 }) }),
    ]);
    const keywords = distribution.criteria.find((c) => c.criterion === 'keywordCoverage');
    assert.deepEqual(keywords.counts, [0, 0, 2, 0, 0]);
    assert.equal(keywords.judged, 2);
    assert.equal(keywords.mean, 3);
    const relevance = distribution.criteria.find((c) => c.criterion === 'relevance');
    assert.deepEqual(relevance.counts, [0, 0, 0, 1, 1]);
    assert.equal(relevance.mean, 4.5);
  });

  test('unjudged versions are excluded from the denominator, not counted as 0', () => {
    const distribution = rubricDistribution([version(), version({ judge: null })]);
    assert.equal(distribution.judged, 1);
    for (const entry of distribution.criteria) {
      assert.equal(
        entry.counts.reduce((a, b) => a + b, 0),
        1,
        entry.criterion,
      );
    }
  });

  test('nothing judged means no mean at all', () => {
    const distribution = rubricDistribution([version({ judge: null })]);
    assert.equal(distribution.judged, 0);
    for (const entry of distribution.criteria) assert.equal(entry.mean, null);
  });

  test('grounding is TALLIED and never averaged — it is a gate, not a score', () => {
    const distribution = rubricDistribution([
      version({ judge: report({ grounding: { verdict: 'fail' }, verdict: 'revise' }) }),
      version(),
      version(),
    ]);
    assert.deepEqual(distribution.grounding, { pass: 2, fail: 1, judged: 3 });
    assert.equal(
      distribution.criteria.some((c) => c.criterion === 'grounding'),
      false,
      'grounding has no mean row',
    );
  });

  test('it counts the user own [Check quality] verdicts too', () => {
    // Deliberately a WIDER denominator than the run shares: this is the
    // distribution of what the reviewer said, and it said it about those as well.
    const distribution = rubricDistribution([version({ source: 'user' })]);
    assert.equal(distribution.judged, 1);
  });

  test('a score outside 1-5 is clamped into the table rather than dropped', () => {
    // `judgeReportSchema` bounds it before anything is stored, so this is a
    // defence against a row written by an older schema — and a row that fell
    // out of the histogram would silently change the denominator.
    const distribution = rubricDistribution([
      version({ judge: report({ keywordCoverage: 9 }) }),
      version({ judge: report({ keywordCoverage: 0 }) }),
    ]);
    const keywords = distribution.criteria.find((c) => c.criterion === 'keywordCoverage');
    assert.deepEqual(keywords.counts, [1, 0, 0, 0, 1]);
    assert.equal(
      keywords.counts.reduce((a, b) => a + b, 0),
      keywords.judged,
    );
  });
});

describe('formatUsdFromMicro', () => {
  test('four decimals, because the sums here are small', () => {
    // A Haiku parse costs a few hundred micro-USD. "$0.00" for a real spend is
    // the same failure `cost_known` exists to prevent one layer down.
    assert.equal(formatUsdFromMicro(430), '$0.0004');
    assert.equal(formatUsdFromMicro(43_100), '$0.0431');
    assert.equal(formatUsdFromMicro(0), '$0.0000');
  });

  test('a large total still reads correctly', () => {
    assert.equal(formatUsdFromMicro(12_500_000), '$12.5000');
  });
});
