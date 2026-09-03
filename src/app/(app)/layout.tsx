import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { FlashToast } from '@/components/flash-toast';
import { Toaster } from '@/components/ui/sonner';
import { AUTH } from '@/lib/copy';
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
        <main className="flex-1 p-4 md:p-8">{children}</main>
        {/*
          Art. 12(1): the privacy statement has to be reachable from anywhere in the
          app, not only from the signed-out screens.
        */}
        <footer className="text-muted-foreground p-4 text-xs md:px-8">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            {AUTH.privacyLink}
          </Link>
        </footer>
      </div>
    </div>
  );
}
