import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/db/types';

/**
 * DAL for `profiles` (SPEC v2.17, migration 004). Policies: select / insert /
 * update — no DELETE, because nothing in the product removes the ROW. Clearing a
 * name is an update to null; erasure is account deletion, and the row goes with
 * the account through `on delete cascade`.
 *
 * ONE ROW PER USER, keyed by `user_id`, which is why every read here is a
 * `maybeSingle()` and never a list.
 */

/**
 * The caller's own profile, or null when they have never saved one.
 *
 * NULL IS A NORMAL STATE and the app is built for it: the display name is
 * optional, so "no row" and "a row with a null name" mean the same thing to
 * every reader and neither is an error. Callers that want the name should use
 * `getDisplayName`.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/**
 * The caller's display name, or null.
 *
 * Collapses the two ways of not having one — no row, or a row whose column is
 * null — into the single answer every consumer actually wants. A blank string is
 * folded into null for the same reason the writer refuses to store one: a name
 * that is present and empty is a third state nothing needs, and it would render
 * as a resume with a blank first line rather than as one asking to be filled in.
 */
export async function getDisplayName(): Promise<string | null> {
  const profile = await getProfile();
  const name = profile?.display_name?.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * Save the caller's display name, or clear it with null.
 *
 * UPSERT, and it is the right shape here even though `documents` is forbidden
 * one: that ban exists because `documents` has no UPDATE policy, so an upsert's
 * update branch would be refused by RLS. `profiles` HAS one, alongside insert,
 * and both carry `with check (auth.uid() = user_id)` — so the row is created on
 * the first save and updated on every one after, under the same ownership test
 * either way.
 *
 * `userId` comes from the caller's verified session and never from a form field:
 * the policies would refuse a forged owner, but as a database error mapped to a
 * 500 rather than as something that cannot be expressed.
 */
export async function upsertDisplayName(
  userId: string,
  displayName: string | null,
): Promise<Profile> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}
