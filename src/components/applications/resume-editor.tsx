'use client';

import { useState } from 'react';
import { Download, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

import { JudgeCard } from '@/components/applications/judge-card';
import { Badge } from '@/components/ui/badge';
import { BusyDots } from '@/components/ui/busy-dots';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { NAME_PLACEHOLDER, RESULT } from '@/lib/copy';
import type { JudgeReport, ResumeVersion } from '@/lib/db/types';

/**
 * The Tailored-resume tab (SPEC Block E, US-4 step 3 and US-5).
 *
 * Presentational on purpose: every metered action lives in
 * `result-workspace.tsx`, which owns the one-click-one-spend refs and the state
 * the rail also reads. Two components holding two copies of "is a request in
 * flight" is two places for a second click to slip through.
 *
 * EMPTY STATE (Block E): "No tailored resume yet." plus the hero [Generate
 * tailored resume]. The editor is not rendered at all before then — a textarea
 * that looks editable but has nothing to save is a control promising something
 * the app cannot do yet.
 */
export function ResumeEditor({
  content,
  onChange,
  versions,
  judge,
  judgeTerms,
  autoRevised,
  revisionNotBetter,
  revisionWithheld,
  pending,
  onGenerate,
  onRegenerate,
  onRescore,
  onCheckQuality,
  onDownload,
}: {
  content: string;
  onChange: (next: string) => void;
  versions: ResumeVersion[];
  judge: JudgeReport | null;
  /** Already split against the career base — see `JudgeCard`. */
  judgeTerms: { supported: string[]; notInBase: string[] };
  autoRevised: boolean;
  revisionNotBetter: boolean;
  revisionWithheld: boolean;
  /** Which metered action is in flight, or null. One at a time, by design. */
  pending: 'generate' | 'regenerate' | 'rescore' | 'judge' | 'export' | null;
  onGenerate: () => void;
  /**
   * The SAME endpoint as `onGenerate`, asked for again once a version exists
   * (SPEC v2.20). Two props rather than one, so the busy label can name the
   * action the user actually pressed.
   */
  onRegenerate: () => void;
  onRescore: () => void;
  onCheckQuality: () => void;
  onDownload: () => void;
}) {
  const hasVersion = versions.length > 0;
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  if (!hasVersion) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-muted-foreground text-sm">
          {RESULT.noVersionYet}
        </p>
        <Button variant="hero" onClick={onGenerate} disabled={pending !== null}>
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
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="resume-editor" className="text-sm font-medium">
          {RESULT.editorLabel}
        </label>
        <Textarea
          id="resume-editor"
          className="min-h-96"
          value={content}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
        {/*
          The name line is still the placeholder (SPEC v2.17). Said HERE, beside
          the editable text, because this is the one place the user can fix it in
          a second — and a resume that goes out with "[YOUR NAME]" at the top does
          so because nobody mentioned it while it was still on screen.
        */}
        {content.includes(NAME_PLACEHOLDER) ? (
          <p role="status" className="text-accent text-xs">
            {RESULT.namePlaceholderNotice}
          </p>
        ) : null}
      </div>

      {/*
        Block E: [Re-score] outline green, [Check quality] outline violet,
        [Download .docx] green — plus [Regenerate] (v2.20), the way back to a
        second attempt that Block E's "hidden after first version" had removed.

        ONE COLUMN PER ACTION, so each carries its own line of helper copy under
        it. A grid and not a wrapping row: a row that wraps puts a caption under
        the wrong button. Single column at 375 px.

        EVERY ACTION SAYS WHAT IT DOES AND WHAT IT SPENDS (v2.20, owner feedback:
        the buttons gave no clue about either). The costs are in the units the app
        actually spends -- see `RESULT.rescoreHelp`, which does not price an
        embeddings-only call as if it were a generate.

        THE THREE METERED ACTIONS ALL SHOW A SIGN OF LIFE. `<BusyDots />` was on
        [Generate] alone, on the argument that a re-score and a quality check
        "take seconds"; live use disagreed -- both are a network round trip to a
        model, and a dimmed button with a changed label is a STATE, not motion.
        One indicator, one reduced-motion fallback, one definition of it.
        [Download .docx] keeps a plain label because it makes no model call.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Action
          help={RESULT.rescoreHelp}
          button={
            <Button
              variant="outline"
              className="w-full"
              onClick={onRescore}
              disabled={pending !== null}
            >
              <RefreshCw aria-hidden />
              {pending === 'rescore' ? (
                <>
                  {RESULT.rescoring}
                  <BusyDots />
                </>
              ) : (
                RESULT.rescore
              )}
            </Button>
          }
        />
        <Action
          help={RESULT.checkQualityHelp}
          button={
            <Button
              variant="outline-accent"
              className="w-full"
              onClick={onCheckQuality}
              disabled={pending !== null}
            >
              <ShieldCheck aria-hidden />
              {pending === 'judge' ? (
                <>
                  {RESULT.checkingQuality}
                  <BusyDots />
                </>
              ) : (
                RESULT.checkQuality
              )}
            </Button>
          }
        />
        <Action
          help={RESULT.regenerateHelp}
          button={
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setConfirmRegenerate(true)}
              disabled={pending !== null}
            >
              <Sparkles aria-hidden />
              {pending === 'regenerate' ? (
                <>
                  {RESULT.regenerating}
                  <BusyDots />
                </>
              ) : (
                RESULT.regenerate
              )}
            </Button>
          }
        />
        <Action
          help={RESULT.downloadHelp}
          button={
            <Button className="w-full" onClick={onDownload} disabled={pending !== null}>
              <Download aria-hidden />
              {pending === 'export' ? RESULT.exporting : RESULT.download}
            </Button>
          }
        />
      </div>

      {/*
        DELIBERATE, NOT ACCIDENTAL (v2.20). A regenerate is the most expensive
        button in the app, so it asks once, in a modal that states the cost and
        says the current version is kept. The same mechanism the deletion dialog
        uses and for the same reason: an action with a consequence takes the focus
        rather than firing on a stray click.
      */}
      <RegenerateDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        onConfirm={() => {
          setConfirmRegenerate(false);
          onRegenerate();
        }}
      />

      <JudgeCard
        report={judge}
        terms={judgeTerms}
        autoRevised={autoRevised}
        revisionNotBetter={revisionNotBetter}
        revisionWithheld={revisionWithheld}
      />

      <VersionList versions={versions} />
    </div>
  );
}

/**
 * US-4's "appears in version history".
 *
 * It lists what was written and when, and nothing else — no content preview.
 * Every row here is the user's own resume text, and a list of excerpts would put
 * four copies of it on one screen for no benefit the editor above does not
 * already give.
 *
 * The AI draft and its revision both appear, which is what makes "Auto-revised
 * once" a claim with something behind it: the badge says a rewrite happened and
 * this is where it can be seen to have happened.
 */
function VersionList({ versions }: { versions: ResumeVersion[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{RESULT.versionsHeading}</h3>
      <ul className="flex flex-col gap-1.5">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center gap-2 text-sm">
            <Badge variant={version.source === 'user' ? 'default' : 'accent'}>
              {RESULT.versionLabel[version.source]}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {/* T1: stored UTC, rendered in the viewer's own timezone. */}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(version.created_at))}
            </span>
            {/*
              Three states, and "not checked" is not "no issues": a version saved
              by the export path, or one whose judge step was refused by the
              daily cap, carries no report at all.
            */}
            <span className="text-muted-foreground text-xs">
              {version.judge === null
                ? RESULT.notChecked
                : version.judge.verdict === 'approve'
                  ? RESULT.versionApproved
                  : RESULT.versionNeedsWork}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One action: the button, and the single line saying what it does and what it
 * costs (SPEC v2.20).
 *
 * The caption is deliberately NOT `aria-describedby` on the button. It describes
 * the action for a reader deciding whether to press it, and every button here
 * already has a complete accessible name -- wiring the sentence into that name
 * would make a screen reader announce the price of a model call before saying
 * which button it is on.
 */
function Action({ button, help }: { button: React.ReactNode; help: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {button}
      <p className="text-muted-foreground text-xs">{help}</p>
    </div>
  );
}

/**
 * The regenerate confirmation (SPEC v2.20).
 *
 * IT STATES THE COST BEFORE IT RUNS, on its own line, because that is the fact a
 * user needs in order to answer the question -- and it says the current version
 * is KEPT, because someone who believes they are about to lose their text will
 * not press the button that gives them a second attempt. Both sentences are true
 * of the endpoint: `resume_versions` is append-only, and the declared cost of one
 * run is 2 chat calls, or 4 with rule B3's single revision.
 */
function RegenerateDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{RESULT.regenerateDialogTitle}</DialogTitle>
          <DialogDescription>{RESULT.regenerateDialogBody}</DialogDescription>
        </DialogHeader>
        <p className="text-accent text-sm">{RESULT.regenerateDialogCost}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {RESULT.regenerateCancel}
          </Button>
          <Button variant="hero" onClick={onConfirm}>
            <Sparkles aria-hidden />
            {RESULT.regenerateConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
