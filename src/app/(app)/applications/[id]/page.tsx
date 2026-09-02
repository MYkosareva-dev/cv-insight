import { Placeholder } from '@/components/placeholder';

export const metadata = { title: 'Scan result — CV Insight' };

/**
 * The id is never trusted: the DAL query runs under the user's session, RLS
 * yields no row for another user's id, and the page answers 404 — never 403
 * (edge case S3).
 */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  return (
    <Placeholder
      title="Scan result"
      description="Match rate, coverage map, base matches, the tailored resume and its judge card."
      phase="the scan and generate phases"
    />
  );
}
