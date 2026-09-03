import Link from 'next/link';
import { Files } from 'lucide-react';

import { ScoreChip } from '@/components/applications/score';
import { StatusSelect } from '@/components/applications/status-select';
import { buttonVariants } from '@/components/ui/button';
import { APPLICATIONS } from '@/lib/copy';
import { listApplications } from '@/lib/db/applications';
import { listVacancyHeadings } from '@/lib/db/vacancies';
import type { Application, Vacancy } from '@/lib/db/types';
import { renderableScore } from '@/lib/scoring';

export const metadata = { title: 'Applications — CV Insight' };

/**
 * `/applications` — SPEC Block E.
 *
 * A Server Component: the rows are read through their DALs under the user's own
 * session, so RLS scopes them to `auth.uid()` and no ownership filter appears in
 * this file.
 *
 * Two reads joined by a Map rather than one nested select — the same shape
 * `/career` uses for `imports`. Position and Company live on `vacancies`, and a
 * PostgREST embed would put that table's row shape inside the `applications`
 * DAL, which is what "one DAL per table" exists to prevent.
 *
 * Block E's three states: LOADING is `loading.tsx` beside this file (an awaited
 * Server Component renders nothing until it resolves); EMPTY is the branch
 * below; a DAL throw reaches app/error.tsx.
 */
export default async function ApplicationsPage() {
  const applications = await listApplications();
  const headings = await listVacancyHeadings(applications.map((row) => row.vacancy_id));
  const byId = new Map(headings.map((row) => [row.id, row]));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{APPLICATIONS.title}</h1>
        <Link href="/scan" className={buttonVariants({ variant: 'default' })}>
          {APPLICATIONS.newScan}
        </Link>
      </header>

      {applications.length === 0 ? <EmptyState /> : <Table rows={applications} byId={byId} />}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Files className="size-6" aria-hidden />
      </div>
      <p className="text-lg font-medium">{APPLICATIONS.emptyTitle}</p>
      <Link href="/scan" className={buttonVariants({ variant: 'default' })}>
        {APPLICATIONS.newScan}
      </Link>
    </div>
  );
}

type Heading = Pick<Vacancy, 'id' | 'title' | 'company'>;

function Table({ rows, byId }: { rows: Application[]; byId: Map<string, Heading> }) {
  return (
    // Wide content scrolls in its own box; the page never scrolls sideways.
    <div className="overflow-x-auto">
      <table className="w-full min-w-176 text-left text-sm">
        <thead className="text-muted-foreground text-xs uppercase">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              {APPLICATIONS.colPosition}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {APPLICATIONS.colCompany}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {APPLICATIONS.colScore}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {APPLICATIONS.colStatus}
            </th>
            <th scope="col" className="py-2 font-medium">
              {APPLICATIONS.colCreated}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const heading = byId.get(row.vacancy_id);
            return (
              <tr key={row.id} className="border-border border-t">
                <td className="py-2 pr-3">
                  <Link href={`/applications/${row.id}`} className="underline-offset-4 hover:underline">
                    {/*
                      A draft whose parse never ran has no title — the parser is
                      what fills it. Named rather than left blank, which would
                      look like a rendering fault.
                    */}
                    {heading?.title ?? APPLICATIONS.notAnalysedTitle}
                  </Link>
                </td>
                <td className="text-muted-foreground py-2 pr-3">
                  {heading?.company ?? APPLICATIONS.noCompany}
                </td>
                <td className="py-2 pr-3">
                  {/* One rule for the number, shared with the detail screen. */}
                  <ScoreChip score={renderableScore(row)} />
                </td>
                <td className="py-2 pr-3">
                  <StatusSelect applicationId={row.id} status={row.status} />
                </td>
                <td className="text-muted-foreground py-2">
                  <CreatedAt iso={row.created_at} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Edge case T1: stored UTC, rendered in the VIEWER's timezone.
 *
 * `suppressHydrationWarning` because that is exactly what this does — the server
 * formats in the server's zone and the client re-formats in the user's, so the
 * two renders legitimately differ. The alternative is a client component per
 * cell, for a date.
 */
function CreatedAt({ iso }: { iso: string }) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatted}
    </time>
  );
}
