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

/** SPEC rule B7: 50 non-embedding calls per user per rolling 24 h. */
export const DAILY_CALL_LIMIT = 50;
const CHAT_STEPS = ['import_resume', 'parse_vacancy', 'generate', 'judge'] as const;

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

/** Rolling 24 h window, not calendar-midnight (edge case T2). Embeddings excluded. */
export async function countCallsInLast24h(): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('llm_calls')
    .select('id', { count: 'exact', head: true })
    .in('step', CHAT_STEPS)
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
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
 */
export function logLlmCall(row: NewLlmCall): void {
  after(async () => {
    try {
      const supabase = await createClient();
      const { error } = await supabase.from('llm_calls').insert(row);
      if (error) throw error;
    } catch (err) {
      // Metadata only — never log resume or vacancy content.
      console.error(
        `[llm_calls] log write failed for step=${row.step} model=${row.model}`,
        err,
      );
    }
  });
}
