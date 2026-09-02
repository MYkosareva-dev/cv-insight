import 'server-only';

/**
 * CONNECTION module — phase 0 stub.
 *
 * This file speaks to the two OpenRouter endpoints and has NO opinion about who
 * may use it. The authorization opinion lives in the two gates:
 *   - `lib/chat.ts`      — completions (parse_vacancy, generate, judge)
 *   - `lib/retrieval.ts` — embeddings (indexing, matching, re-scoring)
 *
 * No page, component or route handler may import this module directly
 * (CLAUDE.md, "AI model calls"). `scripts/check.mjs` enforces that.
 *
 * Nothing here calls the network yet — phase 0 is scaffolding only.
 */

export const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

export const FALLBACK_MODEL = 'google/gemini-2.5-flash';
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
/** documents.embedding is vector(1536) — never change without re-embedding all rows. */
export const EMBEDDING_DIMENSIONS = 1536;
/** OpenRouter embeddings batch limit (SPEC Block F). */
export const EMBEDDING_BATCH_SIZE = 64;

export const REQUEST_TIMEOUT_MS = 60_000;

export type LlmStep =
  | 'import_resume'
  | 'parse_vacancy'
  | 'generate'
  | 'judge'
  | 'embed'
  | 'rescore';

/** Primary model per step; the fallback is always FALLBACK_MODEL. */
export const MODEL_BY_STEP = {
  import_resume: 'anthropic/claude-haiku-4.5',
  parse_vacancy: 'anthropic/claude-haiku-4.5',
  judge: 'anthropic/claude-haiku-4.5',
  generate: 'anthropic/claude-sonnet-4.6',
} as const satisfies Partial<Record<LlmStep, string>>;

/** USD per 1M tokens (SPEC Block F, Cost). Used to compute micro-USD integers. */
export const PRICE_USD_PER_MTOK: Record<string, { in: number; out: number }> = {
  'anthropic/claude-sonnet-4.6': { in: 3, out: 15 },
  'anthropic/claude-haiku-4.5': { in: 1, out: 5 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'openai/text-embedding-3-small': { in: 0.02, out: 0 },
};

export type ChatMessage = { role: 'system' | 'user'; content: string };

export type ConnectionResult<T> = {
  data: T;
  /** The model that ACTUALLY served the request (fallback-aware). */
  model: string;
  fallbackUsed: boolean;
  tokensIn: number;
  tokensOut: number;
  costUsdMicro: number;
  /**
   * false when the serving model had no entry in PRICE_USD_PER_MTOK, so
   * `costUsdMicro` is 0 because the price is UNKNOWN, not because the call was
   * free. Written straight to `llm_calls.cost_known`, so /quality reads it off
   * the stored row rather than re-deriving it from the price table — which it
   * could not do anyway, since a page may not import this module.
   */
  costKnown: boolean;
  latencyMs: number;
};

/**
 * $0.0431 → 43100. Stored as an integer; formatted only at display.
 *
 * An unrecognised slug is never a silent 0: OpenRouter fallback routing can
 * return a variant slug the price table does not list, and a zero-cost row
 * would read as "this call was free" on /quality. The unknown price is shouted
 * at the log AND carried on the return value so the caller can flag the row.
 */
export function costUsdMicro(
  model: string,
  tokensIn: number,
  tokensOut: number,
): { costUsdMicro: number; costKnown: boolean } {
  const price = PRICE_USD_PER_MTOK[model];
  if (!price) {
    console.error(
      `[openrouter] no price entry for model "${model}" — llm_calls row written ` +
        'with cost_usd_micro=0 and cost_known=false. Add it to PRICE_USD_PER_MTOK.',
    );
    return { costUsdMicro: 0, costKnown: false };
  }
  const usd = (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
  return { costUsdMicro: Math.round(usd * 1_000_000), costKnown: true };
}

const NOT_IMPLEMENTED = 'OpenRouter connection is a phase-0 stub — not implemented yet.';

/** POST /chat/completions with `models: [primary, FALLBACK_MODEL]` routing. */
export async function chatCompletion(_args: {
  step: LlmStep;
  primaryModel: string;
  messages: ChatMessage[];
  jsonMode: boolean;
}): Promise<ConnectionResult<string>> {
  throw new Error(NOT_IMPLEMENTED);
}

/** POST /embeddings, model EMBEDDING_MODEL, batch <= EMBEDDING_BATCH_SIZE. */
export async function createEmbeddings(_args: {
  step: Extract<LlmStep, 'embed' | 'rescore'>;
  inputs: string[];
}): Promise<ConnectionResult<number[][]>> {
  throw new Error(NOT_IMPLEMENTED);
}
