import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Application, ApplicationStatus, CoverageEntry } from '@/lib/db/types';

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

export async function insertApplication(_row: {
  userId: string;
  vacancyId: string;
  resumeSource: Application['resume_source'];
  sourceResumeText: string | null;
  matchScore: number | null;
  coverage: CoverageEntry[] | null;
}): Promise<Application> {
  throw new Error('insertApplication is a phase-0 stub — implemented with the scan phase.');
}

export async function updateApplication(
  _id: string,
  _patch: { status?: ApplicationStatus; notes?: string },
): Promise<Application | null> {
  throw new Error('updateApplication is a phase-0 stub — implemented with the scan phase.');
}
