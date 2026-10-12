# ai-code-reviewer — `feature/billing` (`git diff main...HEAD`)

Run once on the full branch diff, 10 commits `dd93157`..`6bb4ccd`. Saved verbatim.

---

# AI Code Review: feature/billing, 2026-10-12

VERDICT: REVISE

There are no blockers. One existing Playwright spec will fail deterministically against the new Free allowance, and one SPEC and test claim points at evidence that does not exist. The security model holds: gates, plan derivation, grant, webhook order, admin-client scope and secrets all hold.

Scope: `git log main..HEAD` has 10 commits (dd93157 to 6bb4ccd) across 44 files. I read every code file in the requested scope, plus `tests/e2e/generate.spec.ts`, `tests/e2e/scan.spec.ts`, `src/lib/tailoring.ts`, `src/app/api/scan/route.ts` and `src/components/applications/result-workspace.tsx` because the diff made them suspect. I did not read `.env*` file contents (variable names only, via `grep -o '^[A-Z_]*'`) or WORKLOG.md.

Commands run:
- `node scripts/check.mjs`: "check passed (13 rules) … service-role key pinned to lib/supabase/admin.ts and its client to the account and Stripe-webhook routes; Stripe client pinned to the three billing routes …", exit 0.
- `npm test`: 455 pass, 0 fail.
- `npx tsc --noEmit`: clean.
- `npx eslint src`: clean.
- Playwright was not run (it needs a live server and keys).

Blockers: []

## MAJOR

**M1. An existing e2e spec breaks: the Free regenerate now gets 429.**
- File: `tests/e2e/generate.spec.ts:760-773` (test "generate, judge, edit, re-score, export — the whole US-4/US-5 path", which starts at :369).
- Evidence: the test signs up a fresh account, which is Free. It generates at :380, then clicks [Regenerate] at :760 and asserts `expect(second.status(), 'a regenerate is the same endpoint, run again').toBe(200)` at :773. Under v3.0 the run goes through `authorizeGenerate()` (`src/lib/chat.ts:209`), then `assertUnderStepCap(plan,'generate')` (:248). With `PLAN_LIMITS.free.perStep.generate = 1`, the second run is a 429 `RESULT.dailyLimitFree`.
- Why it is deterministic: the regenerate happens minutes after the first run, long after its `after()`-written `generate` row has committed.
- This file is not in the diff, so the break is unaddressed. The rest of this test (the "/quality shows the run" check and the code after it) never runs either.
- Fix, choose one:
  - (a) Turn the regenerate block into an assertion of the Free refusal: 429, `RESULT.dailyLimitFree`, `feature: 'generate'`. Move the "it appends, never replaces" check to a Pro witness (fixme plus evidence), and move the code after :773 so it still runs.
  - (b) Split the regenerate into its own `fixme`/Pro test.
- Then run `npx playwright test generate.spec.ts` and record the result. Also re-check the other generate.spec cases (:837, :883, :1090, :1175). Each uses its own account and appears to make one generate, but confirm.

**M2. A claimed witness for the Pro half does not exist.**
- Files: `tests/e2e/plan-gating.spec.ts:200`, `tests/e2e/billing.spec.ts:128`, `SPEC.md:1048` (v3.0a item 13).
- Evidence: all three say the Pro half ("agentic proceeds, portal answers `billing.stripe.com`") is "witnessed … in docs/eval/billing-webhook-evidence.md".
- That file's "What this does NOT witness" section says: "**The agentic path.** It is not built; a Pro account runs the single-shot path." No Pro `POST …/generate {"mode":"agentic"}` answering 200 is recorded anywhere.
- The portal half is only implied ("Customer Portal -> cancel at period end"); the `{ url }` host is not recorded.
- Per CLAUDE.md ("A configured mechanism is not a working one"; "No undeclared deviations"), a SPEC note may not cite evidence that is not there.
- Fix: in the same local setup, have the Pro account POST `/api/applications/<id>/generate` with `{"mode":"agentic"}`, and POST `/api/billing/portal`. Paste both statuses and the portal URL host into the evidence file. Otherwise, reword SPEC item 13 and both fixme comments to say the Pro half is not yet witnessed.

## MINOR

**m1. The Free resume allowance depends on `after()` timing, in a window wider than the declared overshoot.**
- Files: `src/lib/chat.ts:190-215`, `src/lib/db/llmCalls.ts:180-187`, `tests/e2e/plan-gating.spec.ts:182`.
- Evidence: `assertUnderStepCap` counts committed `ok=true` `generate` rows. `logLlmCall` inserts them in `after()`, which runs once the response has been sent. The per-application lock is released in the route's `finally`, before that.
- So a second POST sent right as the first response arrives can read 0 rows and be admitted, even for the same application. The declared overshoot only covers "two runs for two different applications admitted in the same instant".
- The L6 e2e sends its second POST immediately after the first response, so it depends on the same race (it will usually pass because the gate does three round-trips first).
- The chat.ts comment calls the design "not a reliance on `after()` timing". That is true for the revision, not for the next run.
- Fix:
  - Measure the Free resume allowance from `resume_versions` rows with an AI source in the last 24 h. Those rows are written synchronously before the 200.
  - Or keep the current mechanism and widen the declared-overshoot text in chat.ts and SPEC v3.0a item 3 to include back-to-back runs. Add a short wait or poll to the e2e so it is not timing-dependent.

**m2. The "nothing is spent" e2e only partly checks its claim.**
- File: `tests/e2e/plan-gating.spec.ts:144-145`.
- The comment says the tiles prove no `llm_calls` row was written and that "the limit is the plan's". But "0 / 50" is the same for Free and Pro, and neither tile counts `embed` rows. So an embeddings spend before the refusal would not be caught. Only "0 / 20" distinguishes Free.
- Fix: also assert the /quality per-step table or recent-calls list shows no `Embed` row. Or reword the comment to say what is actually asserted.

**m3. The "one subscription" fence is configured, not witnessed, and is doubtful with `customer_email`.**
- Files: `src/app/api/billing/checkout/route.ts:49`, `SPEC.md:1002`.
- The route deliberately does not refuse a Pro caller. It relies on Stripe's "limit customers to one subscription" setting. But each session passes `customer_email` rather than an existing `customer`, so Stripe may create a new customer per session. Whether the setting fires in that case is not witnessed.
- `docs/deploy.md` defers the dashboard steps ("lands with SPEC Block H item 12"), so the setting is not even recorded as on.
- With two subscriptions, `latestForUser` interleaves rows from both, and a paying user can read Free. The failure is in the safe direction, and no money moves in test mode.
- Fix: witness it once (a direct POST `/api/billing/checkout` from a Pro test account, then pay). Record the outcome in the evidence file. If Stripe does not refuse, reuse the stored `stripe_customer_id` as `customer` when the caller has one.

**m4. Block H item 12 and the deploy.md Stripe steps are still open.**
- Files: `docs/eval/billing-webhook-evidence.md` (status: "DEPLOYMENT HALF PENDING"), `docs/deploy.md:266-269`.
- Fix: list both under "not done / deferred" in the PR hand-over, per the no-undeclared-deviations rule.

## NIT

- **n1.** `src/app/api/applications/[id]/generate/route.ts:97`: `request.text()` has no size cap, while the scan route checks `Content-Length`. Refuse bodies over about 1 KB before buffering.
- **n2.** `src/components/billing-button.tsx:47`: `window.location.assign(url)` trusts the host the server returns. Optionally allow only `checkout.stripe.com` and `billing.stripe.com`.
- **n3.** `src/app/(app)/settings/page.tsx` (PlanBlock): a user whose latest row is `canceled`, `unpaid` or `incomplete` sees only [Upgrade], with no [Manage subscription], although a customer exists and the portal route would serve them. An `incomplete` status in particular invites a second Checkout. Consider offering the portal whenever the latest row has a customer and a non-Pro, non-canceled status.
- **n4.** `supabase/migrations/006_subscription_events.sql:41`: `pg_trigger_depth() < 2` lets through any DELETE issued from inside some other trigger, not only the auth.users cascade. That is acceptable today (no such trigger exists), but worth a comment so a future trigger is not added carelessly.
- **n5.** `src/app/api/stripe/webhook/route.ts:41-42`: `stripeClient()` and `webhookSecret()` run before the signature check. On a misconfigured deployment an unsigned request gets 500 rather than 400. This is harmless, since no secret is exposed and nothing is written; noted only for the record.

## Verified OK (no finding)

**Gates and plan**
- `requireMember()` (`getUser()` then `currentPlan()`) heads every exported function in `lib/chat.ts` and `lib/retrieval.ts`.
- PLAN_REQUIRED (agentic on Free) and both DAILY_LIMIT checks throw before any request body exists.
- `authorizeGenerate` runs before `getApplication`, the lock and the retrieval embedding, which matches L7.
- The scan route's parse step, where the scan cap lives, comes before every embeddings call.
- `currentPlan()` never throws, so the indexing save path cannot fail.
- The plan is derived only from `subscription_events`. There is no plan/tier/is_pro column, and the table has owner SELECT only, a trigger that refuses UPDATE and non-cascade DELETE, and TRUNCATE revoked.

**Generate grant**
- `GenerateGrant` is a module-private class with a `#` field, checked with `instanceof` plus the private field. No object literal or other module can forge one, and a `generate` step without a grant is a 500.
- The only `generate` caller is the generate route.
- The rule-B3 revision rides the grant. Its DailyLimit refusal is still caught in `tailoring.ts:436`, which keeps the resume the user paid for.

**Webhook**
- Order is: raw `request.text()`, a missing signature → 400, `constructEvent` failure → 400, then the type switch, then `subscriptions.retrieve`, then attribution, then the append.
- Attribution order is `client_reference_id`, then `metadata.user_id`, then the ledger lookup, with UUID shape checked.
- Idempotency is the database's: 23505 is answered `duplicate` with a 200, and 23503 `unknown_user` with a 200 and a warn line.
- Warn and error lines carry the event id or error class only.
- The admin client is built lazily inside the callbacks, so it is never built for an unverified request.
- The DAL takes the service-role client as an argument and never imports it. R10b/R10c pin the importers, with sandbox tests.
- The unit fixtures sign with the real SDK and cover replay, wrong secret, late redelivery and the `cancel_at` shape.

**Secrets and client exposure**
- No `NEXT_PUBLIC_STRIPE*`, no `js.stripe.com`, and no client component imports `lib/plan`, `lib/billing` or `lib/stripe`.
- `.env.example` names all three Stripe variables. `STRIPE_PRICE_PRO` was added to `SECRET_NAMES` (R7 test).
- No secret-shaped values in the diff or in commit messages. The `sk_test_` guard is in `lib/stripe/server.ts`.
- `.env.local` holds names only, and only `.env.example` is tracked.

**Errors and copy**
- The canonical `{error:{code,message,plan,feature}}` shape matches v3.0a item 5.
- The coverage code now lets every `PlanRefusalError` through, so a refusal is never reported as `could_not_search`.
- The generate body is a strict Zod object (an unknown key is a 400).

**Matches v3.0a**
- Items 1-14 match the code: `cancel_url` /settings; `current_period_end` from items and `cancel_at`; `resume_versions.model` and `retrieval_log` never written; Free allowances counted from `ok=true` rows; Settings past_due/unavailable/pending states; /privacy and /impressum copy.

**Settings states**
- Free, Pro (renews or cancels), past_due, unavailable, and pending (`?checkout=success` with no row) are all present. BillingButton has pending and inline error states, plus a double-click guard.

Checked: secrets ✓, RLS ✓, chokepoints ✓, zod ✓, llm_calls logging ✓ (unchanged; per-step counts use `ok=true`; see m1 for the timing).

Files cited:
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\generate.spec.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\plan-gating.spec.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\billing.spec.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\billing-webhook-evidence.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\deploy.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\chat.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\llmCalls.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\billing\checkout\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\applications\[id]\generate\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\billing-button.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\settings\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\stripe\webhook\route.ts

I modified no files. Per CLAUDE.md this report should be saved verbatim to `docs/reviews/feature-billing.md` (or the branch's review file) before anyone acts on it.
