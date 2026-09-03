'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CAREER, CAREER_ITEM_TYPE_LABEL } from '@/lib/copy';
import type { CareerItem, Import } from '@/lib/db/types';
import { fieldErrorsForItem, type ItemFieldErrors } from '@/lib/validation';

/**
 * One career-item card (SPEC Block E: title, type Badge, period, 2-line content
 * preview, Edit/Delete icon buttons).
 *
 * A Client Component because Edit and Delete are interactive. It re-reads the
 * list through `router.refresh()` rather than holding a local copy: the page is
 * a Server Component and the route handlers already call `revalidatePath`, so
 * refresh is what turns a mutation into the new list without a page reload.
 */
export function CareerItemCard({
  item,
  source,
}: {
  item: CareerItem;
  /** The import run this item came from, when it has one (SPEC v2.11). */
  source: Import | null;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <article className="border-border flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        {/* min-w-0 + break-words: a long unbroken title must wrap, not widen
            the grid column and push the card off a 375 px screen. */}
        <h3 className="min-w-0 flex-1 text-sm font-semibold break-words">{item.title}</h3>
        <Badge variant="primary">{CAREER_ITEM_TYPE_LABEL[item.type]}</Badge>
      </div>

      {item.period ? <p className="text-muted-foreground text-xs">{item.period}</p> : null}

      {/*
        Provenance (SPEC v2.11). Rendered only when the item HAS a run: a
        hand-created item has no source, and a chip reading "from: —" would
        invent a fact about where it came from. `source` is null rather than
        stale when an import row has gone (ON DELETE SET NULL), so this is the
        same branch for both cases.
      */}
      {source ? (
        <Badge variant="accent" className="w-fit max-w-full truncate">
          {CAREER.fromImport(source.name, source.target_role)}
        </Badge>
      ) : null}

      {/* Exactly two lines, per Block E. */}
      <p className="text-muted-foreground line-clamp-2 text-sm break-words">{item.content}</p>

      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${CAREER.edit}: ${item.title}`}
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${CAREER.delete}: ${item.title}`}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>

      <EditDialog item={item} open={editing} onOpenChange={setEditing} />
      <DeleteDialog item={item} open={confirmingDelete} onOpenChange={setConfirmingDelete} />
    </article>
  );
}

/**
 * The Edit surface, with its own three states: idle, saving (button label and
 * disabled inputs), and error (inline per field, or form-level for a failed
 * request).
 */
function EditDialog({
  item,
  open,
  onOpenChange,
}: {
  item: CareerItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  /**
   * M-2 from the phase-2 review. This was `useTransition`, whose `pending` was
   * never true for the request: the fetch was awaited OUTSIDE any transition and
   * `startTransition` was only reached afterwards. So the Block E loading state
   * never appeared, and — because saving a changed title or content triggers a
   * re-embed — a double-click bought TWO paid embedding calls for one intention.
   *
   * The ref is the actual lock and the state is only for the UI. Two clicks can
   * fire before React re-renders, so `disabled={pending}` alone cannot be the
   * guard; a ref is set synchronously and the second click returns immediately.
   * One click, one spend.
   */
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [period, setPeriod] = useState(item.period ?? '');
  const [errors, setErrors] = useState<ItemFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    if (inFlight.current) return;

    // The SAME schema the route handler runs. This one blocks the submit and
    // renders the Block F copy inline; the server parse is the actual gate.
    const fieldErrors = fieldErrorsForItem({ type: item.type, title, content, period });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    inFlight.current = true;
    setPending(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/career/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, period: period.trim() === '' ? null : period }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(body?.error?.message ?? CAREER.updateFailed);
        return;
      }

      onOpenChange(false);
      toast.success(CAREER.updated);
      // D3: saved, but its chunks may be a moment stale. Surfaced, never silent.
      if (body?.indexWarning) toast.warning(body.indexWarning);
      router.refresh();
    } catch {
      setFormError(CAREER.updateFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{CAREER.editTitle}</DialogTitle>
          <DialogDescription>{CAREER_ITEM_TYPE_LABEL[item.type]}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {CAREER.fieldTitle}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!errors.title}
              disabled={pending}
            />
            {errors.title ? <FieldError message={errors.title} /> : null}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {CAREER.fieldPeriod}
            <Input
              value={period}
              placeholder={CAREER.periodPlaceholder}
              onChange={(e) => setPeriod(e.target.value)}
              disabled={pending}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {CAREER.fieldContent}
            <Textarea
              value={content}
              rows={8}
              onChange={(e) => setContent(e.target.value)}
              aria-invalid={!!errors.content}
              disabled={pending}
            />
            {errors.content ? <FieldError message={errors.content} /> : null}
          </label>

          {formError ? <FieldError message={formError} /> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {CAREER.cancel}
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? CAREER.saving : CAREER.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deletion is a Dialog, never an inline panel — the same rule the account
 * deletion follows. It names the consequence for SEARCH, because that is the
 * part the user cannot see: the item's `documents` rows go with it.
 */
function DeleteDialog({
  item,
  open,
  onOpenChange,
}: {
  item: CareerItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  async function remove() {
    // Not a metered path, but a double-click still sends two DELETEs and the
    // second answers 404 for a row that is already gone. Same lock, same reason.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const res = await fetch(`/api/career/items/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(CAREER.deleteFailed);
        return;
      }
      onOpenChange(false);
      toast.success(CAREER.deleted);
      router.refresh();
    } catch {
      toast.error(CAREER.deleteFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{CAREER.deleteTitle}</DialogTitle>
          <DialogDescription>{CAREER.deleteBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {CAREER.cancel}
          </Button>
          <Button variant="danger" onClick={remove} disabled={pending}>
            {pending ? CAREER.deleting : CAREER.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <span role="alert" className="text-destructive text-xs">
      {message}
    </span>
  );
}
