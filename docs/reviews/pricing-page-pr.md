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

---

# Re-review: feature/pricing-page (2026-10-13)

**Verdict: APPROVE WITH NITS**

All six earlier findings are resolved, and M1 is fixed the way the first review asked. The fixes add one new defect, and it is in documentation only: SPEC v3.0d item 5 still says the unit test pins `/pricing` as "bypassed", which is now false (n1). It is a one-line fix and should land before merge, because a stale evidence line is an instruction to the next agent to put the exclusion back. n2 and n3 are optional.

**Scope.** `git diff 4ecbf88..HEAD`, 4 commits (538ad1e, 3c35b88, 9b99c4c, 1cefd7d), 7 files:
- `SPEC.md`
- `src/app/pricing/page.tsx`
- `src/lib/auth/publicPaths.ts` (new)
- `src/lib/copy.ts`
- `src/middleware.ts`
- `tests/e2e/billing.spec.ts`
- `tests/unit/middleware-matcher.test.mjs`

**Files read to check the claims:**
- the old middleware: `git show 4ecbf88:src/middleware.ts`
- in `src/lib/plan.ts`: `PlanView`, `planViewOf`, `PLAN_LIMITS`
- `src/lib/budget.ts`
- in `src/lib/db/llmCalls.ts`: `CHAT_STEPS`, `countCallsInLast24h`, `countRescoreCallsInLast24h`
- `src/app/page.tsx`
- the back links in `src/app/privacy/page.tsx` and `src/app/impressum/page.tsx`
- SPEC Block H item 12

I read no `.env*` file and not WORKLOG.md, and every recursive grep used `--exclude='.env*'`.

**Commands run at HEAD:**
- `node scripts/check.mjs`: exit 0, "check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; …".
- `node --import ./tests/alias-hook.mjs --test tests/unit/middleware-matcher.test.mjs`: 43 tests, 43 pass, 0 fail.

## Previous findings

**M1: RESOLVED.**
- `src/middleware.ts:103`: the matcher no longer contains `pricing$`. The other exclusions (`api(?:/|$)|privacy$|impressum$|…`) are byte-identical to 4ecbf88.
- `src/middleware.ts:90-94`: the comment says why `pricing` is not excluded.
- `src/lib/auth/publicPaths.ts:13`: `PUBLIC_PATHS` is `['/login','/signup','/privacy','/impressum']`, still prefix-matched.
- `src/lib/auth/publicPaths.ts:23`: `PUBLIC_EXACT_PATHS = ['/pricing']`.
- `src/lib/auth/publicPaths.ts:33-35`: `isPublicPath` = exact match on `/pricing` OR the same prefix rule as before.
- `src/lib/auth/publicPaths.ts:38-40`: `isAuthPath` is unchanged.
- `src/middleware.ts:61,65`: the middleware now calls both functions.

How the middleware behaves on /pricing:
- **Visitor:** `user` is null and `isPublicPath('/pricing')` is true, so it returns `supabaseResponse` with no redirect.
- **Member:** `isAuthPath('/pricing')` is false, so it also returns `supabaseResponse`. A token refreshed by the middleware's own `getUser()` therefore reaches the browser, and the page's later `getUser()` sees a fresh token and does not need to rotate again. This is the property M1 asked for.

Behaviour change for other paths, compared with 4ecbf88's `startsWithPath(pathname, PUBLIC_PATHS)`:
- `/login`, `/signup`, `/privacy`, `/impressum` and their subpaths: identical, same prefix rule over the same four entries.
- `/pricing`: was not reached by the middleware at all; now runs and is let through.
- `/pricing/<child>`: a visitor is now sent to `/login`. Before, the prefix rule on `/pricing` would have let them through. That was a latent hole for any future child route, and the change closes it.
- Every other path: unchanged.

Tests:
- `tests/unit/middleware-matcher.test.mjs:86-87` pins `['/pricing', RUNS]` and `['/pricing/checkout', RUNS]`; `/pricingleak` stays RUNS.
- The new `describe` at lines 134-161 imports the real `isPublicPath`/`isAuthPath` and pins:
  - `/pricing` true
  - `/pricing/checkout` false
  - `/pricingleak` false
  - the four public paths true
  - member routes false
  - `isAuthPath('/pricing')` false
- SPEC v3.0d item 0 records why. Its claim that a Server Component cannot write cookies is accurate.

**m1: RESOLVED.**
- `src/app/pricing/page.tsx:89-92`: `<Link href="/">Back to {APP_NAME}</Link>`, same text and target as `privacy/page.tsx:371` and `impressum/page.tsx:71`.
- `src/app/page.tsx` sends a member to `/scan` and a visitor to `/login`, as claimed.
- The link sits at the top of the page, where /privacy and /impressum put it at the bottom. That is fine for a page with no shell.

**m2: RESOLVED (Free witnessed; Pro honestly deferred, with n2 below).**
- `tests/e2e/billing.spec.ts:103-116` signs up a Free member and asserts:
  - the response is 200 and the path is still `/pricing` (no redirect, so the middleware change is covered end to end for a member)
  - [Upgrade to Pro] inside the `Pro` region
  - zero `Sign in to upgrade` links
  - zero [Manage subscription] buttons
- `billing.spec.ts:150-154`: the Pro variant is `test.fixme`. The reason holds: a Pro view needs a ledger row, the ledger has no user-role INSERT policy, and only the webhook writes it through the service role, which R10 pins to two consumers. A test that forged one would break the very rule this app relies on. It sits beside the existing Pro portal fixme on the same terms.
- SPEC v3.0d item 5 declares it explicitly ("**The Pro variant ([Manage subscription]) is NOT WITNESSED YET** … `fixme` … deployment run, Block H item 12"). That is an honest declaration, not silence, so I accept it as the resolution. See n2 for a gap in where it points.
- The mapping a Pro row would hit is now an exhaustive switch (m4), so the type checker covers that code path.

**m3: RESOLVED.**
- SPEC line 1058: the "no `/api/billing/status`" Decision now says the result rail and `/quality` read through `currentPlan()`, and `/settings` and `/pricing` through `latestForUser()` + `planViewOf()`. Accurate against the page.
- SPEC line 361: US-7 step 1 quotes the as-built `RESULT.dailyLimitFree` copy and the "Compare plans" link.
- SPEC line 1299: the v3.0d precedence sentence now covers the paragraph above, the endpoint #11 Decision and US-7.

**m4: RESOLVED.**
- `src/app/pricing/page.tsx:42-55`: `view` is typed `PlanView`. The success path calls `planViewOf({ ok: true, row })`; the catch calls `planViewOf({ ok: false })`, which returns `{ kind: 'unavailable' }` (`plan.ts:122`).
- `page.tsx:61-74`: `proActionFor` switches over `unavailable → signIn`, `free → checkout`, `pastDue|pro → portal`, with `const unhandled: never = view` in the default branch. A new `PlanView` kind now fails to compile.
- `getUser()` is still outside the try (line 43).
- The catch log is unchanged: `err.name` and `err.code` only, no content and no ids.

**m5: RESOLVED. The wording is accurate against what the gates enforce.** `PRICING.sharedCeilingFootnote` (`copy.ts:184-185`), checked claim by claim:
- **"Both plans share one ceiling of 50 AI calls per day":** `PLAN_LIMITS.free.dailyChatCalls = 50` and `PLAN_LIMITS.pro.dailyChatCalls = 50` (`plan.ts:63,69`), read through `dailyCallLimit(plan)` (`budget.ts:189`).
- **"counted across imports, scans, resumes and quality checks":** `countCallsInLast24h()` counts `CHAT_STEPS` = `import_resume`, `parse_vacancy`, `generate`, `generate_agentic`, `judge` (`llmCalls.ts:27-36`).
  - Imports, scans, resumes (both writers) and quality checks map one-to-one onto those steps.
  - Nothing countable is omitted, and nothing is named that is not counted.
- **"the Free plan's scan and resume limits sit inside it":** `perStep: { parse_vacancy: 3, generate: 1 }` is checked in addition to the overall ceiling (`budget.ts:249-252`), so it is a sub-allowance, not a separate one. The per-step count uses ok rows only and the ceiling counts all rows; "inside it" is still true.
- **"Re-scores are counted separately":** rule B7a, `dailyRescoreRequests` 20/100 through `countRescoreCallsInLast24h` over `['rescore']`, a separate counter. Embedding steps are not in `CHAT_STEPS`.
- The table itself is unchanged and still verbatim from SPEC. The footnote is declared in v3.0d item 3.

## New findings

**n1 (minor, docs, fix before merge): SPEC v3.0d item 5 contradicts item 0 and the test it cites.**
- SPEC line 1305 still reads: "`tests/unit/middleware-matcher.test.mjs` pins `/pricing` bypassed and `/pricing/checkout` and `/pricingleak` fenced".
- At HEAD the test pins `['/pricing', RUNS]` (line 86), and v3.0d item 0 (line 1300) says the opposite of "bypassed".
- This is the stale-annotation case CLAUDE.md warns about: a reader who trusts the evidence list would conclude that /pricing is matcher-excluded, and could restore exactly what M1 removed.
- Suggested text: "pins the matcher RUNNING on `/pricing` (and on `/pricing/checkout` and `/pricingleak`), and `isPublicPath()` letting a visitor through on `/pricing` only".

**n2 (nit, docs): the Pro /pricing fixme points at a checklist item that does not list it.**
- `billing.spec.ts:152-153` and v3.0d item 5 defer the [Manage subscription] variant to "Block H item 12".
- Block H item 12 (SPEC line 1789) lists the evidence of the deployment run, and it ends at "the Settings block reading Pro". /pricing is not on it.
- Per the "a configured mechanism is not a working one" rule, a deferral should land on a list someone will actually work through.
- Suggest adding "and `/pricing` offering [Manage subscription]" to item 12.

**n3 (nit, pre-existing, optional): the Block E `/pricing` paragraph still calls the page a "static shell".**
- SPEC lines 1286 and 1296 say "static shell" and "Loading: n/a (static shell, one server read)".
- The page reads cookies, and now also runs the middleware, so it is dynamic.
- v3.0d's precedence sentence technically covers this, and the Loading n/a stays correct (one server read, no client fetch). Only the word is wrong. Optional cleanup.

No other new defects:
- **Secrets:** no new env var, no `NEXT_PUBLIC_` change, no secret reader added.
- **Imports:** `publicPaths.ts` is pure and imports nothing, so it is safe in the middleware's edge bundle and in unit tests.
- **Rendering:** no `dangerouslySetInnerHTML`.
- **No new data paths:** no `.from(` outside `lib/db`, no `getSession()`.
- **Untouched:** RLS, the gates, `currentPlan()` and the ledger.

## Checked
secrets ✓, RLS ✓ (untouched), chokepoints ✓ (check.mjs pass, quoted above), zod ✓ (n/a: no new API input or LLM output), llm_calls logging ✓ (n/a: no model call)

**Before merge:** n1, a one-line SPEC fix. n2 and n3 are recommended, not required.
