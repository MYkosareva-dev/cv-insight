# Billing — webhook evidence

**Status: LOCAL HALF RECORDED, DEPLOYMENT HALF PENDING.** SPEC Block H item 12
asks for one real test-mode upgrade witnessed end to end on the deployment. This
file holds the local run that came first: a real Stripe test-mode Checkout,
Customer Portal and `stripe listen` against the dev server and the live Supabase
project. It found one defect, recorded below with its fix. The deployment run —
the dashboard's own webhook endpoint and its delivery log — is still to do, and
item 12 is not closed until it is here.

## How it was run

- **When:** 2026-10-12, by the owner.
- **Server:** the local dev server (`npm run dev`) against the live Supabase
  project, migration 006 applied.
- **Stripe:** test mode. Events forwarded by the Stripe CLI to
  `localhost:3000/api/stripe/webhook`, restricted to the three types the
  endpoint handles, with the CLI's own signing secret in `.env.local`. On
  PowerShell the event list has to be **quoted** — see docs/deploy.md, "Stripe in
  test mode".
- **Account:** a fresh throwaway account, `2f656679-10ce-4141-a9ae-383419c967d0`.
- **Card:** Stripe's test card, as the Settings helper line says.

## Run output

```
17:44:54  checkout.session.completed      evt_1UPlPF2NKY1mL9wLGnMW5rAv   -> [200]
          Settings: Pro plan, "Renews on 12 November 2026"
          toast plan_upgraded fired (dev log: 307 -> /settings?notice=plan_upgraded)

17:46:45  stripe events resend evt_1UPlPF2NKY1mL9wLGnMW5rAv               -> [200]
          ledger: still ONE row for stripe_event_id = evt_1UPlPF2NKY1mL9wLGnMW5rAv

          Customer Portal -> cancel at period end
          Stripe portal: "will be cancelled 12 Nov 2026"
17:50:06  customer.subscription.updated   evt_1UPlUI2NKY1mL9wLiYYaXhkn   -> [200]
17:50:07  customer.subscription.updated   evt_1UPlUJ2NKY1mL9wL4G7OORlM   -> [200]
          both rows: status active, cancel_at_period_end = false,
                     current_period_end 2026-11-12 15:44:50
          Settings: "Renews on 12 November 2026"            <-- DEFECT
```

## What this witnesses

- **Nothing is written before Stripe confirms, and the first row is the
  confirmation.** The upgrade produced its ledger row from
  `checkout.session.completed`, through the signature check, attribution by
  `client_reference_id` and the service-role insert.
- **The billing period is read off the subscription items** (SPEC v3.0a item 6):
  the row carries the real period end, and Settings rendered it.
- **`?checkout=success` reads the ledger.** The webhook had landed by the time the
  redirect did (edge case P2), so the page found a Pro row and redirected to the
  `plan_upgraded` toast, which strips the parameter.
- **A replay is not a second row** (edge case P4). Stripe redelivered the same
  event, the endpoint answered 200, and the ledger still holds one row for that
  event id — the unique `stripe_event_id` doing the idempotency, as designed.
- **A Portal change is a new row, not an edit** (edge case P7): the cancellation
  arrived as two `customer.subscription.updated` events and appended two rows.

## The defect, and its fix

**What happened.** Both `customer.subscription.updated` rows recorded
`cancel_at_period_end = false`, so Settings said "Renews on 12 November 2026" for
a subscription Stripe showed as ending on that date. The plan itself was right —
Pro until 12 November is what a cancellation at period end means — but the card
told the user the opposite of what they had just done.

**Why.** It is the same shape as the `current_period_end` finding. On the API
version the SDK pins (2026-08-26), under flexible billing mode, cancelling "at
period end" in the Customer Portal sets `cancel_at` to a timestamp and leaves
`cancel_at_period_end` false. The webhook read the flag alone.

**Fix** (`src/lib/billing/webhook.ts`, the commit before this file): `cancel_at`
set OR the flag true now means cancel-scheduled, stored as
`cancel_at_period_end = true`; and when `cancel_at` is set it is stored as
`current_period_end`, so Pro lasts until then and no later. Two fixtures in
`tests/unit/webhook.test.mjs` pin it: the shape this run received (`cancel_at`
set, flag false) and a `cancel_at` before the period would close. SPEC v3.0a
item 6a records the deviation.

**Re-witnessed live** — see "The fix, witnessed" below. The two rows above were
written before the fix and stay as they are: the ledger is append-only, so they
are a true record of what the earlier code stored.

## The fix, witnessed (2026-10-12, after `1df3f62`)

Same account, same dev server and `stripe listen` session, with the fix in place.
The subscription was resumed and then cancelled again, both through the Customer
Portal.

```
17:58:14  resumed in the Portal           evt_1UPlcA2NKY1mL9wLzyTO8Sdy   -> [200]

17:59:40  cancelled again in the Portal   evt_1UPldY2NKY1mL9wLSL8WJnQL   -> [200]
17:59:40                                  evt_1UPldY2NKY1mL9wLepfzfBS3   -> [200]
          Settings: "Cancels on 12 November 2026 — Pro stays until then."
```

This witnesses the fix end to end: the same Portal action that produced "Renews"
before `1df3f62` now produces the cancelling card, with the end date Stripe
shows. Every delivery answered 200, and each appended a row rather than editing
one — the resume and the second cancellation are new rows beside the earlier
ones, which is how a cancellation that was undone and redone reads in a ledger.

## What this does NOT witness

- **The deployment.** The dashboard's webhook endpoint, its signing secret, its
  API version and its delivery log are SPEC Block H item 12's other half.
- **`customer.subscription.deleted`.** It arrives at the period end, 12 November
  2026, or earlier through a test clock; neither has happened.
- **Pro lapsing to Free on its own** once `current_period_end` passes (edge case
  P7's second half). Pinned by `tests/unit/plan.test.mjs`, not yet observed.
- **A failed renewal** (`past_due`, edge case P11/P16), or the portal opened from
  the past-due card.
- **The agentic path.** It is not built; a Pro account runs the single-shot path.
