# ai-architect — pre-implementation review, `feature/compliance-and-docs`

Run before coding, scoped to the six items of the branch brief (Impressum v3.0,
/privacy Stripe paragraph, registration open, the AI-generated line, README H16,
docs/deploy.md H17). Report reproduced verbatim below.

---

```
VERDICT: REVISE
```
Scope verified: I read SPEC.md 1089–1117, 1183–1188, 1247–1287, 1684–1690 and 1725–1726, plus CLAUDE.md in full. I read every file named in the brief. `.claude/agents/` holds 6 agents: ai-architect, ai-code-reviewer, nextjs-security, supabase-security, vercel-security and eu-compliance-reviewer. `.claude/commands/` holds 2 commands: full-review and team-review. No unit test exists for `src/lib/docx.ts`; the brief's "and its tests" refers to nothing.

No chokepoint, DAL, RLS, secret-boundary or metered-call rule is touched by this plan. Checklist items 2–6 are clean. Every finding is in SPEC conformance, false-claim discipline or test coverage.

## Findings

1. **[BLOCKER] Public pages would describe a product the deployed code does not have. This answers (c).**
   - Where: `src/app/privacy/page.tsx` (the new "Plans and payment" paragraph), and `src/lib/copy.ts:117-118` → the v3.0 Impressum "About this deployment" first sentence (SPEC 1278).
   - What it would claim: "CV Insight has a Free plan and a Pro plan. Upgrading goes through Stripe …", "It has a Free plan and a Pro plan; upgrades go through Stripe in test mode".
   - What is actually built: no `lib/plan.ts`, no `/pricing`, no Stripe client, no `subscription_events` table. These are the two pages whose job is to be accurate to a stranger. CLAUDE.md, Process: "a user-facing promise may not ship ahead of that evidence".
   - Over-disclosure is less harmful than under-disclosure, but it is still false. It also makes an Art. 13 recipient list name a processor that receives nothing.
   - Required change: move the privacy "Plans and payment" paragraph, the Stripe processor entry, the "subscription events" category and the Art. 6(1)(b) payment basis into the branch that ships the Stripe webhook and `subscription_events`. Move the plan sentence of the Impressum paragraph with them.
   - Record both under "not done / deferred" in this branch's hand-over.
   - Do not invent interim wording for the Impressum paragraph. Any non-verbatim copy is an undeclared deviation and needs a `> Decision:` amendment. Either ship the Impressum v3.0 copy whole with billing, or have the owner amend SPEC 1278 with an interim sentence.

2. **[MAJOR, a BLOCKER at merge time if left unguarded] `IMPRESSUM_FILLED = true` with the email still a placeholder shows the placeholder to readers.**
   - Where: `src/lib/copy.ts:103,110` and `src/app/impressum/page.tsx:33-38`.
   - With the switch true, the page renders `[[OPERATOR CONTACT EMAIL — owner to fill]]` as a `mailto:` link. Preventing exactly that is why the switch exists (`copy.ts:86-88`, SPEC 1284).
   - Required change: add a unit test (`copy.ts` is client-safe and importable under the alias hook). It asserts that if `IMPRESSUM_FILLED` is true, no `IMPRESSUM` value contains `[[`. Test for `[[` and not a bare `[`, because the SPEC address placeholder is single-bracketed on purpose.
   - The hand-over says the PR cannot go green until the owner types the email.
   - Note: `README.md:22` already publishes an owner address. The agent must not copy it into `IMPRESSUM.email`. SPEC 1284 says the owner fills it "by hand" and says the agent must not derive the values from anywhere.

3. **[MAJOR] Opening registration in this branch is an ordering hazard. This answers (a).**
   - **What the fence does.** Removing the `NODE_ENV` fence (`signup/page.tsx:41`, `login/page.tsx:22`) does not open anything by itself; the gate is the Supabase setting.
   - **Merge without the Supabase flip.** If this branch merges to an auto-deploying `main` and the setting stays OFF, production shows a form that can only fail. That is the v2.25 `vs-1` defect, reintroduced.
   - **Merge with the Supabase flip.** If the owner also turns sign-ups ON, both legs of the v3.0 rationale (SPEC 1111) are missing:
     - The Free plan does not exist. The fence that does exist is v2 rule B7: `DAILY_CALL_LIMIT = 50` chat calls per rolling 24 h (`src/lib/budget.ts:91`), with embeddings excluded (`src/lib/errors.ts:94`). Backlog M-4 (import spends before the cap) is still open (`README.md:637-641`).
     - There is no credit limit. Email confirmation is OFF and the anon key is public, so accounts can be created in bulk through Supabase Auth REST without touching this app. Total spend is unbounded, on a key that belongs to another party.
   - **Is it a merge blocker?** Not by itself, because code alone opens nothing. It becomes one in practice if Vercel auto-deploys `main`. Nothing in the repo says whether it does: `docs/deploy.md:144` says only "Deploy from `main`". The owner must confirm this.
   - **Recommendation:** take item 3 (fence removal), the README "Registration is closed" replacement and deploy.md step 2 out of this branch. Land them in a final "go-public" branch merged after the plans branch, so the form, the Supabase flip and the Free limits arrive together.
   - **If the owner keeps item 3 here anyway,** the hand-over must say:
     - Do NOT turn Supabase sign-ups ON until `lib/plan.ts` is deployed.
     - Until then, production shows a sign-up form that Supabase refuses.
     - The current per-account fence is B7's 50 chat calls a day, not "the Free limits".

4. **[MAJOR] H17 met only in letter. Fence for spend on someone else's key. This also answers (a).**
   - Where: SPEC 1726 versus SPEC 1111.
   - H17 accepts "stating that plainly, with the Free limits as the only fence". SPEC 1111's argument depends on a credit limit bounding the total, and on this key none can be set.
   - "A public deployment with an unbounded key is not Done" (1726) and the plan's "record plainly" are in tension. Writing it down does not bound anything.
   - Required change: the new deploy.md step should state three things.
     - (i) No credit limit can be set; the key belongs to another party.
     - (ii) The per-account fence, named precisely for the state at the time: B7 today, the Free plan once built.
     - (iii) Per-IP sign-up limits in Supabase Auth rate limits (a dashboard setting, not code) as the only available brake on account count, with the value recorded.
   - Also flag that the key's owner bears the spend of strangers. That is the owner's conversation to have, not something the agent can settle.
   - Recommend that the owner either amend SPEC 1111 to acknowledge the missing leg, or move to an operator-owned key with a limit before going public.

5. **[MAJOR] The deploy.md plan ("rewrite step 2") misses most of the closed-registration material. This answers (f).**
   - Lines that become false once registration opens:
     - `docs/deploy.md:7-12` (ordering premise)
     - `:23` (precondition "disabled")
     - `:34-50` (step 1 "while registration is still open")
     - `:61-66` (step 3 hand-made accounts)
     - `:123-126` (`NODE_ENV` drives "the `/signup` registration-closed copy")
     - `:156-168` (step 11 expects "Registration is closed" and says take the deployment down if an account can be created; this is now inverted)
     - `:256-262` and `:325-327` (step 21 and the record bullet about `IMPRESSUM_FILLED` false)
     - `:280-282` and `:282` (known items)
   - Required change: rewrite all of them in the same branch that flips step 2.
   - The 2026-09-04 deployment record table (`:286-310`) is a dated record. Leave its rows and add a dated line saying row 11 describes the v2.25 state.
   - R13 (`scripts/check.mjs:592-614`) fails deploy.md on any backticked path that does not exist. Do not name `src/lib/plan.ts`, `src/lib/stripe/server.ts` or `docs/eval/tool-calling-probe.md` in backticks before those files exist.

6. **[MAJOR] The owner's "do not rewrite other README sections" instruction conflicts with sentences this branch makes false.**
   - Sentences outside the sections named in the plan that opening registration falsifies:
     - `README.md:527-531` (CI: "the deployment's own project has registration closed")
     - `:622-627` (erasure: "with registration closed the store holds one person's own data — and it reopens the moment a second real person holds an account". By README's own words, opening registration reopens backlog `eu-8`.)
     - `:643-644` (password reset: "accounts are created by hand". With open sign-up and no reset, a user who forgets their password is locked out.)
     - `:17-22` (live URL bullet)
     - `:629-632` and `:564-565` (Impressum not filled)
   - Required change: ask the owner whether these sentence-level edits count as "Registration is closed material" under H16. Leaving them is a false claim; rewriting them silently breaks the owner's instruction.
   - The erasure line is a substantive reopening, not wording. It needs an owner decision, recorded in the hand-over.

7. **[MAJOR] README "How this codebase is built" would have to describe `/full-review` truthfully.**
   - Where: `.claude/commands/full-review.md:2,20-45`.
   - The file pins `model: claude-opus-4-1` and dispatches `subagent_type` values that do not exist in `.claude/agents/`: `code-reviewer`, `security-auditor`, `architect-reviewer`, `performance-engineer`, `test-automator`, `tdd-orchestrator`. It also carries TDD flags. It is a vendored generic command.
   - The saved reports (`docs/reviews/full-review-2026-10-12-*.md`) show the project's own agents were used in practice.
   - Required change: either correct the command to dispatch CV Insight's agents, or have the README describe what it actually invokes. A README line saying `/full-review` runs this project's reviewers would be an unverified claim.
   - Stages for the six agents, taken from their `description:` front matter and CLAUDE.md Process: ai-architect before each phase; supabase-security after the database phase and before deploy; nextjs-security after feature phases; vercel-security before deploy; eu-compliance-reviewer on personal-data, cookie or public-page features; ai-code-reviewer on every PR. Commands: `/full-review` before a branch's PR, `/team-review` on a merged phase. Record for all: `docs/reviews/`.

8. **[MINOR] The `src/lib/docx.ts` change needs a way to unit-test it. This answers (e).**
   - `docx.ts` is `server-only`, so `node --test` cannot import it. `tests/unit/export-filename.test.mjs:7-10` sets the precedent: move the pure part out rather than stub the guard.
   - Required change: put the paragraph model in a pure function, e.g. `exportLines(content) → {text, bold, muted}[]`. `resumeToDocx` maps that list to `Paragraph`/`TextRun`.
   - Unit tests to add:
     - (a) The last element is `RESULT.aiGeneratedLine` with `muted: true`, `bold: false`.
     - (b) It is appended exactly once, after the user's final line, including when the content ends in blank lines.
     - (c) The input string is not modified.
     - (d) `isHeading(RESULT.aiGeneratedLine)` is false.
   - Where the function lives: if it goes in a new file, add it to SPEC Block A, otherwise that is a layout deviation. Placing it beside `exportFilename` in `src/lib/utils.ts` needs no amendment.
   - Muted style: a named constant for the colour (`6B7280`, matching `--text-muted` at `src/app/globals.css:12`). No header or footer, to keep the ATS-plain promise at `docx.ts:8-11`.
   - Additions to `tests/e2e/generate.spec.ts:676-709`:
     - `RESULT.aiGeneratedLine` is visible above the editor.
     - After export and reload, the editor value does NOT contain it. This proves it was never stored, because the route inserts `content` at `export/route.ts:107-119` before `resumeToDocx` runs.
   - Known edge case, accepted by SPEC 1187: if a user pastes the sentence into the editor, the file carries it twice.

9. **[MINOR] Production-build witness for the fence removal. This also answers (e).**
   - No e2e spec asserts the closed copy. Playwright runs `npm run dev` (`playwright.config.ts:33`), so the fence was never exercised there and nothing breaks.
   - No `check.mjs` rule reads `/signup` or `NODE_ENV` in auth pages, so R1–R13 are unaffected.
   - Proof that the form renders in production needs the same shape as `docs/eval/dev-routes-production-evidence.md`:
     - `npm run build && npm run start`
     - `curl /signup` shows the password field and "Create account".
     - `curl /login` contains "No account? Create one".
   - Record it under `docs/eval/`. Do this in whichever branch removes the fence.

10. **[MINOR] Dead code and false type claims after the fence goes.**
    - Delete `AUTH.registrationClosedTitle/Body/SignIn` (`copy.ts:185-198`). SPEC 1111 keeps that copy in SPEC as the record, not in code.
    - `src/components/auth-form.tsx:37-45` claims "passing one without the other is a type error". It is not: these are two independent optionals. Make `altHref`/`altLabel` required again, since both callers will pass both, and delete the v2.25 comment.
    - Rewrite the stale doc comments in `signup/page.tsx:9-39` and `login/page.tsx:15-20`.

11. **[MINOR] /privacy edits the plan implies but does not list (for whichever branch ships them).**
    - `src/app/privacy/page.tsx:202` reads "Two service providers"; with Stripe it becomes three.
    - Bump `PRIVACY_UPDATED` (`copy.ts:76`). Its own rule says to bump it for a new recipient.
    - Add "subscription events" to `:46-53`.
    - Add the Art. 6(1)(b) payment basis to `:102-105`.
    - The retention ternary at `:262-265` stays untouched.
    - CLAUDE.md Process requires eu-compliance-reviewer on this branch (public pages, personal data). Ask it whether Stripe's controller/processor role fits `:111-112`, "nothing is … shared with anyone for their own purposes".

12. **[MINOR] Stale annotations in touched files. This also answers (f).**
    - `src/lib/copy.ts:94-101`: the closed-demo rationale. Replace it with the v3.0 single trigger (SPEC 1287).
    - `copy.ts:115-118`: `addressOnRequest`/`nonCommercial`. Superseded by the SPEC 1274-1280 copy; delete them, don't leave them unused.
    - `src/app/impressum/page.tsx:11-15`: "Even behind Vercel Deployment Protection".
    - `src/lib/docx.ts:33-40` and `src/app/api/applications/[id]/export/route.ts:125-128`: "the document on disk is the text the user saw … not a second composition". It now carries one appended line; say so.
    - `README.md:656-659`: "Phase-2 guardrail … binding if it is ever built". CLAUDE.md now calls it the Pro generation path.
    - Outside the plan's file list but the same material: `scripts/demo-seed.mjs:135-136` and `docs/backlog.md:78,113-114`.
    - `.claude/agents/eu-compliance-reviewer.md:30` cites "§5 TMG/DDG". TMG is superseded by DDG. NOTE only.

13. **[NOTE] "Not built, deliberately" (`README.md:656-663`). This answers (b).**
    - Payments and agentic retrieval are no longer deliberate omissions. They are specified and not yet built.
    - Recommended text: "**Not built, deliberately:** i18n, realtime, notifications, analytics, an admin panel." Then a separate sentence: "**Specified in SPEC v3.0 and not yet built:** Free/Pro plans with Stripe test-mode billing, and agentic retrieval on the Pro path." Keep the cron sentence.
    - Remove the "eighth … Phase-2 guardrail" sentence.
    - When the billing and agentic branches merge, they delete the second sentence.

14. **[NOTE] Live URL. This answers (d).**
    - It is not recorded anywhere in the repo. I searched for `vercel.app` and other hostnames, excluding `.env*` and WORKLOG.md: nothing. `README.md:18-20` says it was deliberately not committed.
    - The agent must not invent it, and must not derive it from the Vercel CLI or a dashboard. The owner supplies it in conversation.
    - Publishing it belongs with the go-public step (finding 3). A published URL with a closed `/signup`, or with open sign-ups on an unbounded key, is the hazard above.

15. **[NOTE] Item 4 (the AI-generated line) and the remaining Impressum work (name, address placeholder, v3.0 trigger comment) are true today.**
    - They do not depend on plans existing and are approved as planned, with the guards from findings 2 and 8.
    - Render the line between the label and the `Textarea` (`resume-editor.tsx:105-114`), not in the no-version branch (`:80-100`).

## Recommended plan
- **This branch keeps:**
  - item 4, with the tests from finding 8;
  - item 1 without the plan sentence, guarded by the finding 2 test and blocked on the owner's email, or held whole until the owner amends SPEC 1278 (finding 1);
  - README "How this codebase is built" (with finding 7 fixed);
  - the "Not built" rewrite per finding 13;
  - stale-comment cleanup in the touched files.
- **Moved to a go-public branch merged after plans and billing:** item 2, the plan sentence of item 1, item 3, the README registration, cost-fence and live-URL edits, and deploy.md step 2 plus the H17 step.
- **Hand-over lists as deferred:** H16 pipeline Pro path, limitations edits, Stripe privacy copy, fence removal and live URL.

## Deviations needing a SPEC/CLAUDE amendment
- Any interim Impressum "About this deployment" copy without the plan sentence (SPEC 1278 is marked verbatim).
- SPEC 1111's two-leg rationale versus a key on which no credit limit can be set (H17 "or" clause versus "not Done").
- A new `exportLines` module, if it is not placed in `src/lib/utils.ts` (Block A layout).
- `.claude/commands/full-review.md` dispatching agents that do not exist in the repo: correct the file, or state it in README rather than in SPEC.
