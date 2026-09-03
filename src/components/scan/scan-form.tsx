'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { FILE_TOO_LARGE, MAX_PDF_BYTES, NOT_PDF, SCAN, VACANCY_LENGTH } from '@/lib/copy';
import {
  MAX_VACANCY_CHARS,
  MIN_SCAN_RESUME_CHARS,
  MIN_VACANCY_CHARS,
  isPdfUpload,
} from '@/lib/validation';

/**
 * `/scan` — the two panels, the resume-source tabs and [Analyze] (SPEC Block E,
 * US-2).
 *
 * A client component because the whole screen is one form with a metered submit.
 * The counts it needs (`itemCount`, `baseSearchable`) are read on the server and
 * passed in — no DAL and no `documents` access lives on this side of the
 * boundary.
 *
 * THREE resume sources, not Block E's four. "Saved version" is a Select of
 * previous tailored resumes, and `resume_versions` has no rows until Phase 4 —
 * a tab that can only ever be empty promises something the app cannot do yet
 * (declared in SPEC v2.12).
 */

/** The three sources this phase offers; the values are `applications.resume_source`. */
type Source = 'career_base' | 'paste' | 'file';

export function ScanForm({
  itemCount,
  baseSearchable,
}: {
  itemCount: number;
  /**
   * Whether the base has ANY search-index rows (edge case D7). Items with no
   * `documents` rows match nothing, and "Using all N items of your base" would
   * otherwise promise a search that cannot happen.
   */
  baseSearchable: boolean;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>('career_base');
  const [vacancyText, setVacancyText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * The actual lock on a metered submit (SPEC v2.11, "one click, one spend").
   *
   * Two clicks can fire before React re-renders, so `disabled={pending}` cannot
   * be the guard on its own — the state has not landed when the second click
   * arrives. A ref is set synchronously, so the second call returns before it
   * spends anything.
   */
  const inFlight = useRef(false);

  const emptyBase = itemCount === 0;
  const baseUnusable = source === 'career_base' && emptyBase;

  /** Client-side Block F validation: the same bounds the endpoint enforces. */
  function firstError(): string | null {
    if (vacancyText.trim().length < MIN_VACANCY_CHARS) return SCAN.vacancyRequired;
    if (vacancyText.length > MAX_VACANCY_CHARS) return VACANCY_LENGTH;
    if (source === 'career_base' && emptyBase) return SCAN.emptyBase;
    if (source === 'paste' && resumeText.trim().length < MIN_SCAN_RESUME_CHARS) {
      return SCAN.resumeRequired;
    }
    if (source === 'file' && !file) return SCAN.choosePdf;
    return null;
  }

  async function analyze() {
    if (inFlight.current) return;

    const message = firstError();
    if (message) {
      setError(message);
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/scan', buildRequest());
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        /**
         * The server's own message. On AI_UNAVAILABLE that is the Block E toast
         * ("…Your vacancy was saved — retry from Applications."), which is true
         * because /api/scan writes the vacancy and a draft application BEFORE
         * the model call. Rendering a local string here instead would be this
         * screen guessing at what the server did.
         */
        const detail = payload?.error?.message;
        toast.error(detail ?? SCAN.aiUnavailable);
        setError(detail ?? null);
        return;
      }

      // A truncated PDF extraction: the scan is real, part of the input was not
      // read, and that is said out loud rather than left to look like a low score.
      if (payload?.notice) toast.warning(payload.notice);
      router.push(`/applications/${payload.applicationId}`);
    } catch {
      toast.error(SCAN.aiUnavailable);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  /**
   * JSON for the base and a paste; multipart for an upload, so the PDF is
   * extracted server-side by the same module the career import uses. The
   * extracted text never round-trips through the browser.
   */
  function buildRequest(): RequestInit {
    if (source === 'file' && file) {
      const form = new FormData();
      form.set('file', file);
      form.set('vacancyText', vacancyText);
      form.set('resumeSource', 'file');
      return { method: 'POST', body: form };
    }
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vacancyText,
        resumeSource: source,
        sourceResumeText: source === 'paste' ? resumeText : null,
        resumeVersionId: null,
      }),
    };
  }

  function chooseFile(next: File) {
    // The same two rules the endpoint applies, so the user hears about them
    // without a round trip. The server re-checks regardless — it is the gate.
    if (!isPdfUpload(next)) {
      setError(NOT_PDF);
      return;
    }
    if (next.size > MAX_PDF_BYTES) {
      setError(FILE_TOO_LARGE);
      return;
    }
    setError(null);
    setFile(next);
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{SCAN.title}</h1>
        {/* US-2 step 2: while analysing, the stepper highlights step 3. */}
        <Stepper active={pending ? 2 : vacancyText.length > 0 ? 1 : 0} />
      </header>

      {/* Two panels at 1280, one stacked column at 375 (Block E). */}
      <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${pending ? 'opacity-60' : ''}`}>
        <Panel title={SCAN.resumeSourceLabel}>
          <Tabs value={source} onValueChange={(value) => setSource(value as Source)}>
            <TabsList>
              <TabsTrigger value="career_base" disabled={pending}>
                {SCAN.tabBase}
              </TabsTrigger>
              <TabsTrigger value="paste" disabled={pending}>
                {SCAN.tabPaste}
              </TabsTrigger>
              <TabsTrigger value="file" disabled={pending}>
                {SCAN.tabUpload}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="career_base">
              {emptyBase ? (
                // Block E's EMPTY state for this screen.
                <div className="border-border flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
                  <p className="text-sm">{SCAN.emptyBase}</p>
                  <Link href="/career" className={buttonVariants({ variant: 'outline' })}>
                    {SCAN.goToCareerBase}
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-sm">{SCAN.usingAllItems(itemCount)}</p>
                  {/* Edge case D7 as words instead of an unexplained all-gaps result. */}
                  {baseSearchable ? null : (
                    <p role="status" className="text-destructive text-sm">
                      {SCAN.baseNotIndexed}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="paste">
              <Textarea
                value={resumeText}
                rows={12}
                placeholder={SCAN.resumePlaceholder}
                aria-label={SCAN.tabPaste}
                disabled={pending}
                onChange={(e) => setResumeText(e.target.value)}
              />
            </TabsContent>

            <TabsContent value="file">
              <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
                <FileUp className="text-muted-foreground size-6" aria-hidden />
                <p className="text-muted-foreground text-sm">{SCAN.dropzone}</p>
                <Input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label={SCAN.choosePdf}
                  disabled={pending}
                  className="max-w-xs"
                  onChange={(e) => {
                    const next = e.target.files?.[0];
                    if (next) chooseFile(next);
                  }}
                />
                {file ? <p className="text-muted-foreground text-xs">{file.name}</p> : null}
              </div>
            </TabsContent>
          </Tabs>
        </Panel>

        <Panel title={SCAN.vacancyLabel}>
          <Textarea
            value={vacancyText}
            rows={16}
            placeholder={SCAN.vacancyPlaceholder}
            aria-label={SCAN.vacancyLabel}
            disabled={pending}
            onChange={(e) => setVacancyText(e.target.value)}
          />
          <p
            className={`text-xs ${
              vacancyText.length > MAX_VACANCY_CHARS ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {SCAN.counter(vacancyText.length, MAX_VACANCY_CHARS)}
          </p>
        </Panel>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center gap-3">
        {/* The screen's ONE accent action (Block E). */}
        <Button variant="hero" size="lg" onClick={analyze} disabled={pending || baseUnusable}>
          <ScanSearch aria-hidden />
          {pending ? SCAN.analyzing : SCAN.analyze}
        </Button>
        {pending ? (
          <span role="status" className="text-muted-foreground text-sm">
            {SCAN.analyzing}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

/** `1 Resume → 2 Vacancy → 3 Results`. */
function Stepper({ active }: { active: number }) {
  return (
    <ol className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {SCAN.steps.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          <span
            aria-current={index === active ? 'step' : undefined}
            className={
              index === active ? 'text-foreground font-medium' : index < active ? 'text-primary' : ''
            }
          >
            {index + 1} {label}
          </span>
          {index < SCAN.steps.length - 1 ? <span aria-hidden>→</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}
