import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  coverageStatusFor,
  insufficientSignal,
  keywordCount,
  keywordPresent,
  keywordShare,
  matchScore,
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

  test('below the 0.60 threshold is a gap, whatever the resume says', () => {
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: 0.59 }), 'gap');
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: 0 }), 'gap');
  });

  test('covered by the base AND present in the source resume is "covered"', () => {
    assert.equal(coverageStatusFor({ ...base, bestSimilarity: 0.6 }), 'covered');
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
      coverageStatusFor({ ...base, sourceText: '', sourceIsBase: true, bestSimilarity: 0.4 }),
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
