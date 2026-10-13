# Deployment — ordered procedure

Deployment configuration record for CV Insight. It states what must be set, in
which dashboard, and **in what order**, for a deployment of this application.

The deployment is **public**: registration is open and email confirmation is off
(SPEC v3.0c). What bounds spend is the Free plan, per account, enforced inside the
two gates — not the door. Step 3 states plainly what that fence does not cover.

Steps 1–3 happen before the deploy. Steps 4–9 configure the project, and the
Stripe steps S1–S6 below are done alongside step 8. Step 10 deploys. Steps 11–21
verify.

---

## Preconditions

| Setting | Where | Value |
|---|---|---|
| New user sign-ups | Supabase → Authentication → Sign In / Providers | **enabled** |
| Confirm email | Supabase → Authentication → Sign In / Providers → Email | **off** |
| Stripe | Stripe dashboard, **test mode** | product, price, webhook, portal, one-subscription setting — S1–S6 |
| Fluid compute | Vercel → Settings → Functions | **enabled** |
| Function region | `vercel.json` in this repository | `fra1` (already committed) |
| Node.js version | Vercel → Settings → General | **22.x** |
| Preview deployments | Vercel → Settings → Git | **disabled** |
| Server-only secrets | Vercel → Settings → Environment Variables | **Production environment only** |
| Migrations `001`–`007` | Supabase → SQL editor, in order | **applied**. `007_agentic_step.sql` goes in BEFORE the code that writes `step = 'generate_agentic'` is deployed. Without it Postgres refuses every agentic `llm_calls` row, and because the log write is fire-and-forget the loss is silent. |

---

## Before the first deploy

### 1. Run the gates and the suite

```
npm run check && npm test && npm run build
npm run test:e2e
```

Every Playwright spec creates a throwaway account through the `/signup` form, so
the suite needs sign-ups open and confirm-email off on the project it talks to
(step 2). With registration open on the deployment's own project, the suite can
run against it at any time, not only before a deploy — and every run makes real,
paid model calls, so it stays a deliberate, recorded run.

### 2. Open registration, confirm email off

Supabase Dashboard → **Authentication** → **Sign In / Providers**:

- **Allow new users to sign up** → **on**.
- **Email** → **Confirm email** → **off**. This app sends no mail of its own: with
  it on, a sign-up creates an account with no session and nothing behind the
  login is reachable, and every Playwright spec turns into a mailbox test.

Save, then confirm both by reading the page back rather than trusting the click.

### 3. Record the bound on the model-provider key

The deployment's spend is bounded at the key when the key carries a credit
limit, and this step records that limit. **This deployment's key carries none.**
It belongs to another party, so the operator can neither set nor read a limit on
it. Stated plainly, as it is in SPEC Block E (Decision v3.0c) and README:

- **The Free limits are the only fence**, and they fence each **account**, not
  the deployment: 50 chat calls, 3 scans, 1 tailored resume and 20 re-score
  requests per rolling 24 hours (`src/lib/plan.ts`).
- With registration open and confirm-email off, **the deployment's total is
  unbounded under bulk sign-up** — N scripted accounts receive N allowances.
  Backlog `gp-2`, owner-accepted.
- **The per-account caps are not race-safe** under parallel requests from one
  account. Backlog `gp-1`, owner-accepted.
- When the other party's balance runs out, every model call answers
  `AI_UNAVAILABLE`, which the app reports honestly and which costs nothing
  further.

When the deployment moves to an operator-owned OpenRouter key, set a credit limit
on it in OpenRouter → **Keys** and record the figure and the date here, replacing
this paragraph.

---

## Configure the Vercel project

### 4. Import the repository

Import from Git. Framework preset **Next.js**; leave the build command alone —
`npm run build` already runs `prebuild`, which is `npm run check && npm test`, so
a boundary-rule violation or a failing unit test fails the deployment rather than
shipping.

### 5. Node.js version

Settings → **General** → **Node.js Version** → **22.x**. `package.json` declares
`engines: >=22.18`, and `npm test` relies on Node's own glob expansion for
`node --test`. Pin it rather than inheriting a default that moves.

### 6. Fluid compute and function duration

Settings → **Functions** → enable **Fluid compute**.

Not optional. With Fluid compute the Hobby maximum function duration is 300 s;
without it, 60 s — and four of this app's seven routes declare more than that,
including every route that makes a model call. `/api/applications/[id]/generate`
declares 300, and its own worst case is ~248 s. SPEC Block D, "Function duration
on the deployment plan", carries the full table.

Confirm the ceiling in the **Max Duration** field: the value the UI refuses is the
authoritative answer for this account.

### 7. Function region

Nothing to do — `vercel.json` in this repository sets `"regions": ["fra1"]`, and
the repository is the source of truth for it so the setting is reviewable in a
diff. Confirm after deploying (step 12) rather than trusting it.

Frankfurt because Supabase is in EU-Frankfurt and `/privacy` states that the
application runs in the EU. The platform default is `iad1` (Washington DC), which
would process every resume in the United States.

### 8. Environment variables

Settings → **Environment Variables**. Seven names. **Never paste a value into a
commit, a log, an issue or a chat message.**

| Name | Environments | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Public by design; inlined into the client bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Public by design; protected by RLS, not by secrecy |
| `OPENROUTER_API_KEY` | **Production only** | Metered spend |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production only** | Bypasses RLS entirely |
| `STRIPE_SECRET_KEY` | **Production only** | Must start `sk_test_` (S6) |
| `STRIPE_WEBHOOK_SECRET` | **Production only** | From the dashboard endpoint (S3) — not the `stripe listen` one |
| `STRIPE_PRICE_PRO` | **Production only** | The price id from S2 |

Use the **Sensitive** setting for the server-only keys where offered, so the
value cannot be read back out of the dashboard afterwards.

**Do not set `NODE_ENV`.** Vercel sets it. Two separate behaviours depend on it
being exactly what the platform sets: the `/api/dev/*` 404 fence and the `secure`
flag on the session cookie. Setting it by hand is a way to break both at once.

### 9. Disable preview deployments

Settings → **Git** → turn off preview/branch deployments (deploy the production
branch only).

Gate finding `vs-4`. Vercel's environment-variable UI defaults to all three
environments, and a preview that inherited these values would run a half-finished
branch against the real database with a key that bypasses RLS, billing the real
OpenRouter account. With previews off, the question does not arise. If previews
are ever wanted, they need their own Supabase project and their own spend-limited
OpenRouter key — never the production ones.

---

## Deploy

### 10. Deploy the production branch

Deploy from `main`. Watch the build log for `check passed (13 rules)` and the unit
suite; if `prebuild` fails, the deployment correctly did not happen.

---

## Verify on the deployment

Replace `<url>` with the production hostname. A failure in steps 11, 13 or 14 is a
stop-and-fix, not a note for later.

### 11. Registration works, and the fence still holds

In a private window, open `https://<url>/login`: it must show the "No account?
Create one" link. Follow it, sign up with a throwaway address, and land on
`/scan` signed in — no "Check your email" message (that would mean step 2's
confirm-email setting did not take effect). Then, signed out:

```
curl -i -X POST "https://<url>/api/career/items"     # expect 401, not 200
```

Open registration does not open the API: a signed-out request is still refused
before anything else happens. Delete the throwaway account through Settings
afterwards.

### 12. Region

Vercel → the deployment → **Resources** / deployment summary. Functions must show
**Frankfurt (fra1)**. If they show `iad1`, `vercel.json` was not picked up and
`/privacy`'s statement about where the application runs is currently false.

### 13. The app works behind the CSP

Sign in as a named user and **open `/settings` and the delete-account dialog**,
with the browser console open. Zero CSP violations.

This is the one screen `docs/eval/csp-verification.md` could not cover — it needs
a session — and it is the most CSP-sensitive one in the app, because the Radix
dialog is the heaviest user of inline style attributes. Do not skip it. Also open
`/scan`, `/career`, `/applications` and `/quality` and check the console.

### 14. Dev routes are unreachable

```
curl -s -o /dev/null -w "%{http_code}\n" "https://<url>/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<url>/api/dev/reindex"
```

Both **404**, signed out and signed in. This was verified against a local
production build already (Block H item 9); this repeats it where it counts.

### 15. Signed-out fence

In a private window, each of these must land on `/login` with no flash of member
content: `/scan`, `/career`, `/applications`, `/quality`, `/settings`, and
`/applications/00000000-0000-0000-0000-000000000000`.

### 16. Security headers

```
curl -sI "https://<url>/login" | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy'
```

All five present. `frame-ancestors 'none'` and `X-Frame-Options: DENY` must agree.

### 17. No secret reaches the browser

Grep the served bundle for the variable **names**, never for values:

```
curl -s "https://<url>/login" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u | head -40 \
  | while read f; do curl -s "https://<url>$f" | grep -l "OPENROUTER_API_KEY\|SUPABASE_SERVICE_ROLE_KEY" - && echo "LEAK in $f"; done; echo "sweep done"
```

Any `LEAK` line is a stop-the-deploy event.

### 18. Cookie flags

Sign in, then DevTools → Application → Cookies. Every `sb-*` cookie:
**HttpOnly ✓, Secure ✓, SameSite=Lax**, and `Max-Age` ≈ 2592000 (30 days) — *not*
34560000. The 400-day library default being overridden is what `cappedMaxAge`
exists to do, and it has failed once before.

### 19. One full pipeline run

Sign in → paste a resume and a vacancy → scan → generate → judge → export. Then
open `/quality` and confirm real rows for `parse_vacancy`, `embed`, `generate` and
`judge`, with a nonzero `cost_usd_micro` and correct fallback flags (Block H item
7). Watch the generate step's duration against the 300 s ceiling.

Use invented data. The demonstration notice on every member screen says why, and
it applies to the person running this checklist first of all.

### 20. No third-party script is being injected

Open a member screen with the console visible and confirm there is no error from
a script whose frames are `<anonymous>` / `VM…` rather than
`/_next/static/chunks/*`. This app ships no analytics, no telemetry and no
web-vitals reporter — verified against a clean build — so anything of that shape
came from the platform or the browser, and two settings can put it there:

- Vercel → Project → **Speed Insights**: must be **off**. It injects a reporting
  script with no package installed, and `/privacy` states there are no analytics
  and no trackers. Enabling it makes that sentence false and re-opens the
  no-consent-banner decision in CLAUDE.md. The CSP's `connect-src 'self'` would
  block its beacon, but a header is the wrong place to enforce a promise the
  page makes in prose.
- Vercel → **Toolbar**: injected for visitors authenticated to Vercel. Harmless
  for other viewers, and worth knowing about before treating its console noise
  as an app defect.

### 21. Public pages

`https://<url>/privacy` and `https://<url>/impressum` must load in a private
window with no redirect. `/impressum` must show the operator's name, a working
contact email and the **marked** postal-address placeholder. It must never show a
`[[...]]` token: `tests/unit/impressum.test.mjs` fails the build if
`IMPRESSUM_FILLED` is `true` while one remains.

---

## Stripe in test mode

Every step below is in the Stripe dashboard with the **Test mode** toggle on. No
card data and no Stripe script reach this app: Checkout and the Customer Portal
are Stripe-hosted pages. Do S1–S5 before step 8, because three of the values go
into the environment there.

### S1. Product

**Product catalogue** → **Add product**: name *CV Insight Pro*. The name is what
Checkout and the portal show; nothing in the app reads it.

### S2. Price

On that product, add a **recurring** price: **€5 / month**, matching
`PRICING.proPrice` in `src/lib/copy.ts`. Copy the price id (`price_…`) into
`STRIPE_PRICE_PRO`. The checkout route sends only this id; the amount lives in
Stripe.

### S3. Webhook endpoint on the deployment URL

**Developers** → **Webhooks** → **Add endpoint**:

- URL: `https://cv-insight-lime.vercel.app/api/stripe/webhook`
- Events — exactly these three, nothing else:
  `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`

Reveal the endpoint's **signing secret** (`whsec_…`) and put it in
`STRIPE_WEBHOOK_SECRET`. This is the deployment's secret and differs from the one
`stripe listen` prints locally. The handler verifies the signature on the raw
body before anything else, so a wrong secret answers every delivery 400 and
writes nothing — S3 is checked by the 200s in the endpoint's delivery log, not by
the setting existing.

### S4. Customer Portal

**Settings** → **Billing** → **Customer portal**: enable **cancel subscriptions**
(at period end), and save the configuration in test mode. `/api/billing/portal`
opens this page for a Pro account; with no saved configuration Stripe refuses to
create a portal session.

### S5. One subscription per customer

**Settings** → **Checkout and Payment Links** → subscriptions → **Limit customers
to one subscription** → on. The app derives one plan from the latest ledger row;
a second concurrent subscription for the same customer would make that row
ambiguous. If the dashboard has moved this setting, search the settings for
"one subscription" — the setting must be on, wherever it lives.

### S6. The `sk_test_` check

**Developers** → **API keys**, in test mode: the secret key starts `sk_test_`.
Put it in `STRIPE_SECRET_KEY`. The check is not trust in the paste:
`src/lib/stripe/server.ts` refuses to build a client on any key that does not
start `sk_test_`, so after deploying, **[Upgrade to Pro]** in Settings returning
a `checkout.stripe.com` page that shows Stripe's *Test mode* badge is the proof.
Never compare or print the value — the prefix is all that is checked.

**The end-to-end record** of one real test-mode upgrade on the deployment — the
session, the three deliveries with their 200s, the ledger rows, one redelivery
producing no second row, Settings reading Pro — goes in
`docs/eval/billing-webhook-evidence.md`, section "Deployment run" (SPEC Block H
item 12).

### Local webhook forwarding

```
stripe listen --events "checkout.session.completed,customer.subscription.updated,customer.subscription.deleted" --forward-to localhost:3000/api/stripe/webhook
```

**Quote the event list on PowerShell.** Unquoted, PowerShell reads
`a,b,c` as an array and hands the CLI one argument made of all three names, which
the CLI rejects as a single invalid event name. The quotes keep it one
comma-separated string, which is what `--events` expects. The signing secret the
command prints is the CLI's own, differs from the deployment's, and belongs in
`.env.local` only. A run of this command is recorded in
`docs/eval/billing-webhook-evidence.md`.

---

## Known open items at first deploy

Not blockers, recorded so they are not rediscovered as surprises.

- **The model-provider account is not the operator's.** Its logging, retention and
  training settings cannot be verified, which is why `/privacy` says so plainly
  and why the demonstration notice exists. `docs/openrouter-processing.md`
  records the detail. Moving to an operator-owned OpenRouter key retires the
  notice, the `/privacy` paragraph, and gate finding `eu-2` together.
- **Erasure is account-level.** Career items are individually deletable; job
  postings, scans and generated versions go with the account. `/privacy` says so.
  Backlog `eu-8` — with registration open, its reopening condition has arrived.
- ~~`0 owned rows` after deletion is not witnessed.~~ **Closed** — owner-run on
  2026-09-04 and re-run for the billing ledger on 2026-10-12, both in
  `docs/eval/erasure-evidence.md`.
- **The deployment's total spend is unbounded, and the per-account caps are not
  race-safe.** Step 3; backlog `gp-1` and `gp-2`, owner-accepted.

---

## Deployment record — live and verified, 2026-09-04

The procedure above was carried out. This section records what was observed, and
nothing else: a check not listed here was not run, or its result is not recorded.

In checklist order, so the record can be walked against the steps above.

| Step | Check | Result |
|---|---|---|
| 11 | Registration closed | `/signup` shows the registration-closed copy and no form; an account cannot be created |
| 12 | Function region | Functions report **Frankfurt (`fra1`)** — the `vercel.json` setting was picked up |
| 14 | Dev routes unreachable | `/api/dev/coverage-probe` and `/api/dev/reindex` both answer **404** on the deployment |
| 16 | Security headers | All five present on the response: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` |
| 18 | Cookie flags | Every `sb-*` cookie is **HttpOnly**, **Secure**, **SameSite=Lax**, with `Max-Age` at the **30-day** window (2592000) rather than the library's 400-day default |
| 19 | One full pipeline run | Sign in → scan → generate → judge → export completed on the deployment, and `/quality` shows real rows for `parse_vacancy`, `embed`, `generate` and `judge` |
| 19a | Generation model | The `generate` step of that run was served by **`openai/gpt-5.4`**, with no fallback |

Row 19a is the one this record exists for. Every `generate` call from Phase 4
until SPEC v2.23 was answered by `google/gemini-2.5-flash` because the configured
model was refused by a guardrail on the provider workspace, and the only witness
was `llm_calls`. The check that matters is therefore not "a resume came back" but
"the requested model is the model that served it", which is what `fallback_used`
on that row reports — and on this run it says the configured model answered. That
closes the condition that hid four phases of fallback-written resumes. It is one
run on one deployment, not a series.

### What this record does not cover

- **Step 20 — no third-party script injected — was not run to a conclusion.** A
  console error of that shape WAS observed on member screens and traced to
  something this app does not ship (`docs/backlog.md`, "Phase 6 — from the first
  production deployment"), leaving two candidates: the platform toolbar and Speed
  Insights. Which one it is has not been confirmed, and Speed Insights being off
  is what backs `/privacy`'s "no analytics, no trackers". Unresolved, not passed.
- **`/quality` cost figures** are covered by the pipeline run above; no separate
  cost reconciliation was performed against the provider's own billing.
- **The provider-account settings** in `docs/openrouter-processing.md` — logging,
  retention, training and the guardrail — are properties of an account the
  operator does not control, and are not verified by anything here.
- **`IMPRESSUM_FILLED` was `false` at this deployment.** `/impressum` stated that
  the operator's details were not published. SPEC v3.0 sets the switch to `true`;
  step 21 is the check for the next deployment.
