import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  CHUNK_MAX_CHARS,
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

describe('chunkContent', () => {
  test('a short item is exactly one chunk', () => {
    const chunks = chunkContent('Evaluated LLM outputs against scoring rubrics.');
    assert.deepEqual(chunks, ['Evaluated LLM outputs against scoring rubrics.']);
  });

  test('adjacent short paragraphs are PACKED, not stored as thin vectors each', () => {
    const content = ['First paragraph.', 'Second paragraph.', 'Third paragraph.'].join(BLANK_LINE);
    const chunks = chunkContent(content);
    assert.equal(chunks.length, 1, 'three short paragraphs belong in one chunk');
    assert.equal(chunks[0], content);
  });

  test('blank content yields NO chunks — never one empty chunk', () => {
    // An empty chunk embeds to a meaningless vector and puts a row in documents
    // that can match a query while carrying no information.
    assert.deepEqual(chunkContent(''), []);
    assert.deepEqual(chunkContent('   \n\n  \t \n'), []);
  });

  test('paragraphs split on blank lines, and single newlines stay inside a chunk', () => {
    // A resume bullet list uses single newlines; splitting on those would turn
    // one role into one vector per bullet.
    const bullets = '- bullet one\n- bullet two\n- bullet three';
    assert.deepEqual(chunkContent(bullets), [bullets]);
  });

  test('packing stops at the target, so a long item becomes several chunks', () => {
    const paragraph = `${'word '.repeat(180).trim()}.`; // ~900 chars
    const content = Array.from({ length: 4 }, () => paragraph).join(BLANK_LINE);
    const chunks = chunkContent(content);
    assert.ok(chunks.length > 1, `expected several chunks, got ${chunks.length}`);
  });

  test('no chunk is empty and none is pure whitespace, for any input', () => {
    const content = 'Alpha.\n\n\n\n   \n\nBeta.\n\n\t\n\nGamma.';
    const chunks = chunkContent(content);
    assert.ok(chunks.length >= 1);
    for (const chunk of chunks) assert.notEqual(chunk.trim(), '');
  });

  test('an over-long single paragraph splits on word boundaries, never mid-word', () => {
    // One paragraph with no blank line to split on. The split still has to
    // happen: the embedding model truncates at its own limit silently, and
    // nothing anywhere reports a truncated vector.
    const word = 'supercalifragilistic';
    const long = `${word} `.repeat(200).trim(); // ~4000 chars, one paragraph
    const chunks = chunkContent(long);
    assert.ok(chunks.length > 1, 'a 4000-char paragraph must not be stored whole');
    for (const chunk of chunks) {
      for (const token of chunk.split(/\s+/)) {
        assert.equal(token, word, 'split mid-word');
      }
    }
    // Every word survives the split — a chunker that drops content is worse
    // than one that chunks badly.
    assert.equal(chunks.join(' ').split(/\s+/).length, long.split(/\s+/).length);
  });

  test('the target is below the ceiling, or packing could emit an oversized chunk', () => {
    assert.ok(CHUNK_TARGET_CHARS <= CHUNK_MAX_CHARS);
  });

  test('no item can ever exceed MAX_CHUNKS_PER_ITEM', () => {
    // Many small paragraphs is the shape that defeats packing: a chunk flushes
    // as soon as the next paragraph would cross the target, so the count
    // follows the INPUT's structure unless the cap is explicit.
    const many = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} text.`).join(BLANK_LINE);
    assert.ok(chunkContent(many).length <= MAX_CHUNKS_PER_ITEM);

    // And the count-maximising legal item: 4,000 characters (the career_items
    // CHECK bound) of paragraphs just over half the target, so no two of them
    // ever pack together.
    const halfish = `${'w '.repeat(Math.floor(CHUNK_TARGET_CHARS / 4)).trim()}.`;
    const worst = Array.from({ length: 12 }, () => halfish)
      .join(BLANK_LINE)
      .slice(0, 4000);
    assert.ok(
      chunkContent(worst).length <= MAX_CHUNKS_PER_ITEM,
      `worst-case item produced ${chunkContent(worst).length} chunks`,
    );
  });

  test('capping MERGES the overflow — dropping text would be the silent failure', () => {
    const total = 40;
    const chunks = chunkContent(
      Array.from({ length: total }, (_, i) => `Paragraph ${i} text.`).join(BLANK_LINE),
    );
    // Every paragraph is still present somewhere. Silently dropping one would
    // delete part of the user's career history from the index while the item
    // still looked fully indexed.
    for (let i = 0; i < total; i++) {
      assert.ok(
        chunks.some((chunk) => chunk.includes(`Paragraph ${i} text.`)),
        `paragraph ${i} was dropped by the chunk cap`,
      );
    }
  });

  test('rule B9 is self-consistent: the item cap cannot breach the document cap', () => {
    // 200 items x 2 chunks = 400 <= 500. Without this, a user legal under one
    // B9 ceiling is illegal under the other — and the only copy B9 provides
    // says "200 items", which is false when the document cap is what tripped.
    assert.ok(
      MAX_CAREER_ITEMS * MAX_CHUNKS_PER_ITEM <= MAX_DOCUMENTS,
      `${MAX_CAREER_ITEMS} items x ${MAX_CHUNKS_PER_ITEM} chunks exceeds ${MAX_DOCUMENTS} documents`,
    );
  });
});

describe('chunksForItem — what actually lands in documents.content', () => {
  test('every chunk carries the title, so an item is findable by name from any chunk', () => {
    const paragraph = `${'word '.repeat(180).trim()}.`;
    const content = Array.from({ length: 4 }, () => paragraph).join(BLANK_LINE);
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
