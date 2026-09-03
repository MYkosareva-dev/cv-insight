import { notFound } from 'next/navigation';
import { z } from 'zod';

import { NotesForm } from '@/components/applications/notes-form';
import { RerunScan } from '@/components/applications/rerun-scan';
import { ResultWorkspace } from '@/components/applications/result-workspace';
import { ScoreRing } from '@/components/applications/score';
import { APPLICATIONS, APPLICATION_STATUS_LABEL, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { listResumeVersions } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import type { CoverageEntry, KeywordRow } from '@/lib/db/types';
import { renderableScore } from '@/lib/scoring';

export const metadata = { title: 'Scan result — CV Insight' };

/**
 * `/applications/[id]` — SPEC Block E, US-2 steps 3–4, US-3.
 *
 * The id is never trusted: both DAL queries run under the user's session, RLS
 * yields no row for another user's id, and the page answers 404 — never 403
 * (edge case S3). The id's SHAPE is checked first, because a non-UUID would
 * otherwise reach Postgres and come back as a 500 where Block D mandates a 404.
 *
 * THREE STATES OF A RESULT, and conflating any two of them would be the app
 * describing something it did not observe:
 *   1. `coverage === null` — the analysis never ran (the AI step failed, or rule
 *      B7's cap refused it). Nothing was measured, so nothing is charted: the
 *      screen says so and offers the re-run. A zero-row coverage table here
 *      would read as "no gaps found".
 *   2. `coverage.entries.length === 0` — the parse RAN and the posting stated no
 *      requirements (edge case N4). A measured emptiness, with its own notice.
 *   3. entries present — the normal result.
 *
 * THE INTERACTIVE HALF IS ONE CLIENT COMPONENT (`ResultWorkspace`), and the
 * split is where it is for a reason rather than by taste: [Re-score] has to move
 * the ring in the RAIL from a button inside a TAB, and [Add to resume] has to
 * write into the editor in a different tab. This file keeps what only the server
 * can do — the session, the 404, the three result states — and hands the rest
 * one set of props.
 */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const application = await getApplication(id);
  if (!application) notFound();

  const vacancy = await getVacancy(application.vacancy_id);
  if (!vacancy) notFound();

  const analysed = application.coverage !== null;
  const entries: CoverageEntry[] = application.coverage?.entries ?? [];
  const keywords: KeywordRow[] = application.coverage?.keywords ?? [];
  const score = renderableScore(application);
  /**
   * Newest first. Read here rather than in the client component so the rows come
   * through a DAL under the user's own session — RLS scopes them, and a client
   * fetch would need an endpoint Block D does not define.
   */
  const versions = await listResumeVersions(application.id);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {/*
            Three cases, because a blank heading reads as a rendering fault and
            "Not analysed yet" would deny a run that happened: a title, an
            analysed posting the parser gave no title, or a draft.
          */}
          {vacancy.title?.trim() ||
            (analysed ? APPLICATIONS.untitledPosting : APPLICATIONS.notAnalysedTitle)}
        </h1>
        <p className="text-muted-foreground text-sm">
          {vacancy.company ?? APPLICATIONS.noCompany} ·{' '}
          {APPLICATION_STATUS_LABEL[application.status]}
        </p>
      </header>

      {analysed ? (
        <ResultWorkspace
          applicationId={application.id}
          entries={entries}
          keywords={keywords}
          score={score}
          parsed={vacancy.parsed}
          rawText={vacancy.raw_text}
          sourceIsBase={application.resume_source === 'career_base'}
          versions={versions}
        />
      ) : (
        /* Rail 280 px beside the content at 1280; stacked at 375 (Block E). */
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-6">
            {/*
              The ring shows "—" on a draft, and no 60/40 weighting ever ran, so
              the explainer that describes one is not rendered beside it.
            */}
            <ScoreRing score={score} />
            <div className="flex flex-col items-start gap-3">
              <p role="status" className="text-sm">
                {RESULT.notAnalysed}
              </p>
              <RerunScan applicationId={application.id} />
            </div>
          </div>

          {/*
            The posting is still shown — it was saved, which is what the failure
            toast promised — but nothing is charted against it.

            Its parsed requirements are shown too WHEN THEY EXIST. A retrieval
            failure happens after the parse has been stored, so this branch is
            reachable with a real requirement list, and hiding it would throw
            away a measurement the user already paid for.
          */}
          <div className="flex flex-col gap-6">
            {vacancy.parsed && vacancy.parsed.requirements.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{RESULT.vacancyParsedHeading}</h2>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {vacancy.parsed.requirements.map((requirement, index) => (
                    <li key={`${requirement.text}-${index}`}>
                      {requirement.kind === 'must' ? RESULT.kindMust : RESULT.kindNice} ·{' '}
                      {requirement.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">{RESULT.vacancyRawHeading}</h2>
              <pre className="text-sm break-words whitespace-pre-wrap">{vacancy.raw_text}</pre>
            </div>
          </div>
        </div>
      )}

      {/*
        Notes belong to the application, not to the analysis, so they render in
        both states — a draft whose AI step failed is still an application the
        user takes notes on.
      */}
      <div className="lg:max-w-[280px]">
        <NotesForm applicationId={application.id} notes={application.notes} />
      </div>
    </section>
  );
}
