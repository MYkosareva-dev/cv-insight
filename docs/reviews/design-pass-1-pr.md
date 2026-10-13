# AI Code Review — feature/design-pass-1 — 2026-10-13

Verdict: APPROVE (with one Major to fix before merge, or to defer explicitly in the hand-over)

Scope reviewed: `git diff main...HEAD`. The branch has **7** commits (245feb0 … 842a9a2), not the 8 the brief states. It touches 17 files, +142/−40. I also read the files the diff made suspect: `src/app/(app)/quality/page.tsx` in full (to check the intro's claims), `src/app/pricing/page.tsx`, `src/components/ui/input.tsx`, the `(app)` layout footer, every e2e spec, and the remaining copy in `src/lib/copy.ts`.

Commands run:
- `node scripts/check.mjs` → `check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; ... createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; ... every backticked repo path in the docs/ shelf resolves against the tree.`
- `npx tsc --noEmit` → clean.
- `npx eslint` on the five changed source files → clean.
- Playwright was not run. Test conclusions below come from reading the specs.

## Blockers
None.

## Majors
1. **MAJOR — Microsoft Edge shows two password-reveal controls (owner scope c, layout overlap).** Chromium Edge draws its own reveal button inside every `type="password"` input once the user starts typing (`::-ms-reveal`). Nothing in `src/app/globals.css` or `src/components/ui/input.tsx` hides it (`grep ms-reveal` finds no match). On Edge, the field will therefore show the native eye inside the content box, just left of the new `pr-10` padding, next to the custom toggle. The two controls flip the same `type` attribute independently, so their icons can disagree. Windows is this project's own development platform, so this is the main browser path, not a corner case. The fix is CSS only and stays inside the "markup/classes" scope, for example `input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none; }` in `globals.css`, or an equivalent arbitrary-variant class on the revealable `Input`. Playwright's Chromium does not render `::-ms-reveal`, so the new auth test cannot catch this.

## Minors
2. **MINOR — The `/quality` intro claims slightly more than the page shows (owner scope d).** `QUALITY.intro` says the page holds "the cost of each call" and "the scores the quality check gave every generated resume". What the page actually renders:
   - Per-call cost only appears in the last-50 table (`listRecentLlmCalls(50)`). The totals cover a bounded window (`QUALITY_CALL_WINDOW`, with `QUALITY.windowFull` shown when it is reached).
   - Rubric scores are read through `listResumeVersionsForQuality()` and capped at `QUALITY_VERSION_WINDOW`. Runs where the judge did not run ("not checked", `judge: null`) have no scores at all.

   On a screen whose stated rule is "every number is traceable … a total that quietly stops at a limit is precisely the untraceable figure", "each" and "every" overclaim. Suggested wording: "the cost and model of your recent calls" and "the scores the quality check gave your generated resumes".

   The rest of the intro is accurate:
   - "AI calls in the last 24 hours against your daily ceiling" matches the `tileChatCalls` tile, which reads `countCallsInLast24h()` against `dailyCallLimit(plan)`, the same counter the gate uses.
   - "The model that served each step" matches the per-step `colModels` column.
3. **MINOR — The intro also renders in the empty state.** When `calls.length === 0`, the page shows `QUALITY.intro` ("AI calls in the last 24 hours against your daily ceiling, the cost of each call…") directly above "No AI calls yet.", where none of those figures exist. The sentence reads as a description of the page rather than a claim, so this is not wrong. Still, consider leaving it out of the empty branch, or accept it consciously.
4. **MINOR — User-visible copy still points to "Quality" as a destination.** `RESULT.writtenByFallbackAlways` (`src/lib/copy.ts:902`) reads "…Quality has the per-step counts." The sidebar item a user would click is now "AI usage". The page heading is still "Quality", so the sentence is not false, but a user scanning the nav for "Quality" will not find it. Suggest "AI usage has the per-step counts" (copy only).
5. **MINOR — The sidebar "Pricing" item leaves the member shell.** `/pricing` lives at `src/app/pricing/page.tsx`, outside the `(app)` route group. Clicking the new sidebar item therefore removes the sidebar, and the only way back is "Back to CV Insight" → `/`, which lands on `/scan` rather than the page the user came from. Because of this, the `aria-current="page"` logic in `AppSidebar` can never mark Pricing as active. This matches what SPEC v3.0d chose (a public page, deliberately not inside the shell) and is not a regression. It is a UX seam the design pass creates by putting the page in the nav, so record it in `docs/backlog.md` rather than leaving it implicit.

## Nits
6. **NIT — State is conveyed only by swapping `aria-label`.** "Show password"/"Hide password" follows a recognised pattern, and since the focus stays on the same button element, the e2e test's `toBeFocused()` assertions hold. Some screen readers do not re-announce a name change on the focused element, though. The alternative is a fixed name plus `aria-pressed`. Using both would be wrong. The current choice is acceptable, so no change is required.
7. **NIT — Every member page now has two "Pricing" links**: the new sidebar item and the existing shell footer link at `src/app/(app)/layout.tsx:73`. The owner said the footer stays, so this is intended. Note that any future `getByRole('link', { name: 'Pricing' })` on a member page will hit Playwright's strict-mode error and needs scoping (`page.getByRole('navigation', { name: 'Main' })…`). No current spec uses that locator.
8. **NIT — The SPEC header line was not touched** (`Version: 3.0 | Date: 2026-10-12`) while v3.0e is dated by its closure as 2026-10-13. The v3.0a–d notes did the same, so this is consistent with existing practice.
9. **NIT — The SPEC Block E `/quality` paragraph still lists the original Block E tiles** ("Calls today, Avg judge score, Auto-revision rate"), which differ from what v2.20 built. This predates the branch and is not introduced by it. It is mentioned only because the line was edited here without being reconciled.

## Owner scope checklist

**(a) No logic change — PASS.** The only new behaviour is component-local display state:
- `useState` `revealed` in `Field` flips the input `type` between `password` and `text`.
- `name`, `required`, `autoComplete` (`current-password`/`new-password`), `aria-invalid`/`aria-describedby` and `validateBeforeSubmit` are unchanged. The client Zod parse reads `FormData`, which does not depend on `type`.
- `type` and `className` are destructured before `{...props}`, so nothing in the spread can override the computed `type`.
- Everything else in the diff is classes (`max-w-[75rem]`, `xl:grid-cols-[2fr_3fr]`), copy constants, one array entry in `ITEMS`, and one `<Link>` in the Settings `PlanBlock`, rendered outside the plan-state conditionals so it shows in every state as SPEC says. No plan decision moved into a page.

**(b) No route, endpoint or identifier rename — PASS.**
- Routes are unchanged: `/scan`, `/quality`, `/pricing`, and `/api/scan`. The stepper `SCAN.steps` is unchanged.
- Constant keys are kept and only values change: `NAV.scan`, `NAV.quality`, `SCAN.title`, `APPLICATIONS.newScan`. One new key each was added: `NAV.pricing`, `AUTH.showPassword`/`hidePassword`, `QUALITY.intro`, `SETTINGS.comparePlans`.
- No test id changed. No spec asserted the old "New scan"/"No scans yet" strings, so no spec breaks.
- The metadata title for `/quality` stays `Quality — CV Insight`, which matches the unchanged heading.

**(c) Password toggle accessibility:**
- Accessible name: from `AUTH.*` and describes the action. ✓
- Real `<button type="button">`, so it never submits; the test asserts no POST after both presses. ✓
- Keyboard: in the tab order after the field; Enter and Space both covered by the new test, on both `/login` and `/signup`. ✓
- Focus visibility: `focus-visible:ring-2 focus-visible:ring-ring`, `rounded-r-md`. ✓
- `aria-controls={id}` ✓. The icons are `aria-hidden`. ✓
- No overlap with typed text: `pr-10` (40 px) against a `w-9` (36 px) button. ✓
- The Edge native reveal is not handled. ✗ (Major 1)
- State is conveyed by the label swap. Acceptable (Nit 6).

**(d) Copy consistency:**
- `copy.ts`, the rendered pages, SPEC v3.0e, the route table (line 279), the layout-shell line (1139), the Block E `/scan` (1179), `/applications` (1260) and `/quality` (1262) lines, the `/pricing` reachability line, and README's walkthrough (step 4 "Match a job", step 5 "AI usage") all agree.
- No user-visible "New scan" remains in `src/`, `tests/` or README. The remaining hits are code comments in `api/scan/route.ts` and `lib/validation.ts`, a historical SPEC v2.26 note, and two `docs/eval/` records, all of them historical, not UI.
- Commit 312e5c5's "in the last 24 hours" matches SPEC v3.0e's "rolling 24 hours" and the counter the cap uses.
- Exceptions: Minor 2 (the intro overclaims), Minor 4 (the "Quality has…" pointer).

**e2e locator change — PASS.** The 13 `getByLabel('Password')` sites became `{ exact: true }` across all six signing-in specs. I found no remaining non-exact password label locator. `pricing.spec.ts` does not sign in and has none.

**`npm run check` rules — unaffected.** All 13 rules pass, quoted above. No new `.from(`, env var, secret reader, Supabase client or OpenRouter path.

Checked: secrets ✓, RLS ✓ (no schema or policy change), chokepoints ✓, zod ✓ (no new API input or LLM output; auth Zod path unchanged), llm_calls logging ✓ (untouched)

Files referenced:
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\auth-form.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\globals.css
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\quality\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\app-sidebar.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\pricing\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(app)\layout.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md

---

## Follow-up (2026-10-13, commit c915a5a)

Applied by owner instruction, in one commit:

| Finding | Outcome |
|---|---|
| 1 MAJOR — Edge shows two reveal controls | **Fixed.** `src/app/globals.css` hides `input[type='password']::-ms-reveal` and `::-ms-clear`, so the auth form's toggle is the only one. Not observable in Playwright's Chromium, as the finding noted. |
| 2 MINOR — the intro overclaims | **Fixed.** `QUALITY.intro` now says "what your recent calls cost" and "your recent generated resumes"; the comment beside it names the two windows. |
| 3 MINOR — the intro on the empty page | **Fixed.** Not rendered in the `calls.length === 0` branch. |
| 4 MINOR — "Quality has the per-step counts" | **Fixed.** `RESULT.writtenByFallbackAlways` reads "AI usage has the per-step counts." |
| 5 MINOR — sidebar Pricing leaves the shell | **Deferred** to `docs/backlog.md` as `ux-2` (OPEN). |
| 6–9 NIT | No change. |

One owner addition beyond the findings: the `/quality` page heading (`QUALITY.title`) and browser title now read "AI usage", the same as the sidebar item. The route stays `/quality`. The e2e heading assertion in `generate.spec.ts` reads `QUALITY.title`, so it follows without an edit. SPEC v3.0e and the Block E `/quality` line were updated to match.

Verification after the commit:
- `npm run check`: passed (13 rules).
- `npm test`: 506 pass, 0 fail.
- `npx playwright test tests/e2e/generate.spec.ts -g "the whole US-4/US-5 path"` (the test that asserts `/quality`): 1 passed.
