'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SETTINGS } from '@/lib/copy';

/**
 * Danger zone (SPEC Block E /settings, US-6 steps 3–5).
 *
 * A real modal Dialog, not an inline panel: a destructive, irreversible action
 * should take the focus and be dismissable by Escape, and Radix gives the focus
 * trap and the aria wiring that an inline `role="alertdialog"` only claimed.
 *
 * Confirm stays disabled until the input matches `DELETE` EXACTLY — no trimming,
 * no case folding. "delete " passing would defeat the point of asking.
 *
 * On success the browser leaves for /login?notice=account_deleted. The session
 * cookies were already cleared server-side, so `replace` (not `push`): the back
 * button must not return to a member page whose session is gone.
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
      router.replace('/login?notice=account_deleted');
      router.refresh();
    } catch {
      // The server logs the cause; the user gets the SPEC copy and nothing else.
      setError(SETTINGS.deleteFailed);
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never let a dismissal interrupt a request that is already in flight.
        if (pending) return;
        setOpen(next);
        if (!next) {
          setConfirmation('');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger">{SETTINGS.deleteAccount}</Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{SETTINGS.deleteAccount}</DialogTitle>
          <DialogDescription>
            {SETTINGS.deleteDialogBody}{' '}
            <Link
              href="/privacy"
              target="_blank"
              className="text-primary underline underline-offset-4"
            >
              {SETTINGS.deleteDialogPrivacyLink}
            </Link>
            {SETTINGS.deleteDialogBodyEnd}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">
            {SETTINGS.deleteConfirmPlaceholder}
          </label>
          <Input
            id={inputId}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={SETTINGS.deleteConfirmPlaceholder}
            autoComplete="off"
            disabled={pending}
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            {SETTINGS.deleteCancel}
          </Button>
          <Button variant="danger" disabled={!canConfirm} aria-busy={pending} onClick={onDelete}>
            {pending ? SETTINGS.deleting : SETTINGS.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
