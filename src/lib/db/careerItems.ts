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
 * SPEC rule B9: <= 200 career_items per user. Defined in `lib/limits.ts` and
 * re-exported here, because `lib/validation.ts` needs the same number on the
 * client and cannot import a `server-only` module.
 */
export { MAX_CAREER_ITEMS } from '@/lib/limits';

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

/**
 * The items behind a set of retrieved chunks (SPEC v2.16, the generation path).
 *
 * One query rather than one per id, and NOT `listCareerItems()` filtered in
 * memory: a base at rule B9's cap is 200 items of up to 4,000 characters, so
 * reading all of them to keep eight would pull most of a megabyte of the user's
 * own resume text through the process to throw it away.
 *
 * RLS scopes it to the caller either way, so an id belonging to another account
 * simply does not come back — which is why the caller may pass ids straight from
 * a `documents` match without checking them first. Order is NOT preserved by
 * Postgres and the caller re-orders by relevance; returning them in an arbitrary
 * order and saying so is better than a sort that looks meaningful and is not.
 */
export async function listCareerItemsByIds(ids: string[]): Promise<CareerItem[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('career_items').select('*').in('id', ids);
  if (error) throw error;
  return (data ?? []) as CareerItem[];
}

export type NewCareerItem = Pick<CareerItem, 'type' | 'title' | 'content'> &
  Partial<Pick<CareerItem, 'period' | 'source' | 'import_id'>>;

/**
 * Just the three fields the duplicate guard compares (SPEC v2.11).
 *
 * Three columns and not `*`: this runs on every save, and the rows it reads are
 * only ever turned into comparison keys. Pulling `content` is unavoidable — the
 * key includes it — but there is no reason to pull embeddings-adjacent metadata,
 * timestamps or ids that nothing here looks at.
 *
 * Bounded by rule B9 at 200 items per user, so this is a small read by
 * construction rather than by luck.
 */
export async function listItemSignatureFields(): Promise<
  Pick<CareerItem, 'type' | 'title' | 'content'>[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('career_items').select('type, title, content');
  if (error) throw error;
  return (data ?? []) as Pick<CareerItem, 'type' | 'title' | 'content'>[];
}

/**
 * Bulk insert, returning the stored rows.
 *
 * `userId` comes from the handler's `requireApiUser()` and is stamped on every
 * row here. It is never read from the request body: the insert policy is
 * `auth.uid() = user_id`, so a forged id would be refused by RLS anyway — but it
 * would be refused as a database error mapped to a 500, instead of never being
 * possible in the first place.
 *
 * One statement for the whole batch, so a partial write cannot happen (rule B6,
 * "no partial writes"). `select()` returns the inserted rows including their
 * generated ids, which the indexer needs to write `documents.career_item_id`.
 */
export async function insertCareerItems(
  userId: string,
  items: NewCareerItem[],
): Promise<CareerItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('career_items')
    .insert(items.map((item) => ({ ...item, user_id: userId })))
    .select('*');
  if (error) throw error;
  return (data ?? []) as CareerItem[];
}

/**
 * Patch one item, returning the fresh row — or null when no row matched.
 *
 * Null is the ONLY signal the caller gets, and it deliberately does not
 * distinguish "no such id" from "belongs to another user". RLS scopes the UPDATE
 * to `auth.uid()`, so user B patching user A's item simply matches zero rows
 * (edge case S6). The handler answers 404 for both, because a 403 would confirm
 * that someone else's row exists.
 */
export async function updateCareerItem(
  id: string,
  patch: Partial<NewCareerItem>,
): Promise<CareerItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('career_items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as CareerItem | null) ?? null;
}

/**
 * Delete one item. Returns whether a row actually went, so the handler can
 * answer 404 rather than reporting success for an id that never matched.
 *
 * The item's `documents` rows go with it through the FK's `on delete cascade` —
 * no embedding call and no manual cleanup belongs on this path. (Cascades are
 * not blocked by RLS.)
 */
export async function deleteCareerItem(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('career_items')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
