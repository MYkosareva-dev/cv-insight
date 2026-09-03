import Link from 'next/link';

import { APP_NAME, AUDIT_RETENTION_VERIFIED, PRIVACY_ERASURE } from '@/lib/copy';

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
          {APP_NAME} stores the email address you sign up with, together with your career items,
          job postings, scans, generated resumes and per-call AI usage metadata, in a Supabase
          Postgres database hosted in the EU (Frankfurt). Rows are scoped to your account.
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

      {/*
       * SINGLE SOURCE of the erasure + audit-record claim (SPEC v2.9). This is
       * the ONLY place the page may mention audit records, retention or erasure
       * scope. Two sentences on the subject is how the page came to contradict
       * itself once already: an earlier version claimed Supabase retained the
       * records "for its own retention period" while a second section claimed we
       * delete them at 90 days. The first was simply false - auth.audit_log_entries
       * lives in OUR Postgres and we are the controller.
       *
       * The wording states the CONSEQUENCE, not the mechanism: a reader does not
       * care that auth.audit_log_entries has no foreign key to auth.users, they
       * care that deleting the account does not remove these rows. Scope is
       * likewise exact - "the data you created in the app", never "all data".
       *
       * Which branch renders is decided by AUDIT_RETENTION_VERIFIED, and by
       * nothing else. It is true, so the page states the 90-day period: a
       * scheduled purge run has succeeded, recorded in
       * docs/eval/audit-retention-evidence.md. check.mjs R12 requires that
       * paste before the constant may be true, so the claim and its proof
       * shipped together. If a run ever stops succeeding the constant goes back
       * to false and this paragraph reverts to promising no period.
       */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Right to erasure</h2>
        <p className="text-muted-foreground text-sm">
          {PRIVACY_ERASURE.lead}{' '}
          {AUDIT_RETENTION_VERIFIED ? PRIVACY_ERASURE.verified : PRIVACY_ERASURE.fallback}
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
