import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { DisplayNameForm } from '@/components/display-name-form';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';
import { AUTH, SETTINGS } from '@/lib/copy';
import { getProfile } from '@/lib/db/profiles';
import { getUser } from '@/lib/supabase/server';

export const metadata = { title: 'Settings — CV Insight' };

/**
 * Account screen (SPEC Block E): display name, email read-only, sign out, danger
 * zone.
 *
 * The (app) layout has already verified the session, so `user` is non-null by
 * the time this renders; the fallback is defensive, not a second gate.
 *
 * The display name (v2.17) is read through the DAL under the user's own session,
 * so RLS scopes it — this page never asks for a name by id. `null` is a normal
 * answer and renders an empty optional field, not an error.
 *
 * `getProfile` and NOT `getDisplayName`: the pipeline's reader swallows a failed
 * read and falls back to the placeholder, because losing a paid run over an
 * optional field would be the worse trade. Here the feature IS the row, so a
 * failed read has to be SAID rather than shown as an empty field — an empty
 * field with no explanation reads as "the app forgot my name".
 *
 * SAID, AND NOT THROWN. Letting it reach the error boundary was the first
 * attempt and it is disproportionate twice over: a whole Settings screen lost to
 * one optional field, and — observed, not theorised — Next prefetches the
 * sidebar's /settings link from every member route, so the throw surfaced on
 * pages that never asked for a profile and broke navigation across the app. The
 * page renders, the field is empty, and the form says the read failed.
 */
export default async function SettingsPage() {
  const user = await getUser();

  let displayName: string | null = null;
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
  } catch (err) {
    readFailed = true;
    // Metadata only: the message could carry the name, which is personal data.
    console.error('[settings] could not read the profile', {
      name: err instanceof Error ? err.name : typeof err,
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">{SETTINGS.title}</h1>

      <DisplayNameForm displayName={displayName} readFailed={readFailed} />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{SETTINGS.emailLabel}</span>
        <p className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm">
          {user?.email ?? '—'}
        </p>
      </div>

      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          {AUTH.signOut}
        </Button>
      </form>

      <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-destructive text-sm font-semibold">{SETTINGS.dangerZone}</h2>
        <DeleteAccountDialog />
      </div>
    </section>
  );
}
