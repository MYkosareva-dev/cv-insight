import { ScanForm } from '@/components/scan/scan-form';
import { countCareerItems } from '@/lib/db/careerItems';
import { countDocuments } from '@/lib/db/documents';

export const metadata = { title: 'New scan — CV Insight' };

/**
 * `/scan` — SPEC Block E, US-2.
 *
 * A Server Component wrapper around the form: the two numbers the panel needs
 * are read here, through their own DALs and under the user's own session, so RLS
 * scopes them to `auth.uid()` and no ownership filter appears in this file. The
 * member layout has already verified the session with getUser().
 *
 * Block E's three states, and where each one lives:
 *   - LOADING → `loading.tsx` beside this file. An awaited Server Component
 *               renders nothing until it resolves, so the skeleton has to be a
 *               Suspense fallback rather than a branch here.
 *   - EMPTY   → an empty career base with the Career-base tab selected, handled
 *               inside the form where the tab state lives.
 *   - ERROR   → the AI-unavailable toast, fired by the form from the endpoint's
 *               own message; a throw from either DAL reaches app/error.tsx.
 *
 * Two counts rather than one: the item count is what "Using all N items of your
 * base" states, and the document count is the only way to know whether that
 * base can actually be SEARCHED (edge case D7 — an item whose embedding call
 * failed is stored and invisible to matching).
 */
export default async function ScanPage() {
  const [itemCount, documentCount] = await Promise.all([countCareerItems(), countDocuments()]);

  return <ScanForm itemCount={itemCount} baseSearchable={documentCount > 0} />;
}
