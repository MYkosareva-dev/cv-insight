import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { PRICE_USD_PER_MTOK, costUsdMicro, normalizeModelId } from '../../src/lib/pricing.ts';

/**
 * Cost is the one number in this app that is about money, and every way it can
 * be wrong is SILENT: a mispriced call still returns, still logs a row, and
 * still renders on /quality. Nothing complains — the total is just wrong.
 *
 * These cases exist because a real one got through. The embeddings endpoint
 * echoes the upstream model id (`text-embedding-3-small`) rather than the slug
 * it was sent (`openai/text-embedding-3-small`), so an exact-match price lookup
 * missed on EVERY embedding call and wrote `cost_known=false, cost=0`. It was
 * caught by watching a live e2e run's server log, which is not a mechanism.
 * This file is the mechanism.
 *
 * `src/lib/pricing.ts` exists as a separate module precisely so this test can
 * import it: `tests/` is in scope for check.mjs R6, so a test may never import
 * `lib/openrouter/server.ts`, where this arithmetic used to live.
 */

describe('normalizeModelId', () => {
  test('strips the provider namespace', () => {
    assert.equal(normalizeModelId('openai/text-embedding-3-small'), 'text-embedding-3-small');
    assert.equal(normalizeModelId('anthropic/claude-haiku-4.5'), 'claude-haiku-4.5');
  });

  test('strips a routing suffix', () => {
    assert.equal(normalizeModelId('anthropic/claude-haiku-4.5:beta'), 'claude-haiku-4.5');
  });

  test('a bare id normalizes to itself', () => {
    assert.equal(normalizeModelId('text-embedding-3-small'), 'text-embedding-3-small');
  });

  test('is case-insensitive', () => {
    assert.equal(normalizeModelId('OpenAI/Text-Embedding-3-Small'), 'text-embedding-3-small');
  });
});

describe('costUsdMicro', () => {
  test('the documented example: $0.0431 → 43100', () => {
    // Haiku at $1/$5 per Mtok:
    //   600 in  × $1 / 1e6 = $0.0006
    //   8500 out × $5 / 1e6 = $0.0425
    //                        = $0.0431 → 43100 micro-USD
    const { costUsdMicro: cost, costKnown } = costUsdMicro(
      'anthropic/claude-haiku-4.5',
      600,
      8_500,
    );
    assert.equal(cost, 43_100);
    assert.equal(costKnown, true);
  });

  test('THE BUG: a bare embeddings id prices, and prices as KNOWN', () => {
    // What OpenRouter actually returns for the embeddings call.
    const { costUsdMicro: cost, costKnown } = costUsdMicro('text-embedding-3-small', 500, 0);
    assert.equal(costKnown, true, 'a priced model must never be reported as unpriced');
    assert.ok(cost > 0, 'a call that consumed tokens must never cost 0');
  });

  test('an embed row carries a NONZERO cost — Math.ceil, not Math.round', () => {
    // 500 tokens at $0.02/Mtok is $0.00001 = 10 micro-USD. But even ONE token
    // must round up: Math.round would floor a sub-micro call to 0 while
    // reporting cost_known=true, which reads as "this call was free" — the
    // exact lie the flag exists to prevent. DoD item 7 wants nonzero cost on
    // real embed rows, and this is what makes that true for a short one.
    for (const tokens of [1, 10, 500, 5_000]) {
      const { costUsdMicro: cost, costKnown } = costUsdMicro(
        'openai/text-embedding-3-small',
        tokens,
        0,
      );
      assert.equal(costKnown, true);
      assert.ok(cost >= 1, `${tokens} tokens priced at ${cost} micro-USD`);
    }
  });

  test('a genuinely unknown model is unpriced, NOT free', () => {
    const { costUsdMicro: cost, costKnown } = costUsdMicro('someone/brand-new-model', 1_000, 1_000);
    assert.equal(costKnown, false, 'an unknown price must be reported as unknown');
    assert.equal(cost, 0);
  });

  test('zero tokens is genuinely zero, and known', () => {
    // The one honest zero: nothing was consumed. Distinguishable from the
    // unknown-price zero above only by cost_known, which is why /quality reads
    // the flag off the stored row instead of re-deriving it.
    const { costUsdMicro: cost, costKnown } = costUsdMicro('anthropic/claude-haiku-4.5', 0, 0);
    assert.equal(cost, 0);
    assert.equal(costKnown, true);
  });

  test('exact match wins over the normalized fallback', () => {
    // So a future table entry that deliberately distinguishes two providers'
    // builds of one model is never silently overridden.
    for (const slug of Object.keys(PRICE_USD_PER_MTOK)) {
      const { costKnown } = costUsdMicro(slug, 1_000, 1_000);
      assert.equal(costKnown, true, `${slug} must price by exact match`);
    }
  });

  test('every model the app can ask for is in the price table', () => {
    // The models named in SPEC Block F. If a step's model changes without a
    // price entry, /quality starts under-reporting and only this fails.
    for (const slug of [
      'anthropic/claude-sonnet-4.6',
      'anthropic/claude-haiku-4.5',
      'google/gemini-2.5-flash',
      'openai/text-embedding-3-small',
    ]) {
      assert.ok(PRICE_USD_PER_MTOK[slug], `no price entry for ${slug}`);
    }
  });

  test('output tokens are priced at the output rate', () => {
    // A table read that swapped in/out would still produce plausible numbers.
    const inputOnly = costUsdMicro('anthropic/claude-haiku-4.5', 1_000_000, 0).costUsdMicro;
    const outputOnly = costUsdMicro('anthropic/claude-haiku-4.5', 0, 1_000_000).costUsdMicro;
    assert.equal(inputOnly, 1_000_000); // $1 per Mtok in
    assert.equal(outputOnly, 5_000_000); // $5 per Mtok out
  });
});
