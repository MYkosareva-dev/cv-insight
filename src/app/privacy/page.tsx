import Link from 'next/link';

import { APP_NAME } from '@/lib/copy';

export const metadata = { title: 'Privacy — CV Insight' };

/**
 * Public route. Static content only — no session, no data, no trackers.
 * Full text lands with the legal phase and is reviewed by eu-compliance-reviewer.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Privacy</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">What is stored, and where</h2>
        <p className="text-muted-foreground text-sm">
          {APP_NAME} stores your career items, job postings, scans and generated resumes in a
          Supabase Postgres database hosted in the EU (Frankfurt). Rows are scoped to your account.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Processing by OpenRouter</h2>
        <p className="text-muted-foreground text-sm">
          Resume and vacancy text are personal data. They are sent to OpenRouter for processing so
          the app can parse the posting, score the match, generate a tailored resume and evaluate
          it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Cookies</h2>
        <p className="text-muted-foreground text-sm">
          Only strictly necessary authentication cookies are set. There are no analytics, no
          trackers and no third-party cookies, so no consent banner is shown.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Right to erasure</h2>
        <p className="text-muted-foreground text-sm">
          Deleting your account removes your account and all data you created. Our authentication
          provider (Supabase) retains security audit records of sign-in events for its own retention
          period.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Authentication audit records</h2>
        <p className="text-muted-foreground text-sm">
          Supabase records authentication events — sign-in, sign-out, account changes — in its own
          audit log. Those entries include the account identifier and email address and are kept
          under Supabase&apos;s retention policy, so they are not removed when you delete your
          account. They are provider-side security logging and are not used by CV Insight.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Impressum</h2>
        <p className="text-muted-foreground text-sm">
          Placeholder — completed in the legal phase.
        </p>
      </section>

      <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
        Back to {APP_NAME}
      </Link>
    </main>
  );
}
