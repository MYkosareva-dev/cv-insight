import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  MATCH_COUNT_FOR_GENERATE,
  MAX_GENERATION_ITEMS,
  MAX_ITEMS_CHARS,
  distinctItemIds,
  itemsPayload,
  resumeName,
  vacancyQueryText,
} from '../../src/lib/generation.ts';
import { MAX_CHUNKS_PER_ITEM } from '../../src/lib/chunking.ts';

/**
 * What goes INTO the generator decides what can come out of it. These are the
 * functions that choose the corpus, and a mistake in any of them is a resume
 * grounded in the wrong thing — or in almost nothing, which is the failure the
 * architect gate found in this phase's plan: Block D #5's "top-8 chunks" was
 * written when a chunk was a whole career item, and since SPEC v2.14 a chunk is
 * one CLAIM, so eight of them can resolve to a single job.
 */

describe('the retrieval budget', () => {
  test('asks for enough chunks that eight distinct items are reachable', () => {
    // The pathological case is one item producing every chunk it is allowed to.
    // If the ask were smaller than that, a base with one very long item could
    // fill the whole result and leave the generator writing from one job.
    assert.ok(
      MATCH_COUNT_FOR_GENERATE > MAX_CHUNKS_PER_ITEM,
      'a single item cannot be allowed to fill the entire match',
    );
  });

  test('bounds the corpus at a one-page resume worth of items', () => {
    assert.equal(MAX_GENERATION_ITEMS, 8);
  });
});

describe('distinctItemIds — the chunks SELECT, the rows supply', () => {
  test('collapses many chunks of one item into one id', () => {
    const chunks = [
      { careerItemId: 'a' },
      { careerItemId: 'a' },
      { careerItemId: 'b' },
      { careerItemId: 'a' },
    ];
    assert.deepEqual(distinctItemIds(chunks, 8), ['a', 'b']);
  });

  test('keeps relevance order — the best-ranked chunk names its item first', () => {
    const chunks = [{ careerItemId: 'z' }, { careerItemId: 'y' }, { careerItemId: 'x' }];
    assert.deepEqual(distinctItemIds(chunks, 8), ['z', 'y', 'x']);
  });

  test('stops at the limit', () => {
    const chunks = [{ careerItemId: 'a' }, { careerItemId: 'b' }, { careerItemId: 'c' }];
    assert.deepEqual(distinctItemIds(chunks, 2), ['a', 'b']);
  });

  test('an empty search yields no items, and the caller must refuse rather than generate', () => {
    assert.deepEqual(distinctItemIds([], 8), []);
  });
});

describe('itemsPayload — the character bound on the <items> block', () => {
  const item = (id, chars) => ({
    id,
    type: 'role',
    title: `Role ${id}`,
    period: '01/2025 – present',
    content: 'x'.repeat(chars),
  });

  test('keeps everything that fits', () => {
    const { payload, dropped } = itemsPayload([item('a', 100), item('b', 100)]);
    assert.equal(payload.length, 2);
    assert.equal(dropped, 0);
  });

  test('stops at the budget rather than truncating an item mid-fact', () => {
    // Eight items at the column ceiling is 32,000 characters into P2 AND P3,
    // twice each on a revised run; max_tokens bounds only the output.
    const items = Array.from({ length: 8 }, (_, i) => item(String(i), 4_000));
    const { payload, dropped } = itemsPayload(items);
    const used = payload.reduce((sum, p) => sum + p.title.length + p.content.length + p.period.length, 0);
    assert.ok(used <= MAX_ITEMS_CHARS, 'the block stays inside its budget');
    assert.equal(payload.length + dropped, items.length);
    assert.ok(dropped > 0, 'eight full-size items do not all fit');
  });

  test('the first item is kept even when it alone blows the budget', () => {
    // A corpus of zero items makes every claim in the resume ungrounded by
    // construction, which is not a smaller failure than an over-long prompt.
    const { payload } = itemsPayload([item('a', MAX_ITEMS_CHARS * 2)]);
    assert.equal(payload.length, 1);
  });

  test('the most relevant items survive — it is a prefix, not a sample', () => {
    const { payload } = itemsPayload([item('first', 10), item('second', 10)], 40);
    assert.equal(payload[0].id, 'first');
  });
});

describe('vacancyQueryText — what is actually embedded', () => {
  const parsed = {
    title: 'AI Quality Analyst',
    requirements: [{ text: 'LLM evaluation' }, { text: 'BPMN process modeling' }],
    keywords: ['Python', 'SQL'],
  };

  test('carries the title, every requirement and the keywords', () => {
    const query = vacancyQueryText(parsed);
    assert.match(query, /AI Quality Analyst/);
    assert.match(query, /LLM evaluation/);
    assert.match(query, /BPMN process modeling/);
    assert.match(query, /Python, SQL/);
  });

  test('drops empty parts rather than embedding blank lines', () => {
    const query = vacancyQueryText({ title: '', requirements: [], keywords: [] });
    assert.equal(query, '');
  });

  test('a posting with no keywords still queries on its requirements', () => {
    const query = vacancyQueryText({ ...parsed, keywords: [] });
    assert.match(query, /LLM evaluation/);
    assert.ok(!query.endsWith('\n'));
  });
});

describe('resumeName — the name half of the export filename', () => {
  test('is the first non-empty line, which P2 rule 4 makes the NAME', () => {
    assert.equal(resumeName('\n\nMIRA STEINBERG\nAI Quality Analyst'), 'MIRA STEINBERG');
  });

  test('a blank resume names nothing rather than inventing something', () => {
    assert.equal(resumeName('   \n\n'), '');
  });

  test('a non-Latin name survives intact for exportFilename to handle', () => {
    assert.equal(resumeName('МИРА ШТАЙНБЕРГ\nАналитик'), 'МИРА ШТАЙНБЕРГ');
  });
});
