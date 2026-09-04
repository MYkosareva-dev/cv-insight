import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { JudgeReport, ResumeVersion } from '@/lib/db/types';

/**
 * DAL for `resume_versions`. APPEND-ONLY by design: policies are select /
 * insert only. An edit produces a NEW version and never mutates an old one.
 * Do not add update or delete paths (CLAUDE.md, "Data access rules").
 */

export async function listResumeVersions(applicationId: string): Promise<ResumeVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('resume_versions')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ResumeVersion[];
}

/**
 * The window /quality computes the rubric shares over (SPEC v2.20).
 *
 * Bounded for the same reason `QUALITY_CALL_WINDOW` is: the shares are counted
 * in process, so the rows have to stop somewhere and the screen says where. One
 * generate run writes one or two rows, so 1,000 rows is several hundred runs —
 * far past the point where a share stops moving.
 */
export const QUALITY_VERSION_WINDOW = 1_000;

/**
 * Every recent version the caller owns, across ALL their applications, newest
 * first — the rubric verdicts /quality reports on.
 *
 * NOT SCOPED TO AN APPLICATION, which is the whole difference from
 * `listResumeVersions` above: this screen is about whether the quality gate
 * works at all, and one application is a sample of one. RLS is what scopes it to
 * the caller, exactly as it does for every other read here; no user id is passed
 * in, so this function cannot be asked for someone else's versions.
 *
 * It reads the `judge` column, which is where the verdicts already live —
 * nothing new is stored to draw this screen, and every figure on it is a count
 * over these rows.
 */
export async function listResumeVersionsForQuality(
  limit = QUALITY_VERSION_WINDOW,
): Promise<ResumeVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('resume_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ResumeVersion[];
}

export async function getLatestResumeVersion(
  applicationId: string,
): Promise<ResumeVersion | null> {
  const versions = await listResumeVersions(applicationId);
  return versions[0] ?? null;
}

/**
 * Append one version. The ONLY write this table has.
 *
 * `resume_versions` is select/insert with no UPDATE and no DELETE policy
 * (CLAUDE.md, "Data access rules"), which is not an oversight to work around: a
 * revision, a user edit and an on-demand quality check each produce a NEW ROW,
 * so the history of what the AI wrote, what the reviewer said about it, and what
 * the user changed stays readable. Two consequences worth knowing before
 * changing anything here:
 *
 *  - The judge report must be in hand BEFORE the insert. There is no path that
 *    writes the content first and patches the verdict on afterwards, because RLS
 *    would refuse the UPDATE. A version whose quality check did not run is
 *    written with `judge: null` and stays that way — an honest "not checked"
 *    rather than a row waiting for a write that can never come.
 *  - Nothing here dedupes. The callers decide whether a row is worth writing;
 *    this function's job is to write the one it is given.
 *
 * `userId` comes from the handler's own `requireApiUser()` and never from a
 * request body: the insert policy is `auth.uid() = user_id`, so a forged owner
 * would be refused by RLS — but as a database error mapped to a 500, instead of
 * never being possible.
 */
export async function insertResumeVersion(row: {
  userId: string;
  applicationId: string;
  content: string;
  source: ResumeVersion['source'];
  judge: JudgeReport | null;
}): Promise<ResumeVersion> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('resume_versions')
    .insert({
      user_id: row.userId,
      application_id: row.applicationId,
      content: row.content,
      source: row.source,
      judge: row.judge,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ResumeVersion;
}
