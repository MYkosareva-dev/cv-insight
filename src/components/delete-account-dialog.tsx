'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SETTINGS } from '@/lib/copy';

/**
 * Danger zone (SPEC Block E /settings, US-6 steps 3–5).
 *
 * The confirm button stays disabled until the input matches `DELETE` EXACTLY —
 * no trimming, no case folding: a mismatch must leave the button disabled, and
 * "delete " passing would defeat the point of asking.
 *
 * On success the browser leaves for /login?deleted=1. The session cookies were
 * already cleared server-side by the route, so `replace` (not `push`) is used —
 * the back button must not return to a member page whose session is gone.
 */
export function DeleteAccountDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const canConfirm = confirmation === SETTINGS.deleteConfirmWord && !pending;

  async function onDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/account', { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      router.replace('/login?deleted=1');
      router.refresh();
    } catch {
      // The server logs the cause; the user gets the SPEC copy and nothing else.
      setError(SETTINGS.deleteFailed);
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        {SETTINGS.deleteAccount}
      </Button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={`${inputId}-title`}
      className="border-destructive flex flex-col gap-3 rounded-md border p-4"
    >
      <p id={`${inputId}-title`} className="text-sm font-medium">
        {SETTINGS.deleteAccount}
      </p>
      <p className="text-muted-foreground text-sm">{SETTINGS.deleteDialogBody}</p>

      <label htmlFor={inputId} className="sr-only">
        {SETTINGS.deleteDialogBody}
      </label>
      <Input
        id={inputId}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder={SETTINGS.deleteConfirmPlaceholder}
        autoComplete="off"
        disabled={pending}
      />

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!canConfirm} aria-busy={pending} onClick={onDelete}>
          {pending ? SETTINGS.deleting : SETTINGS.deleteAccount}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setConfirmation('');
            setError(null);
          }}
        >
          {SETTINGS.deleteCancel}
        </Button>
      </div>
    </div>
  );
}
