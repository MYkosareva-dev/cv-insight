import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { keywordPresent, keywordShare, matchScore, scoreBand } from '../../src/lib/scoring.ts';

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
