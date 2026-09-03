import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  COVERAGE_THRESHOLD,
  SIMILARITY_FLOOR,
  SIMILARITY_SPAN,
  coverageStatusFor,
  insufficientSignal,
  isCovered,
  keywordCount,
  keywordPresent,
  keywordShare,
  literalKeywords,
  matchScore,
  normalizeSimilarity,
  renderableScore,
  scoreBand,
} from '../../src/lib/scoring.ts';

/**
 * Zero-dependency unit tests: `node:test` + `node:assert` ship with Node, and
 * Node 24 strips the types off the imported .ts on the fly. Playwright and the
 * e2e suite are Phase 7; these cover the two pieces of rule B1 arithmetic that
 * a reviewer cannot check by reading, and that SPEC B1a claims are "verified".
 *
 * `src/lib/scoring.ts` is importable here precisely because it is pure and has
 * no `server-only` guard.
 */

describe('keywordPresent — B1a word boundary', () => {
  test('a word-character keyword matches only as a whole token', () => {
    assert.equal(keywordPresent('I used Docker daily', 'Docker'), true);
    assert.equal(keywordPresent('dockerfile only', 'Docker'), false);
    assert.equal(keywordPresent('I used Docker daily', 'dock'), false);
  });

  test('symbol-terminated keywords still match — the B1a case', () => {
    // A literal \bC\+\+\b is unsatisfiable, so these are exactly the keywords
    // a naive boundary would silently score as absent.
    assert.equal(keywordPresent('Built services in C++ and Go', 'C++'), true);
    assert.equal(keywordPresent('Backend in C#', 'C#'), true);
    assert.equal(keywordPresent('Shipped on .NET 8', '.NET'), true);
  });

  test('the boundary survives on the side that has a word character', () => {
    assert.equal(keywordPresent('scored ABC++ here', 'C++'), false);
    assert.equal(keywordPresent('JavaScript everywhere', 'Java'), false);
  });

  test('is case-insensitive and escapes regex metacharacters', () => {
    assert.equal(keywordPresent('we use DOCKER', 'docker'), true);
    assert.equal(keywordPresent('a.b', 'a.b'), true);
    assert.equal(keywordPresent('axb', 'a.b'), false, '. must not act as any-char');
  });

  test('an empty or whitespace keyword never matches', () => {
    assert.equal(keywordPresent('anything', ''), false);
    assert.equal(keywordPresent('anything', '   '), false);
  });
});

describe('matchScore — B1 branches', () => {
  const resumeText = 'LLM evaluation and Docker in production';

  test('0 requirements total returns null — the only "—" case (N4)', () => {
    assert.equal(
      matchScore({ requirementCount: 0, mustBestSimilarities: [], resumeText, keywords: [] }),
      null,
    );
    // Still null even when keywords would otherwise score.
    assert.equal(
      matchScore({
        requirementCount: 0,
        mustBestSimilarities: [],
        resumeText,
        keywords: ['Docker'],
      }),
      null,
    );
  });

  test('requirements but 0 MUST drops S and scores round(100 x K)', () => {
    // 1 of 2 keywords present → K = 0.5 → 50, NOT null and NOT weighted by 0.4.
    assert.equal(
      matchScore({
        requirementCount: 3,
        mustBestSimilarities: [],
        resumeText,
        keywords: ['Docker', 'Kubernetes'],
      }),
      50,
    );
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: [],
        resumeText,
        keywords: ['Docker'],
      }),
      100,
    );
  });

  test('with MUST requirements it is round(100 x (0.6 S + 0.4 K))', () => {
    // S = clamp((0.85 - 0.30) / 0.55) = 1; K = 1 → 100.
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: [0.85],
        resumeText,
        keywords: ['Docker'],
      }),
      100,
    );
    // S = 1, K = 0 → 60.
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: [0.85],
        resumeText,
        keywords: ['Kubernetes'],
      }),
      60,
    );
    // Similarity at or below the 0.30 floor contributes nothing.
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: [0.2],
        resumeText,
        keywords: ['Kubernetes'],
      }),
      0,
    );
  });
});

describe('insufficientSignal — B1b', () => {
  test('true only when there is neither a MUST requirement nor a keyword', () => {
    assert.equal(insufficientSignal({ mustBestSimilarities: [], keywords: [] }), true);
    assert.equal(insufficientSignal({ mustBestSimilarities: [], keywords: ['Docker'] }), false);
    assert.equal(insufficientSignal({ mustBestSimilarities: [0.7], keywords: [] }), false);
    assert.equal(insufficientSignal({ mustBestSimilarities: [0.7], keywords: ['Docker'] }), false);
  });

  test('marks the exact case where matchScore returns a meaningless 0', () => {
    const args = { requirementCount: 2, mustBestSimilarities: [], resumeText: 'x', keywords: [] };
    assert.equal(matchScore(args), 0, 'the stored score stays a number per B1b');
    assert.equal(
      insufficientSignal(args),
      true,
      'and the UI must render NO_SCORE rather than that 0',
    );
  });
});

describe('keywordShare and scoreBand', () => {
  test('keywordShare is the fraction of keywords present', () => {
    assert.equal(keywordShare('Docker and Python', ['Docker', 'Python']), 1);
    assert.equal(keywordShare('Docker only', ['Docker', 'Python']), 0.5);
    assert.equal(keywordShare('neither', ['Docker', 'Python']), 0);
    assert.equal(keywordShare('anything', []), 0, 'empty keyword list is 0 by B1');
  });

  test('score bands follow the Block E colour rule', () => {
    assert.equal(scoreBand(0), 'low');
    assert.equal(scoreBand(39), 'low');
    assert.equal(scoreBand(40), 'mid');
    assert.equal(scoreBand(69), 'mid');
    assert.equal(scoreBand(70), 'high');
    assert.equal(scoreBand(100), 'high');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: the keyword COUNTS, the coverage status, and the one render rule
// ---------------------------------------------------------------------------

describe('keywordCount — the Block E keywords table', () => {
  test('counts occurrences under the same B1a boundary as keywordPresent', () => {
    assert.equal(keywordCount('Docker, then more Docker, then dockerfile', 'Docker'), 2);
    assert.equal(keywordCount('Shipped on .NET and .NET 8', '.NET'), 2);
    assert.equal(keywordCount('nothing here', 'Docker'), 0);
  });

  test('case-insensitive, like K in rule B1', () => {
    assert.equal(keywordCount('docker DOCKER Docker', 'Docker'), 3);
  });

  test('keywordPresent is exactly "count > 0" — the two can never disagree', () => {
    for (const [text, keyword] of [
      ['I used Docker daily', 'Docker'],
      ['dockerfile only', 'Docker'],
      ['Built services in C++', 'C++'],
      ['scored ABC++ here', 'C++'],
      ['anything', '   '],
    ]) {
      assert.equal(keywordPresent(text, keyword), keywordCount(text, keyword) > 0);
    }
  });

  test('a blank keyword counts nothing rather than matching everywhere', () => {
    assert.equal(keywordCount('any text at all', ''), 0);
    assert.equal(keywordCount('any text at all', '   '), 0);
  });
});

describe('coverageStatusFor — the three Block D statuses', () => {
  const base = { keyword: 'Docker', sourceText: 'I used Docker daily', sourceIsBase: false };

  test('below the coverage threshold is a gap, whatever the resume says', () => {
    // Written against the CONSTANT rather than a literal: the threshold is
    // calibrated (docs/eval/coverage-thresholds.md) and a recalibration must not
    // be able to leave this assertion quietly testing an old number.
    assert.equal(
      coverageStatusFor({ ...base, bestSimilarity: COVERAGE_THRESHOLD - 0.01 }),
      'gap',
    );
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: 0 }), 'gap');
  });

  test('covered by the base AND present in the source resume is "covered"', () => {
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: COVERAGE_THRESHOLD }), 'covered');
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: 0.91 }), 'covered');
  });

  test('covered by the base but absent from the source is the US-3 hidden match', () => {
    assert.equal(
      coverageStatusFor({ ...base, sourceText: 'no tooling mentioned', bestSimilarity: 0.81 }),
      'gap_in_resume_covered_by_base',
    );
  });

  test('when the base IS the source, the middle status cannot occur', () => {
    // Nothing covered by the base can be "missing from the source" when they
    // are the same body of text.
    assert.equal(
      coverageStatusFor({ ...base, sourceText: '', sourceIsBase: true, bestSimilarity: 0.81 }),
      'covered',
    );
    assert.equal(
      coverageStatusFor({
        ...base,
        sourceText: '',
        sourceIsBase: true,
        bestSimilarity: COVERAGE_THRESHOLD - 0.01,
      }),
      'gap',
    );
  });

  test('no keyword to look for never becomes a claim of absence', () => {
    // The parser can emit an empty keyword. "Not in your resume" would then be
    // a statement about a search that was never performed.
    assert.equal(
      coverageStatusFor({ ...base, keyword: '', sourceText: 'anything', bestSimilarity: 0.8 }),
      'covered',
    );
  });
});

describe('renderableScore — one rule everywhere a score renders', () => {
  const entry = (kind, similarity) => ({
    requirement: 'r',
    kind,
    status: 'covered',
    careerItemId: null,
    careerItemTitle: null,
    similarity,
  });

  test('a scan that never ran shows no number', () => {
    assert.equal(renderableScore({ match_score: null, coverage: null }), null);
    assert.equal(
      renderableScore({ match_score: 68, coverage: null }),
      null,
      'coverage null means nothing was measured, whatever the score column says',
    );
  });

  test('rule B1b: 0 MUST requirements and 0 keywords is "—", not a hard 0', () => {
    assert.equal(
      renderableScore({ match_score: 0, coverage: { entries: [entry('nice', 0.2)], keywords: [] } }),
      null,
    );
  });

  test('a real measurement renders its number', () => {
    assert.equal(
      renderableScore({
        match_score: 68,
        coverage: { entries: [entry('must', 0.87)], keywords: [{ keyword: 'Docker' }] },
      }),
      68,
    );
  });

  test('a nice-only posting WITH keywords still has a computable score (B1)', () => {
    assert.equal(
      renderableScore({
        match_score: 50,
        coverage: { entries: [entry('nice', 0.7)], keywords: [{ keyword: 'Docker' }] },
      }),
      50,
    );
  });

  test('a measured zero is reported as zero', () => {
    assert.equal(
      renderableScore({
        match_score: 0,
        coverage: { entries: [entry('must', 0.1)], keywords: [{ keyword: 'Docker' }] },
      }),
      0,
    );
  });
});

/**
 * RULE B1a's literal-span guard (SPEC v2.13), from the owner's testing round: P1
 * returned "Quality assurance" for a posting that says "quality checks" and
 * "Data labeling" for one that says "label, categorize". The keywords table then
 * rendered a row whose "In vacancy" count was 0.
 */
describe('literalKeywords — B1a literal spans', () => {
  const VACANCY =
    'You will run quality checks against our quality standards, and label, ' +
    'categorize and review data in Python. Remote work, remotely supported.';

  test("the owner's two reported keywords are dropped, the literal ones kept", () => {
    const { kept, dropped } = literalKeywords(VACANCY, [
      'quality checks',
      'Quality assurance',
      'Data labeling',
      'Python',
    ]);
    assert.deepEqual(kept, ['quality checks', 'Python']);
    assert.deepEqual(dropped, ['Quality assurance', 'Data labeling']);
  });

  test('membership uses the SAME boundary rule as the table it feeds', () => {
    // "remotely" must not keep the keyword "Remote" alive, and a keyword the
    // table would count present must never be dropped as absent.
    const { kept, dropped } = literalKeywords('Works remotely', ['Remote']);
    assert.deepEqual(kept, []);
    assert.deepEqual(dropped, ['Remote']);

    const { kept: kept2 } = literalKeywords('Remote-first team', ['Remote']);
    assert.deepEqual(kept2, ['Remote']);
    assert.equal(keywordCount('Remote-first team', 'Remote'), 1);
  });

  test('case and casing follow the table, not the model', () => {
    // The count is case-insensitive, so a differently-cased copy is still a
    // literal span and survives — the row it renders will count it.
    const { kept } = literalKeywords('We do QUALITY CHECKS daily', ['quality checks']);
    assert.deepEqual(kept, ['quality checks']);
  });

  test('every kept keyword has a nonzero in-vacancy count, by construction', () => {
    const { kept } = literalKeywords(VACANCY, [
      'Python',
      'Quality assurance',
      'data',
      '',
      '   ',
    ]);
    for (const keyword of kept) {
      assert.ok(keywordCount(VACANCY, keyword) > 0, `${keyword} must be countable`);
    }
    // A blank keyword counts 0 in any text, so it can never reach the screen.
    assert.equal(kept.includes(''), false);
  });

  test('dropping a phantom keyword RAISES K instead of lowering it', () => {
    // The defect was not only cosmetic: a keyword the posting never used
    // counted against the resume in rule B1.
    const resume = 'I ran quality checks in Python.';
    const withPhantom = keywordShare(resume, ['quality checks', 'Python', 'Quality assurance']);
    const { kept } = literalKeywords('quality checks in Python', [
      'quality checks',
      'Python',
      'Quality assurance',
    ]);
    assert.equal(withPhantom, 2 / 3);
    assert.equal(keywordShare(resume, kept), 1);
  });
});

/**
 * The owner asked how a scan with 0 covered requirements and 0 keywords present
 * renders a nonzero Match Rate. It is rule B1's S term, which is CONTINUOUS
 * partial credit — clamp((best − 0.30) / 0.55) — while "covered" is a separate
 * threshold at 0.60. These pin the arithmetic so the answer cannot drift.
 */
describe('matchScore — the arithmetic behind a small nonzero score (B1)', () => {
  /**
   * The five MUST best similarities MEASURED by the calibration run
   * (docs/eval/coverage-thresholds.md, application 77539dc8…): a senior
   * AI-quality career base against an entry-level annotation posting, every
   * requirement rendered a gap.
   */
  const MEASURED_MUST = [0.4245, 0.3492, 0.3707, 0.3819, 0.1759];

  /** Rule B1's S term with explicit thresholds, so a test can hold either set. */
  const sTerm = (bests, floor, span) =>
    bests.reduce((sum, b) => sum + Math.min(1, Math.max(0, (b - floor) / span)), 0) /
    bests.length;

  test('the reported 6% was the S term at the thresholds that produced it', () => {
    // Owner testing: 0 requirements covered, 0 of 10 keywords in the resume,
    // Match Rate 6%. Both weighted components looked empty, and one was not:
    // "covered" is a THRESHOLD, while S is CONTINUOUS partial credit from the
    // floor upward. At the thresholds in force then (floor 0.30, span 0.55) the
    // measured band still produces a single-digit score with K = 0 — which is
    // the reported number, and it needs no term outside B1 to explain it.
    const s = sTerm(MEASURED_MUST, 0.3, 0.55);
    const score = Math.round(100 * (0.6 * s + 0.4 * 0));
    assert.equal(score, 7);
    assert.ok(score > 0 && score < 10);
    // 6% back-solves to a mean best similarity of 0.355 on that curve, which is
    // inside the 0.20–0.43 band the owner reported. Self-consistent.
    assert.equal(Math.round((0.3 + (6 / 60) * 0.55) * 1000) / 1000, 0.355);
  });

  test('the calibrated thresholds credit the same measurements as 57%', () => {
    // Same five numbers, same K, the constants this file now exports. The rise
    // is the calibration, not a change to the formula.
    const score = matchScore({
      requirementCount: 7,
      mustBestSimilarities: MEASURED_MUST,
      // 2 of the 8 stored keywords appeared in the base: K = 0.25.
      resumeText: 'spreadsheets and Python',
      keywords: [
        'data annotation',
        'Label Studio',
        'CVAT',
        'spreadsheets',
        'Python',
        'quality checks',
        'computer-vision',
        'language models',
      ],
    });
    assert.equal(score, 57);
    assert.equal(
      score,
      Math.round(100 * (0.6 * sTerm(MEASURED_MUST, SIMILARITY_FLOOR, SIMILARITY_SPAN) + 0.4 * 0.25)),
    );
  });

  test('S saturates exactly where isCovered turns true', () => {
    // FLOOR + SPAN === COVERAGE_THRESHOLD is the invariant that keeps B1's two
    // halves from disagreeing about a fully met requirement. Under the old
    // numbers a requirement could be covered at 0.60 and still contribute 55%
    // of its weight. Moving one of the three now has to move another.
    assert.equal(SIMILARITY_SPAN, COVERAGE_THRESHOLD - SIMILARITY_FLOOR);
    assert.equal(normalizeSimilarity(COVERAGE_THRESHOLD), 1);
    assert.equal(normalizeSimilarity(SIMILARITY_FLOOR), 0);
    assert.equal(isCovered(COVERAGE_THRESHOLD), true);
    // Exactly at the threshold and nowhere below it.
    assert.ok(normalizeSimilarity(COVERAGE_THRESHOLD - 0.0001) < 1);
  });

  test('the threshold is reachable by this embedding model, which 0.60 was not', () => {
    // The point of the calibration: the whole measured band tops out at 0.4319,
    // so the shipped 0.60 admitted nothing. Every labeled-covered requirement
    // of the calibration set is admitted now.
    const labeledCovered = [0.4245, 0.3707, 0.3819, 0.3629];
    for (const best of labeledCovered) {
      assert.equal(isCovered(best), true, `${best} is a labeled-covered requirement`);
      assert.equal(best < 0.6, true, 'and it was refused by the old threshold');
    }
    // The one labeled true gap stays a gap and contributes nothing.
    assert.equal(isCovered(0.1759), false);
    assert.equal(normalizeSimilarity(0.1759), 0);
  });

  test('a similarity at or below the floor contributes nothing', () => {
    assert.equal(normalizeSimilarity(SIMILARITY_FLOOR), 0);
    assert.equal(normalizeSimilarity(0.1), 0);
    assert.equal(
      matchScore({
        requirementCount: 2,
        mustBestSimilarities: [SIMILARITY_FLOOR, 0.1],
        resumeText: 'nothing relevant',
        keywords: ['Docker'],
      }),
      0,
    );
  });

  test('K is the only other term, and it is weighted 0.4', () => {
    // Shown explicitly because the owner asked whether an undocumented term
    // contributes: with S pinned at 0, the rest of the score is exactly 0.4 × K.
    const bests = [SIMILARITY_FLOOR];
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: bests,
        resumeText: 'nothing relevant',
        keywords: ['Docker'],
      }),
      0,
    );
    assert.equal(
      matchScore({
        requirementCount: 1,
        mustBestSimilarities: bests,
        resumeText: 'I used Docker',
        keywords: ['Docker'],
      }),
      40,
    );
  });
});
