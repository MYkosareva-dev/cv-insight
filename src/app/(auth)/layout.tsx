import Link from 'next/link';
import { Suspense } from 'react';

import { FlashToast } from '@/components/flash-toast';
import { Toaster } from '@/components/ui/sonner';
import { AUTH } from '@/lib/copy';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      {/*
        Suspense because FlashToast reads useSearchParams: without it, every page
        under this layout would be forced dynamic (or fail the build) just to
        host a toast.
      */}
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <Toaster />

      <div className="border-border w-full max-w-[400px] rounded-lg border p-6 shadow-sm">
        {children}
      </div>
      {/*
        Both legal pages sit here, not just Privacy (v2.24). The signed-out
        screens are where a visitor who has not decided to sign up reads them,
        so this footer is the one that matters most for reachability.
      */}
      <div className="text-muted-foreground flex gap-4 text-xs">
        <Link href="/privacy" className="underline-offset-4 hover:underline">
          {AUTH.privacyLink}
        </Link>
        <Link href="/impressum" className="underline-offset-4 hover:underline">
          {AUTH.impressumLink}
        </Link>
      </div>
    </div>
  );
}
