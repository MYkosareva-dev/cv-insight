import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  CHUNK_MAX_CHARS,
  CHUNK_TARGET_CHARS,
  chunkContent,
  chunksForItem,
  titleOf,
  withTitle,
} from '../../src/lib/chunking.ts';

/**
 * The chunker is the one part of indexing a reviewer cannot verify by reading.
 * It is also the part whose failure is SILENT: a chunk stored without its title
 * prefix, or an empty chunk, still embeds, still inserts, and still matches — it
 * just retrieves the wrong thing, months later, with every gate green.
 *
 * `src/lib/chunking.ts` is importable here for the same reason `scoring.ts` is:
 * it is pure and carries no `server-only` guard. The gate that uses it
 * (`lib/retrieval.ts`) cannot be imported by node:test at all.
 */

describe('withTitle / titleOf — the title is STORED, not merely embedded', () => {
  test('stored content is title + blank line + chunk', () => {
    assert.equal(withTitle('Analyst — Acme', 'Did the thing.'), 'Analyst — Acme\n\nDid the thing.');
  });

  test('titleOf recovers the title, which is what lets dev logging name an item', () => {
    const stored = withTitle('Analyst — Acme', 'Did the thing.\n\nAnd another.');
    assert.equal(titleOf(stored), 'Analyst — Acme');
  });

  test('titleOf returns the title alone even when the chunk itself has blank lines', () => {
    // The split takes the FIRST segment only; a greedy split would return the
    // whole body and dev logs would start printing chunk text, which the
    // privacy rule forbids.
    const stored = withTitle('Role', 'para one\n\npara two\n\npara three');
    assert.equal(titleOf(stored), 'Role');
  });
});

describe('chunkContent', () => {
  test('a short item is exactly one chunk', () => {
    const chunks = chunkContent('Evaluated LLM outputs against scoring rubrics.');
    assert.deepEqual(chunks, ['Evaluated LLM outputs against scoring rubrics.']);
  });

  test('adjacent short paragraphs are PACKED, not stored as thin vectors each', () => {
    const chunks = chunkContent('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    assert.equal(chunks.length, 1, 'three short paragraphs belong in one chunk');
    assert.match(chunks[0], /First paragraph\.\n\nSecond paragraph\.\n\nThird paragraph\./);
  });

  test('blank content yields NO chunks — never one empty chunk', () => {
    // An empty chunk embeds to a meaningless vector and puts a row in documents
    // that can match a query while carrying no information.
    assert.deepEqual(chunkContent(''), []);
    assert.deepEqual(chunkContent('   \n\n  \t \n'), []);
  });

  test('paragraphs are split on blank lines, and single newlines stay inside a chunk', () => {
    // A resume bullet list uses single newlines; splitting on those would turn
    // one role into one vector per bullet.
    const chunks = chunkContent('- bullet one\n- bullet two\n- bullet three');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], '- bullet one\n- bullet two\n- bullet three');
  });

  test('packing stops at the target, so a long item becomes several chunks', () => {
    const paragraph = `${'word '.repeat(80).trim()}.`; // ~400 chars
    const content = Array.from({ length: 6 }, () => paragraph).join('\n\n');
    const chunks = chunkContent(content);
    assert.ok(chunks.length > 1, `expected several chunks, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(
        chunk.length <= CHUNK_MAX_CHARS,
        `chunk of ${chunk.length} chars exceeds the ${CHUNK_MAX_CHARS} ceiling`,
      );
    }
  });

  test('no chunk is empty and none is pure whitespace, for any input', () => {
    const content = 'Alpha.\n\n\n\n   \n\nBeta.\n\n\t\n\nGamma.';
    const chunks = chunkContent(content);
    assert.ok(chunks.length >= 1);
    for (const chunk of chunks) assert.notEqual(chunk.trim(), '');
  });

  test('an over-long single paragraph splits on word boundaries, never mid-word', () => {
    // One paragraph with no blank line to split on: the ceiling has to be
    // enforced anyway, because the embedding model truncates silently and
    // nothing reports a truncated vector.
    const long = 'supercalifragilistic '.repeat(200).trim(); // ~4000 chars, one paragraph
    const chunks = chunkContent(long);
    assert.ok(chunks.length > 1, 'a 4000-char paragraph must not be stored whole');
    for (const chunk of chunks) {
      assert.ok(chunk.length <= CHUNK_MAX_CHARS, `chunk of ${chunk.length} exceeds the ceiling`);
      assert.doesNotMatch(chunk, /^\S*supercalifragilisti$/, 'split mid-word');
    }
    // Every word survives the split — a chunker that drops content is worse
    // than one that chunks badly.
    assert.equal(chunks.join(' ').split(/\s+/).length, long.split(/\s+/).length);
  });

  test('the target is below the ceiling, or packing could emit an oversized chunk', () => {
    assert.ok(CHUNK_TARGET_CHARS <= CHUNK_MAX_CHARS);
  });
});

describe('chunksForItem — what actually lands in documents.content', () => {
  test('every chunk carries the title, so an item is findable by name from any chunk', () => {
    const paragraph = `${'word '.repeat(80).trim()}.`;
    const content = Array.from({ length: 6 }, () => paragraph).join('\n\n');
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
