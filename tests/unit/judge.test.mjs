import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { keywordPresent } from '../../src/lib/scoring.ts';
import {
  WEAK_CRITERION_SCORE,
  bestVersion,
  groundingFailed,
  judgeIssueCounts,
  needsRevision,
  openingVersion,
  partitionMissingHonest,
  revisionFindings,
  rubricTotal,
  weakCriteria,
  withComputedVerdict,
} from '../../src/lib/judge.ts';

/**
 * The rubric decision is what stands between a resume the app invented and a
 * resume it wrote from the user's own history, and every way it can be wrong is
 * quiet: an ungrounded draft with a green card still renders, still downloads,
 * and still goes to an employer.
 *
 * The case these tests exist for is the one the architect raised against this
 * phase's plan: the plan distrusted the model's verdict on grounding and BELIEVED
 * it about the scores, which is half a gate. A model that mislabels its own
 * verdict does not do so selectively, so both halves of P3's rule are computed
 * here from the report's own evidence, and `rubric.verdict` is input to nothing.
 */

/**
 * The career base these tests check terms against — deliberately the owner's own
 * case in miniature. It mentions Docker and BPMN; it mentions NONE of Labelbox,
 * Supervisely, MS Office or Google Suite, which are the four terms the live app
 * listed under "Supported by your base, missing from the resume" on a screen
 * that had already proved their absence two blocks above.
 */
const BASE = [
  'AI Prompt Evaluator — Nordlicht Digital',
  'Evaluated and annotated LLM outputs against scoring rubrics. Ran annotation',
  'quality assurance and kept inter-annotator agreement above 0.85.',
  '',
  'Business Analyst — BotWorks Labs',
  'Mapped as-is and to-be processes in BPMN. Built Python pipelines and ran them',
  'in Docker for the weekly quality report.',
].join('\n');

/** A clean report. Each test spoils exactly the field it is about. */
const approved = () => ({
  grounding: { verdict: 'pass', violations: [] },
  keywordCoverage: { score: 4, missingHonest: [] },
  relevance: { score: 5, evidence: 'Nordlicht experience is in the top third.' },
  atsFormat: { score: 5, issues: [] },
  verdict: 'approve',
  feedbackForGenerator: [],
});

describe('rule B2 — grounding is a gate, not a score', () => {
  test('a violation fails grounding even when the model said pass', () => {
    const report = approved();
    report.grounding = {
      verdict: 'pass',
      violations: [{ claim: 'Led a team of 12', issue: 'no career item mentions a team' }],
    };
    assert.equal(groundingFailed(report), true);
  });

  test('a fail verdict with no listed violation still fails', () => {
    const report = approved();
    report.grounding = { verdict: 'fail', violations: [] };
    assert.equal(groundingFailed(report), true);
  });

  test('perfect scores CANNOT compensate for a grounding failure', () => {
    const report = approved();
    report.grounding = {
      verdict: 'fail',
      violations: [{ claim: 'AWS certified', issue: 'not in the career base' }],
    };
    // 5/5/5 on the other three criteria, and the verdict is still revise.
    assert.equal(rubricTotal(report), 14);
    assert.equal(withComputedVerdict(report).verdict, 'revise');
  });
});

describe("P3's other half — any criterion at or below 2", () => {
  test('names the weak criteria', () => {
    const report = approved();
    report.relevance = { score: WEAK_CRITERION_SCORE, evidence: 'generic' };
    report.atsFormat = { score: 1, issues: ['a two-column layout'] };
    assert.deepEqual(weakCriteria(report), ['relevance', 'atsFormat']);
  });

  test('a score of 3 is not weak', () => {
    const report = approved();
    report.keywordCoverage = { score: 3, missingHonest: [] };
    assert.deepEqual(weakCriteria(report), []);
    assert.equal(withComputedVerdict(report).verdict, 'approve');
  });

  test("the model's own verdict is input to NOTHING", () => {
    // It claims approve while a criterion is at 1 — the app must not believe it.
    const optimistic = approved();
    optimistic.atsFormat = { score: 1, issues: ['tables'] };
    optimistic.verdict = 'approve';
    assert.equal(withComputedVerdict(optimistic).verdict, 'revise');

    // And the other direction: it claims revise with nothing wrong.
    const pessimistic = approved();
    pessimistic.verdict = 'revise';
    assert.equal(withComputedVerdict(pessimistic).verdict, 'approve');
  });

  test('the stored report carries the verdict the app acted on', () => {
    const report = approved();
    report.verdict = 'revise';
    // Not the model's word, or the audit trail would disagree with the behaviour.
    assert.equal(withComputedVerdict(report).verdict, 'approve');
  });
});

describe('rule B3 — the revision is fed specific findings, or it does not happen', () => {
  test('a violation becomes a line naming the claim and the reason', () => {
    const report = approved();
    report.grounding = {
      verdict: 'fail',
      violations: [{ claim: 'Managed a 500k budget', issue: 'no item states a budget' }],
    };
    const findings = revisionFindings(report, BASE);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /Managed a 500k budget/);
    assert.match(findings[0], /no item states a budget/);
  });

  test('missingHonest carries rule B4 in words, not a bare keyword list', () => {
    const report = approved();
    // Both are IN the base, so both survive the gate and reach the rewrite.
    report.keywordCoverage = { score: 2, missingHonest: ['Docker', 'BPMN'] };
    const line = revisionFindings(report, BASE).find((f) => f.includes('Docker'));
    assert.ok(line, 'the missing keywords are passed on');
    // "fix all of them" against a bare list is an invitation to manufacture
    // support, which is the grounding violation B2 exists to catch arriving
    // through the app's own instruction.
    assert.match(line, /ONLY where a career item already supports it/);
    assert.match(line, /Inventing support/);
  });

  test('blank feedback lines are dropped rather than passed on as findings', () => {
    const report = approved();
    report.grounding = { verdict: 'fail', violations: [] };
    report.feedbackForGenerator = ['   ', ''];
    assert.deepEqual(revisionFindings(report, BASE), []);
  });

  test('a revise verdict with NO findings does not earn a revision', () => {
    // The reviewer refused the draft and said nothing actionable. Regenerating
    // against that is a metered call carrying no information.
    const report = approved();
    report.grounding = { verdict: 'fail', violations: [] };
    assert.equal(withComputedVerdict(report).verdict, 'revise');
    assert.equal(revisionFindings(report, BASE).length, 0);
    assert.equal(needsRevision(report, BASE), false);
  });

  test('a revise verdict WITH findings earns one', () => {
    const report = approved();
    report.grounding = {
      verdict: 'fail',
      violations: [{ claim: 'PhD', issue: 'not in the base' }],
    };
    assert.equal(needsRevision(report, BASE), true);
  });

  test('an approved report never earns one, however much feedback it carries', () => {
    const report = approved();
    report.feedbackForGenerator = ['could be punchier'];
    assert.equal(needsRevision(report, BASE), false);
  });
});

describe('bestVersion — which draft the editor opens with', () => {
  const grounded = () => ({ judge: approved() });
  const ungrounded = () => {
    const judge = approved();
    judge.grounding = { verdict: 'fail', violations: [{ claim: 'x', issue: 'y' }] };
    return { judge };
  };

  test('grounding decides first and absolutely', () => {
    const original = grounded();
    const revision = ungrounded();
    // The revision scores identically on the other three criteria and still loses.
    assert.equal(bestVersion(original, revision), original);
  });

  test('an ungrounded original loses to a grounded revision', () => {
    const original = ungrounded();
    const revision = grounded();
    assert.equal(bestVersion(original, revision), revision);
  });

  test('when both are grounded, the higher rubric total wins', () => {
    const original = grounded();
    const revision = grounded();
    revision.judge.relevance = { score: 2, evidence: 'buried' };
    assert.equal(bestVersion(original, revision), original);
  });

  test('a tie goes to the revision — it was written with the findings in hand', () => {
    assert.equal(bestVersion(grounded(), grounded()).judge.relevance.score, 5);
    const original = grounded();
    const revision = grounded();
    assert.equal(bestVersion(original, revision), revision);
  });

  test('an unjudged revision never displaces a judged original', () => {
    // `judge: null` means the check did not RUN, which is not evidence of quality.
    const original = grounded();
    assert.equal(bestVersion(original, { judge: null }), original);
  });
});

describe('openingVersion — a reload shows the same draft the response did', () => {
  const row = (source, judge) => ({ source, judge });

  test('with no versions there is nothing to open', () => {
    assert.equal(openingVersion([]), null);
  });

  test("the user's own newest edit wins outright", () => {
    const user = row('user', null);
    assert.equal(openingVersion([user, row('ai_revision', approved()), row('ai', approved())]), user);
  });

  test('a lone AI draft is the one', () => {
    const ai = row('ai', approved());
    assert.equal(openingVersion([ai]), ai);
  });

  test('a revision pair is compared, so the ORIGINAL can win the reload too', () => {
    const weak = approved();
    weak.grounding = { verdict: 'fail', violations: [{ claim: 'x', issue: 'y' }] };
    const original = row('ai', approved());
    const revision = row('ai_revision', weak);
    // Newest first: the revision, then the original it was written from.
    assert.equal(openingVersion([revision, original]), original);
  });

  test('an ai_revision with no paired original falls back to itself', () => {
    const revision = row('ai_revision', approved());
    assert.equal(openingVersion([revision]), revision);
  });
});

describe('judgeIssueCounts — the two Block E bars the judge owns', () => {
  test('no report is null, NOT zero: the check has not happened', () => {
    // An "0 issues" bar for a review nobody performed is the same defect rule
    // B1b prevents for a score with no signal.
    assert.deepEqual(judgeIssueCounts(null), { atsFormat: null, quality: null });
  });

  test('a clean report counts zero issues', () => {
    assert.deepEqual(judgeIssueCounts(approved()), { atsFormat: 0, quality: 0 });
  });

  test('quality counts grounding violations and weak criteria together', () => {
    const report = approved();
    report.grounding = {
      verdict: 'fail',
      violations: [{ claim: 'a', issue: 'b' }, { claim: 'c', issue: 'd' }],
    };
    report.relevance = { score: 1, evidence: 'generic' };
    report.atsFormat = { score: 4, issues: ['inconsistent dates'] };
    assert.deepEqual(judgeIssueCounts(report), { atsFormat: 1, quality: 3 });
  });
});

describe('partitionMissingHonest — the base is the only source of truth', () => {
  /**
   * THE INVARIANT THIS FILE EXISTS FOR, from owner testing on the live app.
   *
   * The judge panel listed Labelbox, Supervisely, MS Office, Google Suite and
   * "annotation tools" under "Supported by your base, missing from the resume",
   * on a screen where rule B1's lexical gate had already rendered
   * `no mention of "Labelbox"` two blocks above. The page asserted both that the
   * base lacks a term and that the base supports it — and the second assertion
   * told the user to write it into their resume, which is the keyword stuffing
   * this phase removed from P2 arriving through the reviewer instead.
   */
  test('NO term under the supported-by-base header may fail the base literal check', () => {
    const claimed = [
      'data entry',
      'spreadsheets',
      'Labelbox',
      'Supervisely',
      'MS Office',
      'Google Suite',
      'annotation tools',
      'BPMN',
      'Docker',
    ];
    const { supported, notInBase } = partitionMissingHonest(claimed, BASE);

    // The invariant, stated as the property and not as a list of expected terms:
    // whatever survives must pass the SAME check the coverage gate applies.
    for (const term of supported) {
      assert.ok(
        keywordPresent(BASE, term),
        `"${term}" is offered as supported by the base and is not in it`,
      );
    }
    // Nothing is silently dropped: every claimed term lands on exactly one side.
    assert.equal(supported.length + notInBase.length, claimed.length);

    // And the four the owner actually saw are on the honest side of the split.
    for (const absent of ['Labelbox', 'Supervisely', 'MS Office', 'Google Suite']) {
      assert.ok(notInBase.includes(absent), `${absent} must not be offered`);
    }
  });

  test('it uses rule B1a boundaries, so the panel and the coverage gate agree', () => {
    // `keywordPresent` is the same function `missingLexicalTerm` calls. A second
    // implementation here would be a second opinion about one question.
    const { supported } = partitionMissingHonest(['bpmn', 'DOCKER'], BASE);
    assert.deepEqual(supported, ['bpmn', 'DOCKER'], 'the check is case-insensitive');

    const { notInBase } = partitionMissingHonest(['ocker'], BASE);
    assert.deepEqual(notInBase, ['ocker'], 'a substring is not a match');
  });

  test('blank terms are dropped from both sides rather than rendered', () => {
    const { supported, notInBase } = partitionMissingHonest(['  ', ''], BASE);
    assert.deepEqual(supported, []);
    assert.deepEqual(notInBase, []);
  });

  test('an empty base supports nothing — never everything', () => {
    const { supported, notInBase } = partitionMissingHonest(['Docker'], '');
    assert.deepEqual(supported, []);
    assert.deepEqual(notInBase, ['Docker']);
  });

  test('the REVISION prompt is bound by the same gate as the panel', () => {
    // The panel was the visible half. The other half is that `missingHonest`
    // feeds a paid rewrite: telling the generator a term is "supported by the
    // career items" when the base never mentions it is asking for an invention,
    // however carefully the surrounding sentence is worded.
    const report = approved();
    report.grounding = { verdict: 'fail', violations: [{ claim: 'x', issue: 'y' }] };
    report.keywordCoverage = { score: 2, missingHonest: ['Labelbox', 'Docker'] };

    const line = revisionFindings(report, BASE).find((f) => f.includes('vacancy keywords'));
    assert.ok(line, 'the supported keyword still reaches the rewrite');
    assert.match(line, /Docker/);
    assert.ok(!line.includes('Labelbox'), 'a term the base never mentions must not be asked for');
  });

  test('a report whose ONLY finding is an unsupported keyword earns no revision', () => {
    // Nothing actionable survives the gate, so the rewrite would be a paid call
    // carrying no information — the same rule as a reviewer that gives no reason.
    const report = approved();
    report.grounding = { verdict: 'fail', violations: [] };
    report.keywordCoverage = { score: 2, missingHonest: ['Labelbox'] };
    assert.equal(withComputedVerdict(report).verdict, 'revise');
    assert.equal(revisionFindings(report, BASE).length, 0);
    assert.equal(needsRevision(report, BASE), false);
  });
});
