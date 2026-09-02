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

export async function getLatestResumeVersion(
  applicationId: string,
): Promise<ResumeVersion | null> {
  const versions = await listResumeVersions(applicationId);
  return versions[0] ?? null;
}

export async function insertResumeVersion(_row: {
  userId: string;
  applicationId: string;
  content: string;
  source: ResumeVersion['source'];
  judge: JudgeReport | null;
}): Promise<ResumeVersion> {
  throw new Error('insertResumeVersion is a phase-0 stub — implemented with the generate phase.');
}
