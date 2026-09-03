'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { RESULT, SCAN } from '@/lib/copy';

/**
 * [Run analysis] on a draft whose AI step never completed — the button that
 * makes US-2 step 5's toast ("Your vacancy was saved — retry from
 * Applications.") a true sentence.
 *
 * A RETRY IS A BUTTON THE USER PRESSES (CLAUDE.md, "AI model calls"). This is
 * that button: one press, one metered scan, no backoff ladder and nothing
 * automatic. The two in-request exceptions inside `lib/chat.ts` are a separate
 * budget and are not affected by it.
 *
 * The request body is the application id and nothing else: the vacancy text and
 * the resume source come from the stored row, so a re-run cannot analyse
 * something other than what it claims to be retrying.
 */
export function RerunScan({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  /** One click, one spend — set synchronously, unlike the `disabled` prop. */
  const inFlight = useRef(false);

  async function rerun() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        toast.error(payload?.error?.message ?? RESULT.analysisFailed);
        return;
      }
      // Same row, now scored. The page is a Server Component, so the new
      // coverage arrives with a refresh rather than with client state.
      router.refresh();
    } catch {
      toast.error(RESULT.analysisFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Button variant="hero" onClick={rerun} disabled={pending}>
      <RefreshCw aria-hidden />
      {pending ? SCAN.analyzing : RESULT.runAnalysis}
    </Button>
  );
}
