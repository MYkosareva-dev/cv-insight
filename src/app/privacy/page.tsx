import Link from 'next/link';

import { APP_NAME, AUDIT_RETENTION_VERIFIED, PRIVACY_ERASURE, PRIVACY_UPDATED } from '@/lib/copy';

export const metadata = { title: 'Privacy — CV Insight' };

/**
 * Public route. Static content only — no session, no data, no trackers.
 *
 * v2.24: the completeness pass SPEC Block A's privacy decision made a hard gate
 * before any deployment reachable by anyone but the owner. What was here before
 * was ACCURATE — every sentence it made was true — but it was missing most of
 * what Art. 13 enumerates: no controller identity, no legal basis per purpose,
 * no retention beyond the audit records, one right out of six, no complaint
 * right, and no mention at all that the data leaves the EU. That last one was
 * the serious half: the page named "the EU (Frankfurt)" twice and never said
 * that every model call goes to a US company, so a careful reader would have
 * concluded the opposite of what happens.
 *
 * WHAT THIS PAGE MAY NOT DO. The retention PERIOD for authentication audit
 * records appears in exactly one place — the `PRIVACY_ERASURE` ternary below —
 * and nowhere else in the app. Do not restate it in prose here, in the deletion
 * dialog, or in a toast. One claim, one switch, one proof.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="text-muted-foreground text-sm">Last updated: {PRIVACY_UPDATED}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Who is responsible</h2>
        <p className="text-muted-foreground text-sm">
          The operator named in the{' '}
          <Link href="/impressum" className="text-primary underline-offset-4 hover:underline">
            Impressum
          </Link>{' '}
          is the controller for the processing described on this page, and is the person to
          contact about it — including to exercise any of the rights listed below.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">What is stored, and where</h2>
        <p className="text-muted-foreground text-sm">
          {APP_NAME} stores the email address you sign up with, together with your career items,
          the name and optional target role you give each resume you import, job postings you
          paste or upload, scans and their results, generated resume versions, the notes and
          status you set on an application, and per-call AI usage metadata, in a Supabase Postgres
          database hosted in the EU (Frankfurt). Rows are scoped to your account: the database
          refuses to return another account&rsquo;s rows, and there is no administrator view.
        </p>
        <p className="text-muted-foreground text-sm">
          The AI usage metadata is metadata only — which step ran, which model answered, how many
          tokens it used, what it cost, how long it took and whether it succeeded. Your resume and
          vacancy text are not written into it, and there is no column they could go in.
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
        {/*
         * THE HONEST LIMIT OF THE SENTENCE ABOVE (eu-5, phase-6-eu-compliance).
         * The claim is exact and it is enforced by the compiler — but it is a
         * claim about the fields the APP adds, not about text the user supplies.
         * A resume PDF has the person's name, email and phone printed at the top
         * of it, and importing one sends the document as it stands. Saying only
         * the first half creates the impression that no contact detail ever
         * reaches the provider, which is the opposite of what an import does.
         * The code already carried this caveat in a comment in
         * src/lib/resumeHeader.ts; it belongs where the reader is.
         */}
        <p className="text-muted-foreground text-sm">
          That applies to the contact details you save in Settings. It cannot apply to text you
          supply yourself: if you import a resume PDF or paste resume text, that text is sent to
          the AI provider exactly as you gave it, including any name, address, phone number or
          email address printed inside it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Why we process it, and on what basis</h2>
        <p className="text-muted-foreground text-sm">
          Your account, your career base, scans, resume generation, quality checks and export are
          processed to provide the service you asked for — the legal basis is performance of a
          contract with you (Art. 6(1)(b) GDPR). Authentication audit records are kept for the
          security of the service, on the basis of legitimate interests (Art. 6(1)(f)): keeping a
          short record of sign-in events is what makes it possible to notice an account being
          attacked, and it is limited to the events themselves rather than anything you wrote.
        </p>
        <p className="text-muted-foreground text-sm">
          There is no processing here that relies on your consent, no advertising, no profiling for
          marketing, and nothing is sold or shared with anyone for their own purposes.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Processing by AI providers, and outside the EU</h2>
        <p className="text-muted-foreground text-sm">
          Resume and vacancy text are personal data. They are sent to OpenRouter for processing so
          the app can parse the posting, score the match, generate a tailored resume and evaluate
          it. Your career items are part of this: generating and judging a resume draws on the
          items stored in your career base, and the relevant ones are sent with the request. The
          name you save in Settings travels with them, because a resume needs a name line on it.
          The contact details you may save do not travel with them at all — the section above says
          what happens to those instead.
        </p>
        <p className="text-muted-foreground text-sm">
          OpenRouter is established outside the EU/EEA, and it routes each request onward to the
          company that runs the requested model.{' '}
          <strong>This means your resume and vacancy text are transferred to the United States.</strong>{' '}
          The models currently used are <code>openai/gpt-5.4</code> (OpenAI) to write the tailored
          resume, <code>anthropic/claude-haiku-4.5</code> (Anthropic) to read the job posting and
          to run the quality check on the generated resume, <code>google/gemini-2.5-flash</code>{' '}
          (Google) as a fallback when one of those is unavailable, and{' '}
          <code>openai/text-embedding-3-small</code> (OpenAI) to index your career items so they
          can be searched by meaning.
        </p>
        <p className="text-muted-foreground text-sm">
          No account identifier goes with any of it. The request carries the text and nothing that
          says whose account it came from — not your email address, not your user id, not a session
          token, not a database row id.
        </p>
        {/*
         * eu-2, phase-6-eu-compliance. The model-provider account this
         * deployment's key belongs to is not the operator's, and its logging,
         * retention and training settings are therefore configured by someone
         * else — recorded in docs/openrouter-processing.md, setting 4, with the
         * verbatim evidence. The reviewer's conclusion was that silence on this
         * point is the one option not available, and it is right: a reader
         * cannot evaluate a transfer whose retention terms the operator cannot
         * state. Stated plainly here rather than implied.
         *
         * THIS PARAGRAPH IS THE HONEST VERSION OF AN UNRESOLVED SITUATION, NOT
         * A PERMANENT ONE. If the operator moves to their own provider account
         * and records the verification, this becomes a sentence naming the
         * settings instead, and the "do not paste a real resume" instruction
         * below can go.
         */}
        <p className="text-muted-foreground text-sm">
          <strong>What we cannot tell you yet.</strong> The AI provider account used by this
          deployment is not operated by us, so we cannot confirm to you how long that provider
          retains a request, or whether it is used to train models. Until we can, treat this
          deployment as a demonstration: please do not paste a real resume or any other real
          person&rsquo;s details into it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Who else processes this data</h2>
        <p className="text-muted-foreground text-sm">
          Two service providers process data on our behalf and on our instructions. Supabase
          provides the database and the sign-in system, in the EU (Frankfurt). Vercel hosts the
          application: every request passes through it, and it keeps short-lived infrastructure
          logs that include IP addresses and request metadata. OpenRouter and the model companies
          named above receive the text described in the previous section.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Only your own data</h2>
        <p className="text-muted-foreground text-sm">
          Please submit only your own information. {APP_NAME} does not detect or filter other
          people&rsquo;s personal data, so a resume or a job posting you paste is processed exactly
          as you supply it — including any third party&rsquo;s name or contact details left inside
          it. If you do not need them, remove them before pasting.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">How long it is kept</h2>
        <p className="text-muted-foreground text-sm">
          What you create is kept until you remove it or delete your account — there is no separate
          expiry, and nothing is deleted behind your back. You can delete individual career items
          at any time. Job postings, scans, generated resume versions and the AI usage records are
          not individually deletable in this version; deleting your account removes them, and the
          next section says exactly what that does. Authentication audit records are the one
          category on a fixed schedule, described there.
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
       *
       * The paragraph BELOW this one is about the granularity of erasure and is
       * deliberately outside the ternary: it names no period, so it cannot
       * duplicate the claim this switch guards.
       */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Right to erasure</h2>
        <p className="text-muted-foreground text-sm">
          {PRIVACY_ERASURE.lead}{' '}
          {AUDIT_RETENTION_VERIFIED ? PRIVACY_ERASURE.verified : PRIVACY_ERASURE.fallback}
        </p>
        <p className="text-muted-foreground text-sm">
          In this version, deleting your account is the only way to remove a job posting, a scan or
          a generated resume version — the app does not yet offer a delete button for those
          individually. If you want one of them removed without deleting your account, contact the
          operator and it will be done for you.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Your rights</h2>
        <p className="text-muted-foreground text-sm">
          You have the right to access the personal data we hold about you, to have inaccurate data
          corrected, to have data erased, to have processing restricted, to object to processing
          carried out on the basis of legitimate interests, and to receive the data you provided in
          a portable form. To exercise any of these, contact the operator named in the Impressum.
        </p>
        <p className="text-muted-foreground text-sm">
          You also have the right to lodge a complaint with a data protection supervisory
          authority, in particular in the EU country where you live or work, or where you believe
          the problem occurred.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">No decisions are made about you</h2>
        <p className="text-muted-foreground text-sm">
          The match score, the keyword gaps and the quality verdict are advice about your own
          document, shown only to you. No employer, recruiter or other third party sees them, and
          nothing here decides anything about you — what to do with the result is entirely yours.
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
        <h2 className="text-lg font-medium">Impressum</h2>
        <p className="text-muted-foreground text-sm">
          The operator&rsquo;s details are on the{' '}
          <Link href="/impressum" className="text-primary underline-offset-4 hover:underline">
            Impressum
          </Link>{' '}
          page.
        </p>
      </section>

      <Link href="/" className="text-primary text-sm underline-offset-4 hover:underline">
        Back to {APP_NAME}
      </Link>
    </main>
  );
}
