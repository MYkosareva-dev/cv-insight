import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { FlashToast } from '@/components/flash-toast';
import { SignOutButton } from '@/components/sign-out-button';
import { Toaster } from '@/components/ui/sonner';
import { AUTH, DEMO_NOTICE } from '@/lib/copy';
import { getUser } from '@/lib/supabase/server';

/**
 * Second fence behind src/middleware.ts: the session is verified on the SERVER
 * before any protected page renders, with getUser() — never getSession()
 * (CLAUDE.md, Authentication rules 2 and 3).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <Toaster />
      <AppSidebar />
      <div className="flex w-full max-w-5xl flex-1 flex-col">
        {/*
          Sign out, top-right, on every member screen (SPEC v2.20, owner
          feedback). It lived on /settings, which is not where anyone looks for
          it: signing out is wanted from whatever screen the user is on, and it
          changes no setting. `justify-end` and nothing else in the bar, so the
          page's own heading stays the first thing read on every screen.
        */}
        <header className="flex justify-end px-4 pt-4 md:px-8">
          <SignOutButton />
        </header>
        {/*
          THE DEMONSTRATION-DEPLOYMENT NOTICE (v2.25, gate finding `eu-2`).

          On the SHELL rather than on /scan or /career, because the constraint is
          not about one screen: text arrives through the scan panel, the import
          dialog and the editor, and a notice attached to one of them is absent
          from the other two. Here it is on every screen that can send anything
          to a model.

          It is `role="note"` and not a dismissible banner. There is no dismiss
          control on purpose — a notice the user can close is a notice that is
          absent for every session after the first, and this one has to hold for
          the whole life of the deployment, not for one page view. It is styled
          quietly rather than as an alarm: it is a standing condition of the
          deployment, not an error someone must act on now.
        */}
        <div
          role="note"
          className="border-muted-foreground/20 bg-muted/40 text-muted-foreground mx-4 mt-2 rounded-md border px-3 py-2 text-xs md:mx-8"
        >
          <strong className="font-medium">{DEMO_NOTICE.lead}</strong> {DEMO_NOTICE.body}
        </div>
        <main className="flex-1 px-4 pt-2 pb-4 md:px-8 md:pb-8">{children}</main>
        {/*
          Art. 12(1): the privacy statement has to be reachable from anywhere in the
          app, not only from the signed-out screens.
        */}
        <footer className="text-muted-foreground flex gap-4 p-4 text-xs md:px-8">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            {AUTH.privacyLink}
          </Link>
          <Link href="/impressum" className="underline-offset-4 hover:underline">
            {AUTH.impressumLink}
          </Link>
        </footer>
      </div>
    </div>
  );
}
