import 'server-only';

import { after } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import type { LlmCall } from '@/lib/db/types';

/**
 * DAL for `llm_calls` — the append-only observability log. Policies: select /
 * insert only.
 *
 * Every OpenRouter request writes exactly one row, INCLUDING failures
 * (`ok=false`), with the model that actually answered and `fallback_used`
 * (rule B8). Metadata only: never log resume or vacancy CONTENT.
 */

/**
 * THE CEILINGS LIVE IN `lib/budget.ts`, THE QUERIES LIVE HERE (backlog p4-30).
 *
 * Rule B7's 50 and rule B7a's 100 used to be declared in this file, which
 * imports `server-only` — so check.mjs R6 kept every unit test away from them and
 * the two numbers that decide how much money a day of clicking can spend were
 * untestable by construction. They moved to `lib/budget.ts`, which is pure and
 * already the home of the metered-request arithmetic; a query needs a database
 * client and stays.
 */
const CHAT_STEPS = ['import_resume', 'parse_vacancy', 'generate', 'judge'] as const;

const RESCORE_STEPS = ['rescore'] as const;

export async function listRecentLlmCalls(limit = 50): Promise<LlmCall[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('llm_calls')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as LlmCall[];
}

/**
 * Rows of the given steps in the rolling 24 h window — not calendar-midnight
 * (edge case T2). One query behind both ceilings: two copies of the window this
 * arithmetic depends on could drift, and a cap measuring a different window from
 * the one it documents is a cap nobody can reason about.
 */
async function countStepsInLast24h(steps: readonly string[]): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('llm_calls')
    .select('id', { count: 'exact', head: true })
    .in('step', steps)
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

/** Rule B7: chat steps only. Embeddings excluded by the cap's definition. */
export async function countCallsInLast24h(): Promise<number> {
  return countStepsInLast24h(CHAT_STEPS);
}

/** Rule B7a: `rescore` rows only — the embeddings spend B7 does not count. */
export async function countRescoreCallsInLast24h(): Promise<number> {
  return countStepsInLast24h(RESCORE_STEPS);
}

export type NewLlmCall = Omit<LlmCall, 'id' | 'created_at'>;

/**
 * Fire-and-forget from the user's point of view: the handler never awaits this
 * and a log-write failure must NEVER fail the request (rule B8).
 *
 * Scheduled with `after()` rather than a detached promise. A bare
 * `void (async () => …)()` is not tied to the request lifecycle: on Vercel the
 * function can be frozen once the response is sent, so the insert may never run
 * and `cookies()` — which createClient() needs — can throw outside request
 * scope. Either way the catch would swallow it and B8 would quietly stop
 * holding, with /quality as the only witness. `after()` keeps the work inside
 * the request lifecycle while still running it after the response.
 *
 * The `after()` REGISTRATION is inside the try as well, not just the insert:
 * `after()` itself throws when called outside a request or prerender scope (a
 * script, a worker, a test harness). Left uncaught, that would propagate into
 * the caller and a log-write failure would fail the user's request — which B8
 * forbids unconditionally, not merely on the paths that exist today.
 */
export function logLlmCall(row: NewLlmCall): void {
  // Metadata only — never log resume or vacancy content.
  const context = `step=${row.step} model=${row.model}`;
  try {
    after(async () => {
      try {
        const supabase = await createClient();
        const { error } = await supabase.from('llm_calls').insert(row);
        if (error) throw error;
      } catch (err) {
        console.error(`[llm_calls] log write failed for ${context}`, err);
      }
    });
  } catch (err) {
    console.error(`[llm_calls] could not schedule log write for ${context}`, err);
  }
}
