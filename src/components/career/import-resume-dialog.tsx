'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Upload } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { CAREER, CAREER_ITEM_TYPE_LABEL, ERROR_CODES, MAX_PDF_BYTES, SCAN } from '@/lib/copy';
import { MAX_CAREER_ITEMS } from '@/lib/db/limits';
import type { CareerItemType } from '@/lib/db/types';
import { fieldErrorsForItem, isPdfUpload, type ItemFieldErrors } from '@/lib/validation';

/**
 * The import Dialog (SPEC Block E, US-1 steps 2–4).
 *
 * Two phases in one dialog, because that is the flow US-1 describes:
 *   SOURCE  — tabs Upload PDF / Paste text → POST /api/career/import
 *   REVIEW  — the proposed items, each editable and each with an include
 *             checkbox → POST /api/career/items
 *
 * Nothing is saved until [Save N items to base]. The import endpoint writes no
 * rows at all, so abandoning the dialog at the review step leaves the base
 * untouched.
 */

type ProposedItem = {
  type: CareerItemType;
  title: string;
  content: string;
  period: string | null;
  include: boolean;
};

type Phase = 'source' | 'review';
type SourceTab = 'upload' | 'paste';

export function ImportResumeDialog({ itemCount }: { itemCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('source');
  const [tab, setTab] = useState<SourceTab>('upload');
  const [items, setItems] = useState<ProposedItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase('source');
    setTab('upload');
    setItems([]);
    setPending(false);
    setError(null);
    setNotice(null);
    setText('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Reset on close, so re-opening never shows the previous run's review list.
    if (!next) reset();
  }

  /** Hand the extracted items to the review phase, or explain why there are none. */
  function receive(payload: { items: Omit<ProposedItem, 'include'>[]; notice: string | null }) {
    if (payload.items.length === 0) {
      // Edge case D5: valid text that is not a resume. Not an error — the
      // request worked and nothing was saved, so the dialog says so and stays
      // on the source phase for another try.
      setNotice(payload.notice ?? CAREER.noItemsFound);
      return;
    }
    setItems(payload.items.map((item) => ({ ...item, include: true })));
    setPhase('review');
  }

  async function importFrom(body: BodyInit, headers?: HeadersInit) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/career/import', { method: 'POST', body, headers });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(payload?.error?.message ?? CAREER.importFailed);
        /**
         * US-1 step 6: an unreadable PDF arrives "with the paste tab
         * pre-opened". The error is only actionable through the other tab —
         * leaving the user on Upload invites them to retry the same scan.
         */
        if (payload?.error?.code === ERROR_CODES.UNREADABLE_PDF) setTab('paste');
        return;
      }
      receive(payload);
    } catch {
      setError(CAREER.importFailed);
    } finally {
      setPending(false);
    }
  }

  async function uploadPdf(file: File) {
    // Checked here as well as on the server: the same two rules, so the user
    // gets the message without a round trip. The server re-checks regardless —
    // it is the actual gate.
    if (!isPdfUpload(file)) {
      setError(CAREER.notPdf);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(CAREER.fileTooLarge);
      return;
    }
    const form = new FormData();
    form.set('file', file);
    await importFrom(form);
  }

  async function importText() {
    if (text.trim().length < 100) {
      setError(SCAN.resumeRequired);
      return;
    }
    await importFrom(JSON.stringify({ text }), { 'Content-Type': 'application/json' });
  }

  const selected = items.filter((item) => item.include);

  async function save() {
    if (selected.length === 0) {
      setError(CAREER.nothingSelected);
      return;
    }
    // Every included item must satisfy the Block F bounds before the request.
    const invalid = selected.some(
      (item) => Object.keys(fieldErrorsForItem(item)).length > 0,
    );
    if (invalid) {
      setError(CAREER.titleRequired);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/career/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selected.map(({ type, title, content, period }) => ({
            type,
            title,
            content,
            period: period && period.trim() !== '' ? period : null,
          })),
        }),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(payload?.error?.message ?? CAREER.saveFailed);
        return;
      }

      onOpenChange(false);
      toast.success(CAREER.saved(payload?.items?.length ?? selected.length));
      // The index is a separate promise from the save, so its failure is its
      // own message rather than a silent difference in future search results.
      if (payload?.indexWarning) toast.warning(payload.indexWarning);
      router.refresh();
    } catch {
      setError(CAREER.saveFailed);
    } finally {
      setPending(false);
    }
  }

  const remaining = MAX_CAREER_ITEMS - itemCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Upload aria-hidden />
          {CAREER.importResume}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{CAREER.dialogTitle}</DialogTitle>
          <DialogDescription>
            {phase === 'source' ? CAREER.dialogDescription : CAREER.reviewHint}
          </DialogDescription>
        </DialogHeader>

        {phase === 'source' ? (
          <Tabs value={tab} onValueChange={(value) => setTab(value as SourceTab)}>
            <TabsList>
              <TabsTrigger value="upload">{CAREER.tabUpload}</TabsTrigger>
              <TabsTrigger value="paste">{CAREER.tabPaste}</TabsTrigger>
            </TabsList>

            <TabsContent value="upload">
              <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
                <FileUp className="text-muted-foreground size-6" aria-hidden />
                <p className="text-muted-foreground text-sm">{CAREER.dropzone}</p>
                <Input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label={CAREER.choosePdf}
                  disabled={pending}
                  className="max-w-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadPdf(file);
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="paste">
              <div className="flex flex-col gap-3">
                <Textarea
                  value={text}
                  rows={10}
                  placeholder={CAREER.pastePlaceholder}
                  disabled={pending}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button onClick={importText} disabled={pending} className="self-start">
                  {pending ? CAREER.extracting : CAREER.extract}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <ReviewList items={items} onChange={setItems} />
        )}

        {/* Inline in the dialog, per Block E — never a toast for an import error. */}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-muted-foreground text-sm">
            {notice}
          </p>
        ) : null}
        {pending && phase === 'source' ? (
          <p role="status" className="text-muted-foreground text-sm">
            {CAREER.extracting}
          </p>
        ) : null}

        {phase === 'review' ? (
          <DialogFooter>
            {/* Named before the click, not after: B9 rejects a batch whole, so
                a user about to exceed it should see the headroom first. */}
            {selected.length > remaining ? (
              <p role="alert" className="text-destructive mr-auto text-xs">
                {CAREER.limitReached}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              {CAREER.cancel}
            </Button>
            <Button onClick={save} disabled={pending || selected.length === 0}>
              {pending ? CAREER.saving : CAREER.saveToBase(selected.length)}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The review list: US-1 step 4 — edit a title, drop a duplicate, then save. */
function ReviewList({
  items,
  onChange,
}: {
  items: ProposedItem[];
  onChange: (items: ProposedItem[]) => void;
}) {
  const included = items.filter((item) => item.include).length;

  function update(index: number, patch: Partial<ProposedItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{CAREER.reviewHeading(included)}</h3>

      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const errors: ItemFieldErrors = item.include ? fieldErrorsForItem(item) : {};
          return (
            <li
              key={index}
              className="border-border flex flex-col gap-2 rounded-lg border p-3"
              data-included={item.include}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.include}
                  aria-label={`Include: ${item.title}`}
                  className="accent-primary mt-2 size-4 shrink-0"
                  onChange={(e) => update(index, { include: e.target.checked })}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="primary">{CAREER_ITEM_TYPE_LABEL[item.type]}</Badge>
                    {item.period ? (
                      <span className="text-muted-foreground text-xs">{item.period}</span>
                    ) : null}
                  </div>
                  <Input
                    value={item.title}
                    aria-label={CAREER.fieldTitle}
                    aria-invalid={!!errors.title}
                    disabled={!item.include}
                    onChange={(e) => update(index, { title: e.target.value })}
                  />
                  {errors.title ? (
                    <span role="alert" className="text-destructive text-xs">
                      {errors.title}
                    </span>
                  ) : null}
                  <Textarea
                    value={item.content}
                    rows={4}
                    aria-label={CAREER.fieldContent}
                    aria-invalid={!!errors.content}
                    disabled={!item.include}
                    onChange={(e) => update(index, { content: e.target.value })}
                  />
                  {errors.content ? (
                    <span role="alert" className="text-destructive text-xs">
                      {errors.content}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
