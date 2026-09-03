import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';
import { AUTH, SETTINGS } from '@/lib/copy';
import { getUser } from '@/lib/supabase/server';

export const metadata = { title: 'Settings — CV Insight' };

/**
 * Account screen (SPEC Block E): email read-only, sign out, danger zone.
 *
 * The (app) layout has already verified the session, so `user` is non-null by
 * the time this renders; the fallback is defensive, not a second gate.
 */
export default async function SettingsPage() {
  const user = await getUser();

  return (
    <section className="flex max-w-xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">{SETTINGS.title}</h1>

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
