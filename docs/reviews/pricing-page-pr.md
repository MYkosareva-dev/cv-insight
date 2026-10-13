# AI Code Review: feature/pricing-page (2026-10-13)

**Verdict: REVISE**

Scope: `git diff main...HEAD`, 8 commits (23ad9a6..4091a00) touching 11 files: SPEC.md, `src/app/pricing/page.tsx` (new), `src/app/(app)/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/app/api/billing/checkout/route.ts`, `src/components/applications/result-workspace.tsx`, `src/lib/copy.ts`, `src/middleware.ts`, `tests/e2e/generate.spec.ts`, `tests/e2e/pricing.spec.ts` (new) and `tests/unit/middleware-matcher.test.mjs`. I also read the files the diff depends on: `src/components/billing-button.tsx`, `src/lib/plan.ts` (`planViewOf`, `PLAN_LIMITS`), `src/lib/db/subscriptionEvents.ts` (`latestForUser`), `src/lib/supabase/server.ts`, the full `src/middleware.ts`, `src/app/privacy/page.tsx`, and SPEC Block E `/pricing`, P10, P11, L6 and B7. I read no `.env*` file and not WORKLOG.md. Every recursive grep used `--exclude='.env*'`.

`node scripts/check.mjs` on this branch, quoted:
> check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts and its client to the account and Stripe-webhook routes; Stripe client pinned to the three billing routes; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree.

## Blockers
None.

## Majors

**M1. Excluding `/pricing` from the matcher breaks the session-refresh rule this codebase relies on, so members can be logged out at random.**
- `/pricing` is the first matcher-excluded page that reads the session (`getUser()` in `readProAction`).
- `lib/supabase/server.ts` swallows `setAll` failures in Server Components. Its stated reason is: "Safe to ignore: src/middleware.ts refreshes the session cookie on every request." That is not true on a path the matcher excludes.
- When a signed-in member's access token has expired (hourly) and they open /pricing (footer link, or the Checkout `cancel_url` this branch points there), `getUser()` refreshes the session in memory. The rotated refresh token cannot be written back to the browser.
- `src/middleware.ts` names the result itself: "The old token is already spent on the Auth server, so dropping the new one leaves the browser holding a dead credential and the user is logged out at random. It does not reproduce locally." The current e2e cannot catch this either: it runs signed out, and a dev session rarely crosses the refresh boundary.
- Fix: keep `/pricing` in `PUBLIC_PATHS` (visitors already pass through without a redirect) and remove `pricing$` from the matcher exclusion, so middleware runs on /pricing and persists the refreshed cookies.
  - Change the unit-test expectation to `['/pricing', RUNS]`.
  - Keep the `/pricingleak` and `/pricing/checkout` rows.
  - This contradicts SPEC Block E ("matcher-excluded as an EXACT path like /privacy and /impressum"), so it needs a v3.0d amendment saying why /pricing differs: it is the one public page that reads the session.
  - The alternative (persisting cookies from the page) is not possible in a Server Component.

## Minors / nits

- **m1. /pricing is a dead end.** It renders outside both route groups, so it has no shell, no footer and no way back. /privacy ends with a `Link href="/"` back link; /pricing has none. This matters more now that a cancelled Checkout lands here instead of in the member shell. Suggest the same back link /privacy uses.
- **m2. The member variants have no test.** The Free → [Upgrade to Pro] and Pro/`past_due` → [Manage subscription] mapping is untested; only the visitor variant has an e2e. Since `generate.spec.ts` already signs in a Free account, a signed-in Free assertion (button "Upgrade to Pro" inside the Pro region, no "Sign in to upgrade") is cheap. P10 and P11 are reasoned in the code comment but not witnessed. Not required by SPEC Block H, but the v3.0d "Evidence" item covers only the visitor.
- **m3. SPEC still has a stale sentence outside the v3.0d note's stated scope.** SPEC line 1057 (the "no `/api/billing/status`" Decision) says `/pricing` reads the plan "through `currentPlan()`". v3.0d item 1 contradicts it, but v3.0d only claims precedence over "the paragraph above". Either extend item 1's precedence sentence or annotate line 1057.
  - US-7 step 1 (line 360) still quotes the "Pro removes the daily limits…" draft copy. v3.0a's blanket "this note wins" covers it, but v3.0d item 4 lists what it supersedes and US-7 is not in that list. Adding it would close the trail.
- **m4. One branch in the page is unreachable, and only by accident.** `planViewOf({ ok: true, … })` can never return `kind: 'unavailable'`, so `view.kind === 'free' ? 'checkout' : 'portal'` is correct only because a failed read throws first. If `latestForUser` ever changes to return an error instead of throwing, `'unavailable'` would map to [Manage subscription] without anyone noticing. Suggest an exhaustive `switch` on `view.kind` with `unavailable → 'signIn'`, so the P10 mapping is in the type rather than in the call shape. Nit, not a defect today.
- **m5. Wording overlap in the table.** The Free "Scans: 3 per day" row is correct against `PLAN_LIMITS.free.perStep.parse_vacancy = 3`. But Free also carries `dailyChatCalls: 50`, and the Pro column's "50 AI calls per day" reads as if that cap were Pro-only. This is SPEC's verbatim table, so it is not a code defect; flagging it for the owner only.

## Requested checks

1. **RLS and plan derivation untouched: PASS.**
   - No file under `supabase/`, no migration and no policy change.
   - No change to `lib/plan.ts`, `currentPlan()`, `lib/chat.ts`, `lib/retrieval.ts` or `lib/db/subscriptionEvents.ts`.
   - No plan/tier column.
   - The page reads through the existing DAL (`latestForUser`) under the user's RLS session, and its only output is which control to render. Both `/api/billing/*` routes still verify the session themselves, and enforcement stays in the gates. "A hidden button is a courtesy, not a control" holds.
2. **Reuse and mapping: PASS.**
   - `BillingButton` is imported from `src/components/billing-button.tsx`, not copied.
   - The mapping matches SPEC v3.0d item 1:
     - no session → `Link` to `/login` "Sign in to upgrade"
     - read throws → caught, `'signIn'` (P10)
     - `free` → checkout
     - `pastDue` → portal (P11)
     - `pro` → portal
   - `getUser()` is outside the try, as documented. See m4 for the exhaustiveness nit.
3. **Matcher exclusion exact and tested: PASS as written, but see M1.**
   - `pricing$` is anchored like `privacy$` and `impressum$`.
   - The unit test pins `/pricing` BYPASSED and `/pricing/checkout` and `/pricingleak` RUNS, and adds `pricing|` and `pricing(?:/|$)|` to the forbidden-substring list.
   - M1 argues the exclusion itself is the wrong design for a page that reads the session.
4. **Links updated consistently: PASS.**
   - `cancel_url` is `${origin}/pricing` and its comment is updated.
   - `result-workspace.tsx` links to `/pricing` with `RESULT.dailyLimitPricingLink`.
   - `generate.spec.ts` expects `/pricing`.
   - The grep over src/, tests/, scripts/, docs/ and README.md found no "until /pricing exists", "not built yet" or "in Settings for higher" in code or tests, and no `dailyLimitSettingsLink`. The only hit is the historical review `docs/reviews/agentic-retrieval-pr.md:40`, a past report that should not be edited.
   - `SCAN.dailyLimitFree` names the page in words because the scan screen renders it as plain text, and this is declared in v3.0d item 4.
   - `plan-gating.spec.ts` reads the constant, so the copy change does not break it.
5. **Secrets and client boundary: PASS.**
   - No new env var, no `NEXT_PUBLIC_` addition, `.env.example` untouched.
   - No service-role or Stripe client import is added. The R10 and Stripe-pin rules pass in check.mjs.
   - `page.tsx` is a Server Component. The client component it renders (`BillingButton`) receives only the literal `'checkout' | 'portal'`, so no server value or secret crosses into it.
   - The catch logs only `err.name` and `err.code`: no user content and no ids.

## Other passes

- **Pass 2, security and access:**
  - The page makes no data write.
  - There is no new route handler.
  - No `dangerouslySetInnerHTML`; all copy is rendered as text nodes.
  - No `getSession()`.
- **Pass 3, correctness against SPEC:**
  - No new API input and no LLM call, so Zod and `llm_calls` logging do not apply.
  - `PRICING.rows` match the SPEC Block E table verbatim and in order, and each row has a counterpart in `PLAN_LIMITS` / `MAX_CAREER_ITEMS`.
  - `PRICING.proPrice` and `PRICING.testModeLine` match SPEC verbatim.
  - B7 and L6 copy changes are declared in v3.0d item 4 (see m3 for the stale cross-references).
  - Moving the `(app)` link from "sidebar" to "footer" is declared in v3.0d item 2.
  - Block E UI states: Loading and Empty are n/a per SPEC. The Error state (failed read → visitor button) is implemented.
- **Pass 4, quality and accessibility:**
  - TypeScript is strict. The one cast `(err as { code?: string } | null)?.code` is narrow and acceptable. No dead code, no new dependencies.
  - Accessibility: each card is a `<section aria-labelledby>` pointing at its `<h2 id>`, which gives `role=region` with accessible names "Free" and "Pro". That is exactly what `getByRole('region', { name, exact: true })` relies on, and it is correct semantics rather than a test hook.
  - Limits are a `<dl>`/`<dt>`/`<dd>` list, a sound structure.
  - Exactly one `<h1>`.
  - The e2e asserts the button label as a literal, deliberately, so a copy drift fails the test.
- **Documentation voice:** the new comments and the SPEC note describe CV Insight's own rules and name no external organisation as a source. Conforms.

## Checked
secrets ✓, RLS ✓ (untouched), chokepoints ✓ (check.mjs pass), zod ✓ (n/a: no new API input or LLM output), llm_calls logging ✓ (n/a: no model call)

**Required before merge:** M1. The change is to code, the unit test and SPEC v3.0d. m1–m4 are recommended in the same branch; m5 is for the owner only.
