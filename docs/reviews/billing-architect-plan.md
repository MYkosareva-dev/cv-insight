# ai-architect — pre-implementation review, `feature/billing`

Scope: SPEC.md v3.0 billing and plans, items 1–7 of the branch brief (migration 006, the
ledger DAL and `lib/plan.ts`, plan enforcement in the two gates, the three billing routes,
the Settings Plan block, tests, the /privacy and Impressum copy). Run once, before any code
was written. Saved verbatim.

---

VERDICT: REVISE

The plan is the right shape and most of it maps cleanly onto SPEC v3.0. One blocker: as written, the plan has the DAL reach the service-role client itself, which would make the DAL a third consumer of admin.ts. Several MAJOR findings need an owner decision or a `> Decision:` amendment before code is written. The specific technical uncertainties are marked as uncertain where they appear.

Findings:

1. [BLOCKER] Plan item 2 ("DAL appendFromStripeEvent via the admin client") vs CLAUDE.md Secrets ("IMPORTED by exactly two consumers: the account-deletion route and the Stripe webhook route") and SPEC.md:170-171 ("imported ONLY by DELETE /api/account and … POST /api/stripe/webhook").
   - If src/lib/db/subscriptionEvents.ts imports `@/lib/supabase/admin`, the importers become the account route plus the DAL. The webhook route stops being the consumer and the DAL becomes one. Worse, any caller of the DAL (currentPlan, Settings, the portal route) is then one function call away from an RLS-bypassing client.
   - Required change: dependency injection. The webhook route is the only file that imports `createAdminClient` and calls it, only after `constructEvent` succeeds. It passes the client into the DAL as a parameter, typed `SupabaseClient` and imported with `import type` from `@supabase/supabase-js`. For example: `appendFromStripeEvent(serviceRole, row)` and `userIdForCustomer(serviceRole, customerId)`.
   - `latestForUser(userId)` keeps using `createClient()` from `@/lib/supabase/server` like every other DAL.
   - R1 stays satisfied (`.from(` remains in the DAL). Importers of admin.ts stay at exactly the two named routes.
   - If someone hands the DAL the user's client by mistake, the write fails safely: subscription_events has no INSERT policy for any user role.

2. [MAJOR] scripts/check.mjs:428-436: R10 today only pins the KEY READ (`line.includes(SUPABASE_SERVICE_ROLE_KEY)`). It does not check who imports admin.ts. CLAUDE.md says "scripts/check.mjs R10 names both; a third consumer fails the build", and that is currently not true of the code. "R10 amended to name the webhook" therefore has to add a check, not just edit a comment.
   - Required change: add R10b in the same style as R11a-d, so the rule count stays 13. FAIL on any import of `@/lib/supabase/admin` or `…/supabase/admin` outside an allow-list of exactly `src/app/api/account/route.ts` and `src/app/api/stripe/webhook/route.ts`, covering `from`, bare and dynamic `import(`.
   - Add a case to tests/unit/check-rules.test.mjs.
   - Update the summary line at check.mjs:627-631.
   - In the same branch, add a second import-site pin: `@/lib/stripe/server` may be imported only by the three billing routes (CLAUDE.md Secrets, SPEC.md:172-173).

3. [MAJOR] Gate placement for `mode=agentic` vs L7 (SPEC.md:1654, "403 PLAN_REQUIRED from the gate, before retrieval or any model request"). The route spends an embeddings request in `retrieveItemsFor` (generate/route.ts:124 → tailoring.ts:111 → retrieval.ts:620) before any chat call. A PLAN_REQUIRED check that lives only in `runChat` (chat.ts:261) fires after retrieval has already been paid and logged.
   - Required change: add an exported gate entry in src/lib/chat.ts, e.g. `authorizeGenerate(mode)`. It does `getUser()` → `currentPlan(user.id)` → PLAN_REQUIRED if `mode==='agentic'` and plan is free → the Free generate DAILY_LIMIT check (see 5), and returns an opaque grant `{ path }`.
   - The route calls it right after `requireApiUser()` (route.ts:89) and before `acquireLock` (117) and `retrieveItemsFor` (124). The route passes the grant through and never branches on `plan` (B11).
   - Keep the per-step check inside `runChat`/`runChatJson` as defence in depth.

4. [MAJOR] Exact placement inside the existing gates:
   - chat.ts `runChat` (261-262) and `runChatJson` (317-318): `requireUser()` → `currentPlan(user.id)` → step-in-plan check (PLAN_REQUIRED) → `assertUnderDailyCap(plan, step, ledger)`.
     - In `runChatJson` this goes before `const request: ChatRequest = …` (line 320), so "before a request body is built" (B11) holds literally.
     - `assertUnderDailyCap` (136-144) gains `plan` and `step`. The count query moves to a new per-step DAL count; `countStepsInLast24h` at llmCalls.ts:123 already takes a step list, so this is a new export, not a new query shape. The comparison becomes `underDailyCallCap(plan, step, committed…, ledgerChat)` in budget.ts, reading `PLAN_LIMITS`.
   - retrieval.ts `embedTexts` (204-206): `requireUser()` → `currentPlan()` → `if (step==='rescore') assertUnderRescoreCap(plan)`. `assertUnderRescoreCap` (184-190) and `underRescoreCap` (budget.ts:141) take the plan (Free 20 / Pro 100).
   - CLAUDE.md says both gates call `currentPlan()` "immediately after getUser()". Applied literally, that includes `indexCareerItems` (313), `reindexCareerItem` (369), `matchDocuments` (616), `matchDocumentsForTexts` (667) and `reindexAllCareerItems` (485). That is only safe because B11 makes `currentPlan()` never throw. Either:
     - call it everywhere through one `requireUserAndPlan()` helper, with `currentPlan()` documented and tested as non-throwing, or
     - record a `> Decision:` that plan-independent embedding paths skip the read.
     Pick one explicitly; do not let it drift.
   - Every plan refusal in retrieval.ts must be thrown BEFORE the `try` blocks at 619 and 670. Otherwise it becomes `could_not_search` → 502, which is the three-outcomes rule read backwards.
   - Same applies at coverage.ts:207: rethrow the new 403 class as well as `DailyLimitError` (or test against a shared refusal base class).

5. [MAJOR] B7 Free semantics (SPEC.md:1348) are incomplete, and a literal implementation has three defects. Each needs an owner decision recorded in SPEC before code:
   - (a) Revision refused mid-run. One /generate run can write 2 `generate` rows (B3 revision), or up to 4 with network retries. If the Free check is `committedGenerate + ledger < 1`, the revision step is refused after the first draft was paid for, and the route saves nothing because `save()` runs only after `generateWithJudge` returns (generate/route.ts:163-194).
     - Recommendation: the Free generate allowance is per RUN, checked once in `authorizeGenerate`, against committed `generate` rows only.
     - Write down that a revision inside the run is part of the run. Do not rely on `after()` timing as an accident.
   - (b) Free has no cap on judge or import. B7 caps Free only on `parse_vacancy` and `generate`, so on-demand `judge` (/api/applications/[id]/judge) and `import_resume` (/api/career/import) have no ceiling at all for Free users. Before v3.0 the 50-call cap covered them. On a public deployment where H17 says "the Free limits [are] the only fence", that is a regression in the spend fence.
     - Recommendation: Free = per-step limits AND the same 50-row total, so Free is a strict subset of Pro.
   - (c) "3 scans / 1 resume per day" counted in rows. /pricing and Settings promise exactly that (SPEC.md:1223, 1232), but rows count retries. A scan whose parse spends its repair or network retry uses 2 of the 3. A failed generate (`ok=false` rows, 502) uses the day's only resume.
     - Decide: count rows (and say so in the copy) or count runs, e.g. successful `resume_versions` `source='ai'` rows for generate. Either way it is a `> Decision:`.

6. [MAJOR] src/lib/plan.ts purity vs SPEC.md:174-176 ("the limits are pure so tests load them; the lookup goes through lib/db/subscriptionEvents.ts") and budget.ts:4-10 ("Nothing in this file may ever … grow a server import").
   - If plan.ts statically imports the server-only DAL, then neither budget.ts (which must import `PLAN_LIMITS`) nor tests/unit can load it: `server-only` throws under `node --test`, and tests/alias-resolver.mjs stubs nothing.
   - Required change: plan.ts exports `PlanId`, `PLAN_LIMITS`, the feature vocabulary, and a pure `planFromLatestRow(row | null, now)`. That pure function is what the item-6 `currentPlan` state tests exercise.
   - `currentPlan()` either loads the DAL lazily (`await import('@/lib/db/subscriptionEvents')` inside the function) or moves to a server-only module, with a `> Decision:` amending Block A.
   - The Settings page should do ONE `latestForUser()` read and derive Free/Pro/pastDue/unavailable through `planFromLatestRow`, not call `currentPlan()` and `latestForUser()` separately. Two reads can disagree, and settings/page.tsx:36-39 already states the one-read principle.

7. [MAJOR] Webhook customer-id lookup (SPEC.md:999, step 4). The webhook has no session. Through the anon or server client, RLS (owner SELECT `auth.uid() = user_id`) returns zero rows, so every fallback lookup would silently "find no user" (P6 misfiring as routine). A `security definer` lookup function is banned by R3.
   - The only correct path is the service-role client, injected into the DAL as in finding 1. For example: `userIdForCustomer(serviceRole, customerId)` → `.select('user_id').eq('stripe_customer_id', id).order('received_at', { ascending: false }).limit(1)`, returning only `user_id`.
   - Additional webhook hazards to handle explicitly:
     - Validate `client_reference_id` and `metadata.user_id` as UUIDs with Zod. Otherwise the insert fails with 22P02 → 500 → Stripe retries for 3 days.
     - Map FK violation 23503 to "unattributable → 200 + warn with event id only". Example: the user deleted their account (P12) and later subscription events still carry the old id in metadata. Today that becomes a 500 and three days of retries.
     - If `stripe.subscriptions.retrieve` fails on `checkout.session.completed`, answer non-2xx with nothing written so Stripe redelivers. Declare this; §13 is silent on it.
     - `checkout.session.completed` with `mode !== 'subscription'` → 200, nothing written.

8. [MAJOR] Stripe API version vs SPEC.md:1020 ("customer.subscription.updated / .deleted carry those three fields on data.object directly"). package.json:33 pins `stripe ^22`, whose pinned API version is recent. From API version 2025-03-31 ("basil"), I believe `current_period_end` moved off the Subscription object onto subscription items (`items.data[].current_period_end`). Verify this against the SDK's pinned version and the webhook endpoint's configured API version before coding.
   - If it is right, a Zod schema reading `data.object.current_period_end` writes `null`, and `currentPlan()` answers `free` for every paying user, silently, because a null period end can never be `> now()`.
   - Required change: read the item-level field (single price, so `items.data[0]`) with an explicit fallback. Pin the webhook endpoint's API version in docs/deploy.md. Amend the SPEC sentence with a `> Decision:`.
   - Decide and declare what a Zod failure on a verified event answers. Recommendation: non-2xx, so it is visible in Stripe's webhook log (the P15 mechanism) rather than a silent 200.

9. [MAJOR] /pricing is out of scope, but this branch points at it.
   - `cancel_url: ${origin}/pricing` (SPEC.md:984).
   - L6's `RESULT.dailyLimitFree` "link to /pricing" (SPEC.md:1188, 1653).
   - Without the page, a user who cancels Checkout lands on a 404, and the Free daily-limit refusal links to a 404.
   - Required change: either build /pricing in this branch, or point `cancel_url` at `/settings`, drop the link, and list both under "not done / deferred" (CLAUDE.md Process, "No undeclared deviations").

10. [MAJOR] Block H item 13 (SPEC.md:1722) cannot be implemented as written under check.mjs. "The test inserts a ledger row through the service role" needs `SUPABASE_SERVICE_ROLE_KEY` (R10 FAIL; tests/ is in scope, as tests/e2e/auth.spec.ts:41-43 records) and `.from(` (R1 FAIL). Signing a webhook payload inside the test instead means reading `STRIPE_WEBHOOK_SECRET` in a file without `server-only` (R7 FAIL, since the `_SECRET` heuristic is at check.mjs:372).
    - Required: a `> Decision:` choosing one of:
      - plan-gating.spec covers only the Free refusals (403 agentic, 429 second generate), and "Pro proceeds" is witnessed in docs/eval/billing-webhook-evidence.md, or
      - the spec drives a real test-mode Checkout with card 4242.
    - Do not rename variables to dodge the heuristic.
    - Item 6 "written but not run" must still pass `npm run check`, because check scans tests/.

11. [MAJOR] /privacy copy (SPEC.md:1257): "Stripe receives your email address and nothing else from this app" is false under §11 (SPEC.md:980-982). Checkout also sends `client_reference_id: user.id` and `subscription_data.metadata.user_id`, the account UUID, which is a pseudonymous identifier and personal data. The processors list ("data: email address, plan status") has the same gap.
    - Required: amend the verbatim paragraph and the processors entry (e.g. "…your email address and an internal account identifier so the payment can be matched to your account"). This needs an eu-compliance-reviewer pass, because the change touches personal data and a public page.

12. [MAJOR] A user-facing promise ahead of its evidence (CLAUDE.md, "A configured mechanism is not a working one"). The /privacy sentence "that record is deleted with your account" depends on the `pg_trigger_depth() < 2` cascade exemption. SPEC.md:774 itself calls that unwitnessed until Block H item 11.
    - Plan item 7 ships the sentence. No plan item re-runs docs/eval/erasure-evidence.md with ledger rows and nine tables.
    - Required: either run H11 in this branch before the sentence ships (and narrow the trigger to UPDATE-only if the cascade is refused, as SPEC requires), or hold the sentence and declare it deferred.
    - Stale text to fix in the same branch: src/app/api/account/route.ts:14 ("The only consumer of the service-role client") and :25 ("all EIGHT tables").

13. [MINOR] Middleware (src/middleware.ts:117) already excludes `api(?:/|$)`, so `/api/stripe/webhook` is excluded today. Adding `api/stripe/webhook$` to the matcher would be dead regex.
    - Required: no matcher edit. Add a case to tests/unit/middleware-matcher.test.mjs asserting the webhook path is not matched. Add a one-line `> Decision:` to §13 recording that the existing `api` exclusion is the mechanism (otherwise "excluded as an exact path" is a silent drift in one direction or the other).

14. [MINOR] src/lib/errors.ts:15 has `ApiErrorBody = { error: { code, message } }`, and `DailyLimitError` (95-99) takes a message only. Block D requires `{ plan, feature }` on both 403 and 429 (SPEC.md:805, 810, B11).
    - Decide where they sit; recommendation: inside `error`, which existing clients reading `error.code` tolerate. Define the `feature` vocabulary in plan.ts, e.g. `'scan' | 'generate' | 'agentic' | 'rescore'`.
    - The existing rescore 429 must carry them too.
    - Add `PLAN_REQUIRED` to `ERROR_CODES` (copy.ts:1403).
    - Update the status list in the errors.ts header and at SPEC.md:150-153.

15. [MINOR] Copy gaps and inaccuracies:
    - No Free copy exists for the 4th scan in 24 h. `RESULT.dailyLimitFree` speaks only of "1 tailored resume per day" (SPEC.md:1188), and showing it on /scan would be wrong.
    - "Pro removes the daily limits" is false: Pro has 50 chat calls and 100 re-score rows per day. Amend it under the Documentation-voice and accuracy rules.
    - P11 (past_due): `planPastDue` says "manage it in Stripe", but the Free card offers [Upgrade]. That would open a second subscription beside the failed one. Show [Manage subscription] in that state (portal route.ts gates on the customer id, not the plan, so it works) and record it as a Decision.

16. [MINOR] Secrets hygiene in check.mjs:109.
    - Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` to `SECRET_NAMES`. `STRIPE_PRICE_PRO` matches no `_KEY/_SECRET/_TOKEN` heuristic, so without this R7 and R8 never see it, even though CLAUDE.md says it "follow[s] every rule above".
    - Prefer reading all three in src/lib/stripe/server.ts and exporting accessors, rather than `process.env.*` in route bodies as the §11/§13 snippets show.
    - Add a construction-time guard that refuses a key not starting with `sk_test_`. The error names the variable only, never the value. This turns the CLAUDE.md "must be a sk_test_ key" rule into a mechanism.
    - Update the src/lib/supabase/admin.ts:17-24 docblock, which says "the caller must verify the user FIRST … the sole consumer". For the webhook, the verified fact is the signature, not a user.

17. [MINOR] `resume_versions.model` and `retrieval_log`. Migration 006 adds both, and SPEC.md:387 says per-version provenance "closes for every version written from now on". The plan does not say `insertResumeVersion` (src/lib/db/resumeVersions.ts has no `model` today) writes `model`.
    - Either write the serving slug on `ai` and `ai_revision` inserts in this branch, or leave README.md:679-680 as-is and declare the gap deferred.
    - Single-shot rows must write `retrieval_log = null`, never `[]`. Per L9 (SPEC.md:1656), `[]` means "the agent ran and never searched", which renders `researchNone`.

18. [MINOR] generate/route.ts:86 ignores the request today (`_request`, body `{}`). Parse with a strict Zod object (`{ mode?: 'single'|'agentic' }`, default `'single'`, unknown keys rejected). Treat an empty or absent body as `{}` so the existing client keeps working. The 400 must come before the lock.

19. [NOTE] Ledger ordering. `currentPlan()` uses the latest row by `received_at`, and Stripe does not guarantee delivery order. A redelivered earlier `customer.subscription.updated(active)` that lands after `.deleted` resurrects Pro until `current_period_end`. Immediate cancellation in the Portal is the case where that window is real.
    - Cheapest fix inside Block C: retrieve the subscription on every handled event, as §13 already does for checkout, so each row records Stripe's current state at receipt. Otherwise declare the window.

20. [NOTE] Settings `?checkout=success` → toast. FlashToast reads `?notice` only, so the Server Component should `redirect('/settings?notice=plan_upgraded')` when the ledger reads Pro. Add `plan_upgraded` to `NOTICES` (copy.ts:1389). With no row yet, render `upgradePending` and leave the parameter in place.

21. [NOTE] Missing in-scope or owner items that need listing in the hand-over as done or deferred:
    - H11 (erasure re-run, nine tables)
    - H12 (docs/eval/billing-webhook-evidence.md; docs/deploy.md Stripe steps 22/23 and pinning the webhook API version)
    - H15 (fresh clone with 006)
    - H17 (OpenRouter key credit limit recorded in docs/deploy.md; it bears directly on the Free limits being "the only fence")
    - P12's owner-side step in docs/backlog.md
    - .env.example gains the three names, NAMES only

22. [NOTE] The Pro-gets-single-shot deferral is acceptable only as a declared deviation from §5 v3.0 (SPEC.md:937, "a Pro caller gets it"). The hand-over must say so, and Settings and Impressum copy must not claim agentic retrieval exists yet. `SETTINGS.planFreeLimits` "one retrieval pass" is fine. Anything describing Pro's step-by-step research must wait for the loop branch.

Chokepoint check on the plan as written:
- OpenRouter: no new caller. The billing routes and webhook make no model call (§13 step 6). Intact.
- `.from(`: intact provided finding 1's injection is used.
- Server/client boundary: Stripe client is server-only, there is no Stripe script, and navigation is client-side via `{ url }`. Consistent with M12 and the CSP Decision at SPEC.md:989.
- RLS: subscription_events is S-only per the CLAUDE.md matrix, and the trigger sits beneath RLS. Matches Block C. The cascade is unwitnessed (finding 12).

Deviations needing a SPEC/CLAUDE amendment:
- B7 Free semantics: per-run vs per-row; Free also under the 50 total; how retries and failures count (finding 5).
- plan.ts split or lazy DAL import, i.e. where `currentPlan()` lives (finding 6).
- `current_period_end` location on Subscription events under the pinned Stripe API version; webhook answer on Zod failure, on a failed `subscriptions.retrieve`, and on FK 23503 (findings 7, 8).
- /pricing references (`cancel_url`, the L6 link) while /pricing is deferred (finding 9).
- Block H item 13: how the "Pro proceeds" half is witnessed without service-role or secret reads in tests/ (finding 10).
- /privacy "Plans and payment" verbatim paragraph and processors entry: the account identifier sent to Stripe (finding 11).
- §13 "excluded from the middleware matcher as an exact path": record that the existing `api` exclusion covers it (finding 13).
- Placement of `{ plan, feature }` in the Block D error body (finding 14).
- Free scan-limit copy; correction of "Pro removes the daily limits"; the past_due card's button (finding 15).
- Whether `currentPlan()` runs on plan-independent embedding paths (finding 4).
- Pro `mode=agentic` served by single-shot in this branch: declared deferral of §5 v3.0 (finding 22).

Files reviewed (absolute paths):
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\CLAUDE.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md (v3.0 sections only)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\chat.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\retrieval.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\budget.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\errors.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\supabase\admin.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\supabase\server.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\middleware.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\scripts\check.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\llmCalls.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\applications\[id]\generate\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\applications\[id]\rescore\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\scan\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\account\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\settings\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts (Impressum, NOTICES, ERROR_CODES)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\coverage.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\tailoring.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\alias-resolver.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\package.json

Scope note: the judge route (src/app/api/applications/[id]/judge/route.ts) and career import route (src/app/api/career/import/route.ts) were checked only for their gate calls via grep, not read in full. That is enough for finding 5(b), but a full read of both belongs in the implementation review.

Per CLAUDE.md, this report should be saved verbatim to docs/reviews/ (e.g. docs/reviews/billing-architect-plan.md) before you act on it.
