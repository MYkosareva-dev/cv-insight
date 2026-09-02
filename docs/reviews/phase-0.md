# AI Code Review — `phase-0-scaffold` — 2026-09-02

## Summary

Phase 0 is a scaffold-only branch: 33 commits, 53 files, ~9.7k insertions (of which ~7.1k is `package-lock.json`). It lands the Next.js 16 / Tailwind v4 toolchain, the Supabase server and browser clients, route-protecting middleware, the two OpenRouter gate stubs plus the connection stub, one DAL per table, prompts/scoring/copy/export modules, placeholder pages for every route in the SPEC Block A routes table, `supabase/migrations/001_init.sql` (unapplied), a 7-rule repo linter in `scripts/check.mjs`, and zero-dependency unit tests for rule B1.

I judged the boundaries and the things that are actually implemented, not the deliberately absent features. `src/app/api/`, Playwright, and the full README are documented `> Decision:` deferrals in SPEC.md (lines 571–572, 41–42, 54–55) and are **not** reported as defects.

I verified locally: `node scripts/check.mjs` passes (7 rules), `npm test` passes (12/12), `npx tsc --noEmit` is clean, `npx eslint` is clean, and `npm run build` succeeds — including the `prebuild` chain — producing `/privacy`, `/login`, `/signup` as static and every member route as dynamic. **No secrets are exposed anywhere, and no `.env*` file was opened during this review.**

## Verdict

**APPROVE** — merge is safe. There are no blockers and no live security defect. Two **Major** findings are gaps in the *enforcement* layer rather than in the shipped code; neither can bite in Phase 0 (there is no `next.config.ts` env usage, no `getSession()`, no `Buffer.from` in the tree today), but both must be closed before Phase 2 lands the first route handler, because that is the phase in which they become reachable.

---

## Blockers

None.

- No secret value appears in any tracked file, log string, error message, or commit message. `git log main..HEAD` mentions secret *names* only (e.g. the R7 commit body).
- No `NEXT_PUBLIC_` prefix on either server secret in source or in `.env.example` (`.env.example:8-9` lists the two server-only names under an explicit "never prefix these" comment).
- `.gitignore:12-16` covers `/.env` and `/.env.*` with `!/.env.example` re-included; `git check-ignore -v .env.local` confirms the ignore, as does the same for `WORKLOG.md` (`.gitignore:18`), which I did not read.
- No OpenRouter fetch anywhere: `grep -rn "fetch(" src` returns nothing.

---

## Majors

### M1 — `check.mjs` R5/R6/R7 do not scan root-level config; a secret read in `next.config.ts` passes all 7 rules
`scripts/check.mjs:136-139`

```js
const isCode = (abs) => {
  const r = rel(abs);
  return (r.startsWith('src/') || r.startsWith('tests/')) && CODE_EXT.test(r);
};
```

`isCode` is the predicate for R1, R2, R5, R6 and R7 (`scripts/check.mjs:181, 189, 237, 248, 302`). Root-level `.ts`/`.mjs` files and `scripts/` are outside it. I verified empirically: a file at the repo root containing `export const x = process.env.OPENROUTER_API_KEY;` produces **`check passed (7 rules)`**.

This matters specifically because `next.config.ts` is the one file in a Next.js repo that can copy a server secret into the *client* bundle without any `NEXT_PUBLIC_` prefix, via `env: { … }` (or the legacy `publicRuntimeConfig`). Such a line is invisible to R4 (no `NEXT_PUBLIC_` token) and invisible to R7 (not under `src/`). The header comment at `scripts/check.mjs:18` states R7 as "reading a secret from process.env without `import 'server-only'`", and the pass banner at line 323 claims "every secret reader imports 'server-only'" — both are broader than what is actually checked.

The naive fix (widen `isCode`) is wrong: `next.config.ts` cannot meaningfully satisfy a `server-only` import, so it would be a false positive with no correct remedy — exactly the failure mode the R7 comment at lines 260-271 warns about. The right shape is a separate rule: **any reference to a `SECRET_NAMES` entry, or to `env:` / `publicRuntimeConfig`, inside `next.config.*` is a FAIL, unconditionally.** Add `scripts/` and root `.ts`/`.mjs` to R5's scan at the same time, so a hand-rolled `openrouter.ai` fetch in a build script is caught too.

### M2 — no rule enforces the `getSession()` prohibition
`scripts/check.mjs` (rule set), against CLAUDE.md Authentication rule 2

CLAUDE.md states that `getSession()` "does not validate the token — using it for any access decision is prohibited." That is a non-negotiable, it is exactly the class of invariant `scripts/check.mjs:3` says it exists for ("repo invariants that a type-checker cannot see"), and it is the cheapest possible grep — yet it is not among the seven rules.

The current tree is clean: `getSession` appears only in two explanatory comments (`src/lib/supabase/server.ts:11`, `src/app/(app)/layout.tsx:8`), and `stripComments()` (`scripts/check.mjs:95-99`) already removes those before matching, so an R8 of the form "`.auth.getSession(` anywhere under `src/`" would pass today with no exemption list. Phase 2 is when route handlers start making access decisions, and it is the phase where a copy-paste from generic Supabase docs — which use `getSession()` freely — will land. The guard should exist before that code does, not after.

---

## Minors

### m1 — R4 scans `docs/**/*.md`, so this very review file can fail the build
`scripts/check.mjs:205-214` (predicate is `!rel(abs).startsWith('scripts/')`, and `.md` is in `SOURCE_EXT` at line 68)

Verified: a one-line markdown file in `docs/reviews/` containing the public-prefixed form of the OpenRouter key name produces `FAIL: R4 … docs/reviews/_tmp_probe.md:1`. Because `check` is wired as `prebuild` (`package.json:7`), any review report, ADR or README that *quotes the forbidden literal in order to warn about it* breaks `npm run build` and the Vercel deploy. I have deliberately avoided writing that literal in this report, which is itself evidence of the constraint being wrong.

Fix: restrict R4a/R4b to code plus `.env.example` (drop `.md` from the R4 predicate), or add a negated-context allowance for prose. R4's real job is source and the env template; SPEC.md at line 723 already documents the DoD grep as `src/`-scoped.

### m2 — R1 will false-positive on `Buffer.from(` in Phase 2
`scripts/check.mjs:143`

```js
const NON_DB_RECEIVERS = new Set(['Array', 'String']);
```

Verified: `return Buffer.from(b);` in a file under `src/` produces `FAIL: R1 .from( outside lib/db`. The doc comment at line 142 ("Only `.from` has any") suggests the safe-receiver set was thought complete, but `Buffer.from(await file.arrayBuffer())` is the standard idiom for the PDF upload in SPEC Block D endpoint #1, and `Uint8Array.from` is likely in `lib/docx.ts`. The rule fails closed, which is the right default, but a developer meeting it mid-phase is tempted to reach for the DAL allowlist instead. Add `Buffer`, `Uint8Array`, `Object`, `Date`, `Set`, `Map` to `NON_DB_RECEIVERS` now, while the change is uncontroversial.

### m3 — SPEC Block H DoD #6 still contradicts the least-privilege policy matrix
`SPEC.md:724`

> "Every table in `001_init.sql` has RLS enabled + **4 owner policies**"

Block C was amended in this diff to state least-privilege explicitly (`supabase/migrations/001_init.sql:97-101`), and CLAUDE.md's matrix gives `documents` 3 policies, `resume_versions` and `llm_calls` 2 each. As written, DoD #6 is unsatisfiable and instructs the `supabase-security` subagent — which runs against this checklist after the database phase — to demand policies that CLAUDE.md forbids adding. SPEC.md is part of this diff and was revised across four rounds; this line was missed. Reword to "RLS enabled on every table, with exactly the owner-scoped policies in the CLAUDE.md matrix and no others."

### m4 — no `error.tsx` / `global-error.tsx` boundary anywhere
`src/app/` (absent)

Every DAL mutation and every gate function currently throws (`src/lib/db/careerItems.ts:52`, `src/lib/chat.ts:60`, `src/lib/retrieval.ts:61`, and eight more). An uncaught throw in a Server Component today renders Next's stock error page, not app copy. SPEC Block E's three-state requirement is per-screen and correctly deferred, but an app-level error boundary is a *scaffold* concern in the same way `not-found.tsx` is — and `not-found.tsx` was included (`src/app/not-found.tsx`). Add at least `src/app/error.tsx` using `RESULT`/`APPLICATIONS` copy from `src/lib/copy.ts`.

### m5 — R4b (unknown `NEXT_PUBLIC_` variable) scans a narrower set than R4a
`scripts/check.mjs:217-222`

R4b's predicate is `r.startsWith('src/') || r === ENV_TEMPLATE`. A stray public variable introduced in `next.config.ts`, a script, or a future `vercel.json`-adjacent `.mjs` is not seen. Same root cause as M1; fixing them together is one change.

### m6 — migration hardening the Supabase linter will flag
`supabase/migrations/001_init.sql:1-2, 102-126, 129-138`

The file is verbatim from SPEC Block C and the RLS matrix is correct — enabled on all six tables, owner-scoped `auth.uid() = user_id`, no UPDATE on `documents`, append-only `resume_versions` and `llm_calls`, `match_documents` left `security invoker` with the `auth.uid()` filter inside the body. Four hardening items are cheap now, before the migration is ever applied:

1. `create extension if not exists vector;` / `moddatetime;` (lines 1-2) install into the default schema rather than `extensions`; Supabase flags `extension_in_public`. Prefer `with schema extensions`.
2. `match_documents` (line 129) has a mutable `search_path`. For a `security invoker` function the exposure is small, and pinning it blocks SQL-function inlining and therefore HNSW index usage — so if you keep it mutable, record that tradeoff as a `> Decision:` line so the `supabase-security` gate does not re-litigate it.
3. Policies are created without `to authenticated` (lines 118-122), so they are evaluated for `anon` as well. Harmless (`auth.uid()` is null) but noisy in the linter and one word to fix in the `format()` templates.
4. `auth.uid()` is re-evaluated per row; Supabase's documented RLS guidance is `(select auth.uid())`. With 500 `documents` rows per user the cost is small but real on the vector path.

Note for the record: the cascade reasoning in CLAUDE.md is correct — PostgreSQL runs FK referential actions as the table owner with RLS bypassed absent `FORCE ROW LEVEL SECURITY`, so `on delete cascade`/`set null` still clean up children despite the missing DELETE policies.

### m7 — one silent zero survives in `costUsdMicro`
`src/lib/openrouter/server.ts:82-97`

The `cost_known` mechanism is a good addition and correctly threaded through `ConnectionResult` (line 70), `LlmCall` (`src/lib/db/types.ts:113`) and the migration (`001_init.sql:89`). But the arithmetic is `round(tokensIn × priceIn + tokensOut × priceOut)` in micro-USD, and embeddings price at `0.02` USD/Mtok (line 50) — so any embed call under 25 input tokens rounds to `cost_usd_micro = 0` with `cost_known = true`, which is precisely the "this call was free" reading the commit `5bf8f71` set out to eliminate. Either document the sub-micro floor next to line 95 or accumulate embedding cost per batch rather than per call.

### m8 — the two most testable pure functions outside `scoring.ts` are untested
`tests/unit/scoring.test.mjs` (12 tests, all on `scoring.ts`)

`costUsdMicro` (`src/lib/openrouter/server.ts:82`) is the function DoD #7 depends on ("a nonzero integer `cost_usd_micro`"), and `exportFilename` (`src/lib/docx.ts:13`) is pure string logic with sharp edges (see n4). Both are zero-I/O and would cost ~15 lines each in the existing harness. The `scoring.ts` tests themselves are genuinely good — the B1a cases at lines 32-39 (`C++` ✓, `ABC++` ✗, `Java` vs `JavaScript`) test the exact asymmetric-boundary bug the rule exists to prevent, and line 139-146 pins the B1b contract that `matchScore` returns `0` while `insufficientSignal` returns `true`.

---

## Nits

- **n1 — dead code.** `src/components/ui/button.tsx` is not imported anywhere (`grep -rn "<Button\|components/ui/button" src` → nothing), and `class-variance-authority` in `package.json:24` exists only for it. Either use it in the auth placeholders or drop both until Phase 1. Positively: `unpdf` and `docx` were correctly *not* added ahead of use.
- **n2 — third `getUser()` round trip on `/`.** `src/app/page.tsx:6-8` calls `getUser()` even though `src/middleware.ts:51` has already redirected any visitor before the page runs; for a member it is a second auth call on the way to a third in `src/app/(app)/layout.tsx:12`. Defense in depth is right for the `(app)` layout; on `/` the redirect could read the middleware's outcome instead.
- **n3 — `import 'server-only'` in a types-only module.** `src/lib/db/types.ts:1` protects no secret, and a future client component that writes `import { Application }` rather than `import type` will get a confusing server-only build error rather than a type error. Harmless today; worth a comment stating the intent.
- **n4 — `exportFilename` drops non-ASCII names.** `src/lib/docx.ts:18-23` uses `\w` without the `u` flag, so after NFKD a Cyrillic or CJK name is stripped entirely and the filename collapses to `CV_<Company>_<Role>.docx`. Given the persona in SPEC Block B works across EU/RU material, this is plausible in practice. Also unbounded in length.
- **n5 — R6 does not catch re-export laundering.** `scripts/check.mjs:243-258` matches imports *of* the connection module, but `export * from '@/lib/openrouter/server'` inside `src/lib/chat.ts` (an allowed file) would re-expose `chatCompletion` to every importer of the gate, unauthenticated. Not done today; belongs in the KNOWN LIMITS block at lines 25-37 if not enforced.
- **n6 — middleware matcher exclusions are prefix-, not segment-scoped.** `src/middleware.ts:81`: `(?!api|privacy|…)` also excludes `/apifoo` and `/privacy-anything`. No such route exists and `src/app/(app)/layout.tsx:12` is the real fence for pages, but `api(?:/|$)` and `privacy(?:/|$)` cost nothing. The `[.]` escaping discipline in the same regex (explained at lines 78-79) is a nice touch.
- **n7 — the Next 16 middleware deprecation warning prints on every build** (`⚠ The "middleware" file convention is deprecated`). The decision to keep the filename is documented at `SPEC.md:571` and I agree with it; just note the warning is now permanent build noise until it is revisited.
- **n8 — no rule for `dangerouslySetInnerHTML`.** SPEC Block F and CLAUDE.md both forbid it; it is a one-line R9 in the same style as R5.
- **n9 — `walk()` will throw on a symlink loop or an unreadable directory** (`scripts/check.mjs:71-88`, unguarded `statSync`/`readdirSync`). A crash reads as a build failure, so it fails closed — but with a stack trace rather than a rule name.

---

## What I verified clean

**Secrets and exposure.** No `.env*` file was read; I inspected names only, via `.env.example` and `git check-ignore`. No secret value appears in any tracked file, comment, log line, error string, or commit message. `src/lib/supabase/client.ts:14-15` reads exactly the two public variables and nothing else. `SUPABASE_SERVICE_ROLE_KEY` is referenced nowhere in `src/` yet, consistent with CLAUDE.md's "exactly one module" rule. Both server secrets are present in `.env.example` as names only.

**Server/client boundary.** Every module that could touch a secret or the database imports `server-only`: `src/lib/openrouter/server.ts:1`, `src/lib/chat.ts:1`, `src/lib/retrieval.ts:1`, `src/lib/prompts.ts:1`, `src/lib/docx.ts:1`, `src/lib/auth/requireApiUser.ts:1`, `src/lib/supabase/server.ts:1`, and all six DALs plus `types.ts`. The only two `'use client'` files are `src/lib/supabase/client.ts` and `src/components/app-sidebar.tsx`, neither of which reads a secret or calls `.from()`. `src/lib/copy.ts` is correctly *not* server-only, so client components and tests share one copy source.

**Session verification.** `getUser()` everywhere, `getSession()` nowhere outside two warning comments. Three independent fences: `src/middleware.ts:45-56` (with no code between `createServerClient` and `getUser()`, per the documented cookie-refresh hazard at lines 42-44), `src/app/(app)/layout.tsx:12-13`, and `src/lib/auth/requireApiUser.ts:23-26` for the route handlers that arrive in Phase 2. The build output confirms every member route is `ƒ` (dynamic) and only `/login`, `/signup`, `/privacy`, `/_not-found` are static — so there is no prerendered member page to flash data.

**Gate chokepoint.** `src/lib/openrouter/server.ts` is imported by exactly two files, both gates, and both call `requireUser()` as their first statement before touching the connection (`src/lib/chat.ts:58`, `src/lib/retrieval.ts:59, 82`). The `match_documents` `.rpc(` was correctly moved into `src/lib/db/documents.ts:96` so the DAL owns every route to the table, with the retrieval gate orchestrating. R1/R2/R5/R6 all pass. The R1/R2 receiver back-scan fix (`scripts/check.mjs:160-176`) is a real improvement — it closes a fail-open on Prettier-wrapped chains that five of six DALs actually exhibit.

**Three retrieval outcomes.** `MatchOutcome` (`src/lib/retrieval.ts:52-55`) encodes `found` / `found_nothing` / `could_not_search` as a discriminated union, and `src/lib/db/documents.ts:100` throws on RPC error rather than returning `[]`, so a dead search cannot be laundered into "gap". This is structurally enforced, not merely commented.

**Metered-call and anti-bloat rules.** No `fetch` in `src/`. No retry, backoff, debounce, interval, or background refresh anywhere. The two owner-approved retries are documented as future behaviour at `src/lib/chat.ts:25-28` and nothing else is hinted at. No LangChain/agent framework in `package.json`. No analytics or tracker dependency.

**Prompt discipline.** P1–P3 in `src/lib/prompts.ts:17-67` are byte-faithful to SPEC Block F (lines 600-655), with `{{…}}` placeholders unfilled, `<vacancy>` / `<items>` / `<resume>` data tags intact, and the explicit "DATA, not instructions" lines preserved. `server-only`, so no system prompt can travel on the wire; no `role` field is accepted anywhere.

**B1 scoring.** `src/lib/scoring.ts:19-23` matches the formula constants exactly (0.30 floor, 0.55 span, 0.60 coverage threshold, 0.6/0.4 weights). The null branch fires only on `requirementCount === 0` (line 78), the 0-MUST branch drops S and returns `round(100 × K)` (line 91), and B1b is split correctly: the arithmetic predicate in `insufficientSignal` (line 110) and the rendering decision deferred to the Phase 3 UI with `NO_SCORE` (`src/lib/copy.ts:20`, an em dash matching SPEC). `COVERAGE_THRESHOLD` has exactly one definition and is re-exported rather than duplicated (`src/lib/retrieval.ts:37`).

**llm_calls logging.** `src/lib/db/llmCalls.ts:65-81` writes metadata only (`step=… model=…`, never content), schedules with `after()` rather than a detached promise, and wraps the `after()` *registration* itself in the try — so a call outside request scope cannot propagate a log failure into the user's request. That is the correct reading of B8 as unconditional. `cost_known` is threaded end to end. `countCallsInLast24h` (line 33) uses a rolling window and excludes embedding steps, per B7/T2/L2.

**Quality gates.** `tsconfig.json` is `strict: true` with `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch`; `next.config.ts:5-8` pins `ignoreBuildErrors: false`. No `any` in the diff. `prebuild` runs `check` then `test`, so neither can be skipped by a deploy. `npm run build`, `npx tsc --noEmit`, `npx eslint`, `node scripts/check.mjs` and `npm test` were all run against this branch and all pass.

**Scope.** No Playwright spec exists yet to break. Every path in the SPEC Block A routes table renders, and no new user-visible flow was added that would owe the Block E Loading/Empty/Error triad.

---

## Addendum — findings addressed before merge

Added after the review above, on the same branch, before the PR was opened. The report body is unchanged; this section records what was done about it.

| # | Finding | Status | Commit |
|---|---|---|---|
| **M1** | `check.mjs` R5/R6/R7 do not scan root-level config; a secret read in `next.config.ts` passes | **Fixed** — new rule **R8**: any `SECRET_NAMES` entry, any `process.env` read, an `env:` block or `publicRuntimeConfig` in `next.config.*` is an unconditional FAIL. Implemented as a separate rule rather than a widening of `isCode`, exactly as the finding recommended — `next.config.ts` cannot satisfy `import 'server-only'`, so widening R7 would have been a false positive with no correct remedy. | `a09a5d7` |
| **M2** | No rule enforces the `getSession()` prohibition | **Fixed** — new rule **R9**: `getSession(` anywhere under `src/`, no exemptions. The two existing mentions are comments, which `stripComments()` already removes, so the rule cost nothing to adopt. In place before Phase 1 auth. | `a09a5d7` |
| **m1** | R4 scans `docs/**/*.md`, so a review report quoting the forbidden literal breaks the build | **Fixed** — R4a/R4b now exempt `docs/`. Code and `.env.example` are still scanned, which is R4's actual job. This addendum could not otherwise have been written. | `a09a5d7` |
| **m2** | R1 will false-positive on `Buffer.from(` in Phase 2 | **Fixed** — `NON_DB_RECEIVERS` extended to `Array`, `Buffer`, `Uint8Array`, `Object`, `Date`, `Set`, `Map`. Verified against both the single-line and Prettier-wrapped forms. | `a09a5d7` |
| **m3** | SPEC Block H DoD #6 contradicts the least-privilege policy matrix | **Fixed by the owner** — DoD #6 now reads "owner-scoped policies EXACTLY per the least-privilege matrix in Block C — no more, no fewer", with the per-table matrix inline. | `e475bf8` |
| **m4** | No `error.tsx` / `global-error.tsx` boundary | **Fixed** — `src/app/error.tsx` added, copy in `src/lib/copy.ts`. The error MESSAGE is deliberately never rendered or logged (it can carry resume or vacancy text); only Next's server-side `digest` is shown, so a report stays correlatable without exposing content. | `51a7fd0` |
| **m7** | Sub-micro rounding: an embed under ~25 tokens gives `cost_usd_micro = 0` with `cost_known = true` | **Fixed** — `Math.ceil` instead of `Math.round`. A priced call now costs at least 1 micro-USD, so a stored `0` means the call genuinely consumed no tokens. | `2c02d50` |
| **n4** | `exportFilename` drops non-ASCII names and is unbounded in length | **Fixed** — only filesystem-unsafe and non-printable characters are stripped, NFC normalisation, each part bounded to 40 chars. Müller, Мария Косарева and 田中 太郎 all survive intact. The function moved to `src/lib/utils.ts` (Block A: "shared helpers (cn, formatting)") because a `server-only` guard meant for secrets should not be what makes a pure function untestable; `docx.ts` re-exports it. Five tests added. | `096ea2f` |
| **m6** | Migration hardening the Supabase linter will flag | **Deferred by SPEC decision** — recorded in Block C: extensions schema, `SET search_path`, `to authenticated` and `(select auth.uid())` move to a future `002` migration. None is security-relevant under this RLS design (anon has no policies, and `auth.uid()` is null for anon); pinning `search_path` carries a real HNSW-inlining tradeoff. | `e475bf8` |

**Not actioned, with reasons.** `m5` (R4b narrower than R4a) is subsumed by R8, which covers the `next.config.*` path that motivated it. `m8` (untested pure functions) is half done: `exportFilename` now has five tests; `costUsdMicro` remains untested because `openrouter/server.ts` is `server-only`. `n1` (dead `button.tsx`) is resolved as a side effect — `src/app/error.tsx` is its first consumer. `n2`, `n3`, `n5`–`n9` are left as recorded; `n5` is a candidate for the KNOWN LIMITS block when re-export laundering becomes reachable.

**One thing this addendum's work surfaced.** The Block C deferral note for `m6` was written inside the SQL fence, which broke the "migration is byte-for-byte with SPEC Block C" invariant that had been verified twice. Re-extracted and re-verified in `2754eb3`; the added lines are SQL comments and change no statement, and the migration is still unapplied.

**Gates after these changes:** `npm run check` passes at **9 rules**, `npm test` 17/17, `npm run build` (with `prebuild` running both) and `npm run lint` clean. Every new rule was verified against a planted violation that was then removed, and against negative controls — `Buffer.from` single-line and wrapped, docs prose quoting the forbidden literal, and the two pre-existing `getSession` comments.
