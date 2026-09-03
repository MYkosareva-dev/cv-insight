import { notFound } from 'next/navigation';
import { z } from 'zod';

import { NotesForm } from '@/components/applications/notes-form';
import { RerunScan } from '@/components/applications/rerun-scan';
import { ResultTabs } from '@/components/applications/result-tabs';
import { ScoreRing } from '@/components/applications/score';
import { APPLICATIONS, APPLICATION_STATUS_LABEL, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
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
 * The Tailored-resume tab, [Generate tailored resume] and [Download .docx] are
 * Phase 4 (declared in SPEC v2.12): `resume_versions` has no rows yet, and a
 * button that cannot do its job is a promise this screen would be making on the
 * app's behalf.
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

      {/* Rail 280 px beside the tabs at 1280; stacked at 375 (Block E). */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-6">
          <ScoreRing score={score} />
          {/*
            Only where a number was computed. On a draft the ring shows "—" and
            no 60/40 weighting ever ran, so explaining one would describe work
            the app did not do.
          */}
          {score === null ? null : (
            <p className="text-muted-foreground text-xs">{RESULT.scoreExplainer}</p>
          )}

          {analysed ? (
            <CategoryBars entries={entries} keywords={keywords} />
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p role="status" className="text-sm">
                {RESULT.notAnalysed}
              </p>
              <RerunScan applicationId={application.id} />
            </div>
          )}

          <NotesForm applicationId={application.id} notes={application.notes} />
        </div>

        {analysed ? (
          <ResultTabs
            entries={entries}
            keywords={keywords}
            parsed={vacancy.parsed}
            rawText={vacancy.raw_text}
            sourceIsBase={application.resume_source === 'career_base'}
          />
        ) : (
          /*
            The posting is still shown — it was saved, which is what the failure
            toast promised — but nothing is charted against it.

            Its parsed requirements are shown too WHEN THEY EXIST. A retrieval
            failure happens after the parse has been stored, so this branch is
            reachable with a real requirement list, and hiding it would throw
            away a measurement the user already paid for.
          */
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
        )}
      </div>
    </section>
  );
}

/**
 * The four Block E category bars, with "N issues".
 *
 * Two of them measure something this phase computes; two of them are the judge's
 * criteria and are labelled "Not checked yet" until Phase 4. An "0 issues" bar
 * for ATS format would be a measurement nobody took — the same defect rule B1b
 * prevents for a score with no signal.
 */
function CategoryBars({
  entries,
  keywords,
}: {
  entries: CoverageEntry[];
  keywords: KeywordRow[];
}) {
  const keywordIssues = keywords.filter((row) => row.inResume === 0).length;
  const coverageIssues = entries.filter((entry) => entry.status !== 'covered').length;

  return (
    <div className="flex flex-col gap-3">
      <Bar label={RESULT.categoryKeywords} issues={keywordIssues} total={keywords.length} />
      <Bar label={RESULT.categoryCoverage} issues={coverageIssues} total={entries.length} />
      <Bar label={RESULT.categoryAts} issues={null} total={0} />
      <Bar label={RESULT.categoryQuality} issues={null} total={0} />
    </div>
  );
}

function Bar({ label, issues, total }: { label: string; issues: number | null; total: number }) {
  const share = issues !== null && total > 0 ? (total - issues) / total : 0;

  /**
   * Three states, and the first two are NOT the same:
   *   - `issues === null` — the check has not happened (ATS format, Quality).
   *   - `total === 0` — the check RAN and had nothing to look at: no keywords
   *     were extracted, or the posting stated no requirements (N4). Calling
   *     that "Not checked yet" would deny work the app did, and the Analysis
   *     tab on this same screen already says the opposite.
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
