'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BusyDots } from '@/components/ui/busy-dots';
import { SETTINGS } from '@/lib/copy';

/**
 * [Upgrade to Pro] and [Manage subscription] (SPEC v3.0, Block E actions table).
 *
 * POSTs the billing endpoint, receives `{ url }`, and navigates there itself.
 * Not a form posting to a handler that answers 303: the CSP's `form-action
 * 'self'` would block a form-submission redirect to Stripe's origin, and a
 * navigation the page performs is not a form action — so the CSP stays exactly
 * as inventoried, and no Stripe script is ever loaded here.
 *
 * ONE CLICK, ONE SESSION. The ref is set synchronously, so a double click cannot
 * create two Checkout Sessions before React re-renders the disabled state. It is
 * cleared only on failure: on success the page is leaving.
 *
 * A failure is inline and says retrying is safe, because it is — nothing is
 * written on this side until Stripe confirms through the webhook.
 */
export function BillingButton({ action }: { action: 'checkout' | 'portal' }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const label = action === 'checkout' ? SETTINGS.upgrade : SETTINGS.manageSubscription;
  const failed = action === 'checkout' ? SETTINGS.checkoutFailed : SETTINGS.portalFailed;

  async function onClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = (await res.json().catch(() => null)) as { url?: unknown } | null;
      const url = typeof payload?.url === 'string' ? payload.url : null;
      if (!res.ok || !url) throw new Error(String(res.status));
      window.location.assign(url);
    } catch {
      setError(failed);
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant={action === 'checkout' ? 'hero' : 'outline'}
        className="w-fit"
        onClick={onClick}
        disabled={pending}
      >
        {label}
        {pending ? <BusyDots /> : null}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
