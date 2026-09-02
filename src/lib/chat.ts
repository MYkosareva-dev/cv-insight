import 'server-only';

import type { User } from '@supabase/supabase-js';

import { getUser } from '@/lib/supabase/server';
import {
  type ChatMessage,
  type ConnectionResult,
  type LlmStep,
  chatCompletion,
} from '@/lib/openrouter/server';

/**
 * GATE — completions. Phase 0 stub.
 *
 * Every parse_vacancy / generate / judge call goes through here. The gate calls
 * getUser() FIRST and refuses without a verified user: this chokepoint is what
 * keeps an anonymous POST from spending money (CLAUDE.md, "AI model calls").
 *
 * This gate guards a spend the user explicitly asked for. Embedding spends —
 * which can happen as a SIDE EFFECT of saving a career item — are guarded
 * separately by `lib/retrieval.ts`.
 *
 * Retries allowed here, and only these two, both inside one user-initiated
 * submit: (a) one repair retry when JSON-mode output fails Zod validation, with
 * the Zod error appended; (b) one network retry after 2 s when the request
 * itself errored. No debounce-driven calls, no background refresh, no ladders.
 */

export class UnauthorizedError extends Error {
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('No verified user.');
  }
}

/** Refuses without a verified user. Called first in every exported function. */
async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export type ChatStep = Extract<LlmStep, 'import_resume' | 'parse_vacancy' | 'generate' | 'judge'>;

export type ChatRequest = {
  step: ChatStep;
  /** Built server-side in lib/prompts.ts. Never accepted from the client. */
  messages: ChatMessage[];
  jsonMode: boolean;
  /** For the llm_calls row; null when the call is not tied to an application. */
  applicationId: string | null;
};

/**
 * Run a completion for the verified user, log it to `llm_calls`
 * (fire-and-forget), and return the raw text.
 */
export async function runChat(_request: ChatRequest): Promise<ConnectionResult<string>> {
  await requireUser();
  void chatCompletion; // wired up in the AI-pipeline phase
  throw new Error('Chat gate is a phase-0 stub — not implemented yet.');
}
