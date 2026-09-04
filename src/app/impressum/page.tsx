import Link from 'next/link';

import { APP_NAME, IMPRESSUM, IMPRESSUM_FILLED } from '@/lib/copy';

export const metadata = { title: 'Impressum — CV Insight' };

/**
 * Public route (SPEC v2.24, Block E). Static content only — no session, no data,
 * no trackers, exactly like /privacy beside it.
 *
 * It is PUBLIC in both deployment worlds. Even behind Vercel Deployment
 * Protection, /impressum and /privacy are the two pages whose whole purpose is
 * to be readable by someone who has not signed in, so whatever goes here is
 * world-readable from the first deploy. That is the reason the two values below
 * are the owner's to fill and not the agent's to invent.
 *
 * The operator's identity lives in `lib/copy.ts` behind `IMPRESSUM_FILLED`, not
 * inline here, so there is exactly one place to edit and one switch to flip.
 */
export default function ImpressumPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{IMPRESSUM.heading}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">{IMPRESSUM.legalBasisLine}</h2>

        {IMPRESSUM_FILLED ? (
          <>
            <p className="text-muted-foreground text-sm">{IMPRESSUM.operatorName}</p>
            <p className="text-muted-foreground text-sm">
              {IMPRESSUM.contactLabel}:{' '}
              <a
                href={`mailto:${IMPRESSUM.email}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {IMPRESSUM.email}
              </a>
            </p>
            <p className="text-muted-foreground text-sm">
              {IMPRESSUM.responsibleLabel}: {IMPRESSUM.operatorName}
            </p>
            <p className="text-muted-foreground text-sm">{IMPRESSUM.addressOnRequest}</p>
          </>
        ) : (
          /*
           * The unfilled branch states the absence rather than rendering the
           * placeholder tokens at a reader. A page showing "[[OPERATOR FULL
           * LEGAL NAME]]" claims an identity nobody holds; a page saying the
           * details are not published yet is simply true, and it is true in the
           * only window where it renders — before the link is shared.
           */
          <p className="text-muted-foreground text-sm">{IMPRESSUM.unfilled}</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">About this deployment</h2>
        <p className="text-muted-foreground text-sm">{IMPRESSUM.nonCommercial}</p>
        <p className="text-muted-foreground text-sm">
          How {APP_NAME} handles personal data is described on the{' '}
          <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
            privacy page
          </Link>
          .
        </p>
      </section>

      <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
        Back to {APP_NAME}
      </Link>
    </main>
  );
}
