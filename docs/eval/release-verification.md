# Release verification

- **Date:** 2026-10-13
- **Commit:** `main` at `5ad88e4120c5208ac4eb30462759636e33fe4d22` (merge of PR #6, `feature/dependency-patch`)
- **Deployment:** https://cv-insight-lime.vercel.app

This is the final evidence record for the release. Each line says where it came from: **owner run** means the owner performed the step and reported the result, and **re-observed** means the step was repeated on 2026-10-13 and the output is quoted here.

## (a) Deployment check

| Check | Result | Source |
|---|---|---|
| `/signup` shows the sign-up form | `200`; the page carries one `<form>` with an `email` and a `password` input | owner run; re-observed |
| A new account registers without email confirmation | `public-test@example.com` registered and was signed in with no confirmation step | owner run |
| A signed-out visitor to `/scan` is sent to `/login` | `307`, `Location: https://cv-insight-lime.vercel.app/login` | owner run; re-observed |

Re-observation, unauthenticated `GET` requests with no cookies:

```
/signup -> 200   1 <form   1 type="email"   1 type="password"
/scan   -> 307   location=https://cv-insight-lime.vercel.app/login
/login  -> 200   1 <form   1 type="email"   1 type="password"
```

## (b) Fresh clone

Owner run, from a fresh clone of `main` at `5ad88e4`:

| Step | Result |
|---|---|
| `npm ci` | 431 packages installed |
| `npm run check` | passed, 13 rules |
| `npm test` | 491 unit tests, all pass |
| `next build` | succeeded, 28 routes |

Re-observed on 2026-10-13 on branch `feature/final-evidence`, in the working tree between commits `dcce716` and `f963fe1` — `5ad88e4` plus documentation changes only: `npm run check` passed (13 rules) and `npm test` reported `tests 491 · pass 491 · fail 0`.

**Not done: the migrations were NOT re-run against a fresh Supabase project for this release.** The last run from empty is recorded in `docs/eval/fresh-clone-verification.md` and covers `001`–`005`; its section for `001`–`007` is prepared and has not been run. This release therefore has no from-empty evidence for `006_subscription_events.sql` or `007_agentic_step.sql`.

## (c) Dependency audit

`npm audit --omit=dev` on `5ad88e4`, after `feature/dependency-patch` was merged — re-observed:

```
found 0 vulnerabilities
```

The full audit, including devDependencies, reports one dev-only chain (backlog `dp-1`); see the scan below.

## (d) Security scan

`docs/eval/security-scan.md` — the `/security-scan` run on the same commit: 0 critical, 0 high, 0 medium, 2 low, 5 informational, with the owner's decision on each finding in its section 7.
