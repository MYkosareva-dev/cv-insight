import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/db/types';
import { EMPTY_CONTACTS, type ResumeContacts, contactsOf } from '@/lib/resumeHeader';

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
 *
 * FILTERED BY OWNER *AND* FENCED BY RLS, which is the pairing CLAUDE.md
 * requires of `match_documents` — `security invoker`, filtering on `auth.uid()`
 * inside the function, with RLS underneath. This read used to rest on RLS alone
 * for at-most-one-row. It was safe (a second row would make `maybeSingle()`
 * throw rather than pick one), and safe on one mechanism is still one mechanism,
 * on a table that exists to hold a person's name.
 *
 * `userId` comes from the caller's verified session, the same rule
 * `upsertDisplayName` states below: an id from anywhere else could disagree with
 * the session, and the filter would then be describing a different user from the
 * one RLS is about to enforce. Taken as an argument rather than read here,
 * because all four call sites already hold a verified user and a second
 * `getUser()` is a real auth round trip.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
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
 *
 * THIS ONE NEVER THROWS, and `getProfile` above still does. The difference is
 * who is asking. Settings reads the profile to render and to save it, and a
 * failure there must be visible — the feature IS the row, so hiding a broken
 * read would leave a user typing a name into a field that quietly forgets it.
 * The generation pipeline is the opposite case: the name is one optional line of
 * a document the user has already paid a Sonnet call and a Haiku call for, and
 * losing that run to report a profile lookup would take their money and their
 * work for a field they may never have filled in.
 *
 * So a failure here degrades to "no name saved", which is a state the app
 * already handles honestly and visibly: the resume gets the `[YOUR NAME]`
 * placeholder, the editor says so, and the export warns. Nothing is silently
 * wrong — the user sees exactly what the app does not know. Same shape as
 * indexing, where an embedding failure is a warning and never a failed save
 * (CLAUDE.md, Embeddings).
 *
 * It is also what makes the missing-migration state legible rather than fatal:
 * before `004_profiles.sql` is applied, every read fails, the pipeline carries
 * on with the placeholder, and the Settings field — which does NOT swallow —
 * reports the error where the feature lives.
 */
export async function getDisplayName(userId: string): Promise<string | null> {
  let profile: Profile | null;
  try {
    profile = await getProfile(userId);
  } catch (err) {
    // Metadata only: an error message could carry the name, which is personal
    // data. The name of the error is enough to tell a missing table from a
    // network fault in a log.
    console.error('[profiles] could not read the display name; using the placeholder', {
      name: err instanceof Error ? err.name : typeof err,
    });
    return null;
  }
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

/**
 * Save the caller's contact details (SPEC v2.20, migration 005).
 *
 * A SECOND WRITER RATHER THAN A WIDER ONE, and the reason is what each form can
 * see. `upsertDisplayName` is given a name and nothing else; if it also wrote the
 * contact columns it would have to write them as null, and saving a name from the
 * Settings name field would silently erase a phone number the user typed into the
 * field below it. Two forms, two writes, each touching only its own columns —
 * which is what an upsert's UPDATE branch does when it is given a partial object.
 *
 * THE INSERT BRANCH IS WHY `display_name` IS ABSENT HERE RATHER THAN NULL. A user
 * who saves contacts before ever saving a name has no row yet, so this upsert
 * INSERTS one; a `display_name: null` in the payload would be indistinguishable
 * from that, but on the UPDATE branch it would clear a stored name. Omitting the
 * key leaves it to the column default on insert and untouched on update, which is
 * the behaviour both branches need.
 *
 * `userId` comes from the caller's verified session, never from a form field. The
 * policies would refuse a forged owner, but as a database error mapped to a 500
 * rather than as something that cannot be expressed.
 *
 * IT THROWS WHEN THE MIGRATION IS NOT APPLIED, and the action above it turns that
 * into its own sentence. Before `005_profile_contacts.sql` runs these columns do
 * not exist, and the write is refused by PostgREST with `PGRST204` before any SQL
 * runs — which is a true and useful failure, not something to swallow: the
 * alternative is a form that accepts input and quietly keeps none of it. The
 * action names both codes it acts on and why.
 */
export async function upsertContacts(
  userId: string,
  contacts: {
    contactEmail: string | null;
    phone: string | null;
    location: string | null;
    linkedinUrl: string | null;
    githubUrl: string | null;
    openToRemote: boolean;
  },
): Promise<Profile> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        contact_email: contacts.contactEmail,
        phone: contacts.phone,
        location: contacts.location,
        linkedin_url: contacts.linkedinUrl,
        github_url: contacts.githubUrl,
        open_to_remote: contacts.openToRemote,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}

/**
 * The caller's contact details, or none.
 *
 * THIS ONE NEVER THROWS, for the same reason `getDisplayName` does not: it is
 * read by the GENERATION pipeline, and a run the user has already paid a Sonnet
 * call and a Haiku call for must not be lost to a profile lookup. A failure
 * degrades to "no contact details", which is a state the app handles honestly —
 * the header block simply collapses, exactly as it does for a user who has filled
 * nothing in.
 *
 * It is also what makes the un-applied-migration state legible rather than fatal:
 * `select('*')` succeeds against a `profiles` table without the 005 columns and
 * returns a row missing those keys, which `contactsOf` reads as empty. The
 * Settings form — which does NOT swallow — is where the missing migration is
 * reported, because that is where the feature lives.
 */
export async function getContacts(userId: string): Promise<ResumeContacts> {
  try {
    return contactsOf(await getProfile(userId));
  } catch (err) {
    // Metadata only: the message could carry an email address or a phone number.
    console.error('[profiles] could not read the contact details; the header collapses', {
      name: err instanceof Error ? err.name : typeof err,
    });
    return EMPTY_CONTACTS;
  }
}
