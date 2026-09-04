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
          the name and optional target role you give each resume you import, job postings, scans,
          generated resumes and per-call AI usage metadata, in a Supabase Postgres database hosted
          in the EU (Frankfurt). Rows are scoped to your account.
        </p>
        <p className="text-muted-foreground text-sm">
          If you choose to save a display name in Settings, it is stored with your account and used
          for two things only: the name line of the resumes you generate, and the file name when you
          download one. It is optional — the app works without it, and a resume then asks you to
          fill the name in yourself. You can change or remove it in Settings at any time, and it is
          deleted along with everything else when you delete your account.
        </p>
        <p className="text-muted-foreground text-sm">
          The same applies to the contact details you may save in Settings — a contact email
          address, a phone number, a location, a LinkedIn address, a GitHub address and whether you
          are open to remote work. They are stored with your account and used for the header block
          at the top of the resumes you generate and download, so an employer can reply to one.
          They are <strong>not</strong> sent to the AI provider: the header is added to your resume
          after it has been written and checked, and it is removed again before any text is sent
          for a quality check or a re-score. Writing a resume and judging it do not need a phone
          number, so it does not leave. Each of these fields is optional and the app works with all
          of them empty; you can change or remove any of them in Settings at any time, and they are
          deleted along with everything else when you delete your account.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Processing by OpenRouter</h2>
        <p className="text-muted-foreground text-sm">
          Resume and vacancy text are personal data. They are sent to OpenRouter for processing so
          the app can parse the posting, score the match, generate a tailored resume and evaluate
          it. The name you save in Settings travels with them, because a resume needs a name line
          on it. The contact details you may save do not travel with them at all — the section
          above says what happens to those instead.
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
