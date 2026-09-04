# First deployment — ordered procedure

Deployment configuration record for CV Insight. It states what must be set, in
which dashboard, and **in what order**, for the first deployment of this
application.

The ordering is the substance of this document, not a presentation choice. The
deployment is reachable by anyone who has the URL — Vercel Password Protection is
a Pro feature and this project is on Hobby — so the only thing separating a
stranger from an account is **registration being closed in Supabase**. That
setting must therefore be in place *before* a URL exists, because there is no
safe window in which the site is live and registration is open.

Steps 1–3 happen before the first deploy. Steps 4–9 configure the project. Step
10 deploys. Steps 11–20 verify.

---

## Preconditions

| Setting | Where | Value |
|---|---|---|
| New user sign-ups | Supabase → Authentication → Providers → Email | **disabled** |
| Fluid compute | Vercel → Settings → Functions | **enabled** |
| Function region | `vercel.json` in this repository | `fra1` (already committed) |
| Node.js version | Vercel → Settings → General | **22.x** |
| Preview deployments | Vercel → Settings → Git | **disabled** |
| Server-only secrets | Vercel → Settings → Environment Variables | **Production environment only** |

---

## Before the first deploy

### 1. Run the suite while registration is still open

```
npm run check && npm test && npm run build
npm run test:e2e
```

**Do this first, and understand why it cannot be done later.** All four Playwright
specs create a throwaway account through the `/signup` form, and they talk to the
same Supabase project the deployment uses. The moment step 2 closes registration,
the suite can no longer create accounts and every spec that needs one fails —
not because the app broke, but because the fixture path did. Block H item 3 wants
a green suite; this is the last moment it can be produced without extra work.

If the suite must be run again after step 2, the options are a second Supabase
project for testing, or pre-created test accounts with the suite reusing them
instead of signing up. Neither is built today.

### 2. Close registration in Supabase

Supabase Dashboard → **Authentication** → **Sign In / Providers** → **Email** →
turn **off** "Allow new users to sign up". Save.

**This is the gate.** Not Vercel, not the middleware, not the `/signup` page.
Everything else is the app telling the truth about this setting; this setting is
what makes the statement true.

### 3. Create the accounts by hand

Supabase Dashboard → **Authentication** → **Users** → **Add user** / **Invite
user**, one per named person. Do this now rather than after deploying, so the
first person to open the link already has an account and nobody is tempted to
re-open registration to fix it.

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

Settings → **Environment Variables**. Four names. **Never paste a value into a
commit, a log, an issue or a chat message.**

| Name | Environments | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production | Public by design; inlined into the client bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Public by design; protected by RLS, not by secrecy |
| `OPENROUTER_API_KEY` | **Production only** | Metered spend |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production only** | Bypasses RLS entirely |

Use the **Sensitive** setting for the two server-only keys where offered, so the
value cannot be read back out of the dashboard afterwards.

**Do not set `NODE_ENV`.** Vercel sets it. Three separate behaviours depend on it
being exactly what the platform sets: the `/api/dev/*` 404 fence, the `secure`
flag on the session cookie, and the `/signup` registration-closed copy. Setting it
by hand is a way to break all three at once.

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

### 11. Registration really is closed

In a private window, open `https://<url>/signup`. It must show **"Registration is
closed"** and **no form**. Then attempt to register a throwaway address through
the API directly:

```
curl -i -X POST "https://<url>/api/career/items"     # expect 401, not 200
```

The decisive check is the Supabase one: try creating an account from the
dashboard's own sign-up flow or with a direct `signUp` call. **If an account can
be created, take the deployment down** — step 2 did not take effect.

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

### 20. Public pages

`https://<url>/privacy` and `https://<url>/impressum` must load in a private
window with no redirect. **`/impressum` will say the operator's details are not
published** until `IMPRESSUM_FILLED` in `src/lib/copy.ts` is set to `true` with a
real name and a working email address beside it. Do that before sharing the link
with anyone.

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
  Backlog `eu-8`.
- **`0 owned rows` after deletion is not witnessed by a test.** SPEC Block H
  item 3 records what it would take.
- **The Playwright suite cannot create accounts once step 2 is done.** See step 1.
