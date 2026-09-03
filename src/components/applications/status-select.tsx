'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { APPLICATIONS, APPLICATION_STATUS_LABEL, APPLICATION_STATUS_ORDER } from '@/lib/copy';
import type { ApplicationStatus } from '@/lib/db/types';

/**
 * The Status control in the `/applications` table (SPEC Block E), saved with
 * PATCH on change.
 *
 * A NATIVE `<select>` styled to the Block E tokens, not a Radix listbox:
 * `@radix-ui/react-select` is not in the dependency tree, and pulling in a
 * package for one control on one table is not worth the weight. The native
 * element is also the one that behaves correctly on a phone, which matters at
 * the 375 px test width. Recorded as a decision in SPEC v2.12.
 *
 * The chosen value is held locally so the cell responds immediately, and reverts
 * if the request fails — a Select that keeps showing "Applied" after the save
 * was refused would be the screen stating something the database does not.
 */
export function StatusSelect({
  applicationId,
  status,
}: {
  applicationId: string;
  status: ApplicationStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ApplicationStatus>(status);
  const [pending, setPending] = useState(false);

  async function change(next: ApplicationStatus) {
    const previous = value;
    setValue(next);
    setPending(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setValue(previous);
        toast.error(payload?.error?.message ?? APPLICATIONS.statusUpdateFailed);
        return;
      }
      toast.success(APPLICATIONS.statusUpdated);
      router.refresh();
    } catch {
      setValue(previous);
      toast.error(APPLICATIONS.statusUpdateFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <select
      value={value}
      disabled={pending}
      aria-label={APPLICATIONS.colStatus}
      className="border-input bg-background text-foreground focus-visible:ring-ring h-8 rounded-md border px-2 text-sm shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50"
      onChange={(e) => void change(e.target.value as ApplicationStatus)}
      // The row is a link; changing the status must not navigate.
      onClick={(e) => e.stopPropagation()}
    >
      {APPLICATION_STATUS_ORDER.map((option) => (
        <option key={option} value={option}>
          {APPLICATION_STATUS_LABEL[option]}
        </option>
      ))}
    </select>
  );
}
