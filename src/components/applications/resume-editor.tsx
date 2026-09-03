'use client';

import { Download, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';

import { JudgeCard } from '@/components/applications/judge-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RESULT } from '@/lib/copy';
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
  pending: 'generate' | 'rescore' | 'judge' | 'export' | null;
  onGenerate: () => void;
  onRescore: () => void;
  onCheckQuality: () => void;
  onDownload: () => void;
}) {
  const hasVersion = versions.length > 0;

  if (!hasVersion) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="text-muted-foreground text-sm">
          {RESULT.noVersionYet}
        </p>
        <Button variant="hero" onClick={onGenerate} disabled={pending !== null}>
          <Sparkles aria-hidden />
          {pending === 'generate' ? RESULT.generating : RESULT.generate}
        </Button>
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
      </div>

      {/* Block E: [Re-score] outline green, [Check quality] outline violet,
          [Download .docx] green. Wraps rather than overflows at 375 px. */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onRescore} disabled={pending !== null}>
          <RefreshCw aria-hidden />
          {pending === 'rescore' ? RESULT.rescoring : RESULT.rescore}
        </Button>
        <Button variant="outline-accent" onClick={onCheckQuality} disabled={pending !== null}>
          <ShieldCheck aria-hidden />
          {pending === 'judge' ? RESULT.checkingQuality : RESULT.checkQuality}
        </Button>
        <Button onClick={onDownload} disabled={pending !== null}>
          <Download aria-hidden />
          {pending === 'export' ? RESULT.exporting : RESULT.download}
        </Button>
      </div>

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
