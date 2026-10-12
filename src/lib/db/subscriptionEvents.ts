import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import type { SubscriptionEvent } from '@/lib/db/types';

/**
 * DAL for `subscription_events` (SPEC v3.0, migration 006) — the billing ledger.
 *
 * Policies: owner SELECT and nothing else. No user role may insert, update or
 * delete, and a BEFORE trigger beneath RLS refuses every UPDATE and every DELETE
 * that is not the account cascade. A cancellation is a new row.
 *
 * TWO CLIENTS, AND THIS FILE IMPORTS ONLY ONE OF THEM. Reads run under the
 * caller's own session (`createClient()`), so RLS scopes them like every other
 * DAL. The writes — and the webhook's lookup by customer id, which has no
 * session to be scoped by — take the service-role client AS AN ARGUMENT. This
 * module never imports `lib/supabase/admin.ts`: the webhook route is the
 * consumer of that client (check.mjs R10 names exactly two), and a DAL that built
 * one itself would put an RLS-bypassing client one function call away from
 * every reader of the plan. Handed the user's client by mistake, the write
 * fails safely, because there is no INSERT policy for it to pass.
 */

/** The row the webhook writes. `id` and `received_at` are the database's. */
export type NewSubscriptionEvent = Omit<SubscriptionEvent, 'id' | 'received_at'>;

/** Postgres `unique_violation` — the idempotency signal (edge case P4). */
const UNIQUE_VIOLATION = '23505';
/** Postgres `foreign_key_violation` — the user no longer exists (edge case P12). */
const FOREIGN_KEY_VIOLATION = '23503';

export type AppendOutcome = 'inserted' | 'duplicate' | 'unknown_user';

/**
 * Append ONE row for one verified Stripe event.
 *
 * `stripe_event_id` is UNIQUE, and that uniqueness IS the idempotency: a
 * redelivered event is a caught constraint violation, reported as `duplicate`,
 * never a second row and never an error. It belongs to the database rather than
 * to a flag the handler has to remember to set.
 *
 * A foreign-key violation means the account this event names has been deleted
 * since (P12: the Stripe subscription outlives the account, by design). That is
 * `unknown_user`, not a failure — redelivering it for three days would not make
 * the account exist again.
 */
export async function appendFromStripeEvent(
  serviceRole: SupabaseClient,
  row: NewSubscriptionEvent,
): Promise<AppendOutcome> {
  const { error } = await serviceRole.from('subscription_events').insert(row);
  if (!error) return 'inserted';
  if (error.code === UNIQUE_VIOLATION) return 'duplicate';
  if (error.code === FOREIGN_KEY_VIOLATION) return 'unknown_user';
  throw error;
}

/**
 * The account a Stripe customer belongs to, from the ledger itself — the third
 * attribution step of endpoint #13, for an event carrying neither a
 * `client_reference_id` nor `metadata.user_id`.
 *
 * SERVICE ROLE, because the webhook has no session: under any other client the
 * owner-SELECT policy returns zero rows and every lookup would silently find no
 * user. Returns the id only — nothing else of the row leaves this function.
 */
export async function userIdForCustomer(
  serviceRole: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await serviceRole
    .from('subscription_events')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { user_id: string } | null)?.user_id ?? null;
}

/**
 * The caller's latest ledger row, or null when they have never subscribed.
 *
 * NULL IS THE FREE PLAN, and it is the normal state. THROWS on a failed read —
 * `currentPlan()` turns that into `free` for the gates, and Settings turns it
 * into `planUnavailable` so the user is told rather than shown a Free card as
 * though the ledger had said so.
 *
 * Filtered by owner AND fenced by RLS, the pairing `getProfile` uses. `userId`
 * comes from the caller's verified session.
 */
export async function latestForUser(userId: string): Promise<SubscriptionEvent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('subscription_events')
    .select('*')
    .eq('user_id', userId)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SubscriptionEvent | null) ?? null;
}
