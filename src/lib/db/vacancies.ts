import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { ParsedVacancy, Vacancy } from '@/lib/db/types';

/**
 * DAL for `vacancies`. Policies: select / insert / update (no user DELETE in
 * MVP — erasure happens via account deletion; FK cascades are not blocked
 * by RLS).
 */

export async function getVacancy(id: string): Promise<Vacancy | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('vacancies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Vacancy | null) ?? null;
}

export async function insertVacancy(_userId: string, _rawText: string): Promise<Vacancy> {
  throw new Error('insertVacancy is a phase-0 stub — implemented with the scan phase.');
}

export async function setVacancyParsed(_id: string, _parsed: ParsedVacancy): Promise<void> {
  throw new Error('setVacancyParsed is a phase-0 stub — implemented with the scan phase.');
}
