import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { dedupeItems, itemSignature, normalizeForCompare } from '../../src/lib/dedupe.ts';

/**
 * This guard DISCARDS the user's data, so both of its failure modes are silent
 * and neither raises anything:
 *   - over-matching drops a real career item the user asked to keep;
 *   - under-matching lets the exact duplicates back in, which is the defect the
 *     owner hit on first live use.
 * Nothing in the app would report either, which is why the decision lives in a
 * pure module a test can load rather than inside the route handler.
 */

const item = (over = {}) => ({
  type: 'role',
  title: 'AI Prompt Evaluator — Nordlicht Digital',
  content: 'Evaluated and ranked LLM responses against project rubrics.',
  period: '01/2025 – present',
  ...over,
});

describe('normalizeForCompare', () => {
  test('folds case and collapses whitespace runs', () => {
    assert.equal(normalizeForCompare('  Hello   WORLD \n\t x '), 'hello world x');
  });

  test('a newline and a space compare equal — the re-extraction case', () => {
    // pdf.js emits text per positioned run, so the same PDF parsed twice can
    // differ in line wrapping alone. A byte comparison would call two
    // extractions of one document entirely distinct.
    assert.equal(normalizeForCompare('one two\nthree'), normalizeForCompare('one two three'));
  });

  test('punctuation is NOT stripped', () => {
    // This function decides what to throw away, so it stops at the smallest
    // normalization that catches re-extraction noise. Merging on punctuation
    // would start discarding items that differ in meaning.
    assert.notEqual(normalizeForCompare('c++ developer'), normalizeForCompare('c developer'));
  });
});

describe('itemSignature', () => {
  test('identical items share a signature despite whitespace and case', () => {
    const a = item();
    const b = item({
      title: 'ai prompt evaluator —   Nordlicht Digital',
      content: 'Evaluated and ranked LLM responses\nagainst project rubrics.',
    });
    assert.equal(itemSignature(a), itemSignature(b));
  });

  test('type is part of the key', () => {
    // The same sentence as a role and as an achievement is two different claims
    // about a career, not one claim stored twice.
    assert.notEqual(itemSignature(item()), itemSignature(item({ type: 'achievement' })));
  });

  test('period is NOT part of the key', () => {
    // Free text: "01/2025 – present" and "Jan 2025 - now" are one job. Including
    // it would make two spellings of a date range read as two items — exactly
    // the duplicate this guard exists to catch.
    assert.equal(itemSignature(item()), itemSignature(item({ period: 'Jan 2025 - now' })));
  });

  test('different content is a different signature', () => {
    assert.notEqual(itemSignature(item()), itemSignature(item({ content: 'Something else.' })));
  });

  test('no title/content combination can forge another item key', () => {
    // The separator must not be a character that survives normalization, or
    // title "a b" + content "c" could collide with title "a" + content "b c".
    const one = itemSignature({ type: 'role', title: 'a b', content: 'c' });
    const two = itemSignature({ type: 'role', title: 'a', content: 'b c' });
    assert.notEqual(one, two);
  });
});

describe('dedupeItems', () => {
  test('an item already stored for this user is skipped', () => {
    const incoming = [item()];
    const result = dedupeItems(incoming, [itemSignature(item())]);
    assert.deepEqual(result.keep, []);
    assert.equal(result.skipped, 1);
  });

  test('re-importing an identical resume keeps NOTHING and counts every skip', () => {
    // The owner's exact case: the same text imported twice.
    const resume = [item(), item({ type: 'skill_block', title: 'BPMN', content: 'Modeling.' })];
    const stored = resume.map(itemSignature);
    const result = dedupeItems(resume, stored);
    assert.equal(result.keep.length, 0);
    assert.equal(result.skipped, 2);
  });

  test('duplicates WITHIN one batch are caught too', () => {
    // One resume can list the same certification twice. Without this, the first
    // copy inserts and the second is only caught on a LATER import — so the
    // guard would look like it works while still admitting duplicates on the
    // very path it was written for.
    const result = dedupeItems([item(), item()], []);
    assert.equal(result.keep.length, 1);
    assert.equal(result.skipped, 1);
  });

  test('a genuinely new item survives alongside a duplicate', () => {
    const fresh = item({ title: 'IT Product Manager — BotWorks Labs' });
    const result = dedupeItems([item(), fresh], [itemSignature(item())]);
    assert.equal(result.skipped, 1);
    assert.deepEqual(
      result.keep.map((i) => i.title),
      [fresh.title],
    );
  });

  test('order is preserved and the FIRST occurrence wins', () => {
    // The saved items must land in the order the user approved in the review
    // list, or the base reorders itself for no visible reason.
    const a = item({ title: 'A' });
    const b = item({ title: 'B' });
    const c = item({ title: 'C' });
    const result = dedupeItems([a, b, a, c], []);
    assert.deepEqual(
      result.keep.map((i) => i.title),
      ['A', 'B', 'C'],
    );
    assert.equal(result.skipped, 1);
  });

  test('nothing stored and nothing repeated keeps everything', () => {
    const items = [item({ title: 'A' }), item({ title: 'B' })];
    const result = dedupeItems(items, []);
    assert.equal(result.keep.length, 2);
    assert.equal(result.skipped, 0);
  });

  test('an empty batch is not an error', () => {
    assert.deepEqual(dedupeItems([], ['x']), { keep: [], skipped: 0 });
  });
});
