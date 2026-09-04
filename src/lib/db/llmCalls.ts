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
 * The window /quality computes over (SPEC v2.20).
 *
 * A CEILING AND NOT A FILTER, and the screen states it rather than hiding it.
 * `llm_calls` has no aggregate function and adding one would be a SQL function
 * in a migration this phase does not make, so the totals are summed in process
 * over the rows read — which means there has to be a bound, and a bound means
 * the words "total cost" are only true of what was read. Rule B7 caps a user at
 * 50 chat calls a day, so 1,000 rows is roughly three weeks of heavy use; when
 * the ceiling is actually reached the page says the older calls are not counted,
 * because a total that quietly stops at a limit is exactly the untraceable
 * figure that screen exists not to print.
 */
export const QUALITY_CALL_WINDOW = 1_000;

/**
 * Every recent call, newest first, for the /quality dashboard.
 *
 * RLS scopes it to the caller, and there is no user id parameter here for the
 * same reason there is none anywhere else in this DAL: the identity comes from
 * the session the client carries, so this function has no vocabulary to ask for
 * another account's rows.
 *
 * Separate from `listRecentLlmCalls`, which answers Block E's "last 50" table
 * and is a different question with a different bound. One function taking a
 * limit would make the table and the totals share a number that must be allowed
 * to differ.
 */
export async function listLlmCallsForQuality(
  limit = QUALITY_CALL_WINDOW,
): Promise<LlmCall[]> {
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
 * The `generate` rows for ONE application, newest first (v2.22).
 *
 * So the result screen can say which model wrote the resume, and say it loudly
 * when that model was the fallback. `llm_calls` already records the model that
 * actually served and has carried an `application_id` on every pipeline row
 * since v2.16, so this needs no new column and no migration — it is a read of
 * evidence the app was already keeping and only showing on `/quality`.
 *
 * BOUNDED, because a regenerate adds rows and this is rendered on every visit to
 * the screen. The bound is generous relative to what the copy uses (the newest
 * row, and whether every row fell back), and small enough that the read stays a
 * single indexed lookup.
 *
 * RLS scopes it to the caller, and there is no user id parameter for the same
 * reason there is none anywhere else in this DAL: the identity comes from the
 * session. The application id is not an identity — a wrong one yields no rows.
 */
export async function listGenerateCallsForApplication(
  applicationId: string,
  limit = 50,
): Promise<LlmCall[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('llm_calls')
    .select('*')
    .eq('application_id', applicationId)
    .eq('step', 'generate')
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
