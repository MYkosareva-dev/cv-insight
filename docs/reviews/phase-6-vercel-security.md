# Phase 6 gate — vercel-security
(date 2026-09-04, commit 949ded8, branch phase-6-deploy — run BEFORE the first deploy)

## Verdict

**FAIL — do not deploy yet.** 3 BLOCKER, 4 MAJOR, 3 MINOR, 1 NIT.

The repository's own secret hygiene is genuinely excellent — nothing to fix there — but three things must be resolved before the first deploy, and one of them is not a code problem at all.

**The single most important thing:** the owner's compliance posture is "the deployment is password-protected, the link is shared with named people, no stranger can register." Vercel's **Password Protection is a paid feature and is not available on the Hobby plan** (moderate-to-high confidence — confirm in the dashboard before acting, instructions in vs-1). Meanwhile `src/app/(auth)/signup/page.tsx` is a **public route** in the middleware's `PUBLIC_PATHS`, and `signUpAction` calls `supabase.auth.signUp` directly. So on Hobby, the moment the production URL exists, **anyone who learns the URL can create an account and use the owner's metered OpenRouter key.** The gate the owner believes exists would not exist. The Hobby-compatible fix is free and takes two minutes — disable new sign-ups in the Supabase dashboard and invite the named people — but it must be done *before* the first deploy, not after, because there is no window in which the URL is live and ungated.

The other two blockers: `maxDuration = 300` on the generate route is at or over the Hobby ceiling in every plan regime (vs-2), and SPEC Block H item 9's required production-build evidence for the `/api/dev/*` fence has never been produced — `docs/eval/dev-routes-production-evidence.md` still says **"Status: NOT VERIFIED."** in its first line (vs-3).

---

## Findings

### [BLOCKER] vs-1 — Password Protection is not a Hobby feature; the deployment's only real gate would be an open signup page

**Where:** platform configuration — no file. Interacts with `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/middleware.ts:12` and `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/(auth)/signup/page.tsx`

**What:** The owner's stated plan is Vercel Deployment Protection with a shared password. My understanding of Vercel's plan tiers, stated with **moderate-to-high confidence**:

| Deployment Protection option | Availability |
|---|---|
| **Vercel Authentication** | All plans incl. Hobby — but protects **Preview deployments only** by default; requires each viewer to sign in with a Vercel account that has access to the project. Hobby accounts have no team, so in practice only the owner can pass it. |
| **Password Protection** | **Paid.** Pro/Enterprise, and on Pro it is a priced add-on rather than included. **Not on Hobby.** |
| **Trusted IPs** | Enterprise only. |
| **Protection for Production deployments** | Requires a paid plan even where the mechanism exists; Hobby production URLs are public. |

Two independent facts must both hold for the owner's posture to work, and on Hobby neither does: production deployments cannot be password-gated, and the app itself has an open front door. `src/middleware.ts:12` reads:

```ts
const PUBLIC_PATHS = ['/login', '/signup', '/privacy'];
```

`/signup` is public by design, and `src/lib/auth/actions.ts:58` calls `supabase.auth.signUp(parsed.data)` with no invite check, no allow-list, no domain restriction.

**Why it matters:** The eu-compliance posture is audited separately on the assumption that this is a closed, named-recipient deployment. If the production URL is public and registration is open, that assumption is false from the first minute. The practical consequence is not only compliance: every registered stranger can drive the AI pipeline, and `OPENROUTER_API_KEY` is a metered spend on the owner's own account. Rule B7's daily cap is per-user, so N strangers is N times the cap.

**Fix:** Pick one before deploying. In preference order:

1. **Free, Hobby-compatible, recommended — close registration at the identity provider.** Supabase Dashboard → Authentication → Sign In / Providers → Email → turn **off** "Allow new users to sign up". Then Authentication → Users → **Invite user** for each named person. The app's own auth fence (middleware `getUser()` + `requireApiUser()` on every API route) then becomes the real gate, and it is a gate that already works and is already tested. Additionally consider hiding or removing the `/signup` route so the page does not advertise a door that is locked — but note that removing the page is *not* the security control; the Supabase setting is. Verify by attempting to register a throwaway address on the live URL and confirming it is refused.
2. **Paid — upgrade to Pro and buy the Password Protection add-on.** Say plainly: this requires a paid plan and, on Pro, an additional per-month charge for the protection add-on. It gives exactly the posture described, and it composes with option 1.
3. **Vercel Authentication on Previews only** — free on Hobby, and worth enabling regardless (see vs-4), but it does **not** solve production and does not admit named non-Vercel users.

**Confirm the plan facts yourself before acting:** Vercel Dashboard → your project → Settings → **Deployment Protection**. Options your plan does not support are shown greyed out or behind an "Upgrade" badge. That page is authoritative for your account; my table above is not.

---

### [BLOCKER] vs-2 — `maxDuration = 300` exceeds the Hobby ceiling in every plan regime; three more routes exceed it in the classic regime

**Where:**
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/applications/[id]/generate/route.ts:56` — `export const maxDuration = 300;`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/applications/[id]/judge/route.ts:59` — `120`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/scan/route.ts:83` — `120`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/dev/coverage-probe/route.ts:74` — `120`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/dev/reindex/route.ts:72` — `120`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/applications/[id]/export/route.ts:62` — `60`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/applications/[id]/rescore/route.ts:62` — `60`

That is the complete set — `grep -rn "maxDuration" src/` returns exactly these seven declarations plus three prose mentions.

**What:** Vercel has two duration regimes and which one applies depends on whether **Fluid compute** is enabled on the project. My understanding, stated with **moderate confidence for the Fluid numbers and high confidence for the classic ones**:

| Regime | Hobby default | Hobby maximum |
|---|---|---|
| Classic (Fluid compute **off**) | 10 s | **60 s** |
| Fluid compute **on** (default for new projects since 2025) | 300 s | **300 s** |

Against that:

- `generate` at **300** is at the absolute ceiling in the best case (Fluid on) and **5× over** in the worst (Fluid off). Even in the best case it leaves zero headroom, and the route's own docblock at line 55 says the worst-case budget is *"~248 s"* — so a bad run lands within 52 s of a hard kill.
- The four **120 s** routes are fine under Fluid and **2× over** without it.
- The two **60 s** routes are safe in both regimes.

**Why it matters:** Two distinct failure modes, and the second is the nastier one.

If Vercel validates at build time, the deploy fails with a message naming the offending route — annoying but safe, and the owner finds out immediately. I believe this is the actual behaviour (moderate confidence).

If instead the value is silently clamped down to the plan ceiling, the generate route gets killed mid-pipeline. That is not a clean failure: `src/app/api/applications/[id]/generate/route.ts:66` documents that `LOCK_TTL_MS = 300_000` is deliberately tied to `maxDuration`, so a platform kill at 60 s leaves the in-flight lock held for a further 240 s and the user sees a spurious "already generating". Worse, `src/app/api/scan/route.ts:75-81` spells out the consequence in the repo's own words:

```
 * A platform timeout below that budget kills the request before `after()` runs,
 * which drops the `llm_calls` row for a call that WAS billed — rule B8 would
 * stop holding with /quality as the only witness.
```

A platform kill below `maxDuration` therefore produces **billed model calls with no audit row**, and `/quality` — the only witness — would show nothing. That breaks Block H item 7 and the append-only audit-log guarantee at the same time.

**Fix:**
1. Confirm the ceiling in your own dashboard first: Settings → **Functions** → look for the **Fluid compute** toggle and the **Max duration** control. The value the UI refuses to accept is the true ceiling for your plan. Do this before changing any code — if Fluid is on and 300 is permitted, the 120 s routes need no change at all.
2. If Fluid compute is available on Hobby, **enable it**, and the 120 s routes are then in-budget.
3. Regardless of regime, reduce `generate` from 300. The route's budget is four steps × (two 60 s attempts + 2 s wait). Bringing `REQUEST_TIMEOUT_MS` (`src/lib/openrouter/server.ts:50`, currently `60_000`) down, or reducing the per-step retry budget for the generate path specifically, is the honest fix; raising the platform ceiling is not available on Hobby.
4. Whatever `maxDuration` ends up as, keep `LOCK_TTL_MS >= maxDuration` — the coupling is documented at line 62-67 and must survive the edit.
5. If any route is forced down to 60 s, re-check that comment block at `scan/route.ts:75` — the stated budget must still fit, or the audit-row loss it warns about becomes real.

---

### [BLOCKER] vs-3 — SPEC Block H item 9 evidence has never been produced; the file still says "NOT VERIFIED"

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/eval/dev-routes-production-evidence.md:3`

**What:** SPEC Block H item 9 (`SPEC.md:1270`) makes this an explicit condition of the first deploy, not a backlog item. The evidence file's own first lines:

```
**Status: NOT VERIFIED.** This file is a TEMPLATE. Nothing below has been run,
```

and both "Run output" sections still contain `<PASTE RUN OUTPUT HERE>`.

The code itself is correct — I read both handlers and the fence is the first statement in each, before auth and before argument parsing:

`src/app/api/dev/reindex/route.ts:76` and `src/app/api/dev/coverage-probe/route.ts:84`:
```ts
if (process.env.NODE_ENV === 'production') throw new NotFoundError();
```

**Why it matters:** This is CLAUDE.md's "a configured mechanism is not a working one" precisely, and the evidence file argues the case better than I can: the fence cannot be unit-tested (both handlers `import 'server-only'`), Playwright only ever runs against a dev server where the guard is *supposed* to be inactive, and `scripts/check.mjs` has no rule for it. So nothing in the repository witnesses the property. Both routes ship in the production bundle and both spend metered embedding calls; `reindex` also writes to `documents`. A third dev route added later without the guard would pass every gate in the repo.

Note this interacts with vs-1: if the deployment is not gated, an unfenced dev route is reachable by strangers.

**Fix:** Run it, once, locally, before deploying — the file gives the exact commands:

```bash
npm run build
npm run start   # NODE_ENV=production, port 3000

curl -i "http://localhost:3000/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
curl -i -X POST "http://localhost:3000/api/dev/reindex"
```

Both must answer **404**. Run each **signed out and signed in** (`-b` with the session cookie) — a 401 rather than a 404 when signed out would mean the fence is the auth check rather than the environment, which is a weaker property than SPEC claims. Paste both full responses into the file, replace the `NOT VERIFIED` status line, and note the commit.

---

### [MAJOR] vs-4 — Preview deployments will share the production Supabase project and the production OpenRouter key

**Where:** platform configuration — no file. No `vercel.json` exists (confirmed: `ls vercel.json` → no such file; `find . -maxdepth 2 -name "vercel*"` → nothing).

**What:** Every push to any branch creates a preview URL. Vercel's env-var UI defaults to checking **all three** environments (Production, Preview, Development) when you add a variable. If the owner accepts that default, every preview deployment gets `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` pointing at the live project and the live billing account.

Compounding it: `NODE_ENV` is `production` on preview builds too, so the `/api/dev/*` fence *does* hold on previews (good) — but the auth fence is the same code as production, and a preview URL is a real, publicly-reachable URL unless protection is on.

**Why it matters:** Three separate exposures. (a) A preview of a half-finished branch runs against real users' resumes and real personal data — a bug in a branch is a data incident, not a broken preview. (b) The service-role key bypasses RLS entirely; handing it to every branch build widens the blast radius of the one key that has no fence underneath it. (c) OpenRouter spend from previews is indistinguishable from production spend on the same key.

**Fix:**
1. **Enable Vercel Authentication for Preview deployments.** Settings → Deployment Protection → **Vercel Authentication** → scope: *Preview deployments only*. This is free on Hobby and is the one Deployment Protection feature the owner definitely has. Do this even though it does not solve vs-1.
2. **Scope the two secrets to Production only.** When adding `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, uncheck Preview and Development. Previews will then fail loudly on any AI or account-deletion path — `src/lib/openrouter/server.ts:299-300` throws `'OPENROUTER_API_KEY is not set'` (naming the variable, never a value), and `src/lib/supabase/admin.ts:27` behaves likewise. A loud failure on a preview is the correct outcome.
3. If preview testing of the AI path is genuinely wanted, provision a **separate OpenRouter key with its own spend limit** and a **separate Supabase project** for Preview, and scope those to Preview. Do not point Preview at the production database.
4. The two `NEXT_PUBLIC_*` Supabase variables are needed in all three environments — a preview build fails at `src/middleware.ts:24-25` without them.

---

### [MAJOR] vs-5 — No security headers are configured anywhere

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/next.config.ts` (whole file, 20 lines) — and no `vercel.json`.

**What:** `grep -rn "headers()\|X-Frame-Options\|Content-Security-Policy\|Strict-Transport\|X-Content-Type" src/ next.config.ts` returns nothing. The config is:

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  typescript: { ignoreBuildErrors: false },
};
```

No `async headers()`. Vercel supplies HSTS on `.vercel.app` domains automatically, but **not** CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`.

**Why it matters:** This app renders user-supplied resume text and model-generated resume text into the DOM, and holds an httpOnly session cookie. The httpOnly flag (`src/lib/supabase/cookie-options.ts:33`) is a genuinely good decision and it means XSS is not instant account takeover — but without `X-Frame-Options`/`frame-ancestors` the app can be framed for clickjacking, and the destructive action here is account deletion. `sameSite: 'lax'` covers the cross-site POST case, so this is defence in depth rather than an open hole, which is why it is MAJOR and not BLOCKER.

**Fix:** Add an `async headers()` block to `next.config.ts` returning at minimum `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` disabling camera/microphone/geolocation. Prefer `next.config.ts` over creating a `vercel.json` — one config file, and it keeps working for a self-hosted `next start`. A full CSP with `script-src` is harder (Next injects inline bootstrap scripts and needs a nonce) and is reasonable to defer to a follow-up; the four headers above are cheap and immediate. **Note `scripts/check.mjs` R8 scans `next.config.*` for secrets and for an `env:` block — adding a `headers()` function does not trip it, but do not add anything else to that file.**

---

### [MAJOR] vs-6 — Function region will default to US; Supabase is in EU-Frankfurt

**Where:** platform configuration — no file. Confirmed no `preferredRegion` export anywhere: `grep -rn "export const preferredRegion" src/` returns nothing.

**What:** Vercel's default function region for new projects is **Washington, D.C., USA (`iad1`)** (high confidence). Supabase is EU (Frankfurt) per CLAUDE.md. Every database round trip would cross the Atlantic twice.

**Why it matters:** Two reasons, and the second is the one that matters more here.

*Latency:* the pipeline is round-trip heavy — `scan` does an embeddings call plus one RPC per requirement (`src/app/api/scan/route.ts:75-81`). At ~90 ms transatlantic RTT, a scan with 15 requirements pays roughly 1.4 s of pure network on the RPCs alone, on routes that are already fighting the duration ceiling in vs-2. Fixing the region partly funds fixing vs-2.

*Data residency:* CLAUDE.md pins Supabase to EU (Frankfurt) deliberately, and /privacy discloses the processing. A US-region function means personal data — resume text, vacancy text, the display name — is **processed** in the US on every request even though it is *stored* in the EU. Whether that matters legally is the eu-compliance reviewer's call, not mine, but a privacy page that implies EU processing while functions run in `iad1` is at best imprecise. Flagging it so the two audits agree.

**Fix:** Set the region to **Frankfurt (`fra1`)**. On Hobby this is done in the dashboard and needs no `vercel.json`: Settings → **Functions** → **Function Region** → select Frankfurt, then **redeploy** (the setting applies to new deployments, not retroactively). Hobby permits selecting **one** region; multi-region function deployment requires a paid plan, but one region is all this app needs. Do not add a `vercel.json` solely for this — the dashboard setting is sufficient and the repo is currently clean of Vercel config, which is worth preserving.

---

### [MAJOR] vs-7 — The advertised 5 MB PDF limit exceeds Vercel's ~4.5 MB request body limit

**Where:**
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/lib/copy.ts:170` — `export const MAX_PDF_BYTES = 5 * 1024 * 1024;`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/lib/copy.ts:134` — `'Drag & drop or choose a .pdf file, max 5 MB'`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/api/scan/route.ts:91` — `const MAX_SCAN_BODY_BYTES = MAX_PDF_BYTES + 64 * 1024;`

**What:** Vercel serverless functions cap the request body at **4.5 MB** (high confidence — this is long-standing and well documented). The app's UI promises 5 MB, and the scan route's outer bound is 5 MB + 64 KB ≈ **5.06 MB**. Uploads between roughly 4.5 MB and 5 MB will be rejected **by the platform**, before any application code runs.

**Why it matters:** The user gets a raw platform `413` — not `FILE_TOO_LARGE` from `src/lib/errors.ts:77`, not the friendly copy at `src/lib/copy.ts:144`. The app's careful pre-buffer `Content-Length` check (`src/app/api/scan/route.ts:270-274`) never executes, so all of that good error handling is bypassed for exactly the file sizes it was written for. The app tells the user 5 MB is fine and then fails opaquely at 4.6 MB.

To be fair to the code, it already anticipates this. `src/app/api/scan/route.ts:266-267` says the real limits are `file.size` *"plus whatever the platform enforces on a request body"*, and `src/lib/copy.ts:1331-1336` even carries a message for the case:

```
'That request is too large — keep the PDF under 5 MB and the posting under 20,000 characters.'
```

But that message is only reachable if the app sees the request, and above 4.5 MB it does not.

**Fix (cheapest first):** Lower `MAX_PDF_BYTES` to **4 MB** and update the two copy strings. 4 MB leaves headroom for the vacancy field and multipart framing under the 4.5 MB platform cap, so the app's own error is the one users actually see — which is the whole point of having written it. A resume PDF over 4 MB is nearly always an image scan, which `extractPdfText` refuses anyway (`D1/D2`, 422 `UNREADABLE_PDF`). The alternative — client-side direct upload to Supabase Storage, bypassing the function — is a real feature and does not belong in a pre-deploy fix.

---

### [MINOR] vs-8 — `prebuild` couples the Vercel deploy to the full check + unit-test suite

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/package.json:8-11`

```json
"prebuild": "npm run check && npm test",
"build": "next build",
"test": "node --import ./tests/alias-hook.mjs --test \"tests/unit/*.test.mjs\"",
```

**What:** npm runs `prebuild` automatically before `build`, so Vercel's build step executes all thirteen `check.mjs` rules and the unit suite. This is mostly a **good** thing — I want to be clear it is not a defect — and it means a rule violation blocks a deploy rather than shipping. Three fragilities worth knowing before the first deploy rather than during it:

1. It depends on **devDependencies being installed**. Vercel installs them by default; if `NPM_CONFIG_PRODUCTION=true` or `--omit=dev` is ever set, `prebuild` fails and the cause is not obvious from the log.
2. **R12** (`check.mjs:41-49`) fails the build if `docs/eval/audit-retention-evidence.md` is missing or placeholder-y. That file is present and 2,759 bytes, so it passes today — but the build now depends on a docs file, and a future docs tidy-up can break the deploy.
3. **R13** validates that backticked repo paths in `docs/` resolve against the tree. `docs/` is deployed from the same checkout so this holds — but it means an edit to a markdown file can fail a production deploy.
4. `npm test` passes a quoted glob to `node --test`, relying on Node's own glob expansion. Requires Node ≥ 22 — `engines` says `>=22.18`. **Set the Vercel project's Node version to 22.x explicitly** (Settings → General → Node.js Version) rather than relying on the default, which changes over time.

**Why it matters:** None of these is a security hole. They are all "the first deploy fails for a reason that looks unrelated to deploying," which costs an afternoon at the worst possible moment.

**Fix:** No code change. Before deploying, run `npm run check && npm test && npm run build` locally on a clean checkout and confirm green — which the vs-3 fix requires you to do anyway. Pin the Node version in project settings.

---

### [MINOR] vs-9 — Deployment Protection bypass secrets are themselves secrets

**Where:** platform configuration — no file.

**What:** If the owner enables any Deployment Protection (per vs-1 or vs-4), Vercel offers **Protection Bypass for Automation** — a token that, when sent as `x-vercel-protection-bypass`, skips the gate entirely. Vercel can also auto-populate it as the `VERCEL_AUTOMATION_BYPASS_SECRET` environment variable.

**Why it matters:** That token defeats the exact control vs-1 depends on. A bypass token pasted into a Playwright config, a CI file, or a README is the gate removed. CLAUDE.md's Secrets rules apply to it in full, and note it is **not** covered by `check.mjs` R4/R7/R10 — those key off `SECRET_NAMES` and the `_KEY|_SECRET|_TOKEN` suffix heuristic; `VERCEL_AUTOMATION_BYPASS_SECRET` would match the `_SECRET` suffix in a `process.env` read, but a token **pasted as a literal** into a config file matches nothing.

**Fix:** Do not enable automation bypass unless CI genuinely needs it. If it is enabled, never commit the value; keep it in the Vercel dashboard only. Do not put it in `playwright.config.ts` — `tests/e2e/.auth/` is already gitignored for the related reason (`.gitignore:24-26`), and the same reasoning applies here.

---

### [MINOR] vs-10 — `/api/dev/*` routes ship in the production bundle by design

**Where:** `src/app/api/dev/coverage-probe/route.ts`, `src/app/api/dev/reindex/route.ts`

**What:** Both ship; the fence is runtime, not build-time. This is the documented, owner-accepted design (SPEC Block H item 9 says so explicitly: *"and both ship in the bundle"*), and the runtime fence is correct and correctly ordered. Recording it as a known and accepted property rather than a defect.

**Why it matters:** The residual risk is entirely about a *third* dev route added later without the guard — nothing in the repo would catch it, as `docs/eval/dev-routes-production-evidence.md` explains at length. With `check.mjs`'s thirteen rules frozen, the only control is review.

**Fix:** No action now beyond vs-3. For the backlog: an R14 asserting that every `route.ts` under `src/app/api/dev/` contains the `NODE_ENV === 'production'` guard as its first statement would convert this from a review obligation into a build one. That needs an owner decision, since the rule set is described as frozen.

---

### [NIT] vs-11 — Middleware runtime and region interact with vs-6

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/middleware.ts` (no `runtime` export)

**What:** The middleware calls `supabase.auth.getUser()` on **every** non-excluded request (line 50) — a network round trip to Supabase in Frankfurt on every page navigation. Middleware placement and region behaviour differs from route handlers and has changed across Next.js versions; this project is on `next ^16.3.4`.

**Why it matters:** Purely latency, not security. The auth logic is correct and the matcher at line 100 is unusually carefully written — the anchoring comments about `/apifoo` and `/privacyleak` describe a real class of bug that this matcher avoids. If middleware executes at a globally distributed edge while Supabase is in Frankfurt, a user in Frankfurt could still be routed through a distant PoP for the auth check.

**Fix:** After deploying with `fra1` (vs-6), measure a signed-in page navigation from a European client. If middleware latency dominates, consider pinning the middleware to the Node.js runtime so it colocates with the function region. Measure first — this is a NIT precisely because it may be a non-issue.

---

## Environment variables for a production deployment

Names only. **No value in this report, this repository, or any log.** `.env.example` was read with `grep -o '^[A-Z_]*' .env.example` — names only, per CLAUDE.md — and `.env.local` was **not** opened.

| NAME | Exposure | In `.env.example`? | Read at | Vercel environments |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Public** — inlined into the client bundle | Yes | `middleware.ts:24`, `lib/supabase/server.ts:20`, `lib/supabase/admin.ts:33` | Production **+ Preview + Development** (build fails without it) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Public** — inlined into the client bundle | Yes | `middleware.ts:25`, `lib/supabase/server.ts:21` | Production **+ Preview + Development** |
| `OPENROUTER_API_KEY` | **Server-only** | Yes | `lib/openrouter/server.ts:299` — and nowhere else | **Production only.** Preview only with a separate, spend-limited key (vs-4) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** — bypasses RLS entirely | Yes | `lib/supabase/admin.ts:27` — and nowhere else, enforced by `check.mjs` R10 | **Production only.** Never scope to Preview against the production project |

Notes:

- **Do not set `NODE_ENV`.** Vercel sets it to `production` for both Production and Preview builds. The `/api/dev/*` fence and `cookie-options.ts:33`'s `secure` flag both depend on it. Setting it manually is a way to break both at once.
- The two `NEXT_PUBLIC_*` values are *designed* to reach the browser — the anon key is protected by RLS, not by secrecy. This matches CLAUDE.md's Secrets section exactly ("the only client-side environment variables are…").
- `.env.example` contains **exactly these four names and nothing else** — no fifth name, no stray value line. Verified.
- When pasting values into the Vercel dashboard, use the **Sensitive** setting for the two server-only keys where offered, so the value cannot be read back out of the UI afterwards.

---

## Post-deploy verification checklist

Run in order. Steps 1-3 happen **before** the first deploy. Replace `<url>` with the production hostname.

**Before deploying**

1. **Close registration (vs-1).** Supabase Dashboard → Authentication → Providers → Email → disable new sign-ups. Invite each named person. This is the gate; do it first.
2. **Produce the Block H item 9 evidence (vs-3).**
   ```bash
   npm run build && npm run start
   curl -i "http://localhost:3000/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
   curl -i -X POST "http://localhost:3000/api/dev/reindex"
   ```
   Both must be `404`, signed out **and** signed in. Paste into `docs/eval/dev-routes-production-evidence.md` and clear the `NOT VERIFIED` status.
3. **Audit the local production bundle for secret names.** Against the same `.next/` the previous step built:
   ```bash
   grep -rl "OPENROUTER_API_KEY\|SUPABASE_SERVICE_ROLE_KEY" .next/static ; echo "exit=$?  (1 = clean)"
   grep -rl "openrouter.ai" .next/static ; echo "exit=$?  (1 = clean)"
   ```
   Grep for the variable **NAMES**, never values. Both must return nothing.
4. Set **Function Region = Frankfurt** (vs-6), **Node.js 22.x** (vs-8), and confirm the **maxDuration ceiling** (vs-2) in Settings → Functions.
5. Add the four env vars with the scoping in the table above. Enable **Vercel Authentication on Previews** (vs-4).

**After the first deploy**

6. **Signed-out fence — fresh incognito window, no cookies.** Each must land on `/login` with no flash of member content:
   `https://<url>/scan` · `https://<url>/applications` · `https://<url>/applications/00000000-0000-0000-0000-000000000000` · `https://<url>/settings` · `https://<url>/quality`
7. **Signed-out API fence — must be `401` JSON, never HTML, never `500`, never data:**
   ```bash
   for p in /api/applications /api/career/items /api/scan; do
     echo "== $p"; curl -s -o /dev/null -w "%{http_code}\n" "https://<url>$p"
   done
   curl -i "https://<url>/api/applications"     # inspect the body: JSON error, no rows
   ```
8. **`/api/dev/*` must be `404` on the deployment — the production proof of vs-3:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://<url>/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
   curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<url>/api/dev/reindex"
   ```
   Both `404`. Repeat signed in.
9. **Registration is actually closed (vs-1).** In incognito, open `https://<url>/signup` and attempt to register a throwaway address. It must be refused. **If this succeeds, take the deployment down.**
10. **Public bundle carries no secret names.** From the live site:
    ```bash
    curl -s "https://<url>/login" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u | head -40 \
      | while read f; do curl -s "https://<url>$f" \
      | grep -l "OPENROUTER_API_KEY\|SUPABASE_SERVICE_ROLE_KEY" - && echo "LEAK in $f"; done; echo "sweep done"
    ```
    Any `LEAK` line is a stop-the-deploy event.
11. **Cookie flags.** Sign in, then in DevTools → Application → Cookies confirm every `sb-*` cookie shows **HttpOnly ✓, Secure ✓, SameSite=Lax**, and `Max-Age` ≈ 2592000 (30 days), *not* 34560000. The 400-day default being overridden is the specific bug `cappedMaxAge` exists to fix (`lib/supabase/cookie-options.ts:38-56`) — verify it held in production, since that comment records it failing once already.
12. **Security headers** (expect these to be missing until vs-5 is fixed — this step records the baseline):
    ```bash
    curl -sI "https://<url>/login" | grep -i "strict-transport\|x-frame\|content-security\|x-content-type\|referrer-policy"
    ```
13. **Source maps are not served.** `productionBrowserSourceMaps` is not set in `next.config.ts`, so this should already hold:
    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" "https://<url>/_next/static/chunks/main.js.map"   # expect 404
    ```
14. **One full pipeline run on production env vars.** Sign in as a named user → paste a resume + vacancy → scan → generate → judge → export. Confirm `/quality` shows real rows for `parse_vacancy`, `embed`, `generate`, `judge` with nonzero `cost_usd_micro` and correct fallback flags (Block H item 7). **Watch the duration of the generate step against vs-2** — if it approaches the ceiling, that finding is live.
15. **Upload boundary (vs-7).** Upload a PDF of roughly 4.7 MB. Confirm whether the user sees the app's `FILE_TOO_LARGE` copy or an opaque platform `413`. The latter confirms vs-7.
16. **`/privacy` loads publicly** — in incognito, with no redirect to `/login`.
17. **Preview isolation (vs-4).** Open a preview URL in incognito. It must challenge for Vercel Authentication. If the AI path is exercised there, confirm which OpenRouter key was billed.

---

## Checked and clean

Coverage, so the absence of a finding is informative rather than an omission:

- **Git history — no secret was ever committed.** `git log --all --diff-filter=A --name-only -- "*.env*"` returns exactly one file, `.env.example`, added in `5b88b61`. A sweep of every tree in `git rev-list --all` for `^\.env` files returns only `.env.example`. `git ls-files | grep -i env` returns only `.env.example`. **No key needs rotating.**
- **`.gitignore` is correct and root-anchored.** `git check-ignore -v` confirms `.env.local` (line 14, `/.env.*`), `.next` (line 3), `test-results` (line 27), `.vercel` (line 31). The `!/.env.example` re-include is explicit. `git ls-files` shows nothing tracked under `.next/`, `test-results/` or `playwright-report/`.
- **`.env.example` holds four names and no values.** Read via `grep -o '^[A-Z_]*'` per CLAUDE.md. `.env.local` was never opened.
- **Secret read sites are confined exactly as CLAUDE.md requires.** A full `process.env.*` sweep of `src/` returns eleven reads total: `OPENROUTER_API_KEY` only at `lib/openrouter/server.ts:299`; `SUPABASE_SERVICE_ROLE_KEY` only at `lib/supabase/admin.ts:27`; the rest are `NODE_ENV` or the two `NEXT_PUBLIC_*` values. No secret is read in a client component, a page, or a route handler.
- **No `NEXT_PUBLIC_` prefix on any secret.** `grep -rn "NEXT_PUBLIC" src/ scripts/` returns only the two allowed Supabase variables plus `check.mjs`'s own rule text. R4a/R4b enforce this in the build, including against `.env.example` itself.
- **`next.config.ts` is clean and minimal.** No `env:` block, no `publicRuntimeConfig`, no secret name, no `productionBrowserSourceMaps` (so server code is not exposed via source maps), and `typescript.ignoreBuildErrors: false` — the build genuinely fails on type errors, satisfying Block H item 1. R8 guards this file unconditionally.
- **`tsconfig.json` is strict:** `strict`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `noEmit`. The casing flag matters for a Windows-authored repo building on Linux.
- **No `public/` directory exists at all** — zero risk of a secret or user file served as a static asset.
- **No `vercel.json`, no `.vercelignore`, no `.vercel/` in the tree.** Nothing Vercel-specific is committed, so no values can be hiding in platform config. My recommendations deliberately keep it that way (dashboard settings over a new config file).
- **No hardcoded endpoints.** `grep -rn "supabase\.co\|localhost:" src/` (excluding copy strings) returns nothing — no environment is pinned in source.
- **Existing `.next/static` is clean.** `grep -rl` for both secret names and for `openrouter.ai` returns nothing. *Caveat:* this artifact is dated 2026-09-04 15:09 and the directory contains both `build/` and `dev/` subtrees, so I cannot be certain it is a pure production build. Step 3 of the checklist re-runs the grep against a known-fresh build — treat this bullet as encouraging, not conclusive.
- **Middleware auth fence is sound.** `getUser()` only (never `getSession()`, enforced by R9); every redirect carries the refreshed cookies (the rotated-refresh-token bug is handled at lines 57-71); the matcher anchors every exclusion to a path segment, and the escaped-dot and `/apifoo` / `/privacyleak` reasoning is correct.
- **Cookie hardening is correct:** `httpOnly: true`, `secure` in production, `sameSite: 'lax'`, and the `cappedMaxAge` workaround for `@supabase/ssr` overwriting `maxAge`. `createBrowserClient` is banned and R11 enforces it.
- **The `/api/dev/*` fence is correctly written and correctly ordered** in both handlers — before `requireApiUser()`, before any argument parsing. Only the *evidence* is missing (vs-3), not the control.
- **Thirteen `check.mjs` rules run as `prebuild`**, so a deploy cannot skip them. R4, R5, R6, R7, R8, R10 and R11 together form a real, build-enforced boundary around secrets and the OpenRouter connection. This is stronger static enforcement than most projects of this size have, and it is why the secret-placement half of this audit found nothing.

---

## Scope not covered

- **I did not run `npm run build`, `npm test`, `npx vercel build`, or any Vercel CLI command,** and I installed nothing. This was a read-only audit. Every build-time claim is inferred from configuration; steps 2-3 of the checklist are where they get tested.
- **I did not open `.env.local`** and read no secret value anywhere. I therefore cannot confirm the four variables are *populated* locally — only that the four names are the right ones.
- **I did not read `WORKLOG.md`** (CLAUDE.md: owner's private file).
- **Plan-tier and platform-limit facts are stated with explicit confidence and are not authoritative for your account.** The three that matter most — Password Protection availability on Hobby (vs-1), the Hobby `maxDuration` ceiling (vs-2), and the 4.5 MB body limit (vs-7) — each carry a dashboard location where you can confirm them yourself. **Confirm vs-1 before you rely on it**; the whole gating posture turns on that one fact, and a wrong answer there is the difference between a closed deployment and an open one.
- **Supabase-side configuration is out of remit** — RLS policies, the `match_documents` invoker/definer property, and the pg_cron retention job belong to supabase-security. I have assumed RLS holds; note that vs-4's service-role-key-on-previews concern exists *because* the service role bypasses RLS entirely.
- **Whether US-region function execution is acceptable for EU personal data (vs-6) is the eu-compliance reviewer's call,** not mine. I flag the technical fact and recommend `fra1`; the legal characterisation is theirs.
- **The nextjs-security gate ran separately** and its report is at `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/reviews/phase-6-nextjs-security.md`. I did not read it, to keep this assessment independent; expect some overlap on the headers finding (vs-5) and read the two together.
- **No CSP `script-src` policy was designed.** vs-5 recommends four cheap headers; a nonce-based CSP for a Next.js app is a real piece of work and belongs in its own change.
