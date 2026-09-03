import { Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { RESULT } from '@/lib/copy';
import type { JudgeReport } from '@/lib/db/types';
import { WEAK_CRITERION_SCORE, groundingFailed } from '@/lib/judge';

/**
 * The rubric card (SPEC US-4 step 3, Block E's "four criteria rows with icons
 * ✓/✗").
 *
 * THREE STATES, AND THE FIRST TWO ARE NOT THE SAME:
 *   - `report === null` — the quality check did not RUN. Rule B7's daily cap
 *     refused it, or the model was unavailable, or this version came from the
 *     export path. Four grey rows with no scores, and a sentence saying so; four
 *     green ticks here would be a review nobody performed.
 *   - grounding failed — rule B2: a claim with no career item behind it, which
 *     nothing else can compensate for. It is the first row for that reason and
 *     it shows a cross whatever the other three scored.
 *   - a real report — the scores, with the reviewer's own words under each
 *     criterion that has any.
 *
 * The model's text is rendered as React text nodes under a labelled heading, so
 * a reader can always tell the app's copy from the reviewer's output, and
 * nothing after a heading is ever treated as an instruction (edge case S2).
 *
 * No state and no handlers of its own — but it is imported by the editor, which
 * is a client component, so it compiles into the client bundle. It reads only
 * `lib/judge`'s pure exports and `lib/copy`, neither of which touches a secret or
 * a DAL; being presentational is what keeps it that way, and it is not a server
 * boundary.
 */
export function JudgeCard({
  report,
  autoRevised,
  revisionNotBetter,
  revisionWithheld,
}: {
  report: JudgeReport | null;
  /** Rule B3's rewrite ran on this application's latest AI pass. */
  autoRevised?: boolean;
  /** The rewrite ran and the FIRST draft is the one on screen (Block D #5). */
  revisionNotBetter?: boolean;
  /** A rewrite was earned and the reviewer gave nothing to act on. */
  revisionWithheld?: boolean;
}) {
  return (
    <section className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{RESULT.judgeHeading}</h3>
        {autoRevised ? <Badge variant="accent">{RESULT.autoRevised}</Badge> : null}
      </div>

      {report === null ? (
        <p role="status" className="text-muted-foreground text-sm">
          {RESULT.judgeNotRun}
        </p>
      ) : (
        <>
          <dl className="flex flex-col gap-2">
            <Row
              label={RESULT.criterionGrounding}
              ok={!groundingFailed(report)}
              value={groundingFailed(report) ? RESULT.groundingFailed : RESULT.groundingPassed}
            />
            <Row
              label={RESULT.criterionKeywords}
              ok={report.keywordCoverage.score > WEAK_CRITERION_SCORE}
              value={RESULT.criterionScore(report.keywordCoverage.score)}
            />
            <Row
              label={RESULT.criterionRelevance}
              ok={report.relevance.score > WEAK_CRITERION_SCORE}
              value={RESULT.criterionScore(report.relevance.score)}
            />
            <Row
              label={RESULT.criterionAts}
              ok={report.atsFormat.score > WEAK_CRITERION_SCORE}
              value={RESULT.criterionScore(report.atsFormat.score)}
            />
          </dl>

          <Findings
            heading={RESULT.violationsHeading}
            items={report.grounding.violations.map((v) => `${v.claim} — ${v.issue}`)}
          />
          <Findings
            heading={RESULT.missingHonestHeading}
            items={report.keywordCoverage.missingHonest}
          />
          <Findings heading={RESULT.atsIssuesHeading} items={report.atsFormat.issues} />
        </>
      )}

      {/*
        Which of the two drafts the reader is looking at, when a rewrite happened
        and did not win. Without it the "Auto-revised once" badge sits above the
        PRE-revision text with nothing explaining the mismatch.
      */}
      {revisionNotBetter ? (
        <p className="text-muted-foreground text-xs">{RESULT.revisionNotBetter}</p>
      ) : null}
      {revisionWithheld ? (
        <p className="text-muted-foreground text-xs">{RESULT.reviseWithoutFindings}</p>
      ) : null}
    </section>
  );
}

function Row({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="flex items-center gap-2">
        {ok ? (
          <Check aria-hidden className="size-4" style={{ color: 'var(--score-high)' }} />
        ) : (
          <X aria-hidden className="size-4" style={{ color: 'var(--score-low)' }} />
        )}
        {label}
      </dt>
      <dd className="text-muted-foreground">{value}</dd>
    </div>
  );
}

/** A labelled list of the reviewer's own findings. Rendered only when there are any. */
function Findings({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium uppercase">{heading}</h4>
      <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm">
        {items.map((item, index) => (
          <li key={`${heading}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
