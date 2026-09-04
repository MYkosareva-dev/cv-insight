'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { NotesForm } from '@/components/applications/notes-form';
import { ResultTabs } from '@/components/applications/result-tabs';
import { BusyDots } from '@/components/ui/busy-dots';
import { ResumeEditor } from '@/components/applications/resume-editor';
import { ScoreRing } from '@/components/applications/score';
import { Button } from '@/components/ui/button';
import { NO_SCORE, RESULT } from '@/lib/copy';
import type {
  CoverageEntry,
  JudgeReport,
  KeywordRow,
  ParsedVacancy,
  ResumeVersion,
} from '@/lib/db/types';
import {
  judgeIssueCounts,
  mergeVersionsNewestFirst,
  newestJudgedVersion,
  openingVersion,
} from '@/lib/judge';
import type { GenerationProvenance } from '@/lib/quality';

/**
 * `missingHonest`, split into what the career base literally contains and what
 * it does not. Computed on the server by `partitionMissingHonest` and never
 * derived here — the base is not on this side of the wire, which is the point.
 */
type JudgeTerms = { supported: string[]; notInBase: string[] };

/** A review and the terms it may suggest. Never held apart — see the state below. */
type Review = { report: JudgeReport | null; terms: JudgeTerms };

/**
 * The actions that spend money, and the one that does not.
 *
 * `generate` and `regenerate` are the SAME endpoint and are told apart only so
 * the busy label can say which one the user pressed — a "Generating" label on a
 * button reading [Regenerate] is a small lie about what is happening. Both draw
 * on the one shared in-flight lock, because both are a Sonnet call.
 */
type MeteredAction = 'generate' | 'regenerate' | 'rescore' | 'judge' | 'export';

/**
 * Read the partition off an endpoint's response.
 *
 * An absent or malformed `judgeTerms` yields EMPTY lists rather than falling
 * back to the report's own `missingHonest`: a missing partition means nothing
 * checked those terms against the base, and the honest answer to "which terms
 * does your base support" is then to suggest none. Falling back to the raw list
 * is the one thing this whole mechanism exists to prevent.
 *
 * THE MEMBERS ARE CHECKED, NOT ONLY THE CONTAINER. `Array.isArray` alone
 * accepted an array of objects, which the judge card renders into its findings
 * list as `[object Object]`. The payload is same-origin and server-computed, so
 * this is a guard against a shape drifting rather than against an attacker — but
 * it is the ONLY guard between a malformed `judgeTerms` and the panel whose whole
 * purpose is not to suggest a term the base lacks, and a guard that validates the
 * wrapper and trusts the contents is half a guard. A non-string entry is dropped
 * rather than stringified, on the same reasoning as the fallback above: a term
 * nobody can vouch for is not suggested.
 */
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function termsOf(data: { judgeTerms?: unknown }): JudgeTerms {
  const terms = data.judgeTerms as JudgeTerms | undefined;
  return {
    supported: stringsOf(terms?.supported),
    notInBase: stringsOf(terms?.notInBase),
  };
}

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
  judgeTerms: initialJudgeTerms,
  notes,
  provenance,
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
  /**
   * The opening version's `missingHonest`, already split against the career base
   * on the SERVER (SPEC v2.17). The base itself never comes to the browser: it
   * can run to hundreds of kilobytes of the user's own history, and this page
   * needs one yes-or-no per term rather than the corpus.
   */
  judgeTerms: JudgeTerms;
  /**
   * The application's saved notes (SPEC v2.20, owner feedback: the field had
   * drifted to the bottom of the page, far below the fold).
   *
   * THE STRING AND NOT THE ELEMENT. The first version of this took the rendered
   * `<NotesForm />` as a `ReactNode` prop, on the reasoning that `page.tsx` owns
   * the row — and the Playwright run answered that with a React warning on every
   * render of this screen ("Each child in a list should have a unique key prop
   * … it was passed a child from ApplicationDetailPage"): an element created in
   * a Server Component and handed across the boundary as a prop is not the same
   * thing as a child rendered in place. `NotesForm` is already a client
   * component, so rendering it here costs nothing and keeps no state — it holds
   * its own — and `page.tsx` still renders it directly in the not-analysed
   * branch from the same row.
   */
  notes: string | null;
  /**
   * Which model served this application's `generate` calls (v2.22), read from
   * `llm_calls` on the server.
   *
   * It is here rather than in a response body because it has to survive a
   * reload: a user coming back to a resume should still be able to see what wrote
   * it. The generate action refreshes the server render, so the line updates
   * without this component holding a second copy of the fact.
   */
  provenance: GenerationProvenance;
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
  /**
   * ONE piece of state for the report and its base-checked terms, deliberately.
   *
   * They were two `useState`s and that was a way to get them out of step: an
   * action that set the report and forgot the terms would render one review's
   * verdict beside another's suggestions — and the suggestions are the half that
   * tells a user what to write into their resume. Held together, every setter
   * has to supply both.
   */
  const [review, setReview] = useState<Review>({
    report: opening?.judge ?? null,
    terms: initialJudgeTerms,
  });
  const judge = review.report;
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

  const [pending, setPending] = useState<MeteredAction | null>(null);
  /** Set synchronously — the `disabled` prop cannot guard a double click. */
  const inFlight = useRef(false);

  async function run<T>(
    action: MeteredAction,
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

  /**
   * ONE FUNCTION FOR BOTH GENERATE AND REGENERATE, because they are one endpoint
   * (SPEC v2.20).
   *
   * `POST …/generate` already appended rather than replaced — `resume_versions`
   * is append-only by design and the route has never had a "there is already a
   * version" refusal — so regenerating needed no server change at all. What it
   * needed was a way to ASK for it, which Block E's "hidden after first version"
   * had taken away.
   *
   * THE ROWS ARE MERGED AND NOT SUBSTITUTED. The 200 body carries only the rows
   * this run wrote; taking it as the whole list was correct while a generate
   * could only ever happen on an empty history, and wrong the moment one can
   * happen on top of five earlier versions — the history would visibly lose
   * every older row until the next server render landed.
   */
  function generate(action: 'generate' | 'regenerate' = 'generate') {
    void run(
      action,
      // Body is `{}`: every input lives server-side, so nothing a client sends
      // can change what is generated or from what.
      () => post('generate', {}),
      async (res) => {
        const data = await res.json();
        setVersions((current) => mergeVersionsNewestFirst(current, data.versions ?? []));
        setContent(data.content ?? '');
        setReview({ report: data.judge ?? null, terms: termsOf(data) });
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
    /**
     * THE PREVIOUS LIVE READING, AND NEVER THE STORED SCAN'S NUMBER.
     *
     * `shownScore` was the first version of this and it is the wrong baseline:
     * on a FIRST re-score it holds the scan's stored score, which SPEC v2.16
     * note 13 states plainly is not comparable — the stored number was measured
     * against the CAREER BASE through `match_documents`, the live one against an
     * ephemeral corpus of the editor's own text, and the thresholds were
     * calibrated for the first of those. A toast reading "68% → 74%" across that
     * boundary attributes to the user's edit a difference that is partly the
     * corpus, and "Nothing in your edit moved it" is a causal claim the app has
     * no measurement for at all.
     *
     * So the delta is only ever between two readings of the SAME corpus, and a
     * first re-score gets a wording with no delta in it.
     */
    const previous = rescored?.matchScore ?? null;
    const isFirstRescore = rescored === null;
    void run(
      'rescore',
      () => post('rescore', { content }),
      async (res) => {
        const data = await res.json();
        const after: number | null = data.matchScore ?? null;
        setRescored({
          matchScore: after,
          entries: data.coverage ?? [],
          keywords: data.keywords ?? [],
        });
        setTab('analysis');
        /**
         * A RUN THAT MOVED NOTHING STILL REPORTS ITSELF (SPEC v2.20, owner
         * feedback). Re-scoring text nobody edited returns the number it
         * returned before and the ring does not move, which is indistinguishable
         * from a button that did nothing — after a paid call. An unchanged
         * measurement is a result, so it is said, with the number named.
         *
         * `null` compares equal to `null` here, which is right: rule B1b's "—"
         * staying "—" is also a measurement that did not move.
         */
        if (isFirstRescore) {
          toast.success(RESULT.rescoredFirst(scoreText(after)));
        } else if (after === previous) {
          toast.success(RESULT.rescoredUnchanged(scoreText(after)));
        } else {
          toast.success(RESULT.rescoredChanged(scoreText(previous), scoreText(after)));
        }
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
        setReview({ report: data.judge ?? null, terms: termsOf(data) });
        /**
         * THE NEW ROW GOES INTO `versions` TOO (v2.22). The rail's bars derive
         * from the newest judged version, so without this the check the user just
         * paid for would not move them until the server refresh landed — and on
         * the one action whose entire purpose is to produce a verdict, a rail
         * still reading the previous one is the same contradiction this round
         * fixed. `createdAt` comes from the response because only the database
         * knows it; a timestamp made up here would sort wrongly against the rows
         * beside it.
         */
        if (data.resumeVersionId && data.createdAt) {
          setVersions((current) =>
            mergeVersionsNewestFirst(current, [
              {
                id: data.resumeVersionId,
                created_at: data.createdAt,
                source: data.source ?? 'user',
                content: data.content ?? '',
                judge: data.judge ?? null,
              } as ResumeVersion,
            ]),
          );
        }
        // The reviewed text is its own version now, so the badges from the AI
        // pass no longer describe what is on screen.
        setRevisionNotBetter(false);
        setRevisionWithheld(false);
        /**
         * SAID OUT LOUD, for the same reason the re-score reports an unchanged
         * number: the card below can come back with the same four scores it had,
         * and a screen that looks identical after a paid call reads as a click
         * that missed.
         */
        toast.success(RESULT.qualityChecked);
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
        //
        // A file whose name line is still the placeholder gets a WARNING beside
        // that, not instead of it: the download succeeded and the version was
        // saved, and both of those are true — what is also true is that the
        // document says "[YOUR NAME]" at the top.
        toast.success(RESULT.savedUserVersion);
        if (res.headers.get('X-Name-Placeholder') === '1') {
          toast.warning(RESULT.exportedWithPlaceholderName);
        }
        /**
         * The document has no contact header while the profile has contacts
         * (v2.20) — a resume written before they were saved. Said beside the
         * success, not instead of it: the download worked and the version was
         * saved, and what is also true is that the file has no way to reply to.
         */
        if (res.headers.get('X-Missing-Contacts') === '1') {
          toast.warning(RESULT.exportedWithoutContacts);
        }
        router.refresh();
      },
      RESULT.exportFailed,
    );
  }

  const shownScore = rescored ? rescored.matchScore : score;
  const shownEntries = rescored ? rescored.entries : entries;
  const shownKeywords = rescored ? rescored.keywords : keywords;
  /**
   * THE RAIL'S BARS READ THE NEWEST JUDGED VERSION, not the one the editor
   * opened with (v2.22).
   *
   * The editor's version can legitimately carry no report — the export path
   * appends a `judge: null` row, and so does a run whose judge step was refused —
   * and the bars were then asserting "Not checked yet" directly above a version
   * list showing the verdicts of the runs that HAD been checked. Two parts of one
   * screen disagreeing about the same fact, which [Regenerate] made easy to reach
   * by multiplying the rows.
   *
   * `versions` is the single source, so an action that appends a row moves the
   * bars in the same render as the list. "Not checked yet" now means what it
   * says: nothing here has ever been judged.
   */
  const judgedVersion = newestJudgedVersion(versions);
  const issues = judgeIssueCounts(judgedVersion?.judge ?? null);
  /**
   * True when the measurement is not of the newest text. The bars must not be
   * read as a measurement of a document nobody measured, so when this holds the
   * rail names the version the check belongs to.
   */
  const judgedIsStale = judgedVersion !== null && judgedVersion.id !== versions[0]?.id;

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
        {judgedIsStale ? (
          <p className="text-muted-foreground text-xs">
            {RESULT.judgedVersionLabel(RESULT.versionLabel[judgedVersion.source])}
          </p>
        ) : null}

        {/* Block E: the violet hero, hidden once a version exists — the editor
            tab owns the action from then on, and [Regenerate] is the way back to
            a second attempt (v2.20). */}
        {versions.length === 0 ? (
          <div className="flex flex-col gap-1.5">
            <Button variant="hero" onClick={() => generate()} disabled={pending !== null}>
              <Sparkles aria-hidden />
              {pending === 'generate' ? (
                <>
                  {RESULT.generating}
                  <BusyDots />
                </>
              ) : (
                RESULT.generate
              )}
            </Button>
            <p className="text-muted-foreground text-xs">{RESULT.generateHelp}</p>
          </div>
        ) : null}

        {/*
          NOTES, BACK IN THE LEFT COLUMN (SPEC v2.20, owner feedback). They had
          drifted to the bottom of the page, below the tabs and far below the
          fold, which is not where a note taken while reading a posting is
          usable. They sit under the measurement — the ring and the bars are what
          the screen is FOR and stay first — and above the fold at both test
          widths.
        */}
        <NotesForm applicationId={applicationId} notes={notes} />
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
            judgeTerms={review.terms}
            provenance={provenance}
            autoRevised={autoRevised}
            revisionNotBetter={revisionNotBetter}
            revisionWithheld={revisionWithheld}
            pending={pending}
            onGenerate={() => generate()}
            onRegenerate={() => generate('regenerate')}
            onRescore={rescore}
            onCheckQuality={checkQuality}
            onDownload={download}
          />
        }
      />
    </div>
  );
}

/**
 * A score as the ring shows it, for copy that names the number.
 *
 * `NO_SCORE` and not "0" for null: rule B1b's insufficient-signal case renders
 * "—" everywhere else in the app, and a sentence quoting a 0 there would state a
 * measurement the app refuses to display two inches above.
 */
const scoreText = (score: number | null): string => (score === null ? NO_SCORE : `${score}%`);

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
