import 'server-only';

import { costUsdMicro, normalizeModelId } from '@/lib/pricing';

/**
 * CONNECTION module.
 *
 * This file speaks to the two OpenRouter endpoints and has NO opinion about who
 * may use it. The authorization opinion lives in the two gates:
 *   - `lib/chat.ts`      — completions (parse_vacancy, generate, judge)
 *   - `lib/retrieval.ts` — embeddings (indexing, matching, re-scoring)
 *
 * No page, component or route handler may import this module directly
 * (CLAUDE.md, "AI model calls"). `scripts/check.mjs` enforces that (R5 pins the
 * host to this file, R6 pins the import to the two gates).
 *
 * It also writes NO `llm_calls` row. `llm_calls.user_id` is NOT NULL and this
 * module has no way to learn who the user is without acquiring exactly the auth
 * opinion it is defined not to have. So it reports what happened — on success in
 * `ConnectionResult`, on failure in `OpenRouterError` — and the gates, which do
 * know the user, write the row either way (rule B8).
 */

export const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

/**
 * The second entry of every `models` array — and it is a GENUINE fallback again
 * (SPEC v2.23).
 *
 * It was the model writing every resume, because the configured generator was
 * blocked and this is what routing reached for. With `openai/gpt-5.4` as the
 * generate primary it goes back to being what its name says: a different VENDOR
 * (Google, not OpenAI) and a different vendor from the Anthropic primary on the
 * other three steps, so a single provider outage cannot take the app down — and
 * verified to serve on this key by the same probe that found the guardrail.
 *
 * ONE FALLBACK FOR EVERY STEP still holds, and it is a different vendor from
 * every primary: OpenAI generates, Anthropic parses and judges, Google catches
 * both. A per-step fallback map would only be needed if a primary were ever
 * Google's.
 */
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

/**
 * The steps that reach the COMPLETIONS endpoint. `embed` and `rescore` go to the
 * embeddings endpoint, which takes neither a model choice nor an output ceiling.
 *
 * Split out so the two maps below can be TOTAL over their own key space. A
 * `Partial<Record<LlmStep, …>>` accepts a map with a step missing, which is how
 * `parse_vacancy` fell out of `MAX_TOKENS_BY_STEP` in the v2.16 round and was
 * masked by a `?? 1200` default: same number, no error, and the per-step map had
 * quietly stopped being the thing it exists to be. Total maps make the next
 * omission a BUILD failure instead of a silent inheritance.
 */
export type ChatStep = Extract<LlmStep, 'import_resume' | 'parse_vacancy' | 'generate' | 'judge'>;

/** Primary model per step; the fallback is always FALLBACK_MODEL. */
/**
 * WHICH MODEL SERVES WHICH STEP — and the generate entry is not a preference,
 * it is what the provider account permits (SPEC v2.23).
 *
 * `anthropic/claude-sonnet-4.6` was the configured generator from Phase 4 and it
 * has NEVER served a single call. A model guardrail on the OpenRouter workspace
 * removes all of its endpoints during routing, and because every chat call goes
 * out as `models: [primary, fallback]`, a blocked primary is answered by using
 * the second entry. The key belongs to someone else and the owner cannot lift the
 * guardrail, so the primary had to become a model the key can reach.
 *
 * MEASURED, NOT CHOSEN. 23 candidate slugs were requested ALONE on this key —
 * no `models` array, so each answer is that model's own. FIVE serve:
 * `openai/gpt-5.4`, `openai/gpt-5.2`, `openai/gpt-5-mini`,
 * `anthropic/claude-haiku-4.5` and `google/gemini-2.5-flash`. Every other
 * candidate answers HTTP 404 `model-ignored-by-guardrail`, including every
 * Anthropic Sonnet and Opus, Gemini 2.5 Pro, Grok, DeepSeek, Mistral Large and
 * the rest of the GPT-5 family. The full table is in
 * `docs/eval/generation-model-comparison.md`.
 *
 * `openai/gpt-5.4` is the strongest of the five — the highest tier that passes,
 * priced at $2.50/$15.00 per Mtok, which is the band Sonnet 4.6 occupied — and it
 * was verified against THIS APP'S REQUEST SHAPE and not merely against a ping:
 * `temperature` is not in its `supported_parameters` and `reasoning` is, so a
 * probe sent the app's own body (plain text, `max_tokens: 2500`,
 * `temperature: 0.4`) and read the answer off `usage` — `finish_reason: stop`,
 * 149 completion tokens, ZERO reasoning tokens, real resume text. A reasoning
 * model that spent the output budget thinking would have been a worse defect
 * than the fallback: a paid run returning nothing.
 *
 * THE JUDGE IS DELIBERATELY UNCHANGED. `anthropic/claude-haiku-4.5` serves, and
 * its verdicts are the only baseline the project has — every rubric number in
 * `docs/eval/` was produced by it. It is also still a DIFFERENT model from the
 * generator, which is the whole point of CLAUDE.md's self-preference rule, and
 * now a different vendor as well.
 */
export const MODEL_BY_STEP = {
  import_resume: 'anthropic/claude-haiku-4.5',
  parse_vacancy: 'anthropic/claude-haiku-4.5',
  judge: 'anthropic/claude-haiku-4.5',
  generate: 'openai/gpt-5.4',
} as const satisfies Record<ChatStep, string>;

/**
 * Output ceiling per step (SPEC Block F, amended v2.10).
 *
 * Block F's original snippet read `step === 'generate' ? 2500 : 1200`, written for
 * `parse_vacancy` and `judge` — both of which return one small JSON object. It does
 * not fit `import_resume`: US-1 targets ~14 career items whose `content` may reach
 * 4,000 characters each, so 1,200 output tokens (≈4,800 characters TOTAL) truncates
 * the JSON, Zod rejects it, the one repair retry truncates identically, and the
 * user gets a 502 on the app's very first flow. A per-step map instead of a
 * ternary, so the next step to need its own ceiling states it here rather than
 * inheriting a number chosen for something else.
 */
export const MAX_TOKENS_BY_STEP = {
  import_resume: 8000,
  /**
   * One small JSON object, which is what the v2.10 ternary was written for.
   * Stated EXPLICITLY rather than left to a default: this entry was deleted by
   * the v2.16 edit that raised `judge`, and because the fallback beside the
   * lookup supplied the same 1200 the deletion changed no behaviour and broke
   * no build. A map whose entries can vanish without consequence is not the
   * mechanism this docblock describes.
   */
  parse_vacancy: 1200,
  /**
   * v2.16 — 1200 -> 3000. Raised for the reason `import_resume` was raised in
   * v2.10, and found the same way: by watching a real run rather than by
   * reading. A judge report is not one small object. `judgeReportSchema` permits
   * fifty grounding violations, each with a `claim` and an `issue`, plus a
   * 4,000-character `evidence` string and three more lists — and the one thing
   * an output-token cut produces is a TRUNCATED JSON, which is non-empty, so it
   * comes back as a success, fails Zod, and spends the single repair retry at
   * the SAME ceiling to truncate at the same place. Two Haiku calls, a 502, and
   * on `/judge` nothing saved. The retry budget is for output the model got
   * wrong, not for output the app refused to let it finish.
   */
  judge: 3000,
  generate: 2500,
} as const satisfies Record<ChatStep, number>;

/**
 * Prices and the micro-USD arithmetic live in `lib/pricing.ts` and are
 * re-exported here, so existing importers of the connection are unaffected.
 *
 * They moved out because they had to be TESTABLE: `tests/` is in scope for
 * check.mjs R6, so a unit test could never import this module. The cost path's
 * one piece of pure arithmetic being the one piece with no test is exactly how
 * the provider-prefix lookup bug survived to a real e2e run.
 */
export { PRICE_USD_PER_MTOK, costUsdMicro, normalizeModelId } from '@/lib/pricing';

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
 * A call that did not produce a usable response.
 *
 * GATE-INTERNAL. It never escapes `lib/chat.ts` or `lib/retrieval.ts`: both catch
 * it and rethrow `AiUnavailableError` from `lib/errors.ts`. That is not a style
 * preference — a route handler that wanted to `instanceof` this class would have
 * to import the connection module, which is exactly what check.mjs R6 forbids, so
 * letting it escape would break the chokepoint at prebuild.
 *
 * It carries what a failed `llm_calls` row needs (rule B8: every request writes a
 * row, INCLUDING failures). Without `attemptedModel` and `latencyMs` on the error
 * the gate could only log `model=''` and `latency=0`, and /quality would show
 * failures it cannot attribute to a model.
 *
 * `retryable` marks the ONE case CLAUDE.md exception (b) covers: "the request
 * itself errored" — a transport throw or the 60 s abort. A response that arrived
 * carrying a non-2xx status is NOT that case, however tempting a 429 or 503 looks:
 * the service answered. Asking again would be a third retry, and metered calls get
 * no ladders.
 */
export class OpenRouterError extends Error {
  readonly attemptedModel: string;
  readonly latencyMs: number;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(args: {
    message: string;
    attemptedModel: string;
    latencyMs: number;
    retryable: boolean;
    status?: number | null;
  }) {
    super(args.message);
    this.name = 'OpenRouterError';
    this.attemptedModel = args.attemptedModel;
    this.latencyMs = args.latencyMs;
    this.retryable = args.retryable;
    this.status = args.status ?? null;
  }
}

/** What the response said about who served the call and what it cost. */
export type ServedUsage = {
  model: string;
  fallbackUsed: boolean;
  tokensIn: number;
  tokensOut: number;
};

/**
 * A call that was BILLED and still produced nothing usable.
 *
 * The distinction matters for one reason: money. A transport failure spent
 * nothing, so its `llm_calls` row is honestly `tokens=0, cost=0`. A 200 whose
 * body carries no content consumed real tokens and OpenRouter charged for them —
 * logging THAT as a zero-cost row under-reports spend, and both rule B8 and DoD
 * item 7 rest on /quality being truthful about cost. So this subclass carries the
 * real `usage` through the failure path and the gate writes `ok=false` with the
 * actual tokens, model and fallback flag.
 */
export class OpenRouterUsageError extends OpenRouterError {
  readonly usage: ServedUsage;

  constructor(args: {
    message: string;
    attemptedModel: string;
    latencyMs: number;
    status?: number | null;
    usage: ServedUsage;
  }) {
    super({
      message: args.message,
      attemptedModel: args.attemptedModel,
      latencyMs: args.latencyMs,
      // Billed and empty is not "the request errored": it answered. No retry.
      retryable: false,
      status: args.status ?? null,
    });
    this.name = 'OpenRouterUsageError';
    this.usage = args.usage;
  }
}

/**
 * Did the FALLBACK model serve this call, rather than the primary?
 *
 * Compared through `normalizeModelId` — the same normalization the price lookup
 * uses, and for the same reason. Two ways a naive comparison lies:
 *   - a routing suffix (`…haiku-4.5:beta`, a dated snapshot) is the SAME model
 *     serving, not the fallback;
 *   - a provider namespace may simply be absent from the response. That is not
 *     hypothetical: the embeddings endpoint demonstrably echoes
 *     `text-embedding-3-small` for a request sent as
 *     `openai/text-embedding-3-small`, which is exactly how the price table came
 *     to miss on every embed row. If the chat endpoint ever does the same, a
 *     prefix-sensitive comparison would report `fallback_used=true` on every
 *     successful primary call.
 *
 * That second failure is worse than the price one it mirrors. A missed price at
 * least announces itself through `cost_known=false`; a wrong fallback flag is
 * indistinguishable from the truth, so /quality's fallback rate — the one number
 * that says the primary model is having a bad day — would read 100% with nothing
 * anywhere to contradict it.
 */
function isFallback(servedModel: string, primaryModel: string): boolean {
  return normalizeModelId(servedModel) !== normalizeModelId(primaryModel);
}

/** Authorization header. The key is read here and nowhere else in this module. */
function authHeaders(): HeadersInit {
  const key = process.env.OPENROUTER_API_KEY;
  // Names the variable, never a value — not even truncated or masked.
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/**
 * The only failure shape the single network retry may cover: a `fetch` rejection
 * or the abort from `AbortSignal.timeout` (edge case N5). A `fetch` that RESOLVES
 * with a non-2xx status is handled at the call site and is never retryable.
 */
function asRetryable(err: unknown, attemptedModel: string, latencyMs: number): OpenRouterError {
  const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return new OpenRouterError({
    message: aborted ? `request aborted after ${REQUEST_TIMEOUT_MS} ms` : 'request failed',
    attemptedModel,
    latencyMs,
    retryable: true,
  });
}

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** POST /chat/completions with `models: [primary, FALLBACK_MODEL]` routing. */
export async function chatCompletion(args: {
  step: ChatStep;
  primaryModel: string;
  messages: ChatMessage[];
  jsonMode: boolean;
}): Promise<ConnectionResult<string>> {
  const { step, primaryModel, messages, jsonMode } = args;
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    // OpenRouter's own fallback routing. This is ONE request that the service may
    // route to the second entry, not a retry, so it does not count against the
    // metered-call rules — and the response tells us which model answered.
    models: [primaryModel, FALLBACK_MODEL],
    messages,
    max_tokens: MAX_TOKENS_BY_STEP[step],
    temperature: step === 'generate' ? 0.4 : 0,
  };
  // P1/P3/P4 are JSON mode; P2 (generate) returns plain text.
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw asRetryable(err, primaryModel, Date.now() - startedAt);
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    // The response BODY is deliberately not read into the error: a 4xx from
    // OpenRouter echoes the offending request back, and the request is the prompt
    // — which contains resume or vacancy text. It must never reach an error
    // message, a log line or an HTTP body (CLAUDE.md, Privacy).
    throw new OpenRouterError({
      message: `chat completions responded ${res.status}`,
      attemptedModel: primaryModel,
      latencyMs,
      retryable: false,
      status: res.status,
    });
  }

  let json: ChatResponse;
  try {
    json = (await res.json()) as ChatResponse;
  } catch {
    throw new OpenRouterError({
      message: 'chat completions returned a body that is not JSON',
      attemptedModel: primaryModel,
      latencyMs,
      retryable: false,
      status: res.status,
    });
  }

  const served = json.model ?? primaryModel;
  const tokensIn = json.usage?.prompt_tokens ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;
  const content = json.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    // A 200 with no content is a failed call that would otherwise be logged as a
    // success and then explode in the caller's Zod parse. It was still BILLED,
    // so the gate needs the real usage to log an honest row — see UsageOnError.
    throw new OpenRouterUsageError({
      message: 'chat completions returned no content',
      attemptedModel: served,
      latencyMs,
      status: res.status,
      usage: {
        model: served,
        fallbackUsed: isFallback(served, primaryModel),
        tokensIn,
        tokensOut,
      },
    });
  }

  const { costUsdMicro: cost, costKnown } = costUsdMicro(served, tokensIn, tokensOut);

  return {
    data: content,
    model: served,
    fallbackUsed: isFallback(served, primaryModel),
    tokensIn,
    tokensOut,
    costUsdMicro: cost,
    costKnown,
    latencyMs,
  };
}

type EmbeddingsResponse = {
  model?: string;
  data?: { index?: number; embedding?: number[] }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

/**
 * POST /embeddings, model EMBEDDING_MODEL, batch <= EMBEDDING_BATCH_SIZE.
 *
 * NO `models` fallback array here, and that is a decision rather than an omission.
 * CLAUDE.md names a fallback for every step, but the only fallback available is a
 * CHAT model, and any different embedding model means a different vector space —
 * for every candidate, a different dimension too. `documents.embedding` is
 * `vector(1536)` and the rule above it is absolute: never change the embedding
 * model without dropping and re-embedding every row, because mixing two models'
 * vectors breaks retrieval SILENTLY. Cosine distance still returns numbers; they
 * just stop meaning anything. A failed embedding call is visible and recoverable;
 * a silently poisoned index is neither.
 *
 * There is also NO retry on this endpoint, ever. The recovery path is the one the
 * embeddings rules already specify: the save succeeds, the user sees a warning,
 * and the next edit re-indexes.
 */
export async function createEmbeddings(args: {
  step: Extract<LlmStep, 'embed' | 'rescore'>;
  inputs: string[];
}): Promise<ConnectionResult<number[][]>> {
  const { inputs } = args;
  if (inputs.length === 0) throw new Error('createEmbeddings called with no inputs');
  if (inputs.length > EMBEDDING_BATCH_SIZE) {
    // The gate batches; arriving here with more means the batching was bypassed.
    throw new Error(
      `createEmbeddings received ${inputs.length} inputs, over the ${EMBEDDING_BATCH_SIZE} batch limit`,
    );
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw asRetryable(err, EMBEDDING_MODEL, Date.now() - startedAt);
  }

  const latencyMs = Date.now() - startedAt;

  const fail = (message: string) =>
    new OpenRouterError({
      message,
      attemptedModel: EMBEDDING_MODEL,
      latencyMs,
      retryable: false,
      status: res.status,
    });

  // Body deliberately unread — it echoes the inputs, which are career-item text.
  if (!res.ok) throw fail(`embeddings responded ${res.status}`);

  let json: EmbeddingsResponse;
  try {
    json = (await res.json()) as EmbeddingsResponse;
  } catch {
    throw fail('embeddings returned a body that is not JSON');
  }

  const rows = json.data ?? [];
  if (rows.length !== inputs.length) {
    throw fail(`embeddings returned ${rows.length} vectors for ${inputs.length} inputs`);
  }

  // Ordered by the response's own `index`, never by array position: the API does
  // not promise input order, and a silently permuted batch would attach each
  // vector to the WRONG chunk — an index that looks healthy and retrieves
  // nonsense, with nothing anywhere reporting a fault.
  const vectors: number[][] = new Array<number[]>(inputs.length);
  rows.forEach((row, position) => {
    const index = row.index ?? position;
    const embedding = row.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      // Asserted, not trusted: `documents.embedding` is vector(1536), and a wrong
      // width means the model or its config changed underneath us. A failed save
      // beats a table holding two vector spaces.
      const width = Array.isArray(embedding) ? String(embedding.length) : 'no';
      throw fail(`embedding ${index} has ${width} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
    if (index < 0 || index >= inputs.length || vectors[index] !== undefined) {
      throw fail(`embeddings returned an out-of-range or duplicate index ${index}`);
    }
    vectors[index] = embedding;
  });

  const tokensIn = json.usage?.prompt_tokens ?? json.usage?.total_tokens ?? 0;
  const served = json.model ?? EMBEDDING_MODEL;
  const { costUsdMicro: cost, costKnown } = costUsdMicro(served, tokensIn, 0);

  return {
    data: vectors,
    model: served,
    // No fallback exists for this endpoint by design — see the note above.
    fallbackUsed: false,
    tokensIn,
    tokensOut: 0,
    costUsdMicro: cost,
    costKnown,
    latencyMs,
  };
}
