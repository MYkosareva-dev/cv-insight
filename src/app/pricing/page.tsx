import Link from 'next/link';

import { BillingButton } from '@/components/billing-button';
import { buttonVariants } from '@/components/ui/button';
import { PRICING } from '@/lib/copy';
import { latestForUser } from '@/lib/db/subscriptionEvents';
import { planViewOf } from '@/lib/plan';
import { getUser } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Pricing — CV Insight' };

/** Which control sits under the Pro card. The only session-dependent part of the page. */
type ProAction = 'signIn' | 'checkout' | 'portal';

/**
 * ONE LEDGER READ, the same rule as the gates. `latestForUser()` once and
 * `planViewOf()` over it — what Settings does, and the rule `currentPlan()`
 * applies — rather than `currentPlan()` itself, because `currentPlan()` answers
 * `free` on a failed read and on `past_due`, and this page must tell those apart:
 *
 *  - a failed read (edge case P10) renders the VISITOR button. The page can
 *    always be read; the worst a failed read does is offer sign-in to someone
 *    already signed in. Offering [Upgrade] on a read that did not happen would
 *    invite a second subscription beside one the ledger could not show.
 *  - `past_due` (P11) is Free by rule B11 with a customer to manage, so it gets
 *    [Manage subscription], never [Upgrade].
 *
 * The button decides nothing: the plan is enforced in the gates (rule B11), and
 * the billing routes verify the session themselves.
 *
 * `getUser()` stays OUTSIDE the try, as in Settings: it reads cookies, and at
 * build time that read throws Next's dynamic-rendering signal, which a catch
 * here would swallow and log as a failed plan read.
 */
async function readProAction(): Promise<ProAction> {
  const user = await getUser();
  if (!user) return 'signIn';
  try {
    const view = planViewOf({ ok: true, row: await latestForUser(user.id) });
    if (view.kind === 'free') return 'checkout';
    return 'portal';
  } catch (err) {
    console.error('[pricing] could not read the plan; rendering the visitor button', {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: string } | null)?.code,
    });
    return 'signIn';
  }
}

/**
 * Public route (SPEC v3.0, Block E), matcher-excluded as an exact path like
 * /privacy and /impressum. A static shell around one server read: the two
 * plans, the limits their gates enforce, and one button.
 *
 * The Pro card carries the violet accent and nothing else on the page does.
 */
export default async function PricingPage() {
  const action = await readProAction();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{PRICING.heading}</h1>
        <p className="text-muted-foreground text-sm">{PRICING.intro}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="plan-free"
          className="border-border flex flex-col gap-4 rounded-lg border p-6"
        >
          <PlanHeader id="plan-free" name={PRICING.freeName} price={PRICING.freePrice} />
          <Limits column="free" />
        </section>

        <section
          aria-labelledby="plan-pro"
          className="border-accent flex flex-col gap-4 rounded-lg border-2 p-6"
        >
          <PlanHeader id="plan-pro" name={PRICING.proName} price={PRICING.proPrice} accent />
          <Limits column="pro" />
          <div className="mt-auto flex flex-col gap-2 pt-2">
            {action === 'signIn' ? (
              <Link href="/login" className={cn(buttonVariants({ variant: 'hero' }), 'w-fit')}>
                {PRICING.signInToUpgrade}
              </Link>
            ) : (
              <BillingButton action={action} />
            )}
            <p className="text-muted-foreground text-xs">{PRICING.testModeLine}</p>
          </div>
        </section>
      </div>

      <p className="text-muted-foreground text-xs">{PRICING.rollingFootnote}</p>
    </main>
  );
}

function PlanHeader({
  id,
  name,
  price,
  accent = false,
}: {
  id: string;
  name: string;
  price: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className={cn('text-lg font-semibold', accent && 'text-accent')}>
        {name}
      </h2>
      <p className="text-sm font-medium">{price}</p>
    </div>
  );
}

function Limits({ column }: { column: 'free' | 'pro' }) {
  return (
    <dl className="flex flex-col gap-3">
      {PRICING.rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {row.label}
          </dt>
          <dd className="text-sm">{row[column]}</dd>
        </div>
      ))}
    </dl>
  );
}
