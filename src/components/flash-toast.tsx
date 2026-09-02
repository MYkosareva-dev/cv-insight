'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { noticeFor } from '@/lib/copy';

/**
 * Shows a one-shot toast for `?notice=<key>` (SPEC Block E, "Toast mechanism").
 *
 * A Server Action that redirects cannot fire a client toast, so it appends the
 * key and this component turns it into one. Mounted in the (auth) and (app)
 * layouts.
 *
 * Two things it deliberately does NOT do:
 *  - It never renders the query value. `noticeFor` maps a known key to a string
 *    from lib/copy.ts and returns null for anything else, so a crafted URL
 *    cannot put arbitrary words in the app's own voice.
 *  - It never fires twice for one navigation. `router.replace` re-renders this
 *    component, and React 18 StrictMode mounts effects twice in development;
 *    the ref guards both.
 */
export function FlashToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shown = useRef<string | null>(null);

  const key = searchParams.get('notice');

  useEffect(() => {
    if (!key || shown.current === key) return;
    const message = noticeFor(key);
    shown.current = key;

    // Strip the param either way, so an unknown key does not survive in the URL
    // and re-fire on the next navigation.
    const next = new URLSearchParams(searchParams);
    next.delete('notice');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

    if (message) toast.success(message);
  }, [key, pathname, router, searchParams]);

  return null;
}
