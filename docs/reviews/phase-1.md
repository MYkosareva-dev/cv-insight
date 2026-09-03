# AI Code Review — phase-1-auth — 2026-09-03

**Verdict: REVISE** (no blockers; 4 majors, all small and mechanical)

Nothing in this branch exposes a secret, weakens an access decision, or ships a false statement to a user. The auth boundary, the service-role ordering, the cookie clamp and the matcher anchoring all hold up under adversarial testing — I tried to break them and could not. What I did break is `check.mjs` R12 and R13, in ways that matter because SPEC.md and a shipped source comment both assert an enforcement that provably does not exist. That is the CLAUDE.md "a configured mechanism is not a working one" failure applied to the rule written to prevent exactly that, so it goes down as REVISE rather than APPROVE — but the fixes are a widened regex, a stricter predicate, and one pasted test run.

Verified by execution, not by reading: `node scripts/check.mjs` → pass (13 rules); `npm test` → 71/71 pass; `npx tsc --noEmit` → clean.

---

## Blockers

None. Pass 1 (secrets) is clean and I did not read any `.env*` file — only variable names via `grep -o '^[A-Z_]*' .env.example`, which lists exactly `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Majors

### M1. R12 does not fire on the deletion dialog, contradicting a claim in shipped source

`src/lib/copy.ts:150-151` states, of the deletion dialog copy:

> *"Mechanically, a period here would trip check.mjs R12 while /privacy carries the fallback wording."*

It would not. R12's noun pattern is `audit\s+(?:records|logs?|trail|entries)` (`scripts/check.mjs:478`), and the dialog's own wording is **"Some authentication records are kept separately"** — no "audit". I mutated the shipped `copy.ts` to read *"Some authentication records are kept for 90 days — see"*, ran the real `check.mjs`, and it exited **0**.

The same hole is bigger on `/privacy`: rewording the canonical paragraph from "authentication audit records" to "authentication records" while adding "for 90 days" also exits **0**. The single most consequential privacy claim in the app is gated on one optional word, and the app's own preferred phrase for the same thing omits it.

The `SPEC.md:202` decision line repeats the same false claim. Fix the rule (`(?:audit|authentication)\s+(?:records|logs?|trail|entries)` at minimum), or correct both prose claims — but the two must not disagree.

### M2. R12's period matcher only knows the exact string `90 days`

`scripts/check.mjs:485-486` matches the literal `90 days`. `/privacy` rewritten to *"in our EU database on a 90-day retention schedule, deleted automatically when they age out"* exits **0** against the real script — a fully-formed, user-facing retention promise with no evidence file present.

The Playwright backstop on the dialog has the identical hole: `tests/e2e/auth.spec.ts:321` asserts `not.toContainText(/\d+\s*(?:days|months|years)/)`, which does not match `90-day` either (hyphen, singular). Suggest `\d+[-\s]*days?\b` in both places.

### M3. R12's evidence predicate is satisfied by a file that says the run did **not** succeed

`scripts/check.mjs:489` is `existsSync(evidence) && /succeeded/i.test(readFileSync(...))`. An evidence file reading *"The job has NOT succeeded yet: permission denied for table audit_log_entries."* unlocks the 90-day claim — verified, exit **0**.

`tests/unit/check-rules.test.mjs:121-127` is named *"R12 is not satisfied by a file that records a FAILED run"* and passes only because its fixture (`status: failed`) happens not to contain the substring. The test asserts something strictly weaker than its name, and it is the one test the file's own header singles out as the reason it exists. Anchor the predicate (e.g. `/^\s*status\s*[:|]\s*succeeded/im`) and add the negated-prose case as a fixture.

### M4. The phase's stated acceptance evidence has no record of ever having run

SPEC.md:650 is unambiguous: *"Manual 'live verification' is not accepted as evidence; the spec run is."* `tests/e2e/auth.spec.ts` exists and is well built, but:

- `test:e2e` is not in `prebuild` (correctly — it needs a live Supabase project and creates real users), so nothing runs it automatically;
- `docs/eval/` contains only `.gitkeep`; `test-results/` and `playwright-report/` are gitignored;
- there is no hand-over file in the diff recording a green run.

By this branch's own R12 standard, a spec file is `cron.job`, not `cron.job_run_details`. I deliberately did not run it (it creates real accounts and touches a shared project). Before merge, paste the run summary into the hand-over or `docs/eval/`. This is the cheapest of the four fixes and the one the phase's acceptance actually rests on.

---

## Minors

### N1. R13 is case-insensitive on Windows, so it can pass locally and fail on Vercel
`resolvesInTree` (`scripts/check.mjs:531-536`) uses `existsSync`, which is case-insensitive on NTFS. A doc naming `` `src/lib/Supabase/Server.ts` `` exits 0 here and would exit 1 on Linux. Since `check` is `prebuild`, that is a green local tree and a red deploy. Resolve by reading the parent directory and comparing entry names exactly.

### N2. R13 only sees backticked paths
`scripts/check.mjs:546-548` requires backticks. The same annotation written `**lib/supabase/env.ts**` or bare passes — verified, exit 0. The rule was created to close a *class* of defect (an annotation confidently describing a module that has never existed) and closes only its most common typographic form. Worth stating as a known limit in the header alongside the others, since the header currently frames R13 as having converted the problem from a keyword sweep into a property.

### N3. R13 vs R12 collide on the evidence file path
Any `docs/*.md` shelf note that backticks `` `docs/eval/audit-retention-evidence.md` `` fails R13, because R12's whole design requires that file to be absent. Confirmed: one R13 hit. No shelf doc does this today, but the next agent documenting R12 on the shelf will hit it and the obvious "fix" is to create an empty evidence file — which is precisely the touch-file attack R12 exists to stop. Add the path to R13's exemptions, or note it in the R12 header.

### N4. `stripComments` is applied to markdown, where `//` is not a comment
`scripts/check.mjs:139-143`, reached via `scanLines` at :158. A `docs/*.md` line containing a bare `//` blanks everything after it, hiding a stale path from R13 — verified, exit 0. (`https://` is safe: the regex requires the preceding char not be `:` — that part was thought through.) Skip comment-stripping for `.md`, or restrict it to fenced code blocks.

### N5. R7/R10/R11a scope is `src/` + `tests/` only
`isCode` at `scripts/check.mjs:180-183`. `scripts/`, `playwright.config.ts` and any future root-level tooling are walked but not scanned, so a seed or maintenance script reading `SUPABASE_SERVICE_ROLE_KEY` passes R10. CLAUDE.md says the key "is READ in exactly one module"; the rule enforces that only within two directories. `docs/supabase-api-keys.md:44-46` already documents this scope accurately — so the annotation is more honest than the rule. Either widen `isCode` for R10 or narrow the CLAUDE.md claim.

### N6. R11b/R11d pass vacuously if a pinned file disappears
Both are `scanFiles` over `SERVER_CLIENT_FILES`; deleting `src/middleware.ts` makes them scan nothing and pass. Renaming it (e.g. to `proxy.ts`, which SPEC.md:656 notes Next 16 is pushing toward) is caught — R11a fires on the new file. Outright deletion is caught only by `tests/unit/middleware-matcher.test.mjs`, which reads the file and would ENOENT. Covered, but by accident rather than by the rule; an existence assertion in R11b would make it deliberate.

### N7. Deletion-failure copy is inline, SPEC says toast
`src/components/delete-account-dialog.tsx:54,107` renders the failure as an inline `<p role="alert">`; `SPEC.md:599` specifies `Toast "Deletion failed — contact support."` The copy is verbatim-correct and inline is arguably the better choice behind a modal — but per CLAUDE.md "no undeclared deviations", either the code or that SPEC row should move.

### N8. Three GoTrue round trips to render `/settings`
`getUser()` (`src/lib/supabase/server.ts:54`) is not wrapped in React `cache()`, and it is called by middleware, by `src/app/(app)/layout.tsx:17` and again by `src/app/(app)/settings/page.tsx:16`. Each is a network validation call. `cache()` collapses the last two per request; middleware is a separate runtime and stays. Not a correctness bug (`getUser()` is the right call, and duplicating it is the safe direction), just latency and needless Auth rate-limit pressure.

### N9. `E2E_BASE_URL` is a new env var not listed in `.env.example`
`playwright.config.ts:19,26`. Not a secret, but the convention in CLAUDE.md is names-in-the-template.

### N10. Loading state is a label swap, not a spinner
`src/components/auth-form.tsx:151`. `SPEC.md:548` says "button spinner + disabled". Disabled + `aria-busy` + pending label is present; the spinner glyph is not.

### N11. `README.md` known-limitations section never written
`SPEC.md:643` cuts password reset and says it is "noted in README known-limitations". README is still the four-line stub. Password reset is an auth concern, so this branch is where that note belongs.

---

## Nits

- `scripts/check.mjs:568` reports `${failures.length} rule(s) violated` — that counts failure *groups*; R4 and R11 each contribute several.
- `src/components/auth-form.tsx:98` switches `autoComplete` by comparing `submitLabel === AUTH.signIn`. Behaviour-by-copy-string; an explicit `mode` prop would survive a copy edit.
- `supabase/migrations/002_audit_retention.sql:4` runs `create extension if not exists pg_cron` with no target schema while the comment two lines up says the extension must be enabled via the dashboard. Harmless today (002 is unapplied), but it lands `pg_cron` in the default schema, which is the same class the 001 linter-deferral note calls out.
- `src/lib/copy.ts` — `AUTH.signInUnavailable` is the default branch for *any* unrecognised GoTrue code. Correct per SPEC's four outcomes; worth remembering it also swallows genuinely new codes, so add cases as GoTrue grows rather than assuming coverage.

---

## What I verified clean

**`src/app/api/account/route.ts`** — ordering is exactly right. `requireApiUser()` → `getUser()` → 401 before `createAdminClient()` is even constructed; the handler takes **no `Request` parameter**, so there is no body, no param and no header from which an id could be forged; `userId` comes only from the verified session. `deleteUser(id)` is a hard delete (no `shouldSoftDelete`), and the best-effort `signOut` sits after the point of no return inside its own try/catch, so a network failure there cannot surface as "Deletion failed" for an account that is already gone. Error responses use the Block D shape with `SERVER_ERROR`/500 and a generic message; the two `console.error` calls log the variable *name* and the GoTrue message, never a key value.

**`src/lib/supabase/cookie-options.ts`** — the `cappedMaxAge` rationale is not defensive folklore; I read `node_modules/@supabase/ssr/dist/main/cookies.js:325-329` at the installed version 0.8.0 and it does exactly what the comment says: `{...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge: DEFAULT_COOKIE_OPTIONS.maxAge}`, discarding our 30 days for its 400. `httpOnly`, `secure` and `sameSite` *do* survive the spread, so the adapter clamp is the only thing that needs to exist and it is in both adapters. `Math.min` preserves the library's `maxAge: 0` deletion path (`removeCookieOptions` at :320-324), so sign-out and deletion still clear the cookie — asserted directly in `tests/unit/cookie-options.test.mjs`.

**`src/middleware.ts`** — every exclusion is segment-anchored; `/apifoo`, `/privacyleak`, `/applications/x.png` and `/privacy/export` all reach the fence, and `tests/unit/middleware-matcher.test.mjs` extracts the pattern *from the source file* rather than copying it, so editing the real matcher cannot leave the test green. Both redirect branches go through `redirectTo()`, which copies `supabaseResponse.cookies.getAll()` onto the redirect — the rotated-refresh-token drop is genuinely closed. `getUser()` is called immediately after `createServerClient` with nothing in between. No user-controlled redirect target anywhere.

**Auth boundary generally** — `getSession()` appears in `src/` only inside comments (R9 confirmed live-firing by fixture); `createBrowserClient` appears nowhere and `src/lib/supabase/client.ts` is deleted; `requireApiUser()` is the API twin and middleware correctly excludes `/api` so handlers answer 401 JSON. The `(app)` layout is a genuine second server-side fence.

**Pass 3** — `credentialsSchema` runs on the server in `src/lib/auth/actions.ts` (the gate) *and* on the client (the convenience), same schema, messages sourced from `lib/copy.ts` so copy drift breaks a test. `DELETE /api/account` takes no input, so there is nothing to validate. Sign-in branches on `error.code`, never HTTP status, and preserves all four outcomes without collapsing "we could not check" into "you were wrong" — the auth-domain analogue of the three-retrieval-outcomes rule. No LLM calls in this phase, so `llm_calls` and B1–B10 are not exercised.

**Pass 4** — `tsc --noEmit` clean, no `any`, no `dangerouslySetInnerHTML` in app code, no dead modules. New deps (`@radix-ui/react-dialog`, `sonner`, `@playwright/test`) are all used. `FlashToast` maps `?notice=` through a `hasOwnProperty` allow-list and renders `null` for unknown keys, so a crafted URL cannot put words in the app's voice.

**Test quality** — the two unit suites do assert what their names claim, with one exception (M3). `middleware-matcher.test.mjs` and `cookie-options.test.mjs` would both catch their regressions. `check-rules.test.mjs` composing the banned tokens (`'get' + 'Session('`) so the fixture does not fail the build it is asserting about is a nice touch. The e2e spec covers both client-validation paths, asserts `Set-Cookie` attributes on the wire *and* as stored by the browser, and tears down through the app's own deletion flow so cleanup doubles as the US-6 evidence.

---

**Checked:** secrets ✓ · RLS ✓ (002 adds no policy; append-only tables untouched; `documents` still has no UPDATE) · chokepoints ✓ (`node scripts/check.mjs` → "check passed (13 rules)") · zod ✓ · llm_calls logging n/a (no model calls in this phase)
