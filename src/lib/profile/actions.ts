'use server';

import { revalidatePath } from 'next/cache';

import { SETTINGS } from '@/lib/copy';
import { upsertDisplayName } from '@/lib/db/profiles';
import { getUser } from '@/lib/supabase/server';
import { type DisplayNameState, displayNameSchema } from '@/lib/validation';

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
  if (!user) return { error: SETTINGS.displayNameFailed, notice: null };

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
