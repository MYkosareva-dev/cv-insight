import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { DisplayNameForm } from '@/components/display-name-form';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';
import { AUTH, SETTINGS } from '@/lib/copy';
import { getDisplayName } from '@/lib/db/profiles';
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
 */
export default async function SettingsPage() {
  const [user, displayName] = await Promise.all([getUser(), getDisplayName()]);

  return (
    <section className="flex max-w-xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">{SETTINGS.title}</h1>

      <DisplayNameForm displayName={displayName} />

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
