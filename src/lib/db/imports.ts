import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Import } from '@/lib/db/types';

/**
 * DAL for `imports` (SPEC v2.11). One DAL per table, and DALs are the only files
 * allowed to call `.from()` (CLAUDE.md, "Data access rules"; `scripts/check.mjs`
 * is driven by the same list).
 *
 * Ownership is never passed in and never trusted from the client: the server
 * client carries the user's session, so RLS scopes every statement to
 * `auth.uid()`.
 *
 * Policies: select / insert / update. There is deliberately NO DELETE, and no
 * delete function here to tempt one into existence — removing a source would
 * strip the provenance from every item pointing at it, which is the defect this
 * table was added to fix. Account deletion still clears these rows through the
 * FK cascade to `auth.users`.
 *
 * There is also no update function yet. The UPDATE policy exists because
 * renaming and re-targeting a source are legitimate operations; nothing in the
 * app performs one today, and an unused write path is a liability rather than
 * preparation.
 */

export async function listImports(): Promise<Import[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('imports')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Import[];
}

/**
 * How many imports this user already has — the "Resume N" default is `count + 1`.
 *
 * A `head` count, so the name suggestion costs one cheap round trip rather than
 * pulling every row just to measure the list.
 */
export async function countImports(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('imports')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export type NewImport = Pick<Import, 'name' | 'target_role' | 'source_kind'>;

/**
 * Create the run row, returning it so the caller can stamp `import_id` on the
 * items it is about to insert.
 *
 * `userId` comes from the handler's verified user and is stamped here; it is
 * never read from a request body. RLS would refuse a forged id anyway, but as a
 * database error mapped to a 500 rather than as something that was never
 * possible.
 *
 * Called only AFTER the incoming items have survived the duplicate guard: an
 * import that contributed nothing new should leave no row behind, or a user who
 * re-imports the same file five times accumulates five empty sources.
 */
export async function insertImport(userId: string, row: NewImport): Promise<Import> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('imports')
    .insert({ ...row, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as Import;
}
