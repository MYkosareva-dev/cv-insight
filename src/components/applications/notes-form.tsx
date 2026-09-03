'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RESULT, formatCount } from '@/lib/copy';
import { MAX_NOTES_CHARS } from '@/lib/validation';

/**
 * "Notes" below the left rail (SPEC Block E) — Textarea + [Save notes], saved
 * via PATCH, success toast "Notes saved."
 *
 * Not a metered button: this writes one row and calls no model, so it needs no
 * in-flight ref beyond keeping the user from stacking saves.
 */
export function NotesForm({
  applicationId,
  notes,
}: {
  applicationId: string;
  notes: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(notes ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLong = value.length > MAX_NOTES_CHARS;

  async function save() {
    if (pending) return;
    if (tooLong) {
      setError(RESULT.notesTooLong);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: value }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? RESULT.notesFailed);
        return;
      }
      toast.success(RESULT.notesSaved);
      // The page is a Server Component: without this the saved text only
      // reappears after a hard reload.
      router.refresh();
    } catch {
      setError(RESULT.notesFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{RESULT.notesLabel}</h2>
      <Textarea
        value={value}
        rows={5}
        placeholder={RESULT.notesPlaceholder}
        aria-label={RESULT.notesLabel}
        aria-invalid={tooLong || undefined}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
        {formatCount(value.length)} / {formatCount(MAX_NOTES_CHARS)}
      </p>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button variant="outline" className="self-start" onClick={save} disabled={pending}>
        {RESULT.saveNotes}
      </Button>
    </section>
  );
}
