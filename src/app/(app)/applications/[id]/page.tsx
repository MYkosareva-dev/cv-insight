import { notFound } from 'next/navigation';
import { z } from 'zod';

import { NotesForm } from '@/components/applications/notes-form';
import { RerunScan } from '@/components/applications/rerun-scan';
import { ResultWorkspace } from '@/components/applications/result-workspace';
import { ScoreRing } from '@/components/applications/score';
import { APPLICATIONS, APPLICATION_STATUS_LABEL, RESULT } from '@/lib/copy';
import { getApplication } from '@/lib/db/applications';
import { listGenerateCallsForApplication } from '@/lib/db/llmCalls';
import { listCareerItemCorpus } from '@/lib/db/careerItems';
import { itemsCorpus } from '@/lib/generation';
import { openingVersion, partitionMissingHonest } from '@/lib/judge';
import { listResumeVersions } from '@/lib/db/resumeVersions';
import { getVacancy } from '@/lib/db/vacancies';
import type { CoverageEntry, KeywordRow } from '@/lib/db/types';
import { generationProvenance } from '@/lib/quality';
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
 * NOTES LIVE IN THE LEFT COLUMN (SPEC v2.20, from the owner's live use). They had
 * drifted to the bottom of the page, under the tabs and far below the fold, which
 * is not where a note taken while reading a posting is usable. This file still
 * owns the row and renders the form in BOTH result states; in the analysed state
 * it passes the notes STRING to `ResultWorkspace`, which renders the same client
 * form in the rail. Handing over the rendered ELEMENT was the first attempt and
 * the Playwright run rejected it: an element created in a Server Component and
 * passed as a prop into a Client Component draws React's missing-key warning on
 * every render, because it is not a child rendered in place.
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

  /**
   * The reviewer's "supported by your base" terms, CHECKED AGAINST THE BASE
   * before they reach a screen (SPEC v2.17).
   *
   * Done here, on the server, for the version the editor opens with: the check
   * is `keywordPresent` over the career base, and the base is not something to
   * ship to a browser for one yes-or-no per term. The two endpoints that produce
   * a fresh review compute the same partition with the same function, so there
   * is exactly one definition of "is this term in the base" in the app.
   *
   * The WHOLE base and not the retrieved items — the same corpus both endpoints
   * use, so one term gets one answer on every render. A stored report may have
   * been written against a retrieval this page cannot reproduce; more to the
   * point, the heading says "your career base", so the base is what has to
   * decide it. The REVISION prompt keeps the narrower corpus, because it asks a
   * different question: what the writer could honestly reach for.
   */
  /**
   * WHICH MODEL WROTE THIS APPLICATION'S DRAFTS (v2.22).
   *
   * Read here rather than carried in an action's response, so it survives a
   * reload: a user coming back to a resume should still be able to see what
   * produced it. Through the DAL under their own session, like every other read
   * on this page — `llm_calls` already records the model that actually served and
   * has carried the application id since v2.16, so this needs no new column.
   *
   * It is the reason a fallback is now visible in the PRODUCT and not only on
   * `/quality`: owner testing found every generate call served by
   * `google/gemini-2.5-flash` because the configured Sonnet slug is blocked by a
   * guardrail on the provider account, and `models: [primary, fallback]` routing
   * answers that by quietly using the second entry.
   */
  const provenance = generationProvenance(await listGenerateCallsForApplication(application.id));

  const opening = openingVersion(versions);
  const judgeTerms = partitionMissingHonest(
    opening?.judge?.keywordCoverage.missingHonest ?? [],
    opening?.judge ? itemsCorpus(await listCareerItemCorpus()) : '',
  );

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
          judgeTerms={judgeTerms}
          notes={application.notes}
          provenance={provenance}
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
            {/*
              Notes belong to the APPLICATION and not to the analysis, so they
              render in this state too — a draft whose AI step failed is still an
              application the user takes notes on. Same place in the rail as in
              the analysed state (v2.20), so the field does not move between two
              screens the user reaches from the same list.
            */}
            <NotesForm applicationId={application.id} notes={application.notes} />
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

    </section>
  );
}
