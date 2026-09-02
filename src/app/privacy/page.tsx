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
       * SINGLE SOURCE of the erasure + audit-record claim (SPEC v2.5). This is
       * the ONLY place the page may mention audit records, retention or erasure
       * scope. Two sentences on the subject is how the page came to contradict
       * itself once already: an earlier version claimed Supabase retained the
       * records "for its own retention period" while a second section claimed we
       * delete them at 90 days. The first was simply false - auth.audit_log_entries
       * lives in OUR Postgres and we are the controller. Before adding any
       * sentence here, grep the RENDERED page for "audit", "retention" and
       * "provider": each must appear at most once, in this block.
       *
       * The wording states the CONSEQUENCE, not the mechanism: a reader does not
       * care that auth.audit_log_entries has no foreign key to auth.users, they
       * care that deleting the account does not remove these rows. Scope is
       * likewise exact - "the data you created in the app", never "all data".
       *
       * This is the FALLBACK wording (SPEC v2.5). It makes no retention promise,
       * because 002_audit_retention.sql is not applied and no purge run has ever
       * succeeded. check.mjs R12 couples the strong claim to its proof: adding
       * "90 days" here FAILs the build until docs/eval/audit-retention-evidence.md
       * exists. The strong sentence, to be swapped in THE SAME COMMIT as that
       * evidence file, is:
       *
       *   ...in our EU database for 90 days for security purposes; these are not
       *   removed when you delete your account, and are deleted automatically
       *   when they age out.
       *
       * The proof that earns it is a `succeeded` row in cron.job_run_details, not
       * a row in cron.job: the auth schema is owned by supabase_auth_admin, so
       * without the grants in 002 the job fails nightly and leaves no
       * user-visible trace behind a page promising deletion.
       */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Right to erasure</h2>
        <p className="text-muted-foreground text-sm">
          Deleting your account removes your account and the data you created in the app.
          Separately, we keep authentication audit records (event type, your user id, email address
          and IP address) in our EU database for security purposes; these are not removed when you
          delete your account. An automated retention schedule for them is being set up.
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
