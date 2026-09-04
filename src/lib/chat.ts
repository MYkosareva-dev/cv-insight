import 'server-only';

import type { User } from '@supabase/supabase-js';
import type { z } from 'zod';

import { MAX_CHAT_REQUESTS_PER_STEP } from '@/lib/budget';
import { DAILY_CALL_LIMIT, countCallsInLast24h, logLlmCall } from '@/lib/db/llmCalls';
import { ERROR_MESSAGES } from '@/lib/copy';
import { AiUnavailableError, DailyLimitError, UnauthorizedError } from '@/lib/errors';
import { getUser } from '@/lib/supabase/server';
import {
  type ChatMessage,
  type ConnectionResult,
  type ChatStep,
  MODEL_BY_STEP,
  OpenRouterError,
  OpenRouterUsageError,
  chatCompletion,
  costUsdMicro as priceOf,
} from '@/lib/openrouter/server';

/**
 * GATE — completions.
 *
 * Every parse_vacancy / generate / judge / import_resume call goes through here.
 * The gate calls getUser() FIRST and refuses without a verified user: this
 * chokepoint is what keeps an anonymous POST from spending money (CLAUDE.md,
 * "AI model calls").
 *
 * This gate guards a spend the user explicitly asked for. Embedding spends —
 * which can happen as a SIDE EFFECT of saving a career item — are guarded
 * separately by `lib/retrieval.ts`.
 *
 * Retries allowed here, and only these two, both inside one user-initiated
 * submit: (a) one repair retry when JSON-mode output fails Zod validation, with
 * the Zod error appended; (b) one network retry after 2 s when the request
 * itself errored. No debounce-driven calls, no background refresh, no ladders.
 *
 * THE TWO EXCEPTIONS ARE ALTERNATIVES, NOT MULTIPLIERS. Nesting a repair retry
 * around a network retry would issue 2 × 2 = 4 metered requests for one submit,
 * which is a retry ladder however it is spelled. Both draw from ONE shared budget
 * of MAX_CHAT_REQUESTS_PER_STEP, so a submit that spends its second request on a
 * reconnect has none left for a repair, and vice versa. The budget is arithmetic
 * in code, not an instruction in a prompt.
 */

/**
 * Hard ceiling on metered HTTP requests per user-initiated step: the first
 * attempt plus AT MOST ONE of the two owner-approved exceptions.
 *
 * The number itself lives in `lib/budget.ts` and is re-exported here so every
 * existing importer is unaffected. It moved because this module is
 * `server-only` and check.mjs R6 keeps `tests/` away from it, which left the
 * one piece of load-bearing arithmetic in the metered path with no test
 * (backlog `m-4`) — the same argument that moved the price table into
 * `lib/pricing.ts`, and for the same reason: the untestable file is where the
 * arithmetic bug hides.
 */
export { MAX_CHAT_REQUESTS_PER_STEP } from '@/lib/budget';

/** CLAUDE.md exception (b): one network retry, after 2 s. */
const NETWORK_RETRY_DELAY_MS = 2_000;

/**
 * Refuses without a verified user. Called first in every exported function.
 * Throws the SHARED UnauthorizedError from lib/errors, so a route handler maps
 * it to 401 UNAUTHORIZED per Block D with a single instanceof check.
 */
async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Re-exported from the connection, which owns the step vocabulary and keys its
 * model and output-ceiling maps on this exact type. Derived here a second time,
 * the two definitions could drift and the maps would silently stop covering a
 * step this gate accepts.
 */
export type { ChatStep };

export type ChatRequest = {
  step: ChatStep;
  /** Built server-side in lib/prompts.ts. Never accepted from the client. */
  messages: ChatMessage[];
  jsonMode: boolean;
  /** For the llm_calls row; null when the call is not tied to an application. */
  applicationId: string | null;
};

/**
 * A tally of the chat calls ONE HTTP request has already made, passed in by a
 * handler that makes more than one.
 *
 * Rule B7 is otherwise blind to its own request: `countCallsInLast24h` reads
 * COMMITTED rows, and `logLlmCall` writes through `after()` — i.e. after the
 * response is sent. So a request making several chat calls sees the same
 * pre-request count every time and can overshoot the 50-call cap by the number
 * of extra calls it makes.
 *
 * PASSED EXPLICITLY, not discovered from ambient request state. React's `cache()`
 * was the obvious candidate and was MEASURED before being trusted: a probe route
 * incrementing a `cache(() => ({ n: 0 }))` holder returned `n = 0` on every
 * request, because `cache()` does not memoize inside a route handler at all —
 * each call built a fresh object. It would have been a counter that counted
 * nothing while this file claimed the overshoot was closed, which is precisely
 * the "a configured mechanism is not a working one" defect. An argument cannot
 * fail that way: if a caller does not pass one, the code says so.
 *
 * Phase 4's /generate is the first holder: generate -> judge -> regenerate ->
 * judge is four chat STEPS in one HTTP request, it creates one ledger and passes
 * it to all four, and without that the cap could overshoot by three. Every other
 * request in the app makes exactly one chat call and passes none.
 *
 * The ledger counts REQUESTS, not steps — a step that spends its single retry
 * increments it twice, because rule B7 caps billed calls and not user
 * intentions. `lib/budget.ts` holds the ceiling that follows from that
 * (`MAX_CHAT_REQUESTS_PER_GENERATE`), and the generate route asserts against it.
 */
export type CallLedger = { chat: number };

export const newCallLedger = (): CallLedger => ({ chat: 0 });

/**
 * Rule B7, checked ONCE per user-initiated step.
 *
 * Deliberately not re-checked inside the retry budget: a submit that passed the
 * cap, spent a paid call, and then got refused on its repair retry would have
 * taken the user's money and left the operation half-done. The cap decides
 * whether a step may start, not whether it may finish.
 *
 * Embeddings are excluded by the cap's definition (rule B7), which is why both
 * the ledger and the DAL query count chat steps only.
 */
async function assertUnderDailyCap(ledger: CallLedger | undefined): Promise<void> {
  const committed = await countCallsInLast24h();
  if (committed + (ledger?.chat ?? 0) >= DAILY_CALL_LIMIT) {
    throw new DailyLimitError(ERROR_MESSAGES.DAILY_LIMIT);
  }
}

/** One shared budget for the whole step. Both exceptions draw from it. */
type Budget = { spent: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Issue ONE metered request, log it whatever happens, and return the result.
 *
 * The `llm_calls` row is written here rather than in the connection module for
 * one structural reason: `llm_calls.user_id` is NOT NULL and its RLS insert
 * policy is `auth.uid() = user_id`, so the row cannot exist without the identity
 * the connection is defined not to have. Logging therefore lives at the lowest
 * layer that knows the user, which is this one — and it wraps EVERY exit path, so
 * rule B8 holds for failures too.
 */
async function issue(
  request: ChatRequest,
  userId: string,
  messages: ChatMessage[],
  budget: Budget,
  ledger: CallLedger | undefined,
): Promise<ConnectionResult<string>> {
  if (budget.spent >= MAX_CHAT_REQUESTS_PER_STEP) {
    throw new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE);
  }
  budget.spent += 1;
  // Counts the RETRY too: a repair retry is a second billed call and B7 caps
  // billed calls, not user intentions.
  if (ledger) ledger.chat += 1;

  const primaryModel = MODEL_BY_STEP[request.step];

  try {
    const result = await chatCompletion({
      step: request.step,
      primaryModel,
      messages,
      jsonMode: request.jsonMode,
    });
    logLlmCall({
      user_id: userId,
      application_id: request.applicationId,
      step: request.step,
      model: result.model,
      fallback_used: result.fallbackUsed,
      ok: true,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd_micro: result.costUsdMicro,
      cost_known: result.costKnown,
      latency_ms: result.latencyMs,
    });
    return result;
  } catch (err) {
    logFailure(request, userId, primaryModel, err);
    throw err;
  }
}

/**
 * The failure row (rule B8). Two shapes, and conflating them would misreport
 * spend:
 *  - a request that never got an answer spent nothing → tokens and cost 0;
 *  - a request that WAS billed and returned nothing usable carries its real
 *    usage, so /quality's total cost stays truthful (DoD item 7).
 */
function logFailure(
  request: ChatRequest,
  userId: string,
  primaryModel: string,
  err: unknown,
): void {
  const billed = err instanceof OpenRouterUsageError ? err.usage : null;
  const model = billed?.model ?? (err instanceof OpenRouterError ? err.attemptedModel : primaryModel);
  const tokensIn = billed?.tokensIn ?? 0;
  const tokensOut = billed?.tokensOut ?? 0;
  // A call that never reached the service spent nothing, and `cost_known: true`
  // is the honest flag for that: the price is known and it is zero.
  const { costUsdMicro, costKnown } = billed
    ? priceOf(model, tokensIn, tokensOut)
    : { costUsdMicro: 0, costKnown: true };

  logLlmCall({
    user_id: userId,
    application_id: request.applicationId,
    step: request.step,
    model,
    fallback_used: billed?.fallbackUsed ?? false,
    ok: false,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd_micro: costUsdMicro,
    cost_known: costKnown,
    latency_ms: err instanceof OpenRouterError ? err.latencyMs : 0,
  });
}

/**
 * Run a completion for the verified user, log it to `llm_calls`
 * (fire-and-forget), and return the raw text.
 *
 * Covers CLAUDE.md exception (b) only: if the REQUEST itself errored — a
 * transport throw or the 60 s abort — it waits 2 s and spends the step's second
 * and final request. A response that arrived carrying a non-2xx status is not
 * that case: the service answered, and asking again buys the same refusal at the
 * same price.
 *
 * `OpenRouterError` never escapes this module. It becomes AiUnavailableError, so
 * a route handler maps it with the same `isApiError` path as everything else and
 * never has to import the connection (which check.mjs R6 forbids).
 */
export async function runChat(
  request: ChatRequest,
  ledger?: CallLedger,
): Promise<ConnectionResult<string>> {
  const user = await requireUser();
  await assertUnderDailyCap(ledger);
  const budget: Budget = { spent: 0 };
  return runChatWithin(request, user.id, request.messages, budget, ledger);
}

/** The attempt-plus-network-retry core, sharing the caller's budget. */
async function runChatWithin(
  request: ChatRequest,
  userId: string,
  messages: ChatMessage[],
  budget: Budget,
  ledger: CallLedger | undefined,
): Promise<ConnectionResult<string>> {
  try {
    return await issue(request, userId, messages, budget, ledger);
  } catch (err) {
    const retryable = err instanceof OpenRouterError && err.retryable;
    if (!retryable || budget.spent >= MAX_CHAT_REQUESTS_PER_STEP) {
      throw err instanceof OpenRouterError
        ? new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE)
        : err;
    }
    await sleep(NETWORK_RETRY_DELAY_MS);
    try {
      return await issue(request, userId, messages, budget, ledger);
    } catch (retryErr) {
      throw retryErr instanceof OpenRouterError
        ? new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE)
        : retryErr;
    }
  }
}

/**
 * Run a JSON-mode completion and parse it with `schema`.
 *
 * Covers CLAUDE.md exception (a): if the output fails Zod, ONE repair retry goes
 * out with the Zod error appended — and only if the shared budget has a request
 * left, which is what stops (a) and (b) from multiplying. A second failure is
 * edge case N3 and terminates as 502 AI_UNAVAILABLE, never as a 400 or a 500.
 *
 * Zod issues are appended to the PROMPT (the approved exception) but only ever
 * LOGGED as path + code. An issue object carries the received value, and for this
 * app that value is resume text — which must never reach a server log
 * (CLAUDE.md, Privacy). The raw model output is never logged either.
 */
export async function runChatJson<T>(args: {
  step: ChatStep;
  messages: ChatMessage[];
  applicationId: string | null;
  schema: z.ZodType<T>;
  /** Pass one when a single HTTP request makes several chat calls. */
  ledger?: CallLedger;
}): Promise<{ data: T; usage: ConnectionResult<string> }> {
  const { step, messages, applicationId, schema, ledger } = args;
  const user = await requireUser();
  await assertUnderDailyCap(ledger);

  const request: ChatRequest = { step, messages, jsonMode: true, applicationId };
  const budget: Budget = { spent: 0 };

  const first = await runChatWithin(request, user.id, messages, budget, ledger);
  const parsedFirst = parseJsonOutput(first.data, schema);
  if (parsedFirst.ok) return { data: parsedFirst.data, usage: first };

  // Exception (a). Nothing of the model's own output is echoed back to it beyond
  // what it just produced; only the validation complaint is added.
  console.error(`[chat] ${step} output failed validation, one repair retry`, {
    issues: parsedFirst.issues,
  });

  if (budget.spent >= MAX_CHAT_REQUESTS_PER_STEP) {
    throw new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE);
  }

  const repairMessages: ChatMessage[] = [
    ...messages,
    {
      role: 'user',
      content:
        'Your previous response did not match the required JSON schema. ' +
        `Fix exactly these problems and return ONLY the corrected JSON: ${JSON.stringify(parsedFirst.issues)}`,
    },
  ];

  const second = await runChatWithin(request, user.id, repairMessages, budget, ledger);
  const parsedSecond = parseJsonOutput(second.data, schema);
  if (parsedSecond.ok) return { data: parsedSecond.data, usage: second };

  // N3: invalid twice. Treated as N2 — 502, and both attempts are already logged.
  console.error(`[chat] ${step} output failed validation twice`, {
    issues: parsedSecond.issues,
  });
  throw new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE);
}

/**
 * Parse the model's text as JSON and validate it.
 *
 * Returns `issues` as path + code pairs ONLY. `z.ZodError.issues` carries the
 * offending input on some issue types, and here that input is the user's resume
 * text; putting it in a log line or a prompt-visible blob would leak personal
 * data. Path and code are enough for the model to repair its own output.
 */
function parseJsonOutput<T>(
  text: string,
  schema: z.ZodType<T>,
):
  | { ok: true; data: T }
  | { ok: false; issues: { path: string; code: string; message: string }[] } {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(text));
  } catch {
    return { ok: false, issues: [{ path: '', code: 'invalid_json', message: 'not valid JSON' }] };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      // The message is schema-authored copy from lib/copy.ts, never a received value.
      message: issue.message,
    })),
  };
}

/**
 * Strip a ```json fence if the model wrapped its JSON in one.
 *
 * JSON mode makes this rare rather than impossible, and the fallback model is a
 * different vendor with its own habits. Recovering here is not a retry and costs
 * nothing; failing on it would spend a second metered request to fix punctuation.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}
