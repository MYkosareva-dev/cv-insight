'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FileUp, Upload } from 'lucide-react';
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
import { MAX_CAREER_ITEMS } from '@/lib/limits';
import type { CareerItemType } from '@/lib/db/types';
import { fieldErrorsForItem, isPdfUpload, type ItemFieldErrors } from '@/lib/validation';

/**
 * The import Dialog (SPEC Block E, US-1; extended in v2.11).
 *
 * Three phases, which is what the step indicator names:
 *   SOURCE  — name the run, optionally give it a target role, then paste text or
 *             upload a PDF → POST /api/career/import
 *   REVIEW  — the proposed items, each editable and each with an include
 *             checkbox → POST /api/career/items
 *   SAVED   — how many landed, and how many were skipped as duplicates
 *
 * Nothing is saved until [Save N items to base]. The import endpoint writes no
 * rows at all, so abandoning the dialog at the review step leaves the base
 * untouched — and the `imports` row is created by the SAVE, not by the extract,
 * so an abandoned run leaves no source behind either.
 */

type ProposedItem = {
  type: CareerItemType;
  title: string;
  content: string;
  period: string | null;
  include: boolean;
};

type Phase = 'source' | 'review' | 'saved';
type SourceTab = 'paste' | 'upload';

/** Which step the indicator highlights. Phase order IS step order. */
const PHASE_STEP: Record<Phase, number> = { source: 0, review: 1, saved: 2 };

export function ImportResumeDialog({
  itemCount,
  importCount,
}: {
  itemCount: number;
  /** How many runs already exist — the "Resume N" default is this plus one. */
  importCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('source');
  // v2.11: paste is the default path; uploading a PDF is the other tab.
  const [tab, setTab] = useState<SourceTab>('paste');
  const [items, setItems] = useState<ProposedItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [createdRuns, setCreatedRuns] = useState(0);
  const [name, setName] = useState(CAREER.defaultName(importCount + 1));
  const [targetRole, setTargetRole] = useState('');
  const [sourceKind, setSourceKind] = useState<'pdf' | 'paste'>('paste');
  const [result, setResult] = useState<{ saved: number; skipped: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * M-2 from the phase-2 review: the ACTUAL lock on every metered request.
   *
   * Two clicks can fire before React re-renders, so a `disabled={pending}` prop
   * cannot be the guard on its own — the state has not landed when the second
   * click arrives. A ref is set synchronously, so the second call returns before
   * it spends anything. One click, one spend.
   */
  const inFlight = useRef(false);

  /**
   * The import count this component mounted with.
   *
   * The "Resume N" suggestion cannot come from `importCount` alone. That prop is
   * server data, and it only refreshes after the save that changed it — so
   * importing twice without leaving the page suggested "Resume 1" both times,
   * which is exactly the ambiguity naming the run was supposed to remove.
   *
   * Taking the MAX of the two views, rather than adding them, is what keeps the
   * sequence honest in both directions: the prop is right once it catches up, the
   * local tally is right before it does, and neither can make the number skip.
   */
  // `useState` and not `useRef`: this value is READ during render, and a ref read
  // in render is exactly what the react-hooks/refs rule forbids — a ref can
  // change without scheduling one, so the number on screen could go stale. A
  // never-updated state initialiser is the same "captured at mount" semantics
  // with rendering that actually tracks it.
  const [mountedWith] = useState(importCount);
  const nextRunIndex = Math.max(importCount, mountedWith + createdRuns) + 1;

  function reset() {
    setPhase('source');
    setTab('paste');
    setItems([]);
    setPending(false);
    setError(null);
    setNotice(null);
    setText('');
    setName(CAREER.defaultName(nextRunIndex));
    setTargetRole('');
    setSourceKind('paste');
    setResult(null);
    inFlight.current = false;
    if (fileInput.current) fileInput.current.value = '';
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Reset on close, so re-opening never shows the previous run's review list.
    if (!next) reset();
  }

  /** Hand the extracted items to the review phase, or explain why there are none. */
  function receive(payload: { items: Omit<ProposedItem, 'include'>[]; notice: string | null }) {
    /**
     * The notice is set on BOTH branches (M-1 from the review). It used to be set
     * only when the list came back empty, so `CAREER.truncated` — the one case
     * where text WAS dropped and items exist — never reached the screen, and a
     * 40,000-character CV imported its first half in silence.
     */
    if (payload.items.length === 0) {
      // Edge case D5: valid text that is not a resume. Not an error — the request
      // worked and nothing was saved, so the dialog says so and stays here.
      setNotice(payload.notice ?? CAREER.noItemsFound);
      return;
    }
    setNotice(payload.notice);
    setItems(payload.items.map((item) => ({ ...item, include: true })));
    setPhase('review');
  }

  async function importFrom(body: BodyInit, kind: 'pdf' | 'paste', headers?: HeadersInit) {
    if (inFlight.current) return;
    inFlight.current = true;
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
      // Remember which branch produced these items, so the imports row records
      // it. Set only on success: a failed upload must not relabel the run.
      setSourceKind(kind);
      receive(payload);
    } catch {
      setError(CAREER.importFailed);
    } finally {
      inFlight.current = false;
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
    await importFrom(form, 'pdf');
  }

  async function importText() {
    if (text.trim().length < 100) {
      setError(SCAN.resumeRequired);
      return;
    }
    await importFrom(JSON.stringify({ text }), 'paste', { 'Content-Type': 'application/json' });
  }

  const selected = items.filter((item) => item.include);
  const remaining = MAX_CAREER_ITEMS - itemCount;

  /** The run's own fields, validated before the metered save is allowed. */
  function importMetaError(): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 120) return CAREER.nameRequired;
    if (targetRole.trim().length > 120) return CAREER.targetRoleTooLong;
    return null;
  }

  async function save() {
    if (inFlight.current) return;

    if (selected.length === 0) {
      setError(CAREER.nothingSelected);
      return;
    }
    const metaError = importMetaError();
    if (metaError) {
      setError(metaError);
      return;
    }
    /**
     * Every included item must satisfy the Block F bounds before the request.
     *
     * The summary reports the FIRST ACTUAL message, not a fixed one: it used to
     * say `CAREER.titleRequired` for any violation, so a 4,001-character content
     * produced "Title is required, max 200 characters." — copy describing a field
     * that was fine, about a problem it does not name.
     */
    const firstMessage = selected
      .flatMap((item) => Object.values(fieldErrorsForItem(item)))
      .find((message): message is string => typeof message === 'string');
    if (firstMessage) {
      setError(firstMessage);
      return;
    }

    inFlight.current = true;
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
          import: {
            name: name.trim(),
            targetRole: targetRole.trim() === '' ? null : targetRole.trim(),
            sourceKind,
          },
        }),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(payload?.error?.message ?? CAREER.saveFailed);
        return;
      }

      setResult({ saved: payload?.items?.length ?? 0, skipped: payload?.skipped ?? 0 });
      setPhase('saved');
      // Only when a run row was actually created. A save that was entirely
      // duplicates makes no `imports` row, so it must not advance the numbering
      // and leave a gap in the user's sequence.
      if (payload?.import) setCreatedRuns((n) => n + 1);

      // The index is a separate promise from the save, so its failure is its own
      // message rather than a silent difference in future search results.
      if (payload?.indexWarning) toast.warning(payload.indexWarning);
      router.refresh();
    } catch {
      setError(CAREER.saveFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

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
            {phase === 'source' ? CAREER.dialogDescription : null}
            {phase === 'review' ? CAREER.reviewHint : null}
            {phase === 'saved' ? CAREER.nameHint : null}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator phase={phase} />

        {phase === 'source' ? (
          <div className="flex flex-col gap-4">
            <IdentityFields
              name={name}
              targetRole={targetRole}
              disabled={pending}
              onName={setName}
              onTargetRole={setTargetRole}
            />

            <Tabs value={tab} onValueChange={(value) => setTab(value as SourceTab)}>
              <TabsList>
                <TabsTrigger value="paste">{CAREER.tabPaste}</TabsTrigger>
                <TabsTrigger value="upload">{CAREER.tabUpload}</TabsTrigger>
              </TabsList>

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
            </Tabs>
          </div>
        ) : null}

        {phase === 'review' ? <ReviewList items={items} onChange={setItems} /> : null}

        {phase === 'saved' && result ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
              <Check className="size-5" aria-hidden />
            </div>
            <p role="status" className="text-sm font-medium">
              {result.saved === 0
                ? CAREER.allDuplicates(result.skipped)
                : CAREER.savedSummary(result.saved, result.skipped)}
            </p>
            {result.saved > 0 ? (
              <Badge variant="accent">
                {CAREER.fromImport(name.trim(), targetRole.trim() || null)}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {/* Inline in the dialog, per Block E — never a toast for an import error. */}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {notice && phase !== 'saved' ? (
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

        {phase === 'saved' ? (
          <DialogFooter>
            <Button variant="outline" onClick={reset}>
              {CAREER.importAnother}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{CAREER.done}</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "1 Paste → 2 Review → 3 Saved" (v2.11), the current step emphasised. */
function StepIndicator({ phase }: { phase: Phase }) {
  const current = PHASE_STEP[phase];
  return (
    <ol className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {CAREER.steps.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden>→</span> : null}
          <span
            aria-current={index === current ? 'step' : undefined}
            className={index === current ? 'text-foreground font-medium' : undefined}
          >
            {index + 1} {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The run's identity, on the source step (v2.11).
 *
 * It sits BEFORE the text, because it is the question the user can answer without
 * thinking about the document — and because a name defaulted after extraction
 * would arrive at the review screen already filled in, which reads as the app
 * having decided rather than suggested.
 */
function IdentityFields({
  name,
  targetRole,
  disabled,
  onName,
  onTargetRole,
}: {
  name: string;
  targetRole: string;
  disabled: boolean;
  onName: (value: string) => void;
  onTargetRole: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        {CAREER.fieldName}
        <Input value={name} disabled={disabled} onChange={(e) => onName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {CAREER.fieldTargetRole}
        <Input
          value={targetRole}
          placeholder={CAREER.targetRolePlaceholder}
          disabled={disabled}
          onChange={(e) => onTargetRole(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground text-xs sm:col-span-2">{CAREER.nameHint}</p>
    </div>
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
