import { redirect } from 'next/navigation';

import { BillingButton } from '@/components/billing-button';
import { ContactsForm } from '@/components/contacts-form';
import { DeleteAccountDialog } from '@/components/delete-account-dialog';
import { DisplayNameForm } from '@/components/display-name-form';
import { SETTINGS } from '@/lib/copy';
import { getProfile } from '@/lib/db/profiles';
import { latestForUser } from '@/lib/db/subscriptionEvents';
import { type LedgerRead, type PlanView, planViewOf } from '@/lib/plan';
import { EMPTY_CONTACTS, contactsOf } from '@/lib/resumeHeader';
import { getUser } from '@/lib/supabase/server';

export const metadata = { title: 'Settings — CV Insight' };

/**
 * Account screen (SPEC Block E): name, contact details, email read-only, the
 * plan (v3.0), danger zone.
 *
 * The (app) layout has already verified the session, so `user` is non-null by
 * the time this renders; the fallback is defensive, not a second gate.
 *
 * The profile (v2.17 name, v2.20 contacts) is read through the DAL under the
 * user's own session, so RLS scopes it — this page never asks for a profile by
 * id. `null` is a normal answer and renders empty optional fields, not an error.
 *
 * `getProfile` and NOT `getDisplayName` / `getContacts`: the pipeline's readers
 * swallow a failed read and fall back to a placeholder and an empty header,
 * because losing a paid run over an optional field would be the worse trade.
 * Here the feature IS the row, so a failed read has to be SAID rather than shown
 * as empty fields — empty fields with no explanation read as "the app forgot my
 * details".
 *
 * SAID, AND NOT THROWN. Letting it reach the error boundary was the first attempt
 * and it is disproportionate twice over: a whole Settings screen lost to optional
 * fields, and — observed, not theorised — Next prefetches the sidebar's /settings
 * link from every member route, so the throw surfaced on pages that never asked
 * for a profile and broke navigation across the app. The page renders, the fields
 * are empty, and each form says the read failed.
 *
 * ONE READ FOR BOTH FORMS. `select('*')` already returns every column, so asking
 * twice would be a second round trip for data the first one brought back — and
 * two reads could disagree, leaving one form reporting a failure the other did
 * not have.
 *
 * NO [Sign out] BUTTON HERE (v2.20, from owner feedback). It moved to an icon in
 * the top-right of the app shell, which is where users look for it — a sign-out
 * buried on the settings screen is one that has to be hunted for on every screen.
 */
/** "12 November 2026" — the house date format (`PRIVACY_UPDATED`), in UTC so the server's zone cannot shift it. */
function formatPlanDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * THE PLAN BLOCK (SPEC v3.0, Block E), from ONE ledger read.
 *
 * `latestForUser()` once, and every state derived from that row by
 * `planViewOf()` — the same rule `currentPlan()` applies in the gates. Two reads
 * (the plan, then the row for its dates) could disagree, and the card would
 * describe a plan the gates are not enforcing.
 *
 * A failed read is SAID (`planUnavailable`), not rendered as a Free card: the
 * gates treat the user as Free in that state, and the user is told why.
 */
async function readPlan(userId: string | undefined): Promise<PlanView> {
  if (!userId) return planViewOf({ ok: true, row: null });
  let read: LedgerRead;
  try {
    read = { ok: true, row: await latestForUser(userId) };
  } catch (err) {
    read = { ok: false };
    console.error('[settings] could not read the plan', {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: string } | null)?.code,
    });
  }
  return planViewOf(read);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const user = await getUser();
  const { checkout } = await searchParams;
  const plan = await readPlan(user?.id);

  /**
   * `?checkout=success` is NEVER A FACT (edge cases P2/P3). It only says the user
   * came back from Stripe; the LEDGER says whether the payment landed. Pro row →
   * the toast, through the `?notice` mechanism, which also strips the parameter.
   * No Pro row yet → stay, and say the upgrade is being confirmed.
   */
  const returnedFromCheckout = checkout === 'success';
  if (returnedFromCheckout && plan.kind === 'pro') redirect('/settings?notice=plan_upgraded');

  let displayName: string | null = null;
  let contacts = EMPTY_CONTACTS;
  let readFailed = false;
  try {
    /**
     * `getProfile` takes the owner id and filters on it, so RLS is no longer the
     * only thing keeping this read to one user's row. `user` is nullable here
     * because `getUser()` says so — the middleware fence means a signed-out
     * visitor never reaches this page, and the ternary states that rather than
     * asserting it with a `!`: no user means no profile to read, which is the
     * same empty field a user without a saved name sees.
     */
    const profile = user ? await getProfile(user.id) : null;
    displayName = profile?.display_name?.trim() || null;
    // Reads a row without the 005 columns as "nothing filled in", which is what
    // it is until the owner applies the migration.
    contacts = contactsOf(profile);
  } catch (err) {
    readFailed = true;
    // Metadata only: the message could carry the name, an email address or a
    // phone number — all of it personal data.
    console.error('[settings] could not read the profile', {
      name: err instanceof Error ? err.name : typeof err,
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{SETTINGS.title}</h1>

      <DisplayNameForm displayName={displayName} readFailed={readFailed} />

      {/*
        TWO LIGHT DIVIDERS (v2.20, owner feedback), and they do different jobs.
        The first separates the two things a user WRITES about themselves — their
        name and their contact details — which are one form each and would
        otherwise read as one long form. The second separates both of those from
        the account email below, which is a fact about the account they cannot
        change. A rule is the cheapest way to say that, and it needs no heading.
      */}
      <hr className="border-border" />

      <ContactsForm contacts={contacts} readFailed={readFailed} />

      {/* Written above, given below: the email is not a field. */}
      <hr className="border-border" />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{SETTINGS.emailLabel}</span>
        <p className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm">
          {user?.email ?? '—'}
        </p>
      </div>

      <PlanBlock plan={plan} pending={returnedFromCheckout} />

      {/* Unchanged, deliberately: an irreversible action keeps the shape the
          owner already reviewed. */}
      <div className="border-destructive/40 flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-destructive text-sm font-semibold">{SETTINGS.dangerZone}</h2>
        <DeleteAccountDialog />
      </div>
    </section>
  );
}

/**
 * Free / Pro / past due / unreadable — the card between the account details and
 * the danger zone. [Upgrade to Pro] is the card's single violet accent.
 *
 * The buttons are courtesies, not controls: hiding [Upgrade] from a Pro user
 * decides nothing (rule B11) — Stripe's one-subscription setting is the fence.
 */
function PlanBlock({ plan, pending }: { plan: PlanView; pending: boolean }) {
  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {SETTINGS.planHeading}
      </span>
      {plan.kind === 'pro' ? (
        <>
          <h2 className="text-sm font-semibold">{SETTINGS.planPro}</h2>
          <p className="text-muted-foreground text-sm">
            {plan.cancelAtPeriodEnd
              ? SETTINGS.planEnds(formatPlanDate(plan.periodEnd))
              : SETTINGS.planRenews(formatPlanDate(plan.periodEnd))}
          </p>
          <BillingButton action="portal" />
          <p className="text-muted-foreground text-xs">{SETTINGS.portalHelp}</p>
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold">{SETTINGS.planFree}</h2>
          <p className="text-muted-foreground text-sm">{SETTINGS.planFreeLimits}</p>
          {plan.kind === 'unavailable' ? (
            <p role="status" className="text-sm">
              {SETTINGS.planUnavailable}
            </p>
          ) : plan.kind === 'pastDue' ? (
            /* P11: a customer with a failed renewal. [Upgrade] would open a
               second subscription beside the failed one; the portal fixes it. */
            <>
              <p role="status" className="text-sm">
                {SETTINGS.planPastDue}
              </p>
              <BillingButton action="portal" />
              <p className="text-muted-foreground text-xs">{SETTINGS.portalHelp}</p>
            </>
          ) : pending ? (
            /* P3: back from Stripe, the webhook not in yet. A second Checkout
               beside a payment that just succeeded is the wrong control. */
            <p role="status" className="text-sm">
              {SETTINGS.upgradePending}
            </p>
          ) : (
            <>
              <BillingButton action="checkout" />
              <p className="text-muted-foreground text-xs">{SETTINGS.upgradeHelp}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
