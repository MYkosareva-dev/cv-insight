/**
 * Model prices and the micro-USD arithmetic (SPEC Block F, "Cost"; v2.10).
 *
 * Pure, and deliberately NOT `server-only`, for the same reason `scoring.ts` and
 * `chunking.ts` are not: this is arithmetic over a constant table with no secret,
 * no network and no auth opinion, and it needs to be TESTABLE. It cannot live in
 * `lib/openrouter/server.ts` and be tested there — `tests/` is in scope for
 * check.mjs R6, so a unit test importing the connection module would fail the
 * gate that keeps every model call behind the two gates.
 *
 * That mattered in practice: the provider-prefix bug below shipped unnoticed
 * precisely because the one piece of this system that is pure arithmetic had no
 * test, and was only caught by watching a real e2e run's logs.
 */

/** USD per 1M tokens. */
export const PRICE_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  'anthropic/claude-sonnet-4.6': { in: 3, out: 15 },
  'anthropic/claude-haiku-4.5': { in: 1, out: 5 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'openai/text-embedding-3-small': { in: 0.02, out: 0 },
};

/**
 * A model id reduced to the part that identifies the model itself: no provider
 * namespace, no routing suffix, lower-cased.
 *
 * The embeddings endpoint echoes the UPSTREAM model id rather than the slug it
 * was asked for — `openai/text-embedding-3-small` goes out and
 * `text-embedding-3-small` comes back. An exact-match price table therefore
 * missed on EVERY embedding call and wrote `cost_known=false,
 * cost_usd_micro=0`: not a wrong price, but "we do not know what this cost" for
 * a call whose price is sitting in the table. /quality would have shown a
 * growing pile of unpriced calls with its total understated.
 *
 * The `cost_known` flag did its job — it refused to report an unpriced call as a
 * free one — which is how a lookup bug became visible at all.
 */
export function normalizeModelId(model: string): string {
  const withoutSuffix = model.split(':')[0] ?? model;
  const segments = withoutSuffix.split('/');
  return (segments[segments.length - 1] ?? withoutSuffix).toLowerCase();
}

/** Built once from the table above, not per call. */
const PRICE_BY_NORMALIZED_ID: Record<string, { in: number; out: number }> = Object.fromEntries(
  Object.entries(PRICE_USD_PER_MTOK).map(([slug, price]) => [normalizeModelId(slug), price]),
);

/**
 * $0.0431 → 43100. Stored as an integer; formatted only at display.
 *
 * Three ways a 0 could lie, all closed:
 *   - An unrecognised slug: OpenRouter fallback routing can return a variant the
 *     price table does not list. The missing price is shouted at the log AND
 *     carried back as costKnown=false, so /quality shows unknown pricing rather
 *     than a free call.
 *   - A provider-prefixed vs bare id: see `normalizeModelId`. Exact match is
 *     tried FIRST, so a future table entry that deliberately distinguishes two
 *     providers' builds of one model is never overridden by the fallback.
 *   - Sub-micro rounding: embeddings price at $0.02/Mtok, so a short embed costs
 *     a fraction of one micro-dollar and Math.round would floor it to 0 with
 *     costKnown=true — the exact "this call was free" reading the flag exists to
 *     prevent. Math.ceil instead: a priced call that consumed tokens is at least
 *     1 micro-USD. Over-reporting a rounding crumb is the honest direction.
 */
export function costUsdMicro(
  model: string,
  tokensIn: number,
  tokensOut: number,
): { costUsdMicro: number; costKnown: boolean } {
  const price = PRICE_USD_PER_MTOK[model] ?? PRICE_BY_NORMALIZED_ID[normalizeModelId(model)];
  if (!price) {
    console.error(
      `[pricing] no price entry for model "${model}" — llm_calls row written ` +
        'with cost_usd_micro=0 and cost_known=false. Add it to PRICE_USD_PER_MTOK.',
    );
    return { costUsdMicro: 0, costKnown: false };
  }
  const usd = (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
  // ceil, not round — see the sub-micro note above. A zero here means the call
  // genuinely consumed no tokens, never that it was too cheap to count.
  return { costUsdMicro: Math.ceil(usd * 1_000_000), costKnown: true };
}
