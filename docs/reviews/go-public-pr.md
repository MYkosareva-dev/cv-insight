# AI Code Review — feature/go-public — 2026-10-13
Verdict: REVISE. The code is clean and could merge as it is. What needs fixing is one statement about the live site that has nothing behind it yet, and three factual errors in the docs. All four are doc-only edits.

Blockers: none
Majors: 1
Minors/nits: 3 MINOR, 3 NIT
Checked: secrets ✓, RLS ✓ (no schema change), chokepoints ✓, zod ✓ (no new API input or LLM output), llm_calls logging ✓ (no call path touched)

## Gates I ran
- `node scripts/check.mjs` → "check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; … every backticked repo path in the docs/ shelf resolves against the tree." Exit 0.
- `npx tsc --noEmit` → exit 0. With `AuthForm`'s link props now required, both callers type-check.
- `eslint` on the changed source and spec files → clean.
- `npm test` → 491 tests, 491 pass, 0 fail.

## Answers to the five checks
1. **Removed keys and props.** Nothing in `src/`, `tests/`, `scripts/`, README or the docs still uses `registrationClosed*`, `registrationOpen` or optional `altHref?`/`altLabel?`. The only hit is a review record, `docs/reviews/compliance-and-docs-architect-plan.md:114`, which is a verbatim history file and should stay. SPEC:1158 still describes the props as "optional together", but SPEC:1165 retires that explicitly, which is fine.
2. **/signup and /login.** Both are still server components (no `'use client'`; only `auth-form.tsx` is a client component, as before). Neither reads an env var or a secret, and neither makes an access decision. The only remaining logic is the middleware's existing signed-in bounce. The privacy line is a sibling of the form inside the `(auth)` layout's card, so "inside the card" is true. The copy is informational, as SPEC requires.
3. **The L7 test change is sound.**
   - `src/app/(app)/quality/page.tsx:113` renders `QUALITY.empty` only when `calls.length === 0`, and the tiles are never drawn in that branch.
   - `listLlmCallsForQuality` throws on a read error (`src/lib/db/llmCalls.ts:88`), so a failed read goes to the error boundary. It cannot show the empty state and give a false pass.
   - The account is fresh (sign up only, no import or scan), so the comment's "ANY row would be the refused call's" holds. NIT 6 covers what this assertion gives up.
4. **README and deploy.md against the code.** These all match:
   - Plan table vs `src/lib/plan.ts:61-74` (Free 50 / 3 / 1 / 20; Pro 50 / – / – / 100).
   - Budgets vs `src/lib/budget.ts` (2 per step, 4 steps, 4 tool rounds, 6 searches; 12 vs 8 = `MAX_CHAT_REQUESTS_PER_GENERATE_BY_PATH`).
   - R10's two consumers and "13 rules" vs `scripts/check.mjs`.
   - Migrations 001–007 vs `supabase/migrations/`.
   - The seven env names vs `.env.example` (names only).
   - The `sk_test_` refusal (`src/lib/stripe/server.ts:34`).
   - Provenance attributed to migration 006 (correct).
   - "nine DAL files" (correct).

   Exceptions are findings 1–3 below.
5. **"No undeclared deviations" and "documentation voice".**
   - All four v3.0c amendments (form and link everywhere, required props, notice aligned, signup privacy line) are implemented in this branch.
   - The rest of `gp-3` (the notice is not shown on the auth layout) is declared as open in `docs/backlog.md`.
   - The architect's finding 5 stale-text list is handled: `demo-seed.mjs` is rewritten, `fresh-clone-verification.md:165` and the backlog are annotated.
   - The statute citations (§ 5 DDG, Art. 6(1)(b), 28, 44) appear as questions for counsel or as the stated legal basis. None of them justifies a rule as "required of us". No voice violation.

## Findings

**1. [MAJOR] README.md:17-23, SPEC.md:3 (v3.0c note: "the live URL is published"). The README says registration is open on the live deployment, and nothing shows that yet.**
- The README says "Live deployment: https://cv-insight-lime.vercel.app … Registration is open; sign up …".
- The deployment runs `740226d`, the merge of PR #4 on `main`. At that commit, `/signup` in production still renders `registrationClosedTitle` (confirmed with `git show 740226d:src/app/(auth)/signup/page.tsx`).
- The e2e evidence for this branch (`docs/eval/e2e-go-public-run.txt`) came from `next dev` (NODE_ENV=development). The form rendered there before this branch too, so the run never exercises the deleted production fence.
- CLAUDE.md says "a user-facing promise may not ship ahead of that evidence".
- **Required change:** after merge and redeploy, run `docs/deploy.md` step 11 on the deployment (signup form renders, sign-up lands signed in, signed-out `POST /api/career/items` returns 401). Record it as a v3.0c row or sub-table in the deployment record. Until that row exists, list it under "not done / deferred" in the PR description and hand-over, and do not share the link before it is recorded.

**2. [MINOR] docs/deploy.md:296-297. `PRICING.proPrice` does not exist.**
- S2 says the €5/month price is "matching `PRICING.proPrice` in `src/lib/copy.ts`". `src/` has no `PRICING` export and no `/pricing` route; a grep for `proPrice` finds only `proPriceId()` in `src/lib/stripe/server.ts`.
- `check.mjs`'s docs-path rule cannot catch this because it is an identifier, not a path.
- **Required change:** cite what really holds the amount. That is Stripe itself, per SPEC Block A line 74 (500 minor units = €5.00). Drop the `PRICING.proPrice` reference.
- Separately, SPEC:1294 specifies a `/pricing` screen with `PRICING.*` copy that is not built. That predates this branch, but it should be checked and either declared in the backlog or confirmed.

**3. [MINOR] README.md:779-781. The missed-webhook paragraph makes two false claims.**
- (a) "Stripe retries for up to three days" describes live mode. This deployment is test mode only, where Stripe retries far fewer times, over hours. Check the exact figure against Stripe's webhook docs.
- (b) "Settings says 'being confirmed' in that window" is not what the code does. `SETTINGS.upgradePending` renders only when `returnedFromCheckout` is true (`src/app/(app)/settings/page.tsx:158, 212`), i.e. on the redirect back from Checkout. A later visit inside the retry window shows plain Free. A missed cancellation delivery shows Pro with no notice at all.
- **Required change:** state the test-mode retry behaviour, and limit the Settings claim to "on the return from Checkout".

**4. [MINOR] docs/deploy.md:394-403. The old record now contradicts step 11.**
- The deployment record says "In checklist order, so the record can be walked against the steps above". Its row 11 reads "Registration closed — `/signup` shows the registration-closed copy", but step 11 is now "Registration works, and the fence still holds".
- The architect asked to keep that row as history, which is right, but nothing marks it as history.
- **Required change:** add one line above the table, e.g. "2026-09-04 record, made under v2.25 (registration closed); step 11 has since changed — see the v3.0c row". Finding 1 supplies that row.

**5. [NIT] docs/eval/e2e-go-public-run.txt. The committed log has unexplained server errors and broken characters.**
- It carries repeated `[WebServer] ⨯ Error: The destination stream closed early. digest: '3157741274'` lines (about lines 61-79) with no note on what they are. The SPEC/README summary "42 passed, 3 skipped, 1 failed" reads as if nothing else happened.
- The file also has broken characters (`Ô£ô`, `ÔÇ║`) from a console-encoding mismatch.
- **Required change:** add a one-line note to the record. Either the errors are aborted dev-server streams from client navigation (harmless), or they get a backlog id.
- The invented `example.com` fixture lines the generate spec prints (line 72) are invented data, so this is not a privacy finding.

**6. [NIT] tests/e2e/plan-gating.spec.ts:138-149. The new assertion drops a check, and its comment overstates it.**
- The old assertion also showed that the page reads the caller's plan ceiling ("0 / 50", "0 / 20"). No e2e spec checks that ceiling any more; only `tests/unit/budget.test.mjs` covers `dailyCallLimit`.
- "exactly when the caller has zero rows" is true of the window read (`listLlmCallsForQuality`, limited to `QUALITY_CALL_WINDOW`). For a fresh account that is the same thing as the whole table.
- **Required change:** none blocking. Optionally add one sentence to the comment saying the ceiling-tile check now lives in the unit test.

## Paths
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\README.md (17-23, 779-781)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md (3)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\deploy.md (296-297, 394-403)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\e2e-go-public-run.txt
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\plan-gating.spec.ts (138-149)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\quality\page.tsx (113-122)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\settings\page.tsx (158, 212)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\db\llmCalls.ts (79-90)

Per CLAUDE.md, save this report verbatim to docs/reviews/feature-go-public.md before acting on it.
