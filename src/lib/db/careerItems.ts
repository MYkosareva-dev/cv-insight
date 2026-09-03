import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { CareerItem } from '@/lib/db/types';

/**
 * DAL for `career_items`. One DAL per table, and DALs are the only files
 * allowed to call `.from()` (CLAUDE.md, "Data access rules"; enforced by
 * scripts/check.mjs).
 *
 * Ownership is not passed in and is never trusted from the client: the server
 * client carries the user's session, so RLS scopes every statement to
 * auth.uid(). Policies: select / insert / update / delete.
 */

/**
 * SPEC rule B9: <= 200 career_items per user. Defined in `lib/db/limits.ts` and
 * re-exported here, because `lib/validation.ts` needs the same number on the
 * client and cannot import a `server-only` module.
 */
export { MAX_CAREER_ITEMS } from '@/lib/db/limits';

export async function listCareerItems(): Promise<CareerItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('career_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CareerItem[];
}

export async function countCareerItems(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('career_items')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function getCareerItem(id: string): Promise<CareerItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('career_items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as CareerItem | null) ?? null;
}

export type NewCareerItem = Pick<CareerItem, 'type' | 'title' | 'content'> &
  Partial<Pick<CareerItem, 'period' | 'source'>>;

export async function insertCareerItems(
  _userId: string,
  _items: NewCareerItem[],
): Promise<CareerItem[]> {
  throw new Error('insertCareerItems is a phase-0 stub — implemented with the career-base phase.');
}

export async function updateCareerItem(
  _id: string,
  _patch: Partial<NewCareerItem>,
): Promise<CareerItem | null> {
  throw new Error('updateCareerItem is a phase-0 stub — implemented with the career-base phase.');
}

export async function deleteCareerItem(_id: string): Promise<void> {
  throw new Error('deleteCareerItem is a phase-0 stub — implemented with the career-base phase.');
}
