import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ParsedVacancy, Vacancy } from '@/lib/db/types';

/**
 * DAL for `vacancies`. Policies: select / insert / update (no user DELETE in
 * MVP — erasure happens via account deletion; FK cascades are not blocked
 * by RLS).
 *
 * Ownership is never passed in except on the insert, where it is stamped from
 * the handler's verified user: the server client carries the session, so RLS
 * scopes every other statement to auth.uid() and no ownership filter appears in
 * this file.
 */

export async function getVacancy(id: string): Promise<Vacancy | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('vacancies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Vacancy | null) ?? null;
}

/**
 * The row is written BEFORE the posting is parsed, and that order is US-2 step
 * 5: when the AI step fails, "your vacancy was saved" has to be a true sentence.
 * A single insert-after-parse would lose the text the user pasted on exactly the
 * path where the toast promises it was kept.
 *
 * `title` and `company` stay null until the parser fills them (`setVacancyParsed`),
 * because they are the parser's output and inventing a title from the first line
 * of the posting would be the app reporting something it never read.
 */
export async function insertVacancy(userId: string, rawText: string): Promise<Vacancy> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vacancies')
    .insert({ user_id: userId, raw_text: rawText })
    .select('*')
    .single();
  if (error) throw error;
  return data as Vacancy;
}

/**
 * Store the P1 result: the parsed JSON plus the two columns denormalized out of
 * it for the `/applications` table, which lists Position and Company without
 * reading the whole `parsed` blob for every row.
 */
export async function setVacancyParsed(id: string, parsed: ParsedVacancy): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('vacancies')
    .update({ title: parsed.title, company: parsed.company, parsed })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Position and Company for a page of applications, by vacancy id.
 *
 * A second read joined by a Map in the page rather than a nested PostgREST
 * select from the applications DAL — the same shape `/career` uses for
 * `imports`. One DAL per table means the `applications` DAL does not learn the
 * `vacancies` row shape.
 *
 * Three columns and not `*`: `raw_text` is up to 20,000 characters of personal
 * data per row and the list renders none of it.
 */
export async function listVacancyHeadings(
  ids: string[],
): Promise<Pick<Vacancy, 'id' | 'title' | 'company'>[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vacancies')
    .select('id, title, company')
    .in('id', ids);
  if (error) throw error;
  return (data ?? []) as Pick<Vacancy, 'id' | 'title' | 'company'>[];
}
