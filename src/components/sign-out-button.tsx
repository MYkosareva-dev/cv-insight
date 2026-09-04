import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { signOutAction } from '@/lib/auth/actions';
import { AUTH } from '@/lib/copy';

/**
 * Sign out, as an icon in the top-right of the app shell (SPEC v2.20, from owner
 * feedback).
 *
 * WHY IT MOVED. It was a labelled button on /settings, which is where the app
 * happened to put it rather than where anyone looks for it: signing out is
 * something a user wants from whatever screen they are on, and the top-right
 * corner is where two decades of web applications have taught them to look. It is
 * not a settings CHANGE — nothing is saved — so it did not belong in a column of
 * forms.
 *
 * ICON PLUS AN ACCESSIBLE NAME, never an icon alone. `aria-label` carries the
 * same `AUTH.signOut` string the button used to render, so a screen reader hears
 * "Sign out" and not "button"; `title` gives a pointer user the same words on
 * hover. One string, three surfaces.
 *
 * A SERVER COMPONENT with a plain `<form action={…}>`: `signOutAction` is a
 * Server Action that revalidates the layout and redirects, so no client
 * JavaScript is needed to make this work — and it keeps working with none.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="icon" aria-label={AUTH.signOut} title={AUTH.signOut}>
        <LogOut aria-hidden />
      </Button>
    </form>
  );
}
