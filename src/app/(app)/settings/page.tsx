import { ContactsForm } from '@/components/contacts-form';
import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { DisplayNameForm } from '@/components/display-name-form';
import { SETTINGS } from '@/lib/copy';
import { getProfile } from '@/lib/db/profiles';
import { EMPTY_CONTACTS, contactsOf } from '@/lib/resumeHeader';
import { getUser } from '@/lib/supabase/server';

export const metadata = { title: 'Settings — CV Insight' };

/**
 * Account screen (SPEC Block E): name, contact details, email read-only, danger
 * zone.
 *
 * The (app) layout has already verified the session, so `user` is non-null by
 * the time this renders; the fallback is defensive, not a second gate.
 *
 * The profile (v2.17 name, v2.20 contacts) is read through the DAL under the
 * user's own session, so RLS scopes it — this page never asks for a profile by
 * id. `null` is a normal answer and renders empty optional fields, not an error.
 *
 * `getProfile` and NOT `getDisplayName` / `getContacts`: the pipeline's readers
 * swallow a failed read and fall back to a placeholder and an empty header,
 * because losing a paid run over an optional field would be the worse trade.
 * Here the feature IS the row, so a failed read has to be SAID rather than shown
 * as empty fields — empty fields with no explanation read as "the app forgot my
 * details".
 *
 * SAID, AND NOT THROWN. Letting it reach the error boundary was the first attempt
 * and it is disproportionate twice over: a whole Settings screen lost to optional
 * fields, and — observed, not theorised — Next prefetches the sidebar's /settings
 * link from every member route, so the throw surfaced on pages that never asked
 * for a profile and broke navigation across the app. The page renders, the fields
 * are empty, and each form says the read failed.
 *
 * ONE READ FOR BOTH FORMS. `select('*')` already returns every column, so asking
 * twice would be a second round trip for data the first one brought back — and
 * two reads could disagree, leaving one form reporting a failure the other did
 * not have.
 *
 * NO [Sign out] BUTTON HERE (v2.20, from owner feedback). It moved to an icon in
 * the top-right of the app shell, which is where users look for it — a sign-out
 * buried on the settings screen is one that has to be hunted for on every screen.
 */
export default async function SettingsPage() {
  const user = await getUser();

  let displayName: string | null = null;
  let contacts = EMPTY_CONTACTS;
  let readFailed = false;
  try {
    /**
     * `getProfile` takes the owner id and filters on it, so RLS is no longer the
     * only thing keeping this read to one user's row. `user` is nullable here
     * because `getUser()` says so — the middleware fence means a signed-out
     * visitor never reaches this page, and the ternary states that rather than
     * asserting it with a `!`: no user means no profile to read, which is the
     * same empty field a user without a saved name sees.
     */
    const profile = user ? await getProfile(user.id) : null;
    displayName = profile?.display_name?.trim() || null;
    // Reads a row without the 005 columns as "nothing filled in", which is what
    // it is until the owner applies the migration.
    contacts = contactsOf(profile);
  } catch (err) {
    readFailed = true;
    // Metadata only: the message could carry the name, an email address or a
    // phone number — all of it personal data.
    console.error('[settings] could not read the profile', {
      name: err instanceof Error ? err.name : typeof err,
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{SETTINGS.title}</h1>

      <DisplayNameForm displayName={displayName} readFailed={readFailed} />

      {/*
        A LIGHT DIVIDER between the identity block and the account block (v2.20,
        owner feedback). The three blocks above it are things the user WRITES; the
        email below it is a fact about the account they cannot change. A rule is
        the cheapest way to say that, and it needs no heading to do it.
      */}
      <hr className="border-border" />

      <ContactsForm contacts={contacts} readFailed={readFailed} />

      <hr className="border-border" />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{SETTINGS.emailLabel}</span>
        <p className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm">
          {user?.email ?? '—'}
        </p>
      </div>

      {/* Unchanged, deliberately: an irreversible action keeps the shape the
          owner already reviewed. */}
      <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-destructive text-sm font-semibold">{SETTINGS.dangerZone}</h2>
        <DeleteAccountDialog />
      </div>
    </section>
  );
}
