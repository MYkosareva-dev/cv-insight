import type { SubscriptionEvent } from '@/lib/db/types';

/**
 * The two plans, their limits, and the rule that turns a ledger row into a plan
 * (SPEC v3.0, rules B7 / B7a / B11).
 *
 * THE PLAN IS DERIVED, NEVER STORED WHERE A USER CAN WRITE IT. `profiles` has an
 * owner UPDATE policy and the project URL and anon key are public, so a `plan`
 * column there could be set to `pro` through the REST endpoint by any signed-in
 * user without this app ever seeing the request. The plan is the latest
 * `subscription_events` row's answer instead, and that table has no write policy
 * for any user role.
 *
 * Deliberately NOT `server-only`, for the reason `lib/budget.ts` is not: the
 * limits and the derivation are the arithmetic that decides how much one user
 * may spend, and `node --test` cannot load a `server-only` module. Everything in
 * this file is pure EXCEPT `currentPlan()`, which loads the ledger DAL lazily —
 * a static import would pull `server-only` into every test that reads a limit.
 *
 * WHO DECIDES. `lib/chat.ts` and `lib/retrieval.ts` call `currentPlan()` right
 * after `getUser()` and refuse there. No page, component or route handler makes a
 * plan decision; a screen may DESCRIBE the plan (Settings, the limit tiles on
 * /quality), and a hidden button is a courtesy, not a control.
 */

export type PlanId = 'free' | 'pro';

/**
 * What a refusal names, so the screen can say which plan and which feature
 * (Block D, 403 PLAN_REQUIRED and 429 DAILY_LIMIT). `ai_calls` is the overall
 * chat ceiling, which is no one feature.
 */
export type PlanFeature = 'scan' | 'generate' | 'agentic' | 'rescore' | 'ai_calls';

/** The chat steps that carry a per-step allowance on some plan. */
export type MeteredStep = 'parse_vacancy' | 'generate';

export type PlanLimits = {
  /** Rule B7: chat rows per rolling 24 h, every step together. Embeddings excluded. */
  dailyChatCalls: number;
  /**
   * Rule B7, Free only: successful rows of one step per rolling 24 h. A step
   * absent here has no allowance of its own and is bounded by `dailyChatCalls`.
   */
  perStep: Partial<Record<MeteredStep, number>>;
  /** Rule B7a: `rescore` embedding requests per rolling 24 h. */
  dailyRescoreRequests: number;
  /** SPEC v3.0 §5: the agentic generation path. */
  agentic: boolean;
};

/**
 * The table of limits, keyed by plan. `lib/budget.ts` takes the plan as an
 * argument and reads this; nothing else holds a limit.
 *
 * FREE IS A STRICT SUBSET OF PRO. The per-step allowances are added ON TOP of the
 * same 50-row overall ceiling, not instead of it: without that, the on-demand
 * judge and the career import — which no per-step allowance names — would have
 * no ceiling at all on the plan that anyone can sign up for.
 */
export const PLAN_LIMITS: Readonly<Record<PlanId, Readonly<PlanLimits>>> = {
  free: {
    dailyChatCalls: 50,
    perStep: { parse_vacancy: 3, generate: 1 },
    dailyRescoreRequests: 20,
    agentic: false,
  },
  pro: {
    dailyChatCalls: 50,
    perStep: {},
    dailyRescoreRequests: 100,
    agentic: true,
  },
};

/** The two Stripe statuses this app reads as Pro. Every other status is stored verbatim and means Free. */
export const PRO_STATUSES: readonly string[] = ['active', 'trialing'];

/** The fields of a ledger row the plan is decided by. */
export type PlanRow = Pick<SubscriptionEvent, 'status' | 'current_period_end'>;

/**
 * Rule B11, as a pure function: `pro` while the status is `active` or `trialing`
 * AND the period end is in the future; `free` otherwise, and `free` with no row.
 *
 * A null or unparseable period end is Free. "Pro until a date nobody knows" is
 * not a state this app may infer, and the safe direction for a metered decision
 * is the smaller allowance.
 */
export function planFromLatestRow(row: PlanRow | null, now: Date = new Date()): PlanId {
  if (!row) return 'free';
  if (!PRO_STATUSES.includes(row.status)) return 'free';
  if (!row.current_period_end) return 'free';
  const end = Date.parse(row.current_period_end);
  if (Number.isNaN(end)) return 'free';
  return end > now.getTime() ? 'pro' : 'free';
}

/**
 * What the Settings Plan block renders (SPEC Block E v3.0), derived from ONE
 * ledger read so the card and the plan cannot disagree.
 *
 *  - `unavailable`: the read failed (006 not applied, `PGRST205` / `42P01`, or
 *    the database unreachable). The gates treat the user as Free in the same
 *    state, and the card SAYS so rather than showing a Free card as though that
 *    were the ledger's answer.
 *  - `pastDue`: the latest row is `past_due` (edge case P11). Free by rule B11,
 *    with a customer to manage — so the card offers [Manage subscription], never
 *    [Upgrade], which would open a second subscription beside the failed one.
 */
export type PlanView =
  | { kind: 'unavailable'; plan: 'free' }
  | { kind: 'free'; plan: 'free' }
  | { kind: 'pastDue'; plan: 'free' }
  | { kind: 'pro'; plan: 'pro'; periodEnd: string; cancelAtPeriodEnd: boolean };

export type LedgerRead =
  | { ok: true; row: Pick<SubscriptionEvent, 'status' | 'current_period_end' | 'cancel_at_period_end'> | null }
  | { ok: false };

export function planViewOf(read: LedgerRead, now: Date = new Date()): PlanView {
  if (!read.ok) return { kind: 'unavailable', plan: 'free' };
  const { row } = read;
  if (row && planFromLatestRow(row, now) === 'pro' && row.current_period_end) {
    return {
      kind: 'pro',
      plan: 'pro',
      periodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
    };
  }
  if (row?.status === 'past_due') return { kind: 'pastDue', plan: 'free' };
  return { kind: 'free', plan: 'free' };
}

/** The reader `currentPlan()` uses; injectable so the failure path is testable. */
export type LatestRowReader = (userId: string) => Promise<PlanRow | null>;

/**
 * The caller's plan, for the gates. NEVER THROWS: a failed read answers `free`
 * (rule B11, edge case P10), because both gates call this on every metered path
 * — indexing included, which must never be able to fail a save — and the safe
 * direction for a metered decision is the smaller allowance.
 *
 * `userId` comes from the gate's own verified `getUser()`; the DAL reads under
 * the caller's session as well, so RLS scopes the row whatever id is passed.
 */
export async function currentPlan(userId: string, read?: LatestRowReader): Promise<PlanId> {
  try {
    const reader =
      read ?? (await import('@/lib/db/subscriptionEvents')).latestForUser;
    return planFromLatestRow(await reader(userId));
  } catch (err) {
    // Metadata only. The code tells the operator whether 006 is applied.
    console.error('[plan] ledger read failed; treating the caller as free', {
      name: err instanceof Error ? err.name : typeof err,
      code: (err as { code?: string } | null)?.code,
    });
    return 'free';
  }
}
