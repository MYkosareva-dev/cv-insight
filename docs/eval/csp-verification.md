# Content-Security-Policy — verification against a production build

**Status: VERIFIED.** The shipped policy was tested in a real browser against a
production build before it was committed, and the strict variant it replaced was
tested first so the relaxation is a measurement rather than a guess.

Run on 2026-09-04 (branch `phase-6-deploy`), Node v24.15.0, Next.js v16.3.4,
Chromium via the repository's own Playwright install. Closes gate findings `ns-2`
and `vs-5`.

## Why this file exists

The instruction that produced it: *a CSP that had to be relaxed later because
nobody tested it is worse than none.* A policy relaxed under pressure, after a
page has visibly broken on a deployment, gets relaxed by whatever makes the error
stop — which is how `'unsafe-inline'` ends up in `style-src` **and** `script-src`
**and** `connect-src` with nobody able to say which of the three was needed. The
point of measuring first is that every relaxation in the shipped policy can be
named, and the ones that were not needed are absent.

## What the app actually loads

The policy was built from this inventory, not from a template. Each line was
verified against the tree:

- **No external scripts, styles, fonts or images.** No CDN, no analytics package,
  no font host, no `public/` directory. Tailwind and `tw-animate-css` are bundled
  at build time. The only external host named anywhere in `src/` is
  `openrouter.ai`, reached from the server in `src/lib/openrouter/server.ts`.
- **The browser never contacts Supabase.** `createBrowserClient` is banned and
  `scripts/check.mjs` R11 enforces it, so the session is written server-side and
  every database read happens in a Server Component or a route handler. This is
  what lets `connect-src` be `'self'` rather than a Supabase origin.
- **Every client fetch is a relative `/api/*` path.** All seven.

## Experiment 1 — the strict policy, `script-src 'self'`

Built and served with no `'unsafe-inline'` in `script-src`. Five pages loaded in
Chromium with console and page errors collected.

```
=== /login === PROBLEMS  (body text 48 chars)
  CSP: Executing inline script violates the following Content Security Policy directive 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-OBTN3RiyCV4Bq7dFqZ5a2pAXjnCcCYeTJMO2I/LYKeo='), or a nonce ('nonce-...') is required t
  ERR: Error: Minified React error #412; visit https://react.dev/errors/412 for the full message

=== /signup === PROBLEMS  (body text 302 chars)
  CSP: Executing inline script violates ... 'script-src 'self''
  ERR: Error: Minified React error #412

=== /privacy === PROBLEMS  (body text 8333 chars)
  CSP: Executing inline script violates ... 'script-src 'self''
  ERR: Error: Minified React error #412

=== /impressum === PROBLEMS  (body text 494 chars)
  CSP: Executing inline script violates ... 'script-src 'self''
  ERR: Error: Minified React error #412

=== / === PROBLEMS  (body text 48 chars)
  CSP: Executing inline script violates ... 'script-src 'self''
  ERR: Error: Minified React error #412

RESULT: 5 page(s) with problems
```

**Every page broke, including the two static public ones.** Next.js App Router
streams the RSC payload through inline `<script>` tags; blocking them fails
hydration, which is what React error #412 is. The pages still show text, because
the server-rendered HTML arrives — which is exactly the trap. A policy this
strict does not produce a blank screen that someone notices immediately; it
produces pages that look right and do nothing, and `/privacy` at 8,333 characters
looks entirely healthy.

## Why a nonce was rejected rather than adopted

A nonce is the correct way to keep `script-src` strict, and it does not fit here.
It must be minted per request in middleware, and `/privacy` and `/impressum` are
deliberately EXCLUDED from the middleware matcher so they stay static — they are
the two pages a visitor with no account reads. Nonces would either leave those
two without one, which is experiment 1 again for exactly the pages that most need
to render, or drag them into the matcher and make them dynamic — undoing a
deliberate decision and buying a `getUser()` round trip on a public page.

## Experiment 2 — the shipped policy

```
=== /login === CLEAN  (body text 48 chars)
=== /signup === CLEAN  (body text 302 chars)
=== /privacy === CLEAN  (body text 8333 chars)
=== /impressum === CLEAN  (body text 494 chars)
=== / === CLEAN  (body text 48 chars)

RESULT: ALL PAGES CLEAN
```

`/login` reports the same 48 characters under both policies, which is the one
number in experiment 1 that could have been read as "fine". It is not a size
difference that separates a hydrated page from a dead one, so hydration was
proved directly instead — by driving the page:

```
body text  : "Sign in\nEmail\nPassword\nSign in\nPrivacy\nImpressum"
inputs     : 6
submit btn : 1
signup link: 0 (expect 0 in production)
privacy lnk: 1
after submit (client-side validation must have rendered copy):
   "Sign in\nEmail\n\nEnter a valid email address.\n\nPassword\n\nPassword must be at least 8 characters.\n\nSign in\nPrivacy\nImpressum"
HYDRATED   : YES - client validation ran
csp violations: 0 | page errors: 0 []
```

Filling the form with a bad address and a short password made the client-side Zod
copy appear. That copy is rendered by React in the browser, so it cannot appear
unless hydration succeeded — which is a positive proof of a working page rather
than the absence of an error message.

The same run incidentally confirms gate finding `vs-1`: **`signup link: 0`** — on
a production build `/login` no longer offers "No account? Create one".

## Header coverage

Checked on a static page, an API route and a member route, since `source:
'/:path*'` covering all three is a claim worth testing rather than assuming:

```
--- /privacy      --- /api/scan      --- /scan
Content-Security-Policy: ... frame-ancestors 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
```

All five headers on all three, including the 401 from `/api/scan` and the 307
redirect from `/scan`.

`/signup` was also confirmed to render the registration-closed copy with **zero
`<form>` elements** on a production build.

## What this does not cover

- **The authenticated shell was not loaded in the browser.** Every page behind
  the sign-in needs a session, and this run had no test-account credentials. The
  screens not exercised are `/scan`, `/career`, `/applications`, `/quality` and
  `/settings` — and `/settings` is the one that matters most, because the Radix
  dialog is the app's heaviest user of inline style attributes and the account
  deletion behind it is what `frame-ancestors` exists to protect. `style-src`
  carries `'unsafe-inline'` precisely so those attributes are permitted, so the
  expected result is clean; it is expected rather than measured. **Load
  `/settings` and open the deletion dialog on the first deployment** — it is step
  13 of the deploy checklist for this reason.
- **No `report-uri` / `report-to` endpoint.** Violations surface in the browser
  console and nowhere else. Collecting them would mean an external reporting
  service, which would be a third-party recipient of request metadata and would
  re-open the no-trackers decision on `/privacy` for very little.
- The probe was a throwaway script run from the repository root and deleted
  afterwards. It is not part of the test suite; nothing here runs in CI.
