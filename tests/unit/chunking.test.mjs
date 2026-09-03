import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  CHUNK_HARD_MAX_CHARS,
  CHUNK_MIN_CHARS,
  CHUNK_TARGET_CHARS,
  MAX_CHUNKS_PER_ITEM,
  chunkContent,
  chunksForItem,
  titleOf,
  withTitle,
} from '../../src/lib/chunking.ts';
import { MAX_CAREER_ITEMS, MAX_DOCUMENTS } from '../../src/lib/limits.ts';

/**
 * The chunker is the one part of indexing a reviewer cannot verify by reading.
 * It is also the part whose failure is SILENT: a chunk stored without its title
 * prefix, an empty chunk, or a dropped paragraph still embeds, still inserts, and
 * still matches — it just retrieves the wrong thing, months later, with every
 * gate green.
 *
 * `src/lib/chunking.ts` is importable here for the same reason `scoring.ts` is:
 * it is pure and carries no `server-only` guard. The gate that uses it
 * (`lib/retrieval.ts`) cannot be imported by node:test at all.
 *
 * SPEC v2.14 (backlog p3-13) replaced paragraph PACKING with semantic units.
 * Two assertions in this file used to require the old behaviour — three short
 * paragraphs packed into one chunk, and a bullet list stored as a single chunk —
 * and those were assertions on the defect: one chunk holding eight claims wins
 * almost every comparison, which is how a base with no mention of MS Office
 * came back Covered against "Proficient with MS Office or Google Suite". They
 * are replaced below by the four cases the fix has to get right.
 */

const BLANK_LINE = '\n\n';

describe('withTitle / titleOf — the title is STORED, not merely embedded', () => {
  test('stored content is title + blank line + chunk', () => {
    assert.equal(withTitle('Analyst — Acme', 'Did the thing.'), 'Analyst — Acme\n\nDid the thing.');
  });

  test('titleOf recovers the title, which is what lets dev logging name an item', () => {
    const stored = withTitle('Analyst — Acme', 'Did the thing.');
    assert.equal(titleOf(stored), 'Analyst — Acme');
  });

  test('titleOf returns the title alone even when the chunk itself has blank lines', () => {
    // The split takes the FIRST segment only. A greedy split would return the
    // whole body, and the dev retrieval log would start printing chunk text —
    // which the privacy rule forbids in either mode.
    const stored = withTitle('Role', ['para one', 'para two', 'para three'].join(BLANK_LINE));
    assert.equal(titleOf(stored), 'Role');
  });
});

describe('chunkContent — the four shapes a career item arrives in', () => {
  test('a BULLETED item becomes one chunk per bullet', () => {
    // The case the whole revision is for. Each bullet is one claim, and a query
    // that matches one of them must not have to out-score the other four.
    const bullets = [
      'Evaluated and annotated Russian and English LLM outputs against written scoring rubrics, including multi-turn dialogues.',
      'Performed side-by-side evaluation and ranking of model responses for a weekly release review, at 400 items per week.',
      'Maintained an average QA quality score of 98 percent across all batches, measured by the sampling audit.',
      'Wrote the annotation guidelines the rest of the team worked from, and ran the calibration sessions.',
    ];
    // Each bullet clears the floor on its own — as real resume bullets do. The
    // rule for the ones that do not has its own case in the next block: a
    // 66-character bullet SHOULD merge, and asserting otherwise here would be
    // asserting against the floor rather than testing it.
    for (const bullet of bullets) assert.ok(bullet.length >= CHUNK_MIN_CHARS);

    const chunks = chunkContent(bullets.map((bullet) => `- ${bullet}`).join('\n'));
    assert.deepEqual(chunks, bullets, 'one chunk per bullet, bullet marker stripped');
    for (const chunk of chunks) {
      assert.ok(chunk.length <= CHUNK_TARGET_CHARS, `${chunk.length} chars exceeds the target`);
    }
  });

  test('a PROSE item splits at sentence boundaries, not at a character count', () => {
    const content =
      'Reviewed and corrected labelled training data for an intent-classification model, ' +
      'auditing sampled batches and tracking error rates per annotator. ' +
      'Built Python pipelines that de-duplicated incoming datasets, validated schema ' +
      'conformance and produced the weekly quality report. ' +
      'Worked to a documented turnaround target and hit it in eleven of twelve months.';

    const chunks = chunkContent(content);
    assert.ok(chunks.length > 1, 'a 400-character paragraph is not one claim');
    for (const chunk of chunks) {
      // Every chunk ends at a sentence end — nothing was cut mid-clause.
      assert.match(chunk, /[.!?]$/);
      assert.ok(chunk.length >= CHUNK_MIN_CHARS || chunks.length === 1);
    }
    assert.equal(chunks.join(' '), content.replace(/\s+/g, ' '));
  });

  test('a ONE-LINE item stays exactly one chunk', () => {
    const content = 'Evaluated LLM outputs against scoring rubrics.';
    assert.deepEqual(chunkContent(content), [content]);
  });

  test('a 600-character SENTENCE is stored whole — there is nothing to split on', () => {
    // At the hard ceiling and with no interior boundary. Splitting one sentence
    // into two vectors gives two halves that each mean less than the sentence
    // did, so the honest answer is one chunk, and the ceiling is where that
    // stops being true.
    const words = [];
    while (words.join(' ').length < 598) words.push('annotation');
    const sentence = `${words.join(' ').slice(0, 599)}.`;
    assert.equal(sentence.length, 600);

    const chunks = chunkContent(sentence);
    assert.equal(chunks.length, 1, 'a single sentence at the ceiling is not split');
    assert.equal(chunks[0].length, 600);

    // Past the ceiling the dilution argument wins again, and the split is on
    // word boundaries, never mid-word.
    const longer = `${'annotation '.repeat(200).trim()}.`;
    const split = chunkContent(longer);
    assert.ok(split.length > 1, `a ${longer.length}-char sentence must not be stored whole`);
    for (const chunk of split) {
      for (const token of chunk.split(/\s+/)) {
        assert.match(token, /^annotation\.?$/, 'split mid-word');
      }
    }
    assert.equal(split.join(' ').split(/\s+/).length, longer.split(/\s+/).length);
  });
});

describe('chunkContent — invariants that must hold for any input', () => {
  test('units below the floor are merged, never stored alone', () => {
    // "SKILLS" and "Python, SQL" are keywords, not claims: alone they embed to a
    // vector dominated by coincidence, which is what the floor prevents.
    const content = ['SKILLS', 'Python, SQL', 'BPMN process modeling and requirements documentation.'].join('\n');
    const chunks = chunkContent(content);
    for (const chunk of chunks) {
      assert.ok(
        chunk.length >= CHUNK_MIN_CHARS || chunks.length === 1,
        `chunk of ${chunk.length} chars is below the floor: ${chunk}`,
      );
    }
    assert.ok(chunks.some((chunk) => chunk.includes('SKILLS')), 'nothing was dropped');
  });

  test('a trailing fragment merges BACKWARDS instead of being stored alone', () => {
    const content = [
      'Reviewed and corrected labelled training data for an intent-classification model every week.',
      'Also helped out.',
    ].join('\n');
    const chunks = chunkContent(content);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].includes('Also helped out.'));
  });

  test('blank content yields NO chunks — never one empty chunk', () => {
    // An empty chunk embeds to a meaningless vector and puts a row in documents
    // that can match a query while carrying no information.
    assert.deepEqual(chunkContent(''), []);
    assert.deepEqual(chunkContent('   \n\n  \t \n'), []);
  });

  test('no chunk is empty and none is pure whitespace, for any input', () => {
    const content = 'Alpha.\n\n\n\n   \n\nBeta.\n\n\t\n\nGamma.';
    const chunks = chunkContent(content);
    assert.ok(chunks.length >= 1);
    for (const chunk of chunks) assert.notEqual(chunk.trim(), '');
  });

  test('the floor is below the target and the target below the ceiling', () => {
    assert.ok(CHUNK_MIN_CHARS < CHUNK_TARGET_CHARS);
    assert.ok(CHUNK_TARGET_CHARS <= CHUNK_HARD_MAX_CHARS);
  });

  test('no item can ever exceed MAX_CHUNKS_PER_ITEM', () => {
    const many = Array.from({ length: 60 }, (_, i) => `- Bullet ${i} describes one distinct thing that was done.`).join('\n');
    assert.ok(chunkContent(many).length <= MAX_CHUNKS_PER_ITEM);

    // The count-maximising legal item: 4,000 characters (the career_items CHECK
    // bound) of one-claim bullets, which is the shape that produces the most
    // units per character once the floor has done its merging.
    const bullet = '- Audited one sampled batch and recorded the error rate for it.';
    const worst = Array.from({ length: 200 }, () => bullet).join('\n').slice(0, 4000);
    assert.ok(
      chunkContent(worst).length <= MAX_CHUNKS_PER_ITEM,
      `worst-case item produced ${chunkContent(worst).length} chunks`,
    );
  });

  test('capping merges the SMALLEST neighbours, so no chunk becomes a blob', () => {
    // Merging all overflow into the last chunk — which is what the 2-chunk cap
    // used to do — would rebuild the defect this revision removes: nineteen
    // small chunks and one holding everything else.
    const bullets = Array.from(
      { length: 40 },
      (_, i) => `- Bullet ${i} describes one distinct thing that was done here.`,
    ).join('\n');
    const chunks = chunkContent(bullets);
    assert.equal(chunks.length, MAX_CHUNKS_PER_ITEM);
    const longest = Math.max(...chunks.map((chunk) => chunk.length));
    const shortest = Math.min(...chunks.map((chunk) => chunk.length));
    assert.ok(
      longest <= shortest * 3,
      `sizes are lopsided: shortest ${shortest}, longest ${longest}`,
    );
  });

  test('capping MERGES the overflow — dropping text would be the silent failure', () => {
    const total = 60;
    const chunks = chunkContent(
      Array.from({ length: total }, (_, i) => `- Bullet ${i} describes one distinct thing.`).join('\n'),
    );
    for (let i = 0; i < total; i++) {
      assert.ok(
        chunks.some((chunk) => chunk.includes(`Bullet ${i} describes one distinct thing.`)),
        `bullet ${i} was dropped by the chunk cap`,
      );
    }
  });

  test('rule B9 is self-consistent: the item cap cannot breach the document cap', () => {
    // 200 items × 20 chunks = 4,000 ≤ 4,000. Without this, a user legal under
    // one B9 ceiling is illegal under the other — and the only copy B9 provides
    // says "200 items", which is false when the document cap is what tripped.
    // This assertion is the ENFORCEMENT: `lib/limits.ts` cannot import the
    // chunker without costing both modules their node:test loadability.
    assert.ok(
      MAX_CAREER_ITEMS * MAX_CHUNKS_PER_ITEM <= MAX_DOCUMENTS,
      `${MAX_CAREER_ITEMS} items x ${MAX_CHUNKS_PER_ITEM} chunks exceeds ${MAX_DOCUMENTS} documents`,
    );
  });
});

describe('chunksForItem — what actually lands in documents.content', () => {
  test('every chunk carries the title, so an item is findable by name from any chunk', () => {
    const content = [
      '- Evaluated and annotated Russian and English LLM outputs against scoring rubrics.',
      '- Performed side-by-side ranking of model responses for a weekly release review.',
      '- Maintained an average QA quality score of 98 percent across all batches.',
    ].join('\n');
    const stored = chunksForItem('AI Prompt Evaluator — Nordlicht Digital', content);
    assert.ok(stored.length > 1, 'this fixture is only meaningful with several chunks');
    for (const row of stored) {
      assert.equal(titleOf(row), 'AI Prompt Evaluator — Nordlicht Digital');
    }
  });

  test('an item with no usable content produces no rows at all', () => {
    assert.deepEqual(chunksForItem('Title only', '   '), []);
  });
});
