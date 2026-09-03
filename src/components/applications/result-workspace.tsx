'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { ResultTabs } from '@/components/applications/result-tabs';
import { ResumeEditor } from '@/components/applications/resume-editor';
import { ScoreRing } from '@/components/applications/score';
import { Button } from '@/components/ui/button';
import { RESULT } from '@/lib/copy';
import type {
  CoverageEntry,
  JudgeReport,
  KeywordRow,
  ParsedVacancy,
  ResumeVersion,
} from '@/lib/db/types';
import { judgeIssueCounts, openingVersion } from '@/lib/judge';

/**
 * The result screen's interactive half (SPEC Block E, US-3 step 4, US-4, US-5).
 *
 * ONE CLIENT BOUNDARY around the rail AND the tabs, which is what the phase
 * needs rather than a preference: [Re-score] has to move the ring in the rail
 * from a button in a tab, and [Add to resume] has to reach the editor from a
 * different tab. Two separate islands could not do either without duplicating
 * the state that connects them.
 *
 * ONE CLICK, ONE SPEND (SPEC v2.11). Every metered action is locked by a ref set
 * SYNCHRONOUSLY, not by the `disabled` prop alone: two clicks can fire before
 * React re-renders, so state-based disabling is not a guard. The lock is shared
 * across all four buttons because they all spend, and because a re-score racing
 * a generate would show one text's score beside another text's card. The server
 * has its own 409 lock for the case a reload puts between the two clicks.
 *
 * WHAT IS STORED AND WHAT IS LIVE, kept apart on purpose:
 *   - the SCAN's score and coverage arrive as props from the server row. They
 *     are what that run measured, at the moment it measured it.
 *   - a RE-SCORE is a live reading of the unsaved text in the editor. It
 *     replaces the ring in place, as Block E asks, and says in words that it is
 *     not saved, with a way back to the stored number. Silently swapping one for
 *     the other would put two measurements of two different texts under one
 *     label.
 */
export function ResultWorkspace({
  applicationId,
  entries,
  keywords,
  score,
  parsed,
  rawText,
  sourceIsBase,
  versions: initialVersions,
}: {
  applicationId: string;
  entries: CoverageEntry[];
  keywords: KeywordRow[];
  /** The STORED score, already through `renderableScore()`. */
  score: number | null;
  parsed: ParsedVacancy | null;
  rawText: string;
  sourceIsBase: boolean;
  versions: ResumeVersion[];
}) {
  const router = useRouter();

  /**
   * The rows, mirrored so an action can show its result before the server render
   * catches up — and RE-SYNCED whenever the server sends a new array.
   *
   * The parent is a Server Component, so `initialVersions` only changes identity
   * when the server re-rendered: after a `router.refresh()`, or a navigation.
   * Adjusting during render (rather than in an effect) is React's own pattern for
   * this, and it keeps the list from being one action stale after an export,
   * whose response is a FILE and carries no row to mirror.
   */
  const [versions, setVersions] = useState(initialVersions);
  const [syncedFrom, setSyncedFrom] = useState(initialVersions);
  if (syncedFrom !== initialVersions) {
    setSyncedFrom(initialVersions);
    setVersions(initialVersions);
  }

  // Seeded once. `openingVersion` is what makes a reload show the same draft the
  // generate response did — the newest row is not always that draft.
  const opening = openingVersion(initialVersions);
  const [content, setContent] = useState(opening?.content ?? '');
  const [judge, setJudge] = useState<JudgeReport | null>(opening?.judge ?? null);
  /**
   * Derived from the ROWS, not from a response, so it survives a reload: a
   * revision happened if and only if there is an `ai_revision` row.
   */
  const autoRevised = versions.some((version) => version.source === 'ai_revision');
  const [revisionNotBetter, setRevisionNotBetter] = useState(false);
  const [revisionWithheld, setRevisionWithheld] = useState(false);

  const [tab, setTab] = useState('analysis');
  const [rescored, setRescored] = useState<{
    matchScore: number | null;
    entries: CoverageEntry[];
    keywords: KeywordRow[];
  } | null>(null);

  const [pending, setPending] = useState<'generate' | 'rescore' | 'judge' | 'export' | null>(null);
  /** Set synchronously — the `disabled` prop cannot guard a double click. */
  const inFlight = useRef(false);

  async function run<T>(
    action: 'generate' | 'rescore' | 'judge' | 'export',
    request: () => Promise<Response>,
    onOk: (res: Response) => Promise<T>,
    fallbackMessage: string,
  ): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    try {
      const res = await request();
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        toast.error(payload?.error?.message ?? fallbackMessage);
        return;
      }
      await onOk(res);
    } catch {
      toast.error(fallbackMessage);
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const post = (path: string, body: unknown) =>
    fetch(`/api/applications/${applicationId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  function generate() {
    void run(
      'generate',
      // Body is `{}`: every input lives server-side, so nothing a client sends
      // can change what is generated or from what.
      () => post('generate', {}),
      async (res) => {
        const data = await res.json();
        setVersions(data.versions ?? []);
        setContent(data.content ?? '');
        setJudge(data.judge ?? null);
        setRevisionNotBetter(Boolean(data.revisionNotBetter));
        setRevisionWithheld(Boolean(data.revisionWithheld));
        // A stale re-score belongs to the text that was in the editor before.
        setRescored(null);
        setTab('resume');
        // The rail's stored numbers and the list are Server Components.
        router.refresh();
      },
      RESULT.generationFailed,
    );
  }

  function rescore() {
    void run(
      'rescore',
      () => post('rescore', { content }),
      async (res) => {
        const data = await res.json();
        setRescored({
          matchScore: data.matchScore ?? null,
          entries: data.coverage ?? [],
          keywords: data.keywords ?? [],
        });
        setTab('analysis');
      },
      RESULT.rescoreFailed,
    );
  }

  function checkQuality() {
    void run(
      'judge',
      () => post('judge', { content }),
      async (res) => {
        const data = await res.json();
        setJudge(data.judge ?? null);
        // The reviewed text is its own version now, so the badges from the AI
        // pass no longer describe what is on screen.
        setRevisionNotBetter(false);
        setRevisionWithheld(false);
        // The reviewed text is now a row of its own; the refresh brings it back
        // with the timestamp the database gave it, rather than one this browser
        // made up.
        router.refresh();
      },
      RESULT.qualityCheckFailed,
    );
  }

  function download() {
    void run(
      'export',
      () => post('export', { content }),
      async (res) => {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filenameFrom(res) ?? 'resume.docx';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        // The export APPENDS the edited text as a version (Block D #6: saving
        // happens via /judge or export), so the history has a new row.
        toast.success(RESULT.savedUserVersion);
        router.refresh();
      },
      RESULT.exportFailed,
    );
  }

  const shownScore = rescored ? rescored.matchScore : score;
  const shownEntries = rescored ? rescored.entries : entries;
  const shownKeywords = rescored ? rescored.keywords : keywords;
  const issues = judgeIssueCounts(judge);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-6">
        <ScoreRing score={shownScore} />
        {shownScore === null ? null : (
          <p className="text-muted-foreground text-xs">
            {rescored ? RESULT.rescoredExplainer : RESULT.scoreExplainer}
          </p>
        )}
        {rescored ? (
          <div className="flex flex-col items-start gap-1">
            <p role="status" className="text-accent text-xs">
              {RESULT.rescoredLabel}
            </p>
            <Button variant="link" size="sm" className="px-0" onClick={() => setRescored(null)}>
              {RESULT.rescoredRevert}
            </Button>
          </div>
        ) : null}

        <CategoryBars
          entries={shownEntries}
          keywords={shownKeywords}
          atsIssues={issues.atsFormat}
          qualityIssues={issues.quality}
        />

        {/* Block E: the violet hero, hidden once a version exists — the editor
            tab owns the action from then on. */}
        {versions.length === 0 ? (
          <Button variant="hero" onClick={generate} disabled={pending !== null}>
            <Sparkles aria-hidden />
            {pending === 'generate' ? RESULT.generating : RESULT.generate}
          </Button>
        ) : null}
      </div>

      <ResultTabs
        tab={tab}
        onTabChange={setTab}
        entries={shownEntries}
        keywords={shownKeywords}
        parsed={parsed}
        rawText={rawText}
        sourceIsBase={sourceIsBase}
        canAddToResume={versions.length > 0}
        onAddToResume={(entry) => {
          const bullet = RESULT.insertedBullet(entry.requirement, entry.careerItemTitle);
          setContent((current) => (current.endsWith('\n') ? current : `${current}\n`) + bullet);
          setTab('resume');
          toast.success(RESULT.addedToResume);
        }}
        resume={
          <ResumeEditor
            content={content}
            onChange={setContent}
            versions={versions}
            judge={judge}
            autoRevised={autoRevised}
            revisionNotBetter={revisionNotBetter}
            revisionWithheld={revisionWithheld}
            pending={pending}
            onGenerate={generate}
            onRescore={rescore}
            onCheckQuality={checkQuality}
            onDownload={download}
          />
        }
      />
    </div>
  );
}

/** The server's own filename, so the browser saves what the export named. */
function filenameFrom(res: Response): string | null {
  const header = res.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? null;
}

/**
 * The four Block E category bars, with "N issues".
 *
 * ATS format and Quality said "Not checked yet" through Phase 3 because the
 * judge did not exist. They now report the reviewer's counts WHEN THERE IS A
 * REPORT — and go back to "Not checked yet" when there is not, which is the
 * common case for a version saved by the export path. An "0 issues" bar for a
 * review nobody performed is the same defect rule B1b prevents for a score with
 * no signal.
 */
function CategoryBars({
  entries,
  keywords,
  atsIssues,
  qualityIssues,
}: {
  entries: CoverageEntry[];
  keywords: KeywordRow[];
  atsIssues: number | null;
  qualityIssues: number | null;
}) {
  const keywordIssues = keywords.filter((row) => row.inResume === 0).length;
  const coverageIssues = entries.filter((entry) => entry.status !== 'covered').length;

  return (
    <div className="flex flex-col gap-3">
      <Bar label={RESULT.categoryKeywords} issues={keywordIssues} total={keywords.length} />
      <Bar label={RESULT.categoryCoverage} issues={coverageIssues} total={entries.length} />
      {/*
        The judge's two criteria are counts of PROBLEMS with no natural
        denominator, so the bar is drawn full when there are none and empty when
        there are any. Inventing a total would make the fill look like a
        proportion of something measured.
      */}
      <Bar label={RESULT.categoryAts} issues={atsIssues} total={atsIssues === null ? 0 : 1} />
      <Bar label={RESULT.categoryQuality} issues={qualityIssues} total={qualityIssues === null ? 0 : 1} />
    </div>
  );
}

function Bar({ label, issues, total }: { label: string; issues: number | null; total: number }) {
  const share = issues !== null && total > 0 ? Math.max(0, (total - issues) / total) : 0;

  /**
   * Three states, and the first two are NOT the same:
   *   - `issues === null` — the check has not happened.
   *   - `total === 0` — the check RAN and had nothing to look at: no keywords
   *     were extracted, or the posting stated no requirements (N4). Calling that
   *     "Not checked yet" would deny work the app did.
   *   - otherwise, the count.
   */
  const caption =
    issues === null
      ? RESULT.notChecked
      : total === 0
        ? RESULT.nothingToCheck
        : issues === 0
          ? RESULT.noIssues
          : RESULT.issues(issues);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{caption}</span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  );
}
