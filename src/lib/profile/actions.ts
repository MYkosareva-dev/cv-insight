'use server';

import { revalidatePath } from 'next/cache';

import { SETTINGS } from '@/lib/copy';
import { upsertContacts, upsertDisplayName } from '@/lib/db/profiles';
import { getUser } from '@/lib/supabase/server';
import {
  type ContactsState,
  type DisplayNameState,
  contactsFieldErrors,
  contactsSchema,
  displayNameSchema,
} from '@/lib/validation';

/**
 * PostgREST forwards Postgres' own SQLSTATE, and 42703 is `undefined_column` —
 * the answer until `005_profile_contacts.sql` has been applied.
 *
 * `'use server'` permits only async exports, so this cannot be a module constant
 * here; it is inlined at its one use site below and named in this comment
 * instead. The code is the contract, the message is not: the message names the
 * missing column and changes with the schema.
 */

/**
 * Save the user's display name (SPEC v2.17, Block E Settings).
 *
 * A SERVER ACTION rather than a route handler, and the choice is not cosmetic.
 * Block D numbers the app's endpoints and this is not one of them: it is a form
 * on a Server Component with no client state to keep, so an action keeps the API
 * surface unchanged and the whole write on the server. The same reasoning
 * `lib/auth/actions.ts` records for sign-in.
 *
 * A Server Action IS a public endpoint, so the Zod parse here is the real gate —
 * a client-side check validates nothing — and `getUser()` runs first, exactly as
 * it does in a route handler. The verified id is the only source of `user_id`:
 * the form carries no owner field, and the RLS policies would refuse a forged
 * one anyway.
 *
 * This module exports ONE async function and nothing else, because `'use server'`
 * permits nothing else — a constant here is a build error. The bounds and the
 * copy therefore live where every other schema and string lives.
 */

export async function saveDisplayNameAction(
  _previous: DisplayNameState,
  formData: FormData,
): Promise<DisplayNameState> {
  const user = await getUser();
  // The (app) layout has already verified the session, so this is the second
  // fence rather than the first — and it is the one that matters here, because
  // an action is reachable without the page that renders it.
  if (!user) return { error: SETTINGS.displayNameSignedOut, notice: null };

  const parsed = displayNameSchema.safeParse({
    displayName: String(formData.get('displayName') ?? ''),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? SETTINGS.displayNameFailed,
      notice: null,
    };
  }

  try {
    await upsertDisplayName(user.id, parsed.data.displayName);
  } catch (err) {
    // Metadata only: the message could carry the name, which is personal data.
    console.error('[profile] saving the display name failed', {
      name: err instanceof Error ? err.name : typeof err,
    });
    return { error: SETTINGS.displayNameFailed, notice: null };
  }

  // The Settings page is a Server Component and reads the name on render; without
  // this the saved value only reappears after a hard reload.
  revalidatePath('/settings');

  /**
   * Two notices, because clearing a name is a real edit with a real consequence —
   * the next resume goes back to the placeholder — and reporting it as "Name
   * saved." would describe the opposite of what just happened.
   */
  return {
    error: null,
    notice: parsed.data.displayName ? SETTINGS.displayNameSaved : SETTINGS.displayNameCleared,
  };
}

/**
 * Save the user's contact details (SPEC v2.20, Block E Settings).
 *
 * A SERVER ACTION, for the reason `saveDisplayNameAction` above is one: Block D
 * numbers the app's endpoints and this is not one of them — a form on a Server
 * Component with no client state to keep. The Zod parse here is the real gate,
 * because an action IS a public endpoint, and `getUser()` runs first exactly as
 * it does in a route handler. The verified id is the only source of `user_id`.
 *
 * THE UNAPPLIED MIGRATION GETS ITS OWN SENTENCE. Postgres answers 42703
 * (`undefined_column`) until `005_profile_contacts.sql` has been run in the
 * dashboard, and "try again" is advice that cannot work in that state — every
 * save will refuse identically. The app tells the two apart the way it tells
 * three retrieval outcomes and four sign-in outcomes apart: a state with its own
 * cause gets its own copy.
 */
export async function saveContactsAction(
  _previous: ContactsState,
  formData: FormData,
): Promise<ContactsState> {
  const user = await getUser();
  if (!user) {
    return { fieldErrors: {}, formError: SETTINGS.contactsSignedOut, notice: null };
  }

  const parsed = contactsSchema.safeParse({
    contactEmail: String(formData.get('contactEmail') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    location: String(formData.get('location') ?? ''),
    linkedinUrl: String(formData.get('linkedinUrl') ?? ''),
    githubUrl: String(formData.get('githubUrl') ?? ''),
    // Absent when the box is unticked — an HTML checkbox sends nothing at all.
    openToRemote: formData.get('openToRemote') ?? undefined,
  });
  if (!parsed.success) {
    return {
      fieldErrors: contactsFieldErrors(parsed.error),
      formError: null,
      notice: null,
    };
  }

  try {
    await upsertContacts(user.id, parsed.data);
  } catch (err) {
    /**
     * The columns are not there yet. Read off the PostgREST error code rather
     * than off the message: the message names the missing column and is a
     * moving target, the code is the contract.
     */
    const code = (err as { code?: string } | null)?.code;
    // Metadata only: the message could carry an email address or a phone number.
    console.error('[profile] saving the contact details failed', {
      name: err instanceof Error ? err.name : typeof err,
      code,
    });
    return {
      fieldErrors: {},
      formError:
        code === '42703' ? SETTINGS.contactsNotMigrated : SETTINGS.contactsFailed,
      notice: null,
    };
  }

  // Settings reads the row on render; without this the saved values only
  // reappear after a hard reload.
  revalidatePath('/settings');

  /**
   * Two notices, because clearing every field is a real edit with a real
   * consequence — the next resume loses its header block — and reporting it as
   * "Contact details saved." would describe the opposite of what happened.
   */
  const anySaved = Boolean(
    parsed.data.contactEmail ||
      parsed.data.phone ||
      parsed.data.location ||
      parsed.data.linkedinUrl ||
      parsed.data.githubUrl ||
      parsed.data.openToRemote,
  );
  return {
    fieldErrors: {},
    formError: null,
    notice: anySaved ? SETTINGS.contactsSaved : SETTINGS.contactsCleared,
  };
}
