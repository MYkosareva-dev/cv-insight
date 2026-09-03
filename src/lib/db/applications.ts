import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Application, ApplicationStatus, CoverageMap } from '@/lib/db/types';

/**
 * DAL for `applications`. Policies: select / insert / update (no user DELETE
 * in MVP). A row absent OR owned by another user is indistinguishable here —
 * callers must answer 404, never 403 (SPEC edge case S3).
 */

export async function listApplications(): Promise<Application[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Application[];
}

export async function getApplication(id: string): Promise<Application | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Application | null) ?? null;
}

/**
 * Create the run's row.
 *
 * Inserted as a DRAFT before the AI steps and updated with the result
 * afterwards (SPEC v2.12; `applications` has an UPDATE policy, which is what
 * makes that order available). Two consequences, both of them the point:
 *   - a scan that dies in the parse, the match, or on rule B7's daily cap still
 *     leaves the row US-2 step 5 promises, with `match_score` and `coverage`
 *     null — never an orphaned `vacancies` row that no screen can reach and no
 *     policy can delete;
 *   - the `parse_vacancy` row in `llm_calls` can carry this `application_id`,
 *     since `llm_calls` is append-only and could never be linked afterwards.
 *
 * `userId` comes from the handler's `requireApiUser()`. It is never read from a
 * request body: the insert policy is `auth.uid() = user_id`, so a forged id
 * would be refused by RLS — but as a database error mapped to a 500, instead of
 * never being possible.
 */
export async function insertApplication(row: {
  userId: string;
  vacancyId: string;
  resumeSource: Application['resume_source'];
  sourceResumeText: string | null;
}): Promise<Application> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .insert({
      user_id: row.userId,
      vacancy_id: row.vacancyId,
      resume_source: row.resumeSource,
      source_resume_text: row.sourceResumeText,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Application;
}

/**
 * Patch one application, returning the fresh row — or null when no row matched.
 *
 * Null is the ONLY signal the caller gets, and it deliberately does not
 * distinguish "no such id" from "belongs to another user": RLS scopes the UPDATE
 * to auth.uid(), so another user's id simply matches zero rows and the handler
 * answers 404 for both (S3/S6). A 403 would confirm that someone else's row
 * exists.
 *
 * `matchScore` / `coverage` are how a scan commits its result onto the draft it
 * created; `status` / `notes` are the user's own edits (Block D #8). One function
 * because it is one UPDATE policy and one row — the handlers decide which fields
 * they are allowed to send, and the two API surfaces never overlap.
 */
export async function updateApplication(
  id: string,
  patch: {
    status?: ApplicationStatus;
    notes?: string;
    matchScore?: number | null;
    coverage?: CoverageMap | null;
  },
): Promise<Application | null> {
  const columns: Record<string, unknown> = {};
  if (patch.status !== undefined) columns.status = patch.status;
  if (patch.notes !== undefined) columns.notes = patch.notes;
  if (patch.matchScore !== undefined) columns.match_score = patch.matchScore;
  if (patch.coverage !== undefined) columns.coverage = patch.coverage;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('applications')
    .update(columns)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as Application | null) ?? null;
}
