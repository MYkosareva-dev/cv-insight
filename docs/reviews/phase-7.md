# AI Code Review — phase-7-release — 2026-09-04

> Subagent: `ai-code-reviewer` · Branch `phase-7-release` vs `main` · Five commits, four files, documentation only. Saved verbatim in the run that produced it, before any of it was acted on (CLAUDE.md, Process).

**Verdict: REVISE** (no blockers; three majors, six minors, ten nits)

Ran on this branch: `node scripts/check.mjs` → *"check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.\* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree."* · `npm test` → **382 pass / 0 fail** · `npx tsc --noEmit` → clean · `git diff --numstat main...HEAD` → `README.md`, `docs/backlog.md`, `docs/deploy.md`, `docs/eval/phase-6-e2e-run.txt` only; `package.json` and `package-lock.json` untouched.

## Blockers

None. Pass 1 is clean. The diff contains no secret value, no `sk-`/JWT-shaped literal, and no `NEXT_PUBLIC_` prefix on a secret name; the only appearance of `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` is as bare NAMES in the README's local-setup block, which is the correct form and matches `.env.example` (four names, all with empty values — checked by field length, never by reading the values). No env var is added. No commit message carries a secret. No code file changed, so Passes 2–4 have no new route handler, no `.from(`/`.rpc(` outside `src/lib/db/`, no `security definer`, no OpenRouter call outside the two gates, no `getSession(`, no `dangerouslySetInnerHTML`, no schema change, no dependency change.

**What the branch gets right, stated first because it is the bulk of it.** Every number I could check in `README.md` checks out against the file it names, and I checked all of them:

| Claim | Verified against |
|---|---|
| 0.20 / 0.36 / 0.16, 0.16 derived not declared | `src/lib/scoring.ts:78-88` (`SIMILARITY_SPAN = COVERAGE_THRESHOLD - SIMILARITY_FLOOR`) |
| 60/40 weighting, `round(100 × (0.6S + 0.4K))` | `src/lib/scoring.ts` `WEIGHT_SIMILARITY`/`WEIGHT_KEYWORDS`, `matchScore()` |
| zero-MUST → `round(100 × K)`; zero-MUST + zero-keywords → `—` | `matchScore()` + `insufficientSignal()` + `renderableScore()` |
| 1536 dimensions, batch of 64 | `src/lib/openrouter/server.ts:46,48`; `supabase/migrations/001_init.sql:26` |
| 80–300 character chunks | `src/lib/chunking.ts:41,51` |
| `MAX_CHAT_REQUESTS_PER_STEP = 2`, 4 chat steps per generate | `src/lib/budget.ts` |
| 50 / 100 daily caps, unit-tested at their boundaries | `src/lib/budget.ts`; `tests/unit/budget.test.mjs:98-164` asserts limit−1 / limit / limit+1 on both |
| 13 rules, `check passed (13 rules)`, wired as `prebuild` | `scripts/check.mjs`; `package.json` `"prebuild": "npm run check && npm test"` |
| 8 owner-scoped tables, exact RLS matrix incl. every absence | `supabase/migrations/001_init.sql:105-112`, `003_imports.sql:41-44`, `004_profiles.sql:59-86` — the README table reproduces it row for row |
| `match_documents` is `security invoker` and filters on `auth.uid()` inside | `001_init.sql:134-142` (no `security definer`, R3 green) |
| 30-day sliding cap, clamped in both adapters, R11 enforces | `src/lib/supabase/cookie-options.ts:29`; `scripts/check.mjs` R11b/R11d; `tests/unit/cookie-options.test.mjs` |
| five security headers on every response | `next.config.ts` `SECURITY_HEADERS` + `headers()` on `/:path*` |
| erasure counts 8→0, 24→0, 1→0, 1→0, 2→0, 9→0, 1→0, 1→0 | `docs/eval/erasure-evidence.md` "Run output" — exact match |
| 23 slugs probed, 5 serve, 18 identical `model-ignored-by-guardrail` 404 | `docs/eval/generation-model-comparison.md` Part 1 (23 rows, 5 × 200) |
| 149 completion tokens, 0 reasoning, `finish_reason: stop` | same file, second-probe table |
| grounding fails first draft 3 of 3, both models; 3→5 under fallback, 2→0 and 3→3 under gpt-5.4; keyword 3/5 and `missingHonest = 5` in all six versions | same file, Part 2 table and findings 1–4 |
| model slugs `openai/gpt-5.4` / `anthropic/claude-haiku-4.5` / `google/gemini-2.5-flash` / `openai/text-embedding-3-small` | `src/lib/openrouter/server.ts` `MODEL_BY_STEP`, `FALLBACK_MODEL`, `EMBEDDING_MODEL`; agrees with CLAUDE.md's amended list and `docs/openrouter-processing.md` |
| pipeline ORDER: draft `applications` row inserted **before** the parse | `src/app/api/scan/route.ts` `freshPlan()` — `insertVacancy` → `insertApplication`, then `parseAndScore` |
| `001_init.sql` fails on its **second line** without `moddatetime` | `supabase/migrations/001_init.sql:2` — precisely right |

Every backticked repo path in `README.md` resolves against the tree (I extracted and tested them all; the only non-resolving strings are model slugs, route paths and bare migration filenames, none of which are repo paths). `README.md` is inside R12's scan set and its "90-day purge" sentence passes because `AUDIT_RETENTION_VERIFIED` is `true` with `docs/eval/audit-retention-evidence.md` behind it (`src/lib/copy.ts:29`).

**The backlog restructure is clean where it matters most.** `git diff --numstat main...HEAD -- docs/backlog.md` → **265 insertions, 0 deletions**. Not one character of an existing entry was rewritten; every closure is a blockquote beside the entry, which is the convention the file already used. All six new closure blockquotes are accurate against the code:

- `p4-30` → `DAILY_CALL_LIMIT = 50` / `DAILY_RESCORE_LIMIT = 100` with `underDailyCallCap` / `underRescoreCap` in `src/lib/budget.ts`, boundaries pinned in `tests/unit/budget.test.mjs`; the queries did stay in `src/lib/db/llmCalls.ts`, so "a re-export plus a test, not a redesign" is exactly what happened. ✓
- `p3-1`/`m-3`/`ns-5`/`vs-7` → `MAX_PDF_BYTES = 4 * 1024 * 1024` at `src/lib/copy.ts:284`, and `src/app/api/career/import/route.ts:111-114` reads `content-length` **before** `request.formData()` at `:116`. ✓
- `p3-2`/`p4-1` → `SPEC.md:782-799` carries the function-duration table, `/generate` at 300 against a stated ~248 s worst case, matching `maxDuration = 300` at `src/app/api/applications/[id]/generate/route.ts:56`. ✓
- `eu-12` → `README.md:372-373` names `docs/openrouter-processing.md` as the record; SPEC Block G's G2 wording (`SPEC.md:1374`) is now true of the file it points at. ✓
- The two table rows I did not have to take on trust are also right: `ns-1`/`vs-3` and `eu-11`/`eu-14`/`eu-15` are each already marked beside their entries in the pre-existing Phase-6 blockquote (`docs/backlog.md:535-543`), so the front matter's promise — "Marked here and again beside the entries below" — holds for every row of the table, including `p3-13`, `p3-17`, `p4-19`, `p3-8` and `m-4` (budget half).
- The ten-id owner-triage row matches the pre-existing triage blockquote exactly: `vs-1`, `eu-2`, `ns-2`/`vs-5`, `vs-6`/`eu-10`, `vs-4`, `vs-7`/`ns-5`, `eu-6`, `eu-5`, `eu-7`. ✓

**And the "not closed" claims are correct against the code, which is the part that would have been easiest to get wrong.**
- `M-3` (= `ns-4`): `src/app/api/career/items/[id]/route.ts` has no `z.uuid().safeParse(id)` in either verb, while `src/app/api/applications/[id]/route.ts:38` does. Still open. ✓
- `M-4`: `src/app/api/career/import/route.ts:45-60` runs `requireApiUser()` → `readResumeText()` → `runChatJson({ step: 'import_resume' })` with no item count anywhere in front of it. Still open, and still costs a metered call every time. ✓

---

## Majors

**MAJ-1. README states "No analytics, no trackers, no third-party cookies" as settled, while this branch's own backlog carries it as an unresolved owner action and the new deployment record omits the check that would settle it.**

`README.md:358` reads *"**No analytics, no trackers, no third-party cookies.** Auth cookies are strictly necessary, so no consent banner is shown"* — inside a section titled **Security and privacy posture**, three hundred lines under a bullet declaring a live deployment. Three things in this same branch disagree with reading that as a statement about the deployment:

1. `docs/backlog.md` "Read these first" item 7 (added here) says *"**Speed Insights must be off** in the Vercel dashboard: it beacons per-visit data to a third party… The CSP would currently stop the beacon leaving, which is a reason to turn the setting off, not a reason to lean on a header to keep a promise the page makes in prose."* It is listed as one of *"two one-line owner actions [that] gate sharing the link"* — i.e. **not yet done**.
2. `docs/deploy.md` step 20 ("No third-party script is being injected") is the check that resolves it. The new **Deployment record** table records steps 12, 11, 14, 16, 18, 19, 19 — and **not** 20.
3. Step 20 was in fact partly performed: the backlog section "Phase 6 — from the first production deployment" records `Uncaught TypeError … at et.reportAllChanges` observed on member screens with `<anonymous>`/`VM…` frames, concludes *"injected at run time by the platform or the browser, not shipped by us"*, and names Vercel Toolbar and Speed Insights as the two candidates. So a script of exactly the shape step 20 hunts for **was seen on the deployment**, its source is one of two dashboard settings, and neither has been confirmed off.

The record's disclaimer — *"a check not listed here was not run, or its result is not recorded"* — is technically survivable, but it is doing a lot of work: the omitted check is the one that backs both the README sentence above and `/privacy`'s *"There are no analytics, no trackers and no third-party cookies"* (`src/app/privacy/page.tsx:301-302`), and its result is not merely unrecorded, it is known-ambiguous. This is precisely CLAUDE.md's *"a configured mechanism is not a working one"* applied to a promise rather than a job.

Fix, either half: (a) run step 20 to a conclusion and record it in the deployment record — "Speed Insights confirmed off, Toolbar accounts for the console error" is one line; or (b) narrow the README sentence to what the repository proves on its own — *"This app ships no analytics package, no telemetry and no web-vitals reporter, and sets no third-party cookie; the deployment's Speed Insights setting is a dashboard control, recorded in `docs/deploy.md`."*

**MAJ-2. `docs/openrouter-processing.md` still says the deployment is development-only and no URL may be shared, while README and the new deploy record declare it live and the link shared. README points the reader straight at that file.**

`docs/openrouter-processing.md:121-136`:

```
## Verification

Status: NOT VERIFIED
...
Until this section is filled in, the deployment is development-only and no URL is
shared outside the owner.
```

Against `README.md:15-18`: *"**Live deployment:** running on Vercel in `fra1`, verified 2026-09-04 … registration is closed and accounts are created by hand, so **the link is shared directly** rather than published here."* And `docs/deploy.md:286`: *"## Deployment record — **live and verified**, 2026-09-04"*.

Two committed documents in the same branch state opposite things about whether this deployment may be shared. The collision is not hypothetical for a reader: `README.md:372-373` sends them to that exact file (*"`docs/openrouter-processing.md` is the record of what leaves this deployment"*), and the third heading down is the sentence that says the deployment should not exist in this state.

**The stale document is `docs/openrouter-processing.md`.** Its gate was written before the arrangement that actually replaced it — registration closed, a demonstration notice on every authenticated screen, `/privacy` saying in its own words that the provider account is not the operator's, and "please do not paste a real resume". That arrangement is a deliberate owner decision and the README describes it honestly. What is missing is the amendment saying so. Items 1–3 of that file (logging, retention, training) genuinely remain unverified, and CLAUDE.md's *"No undeclared deviations — if a SPEC amendment is committed in a branch, it is either implemented in that same branch or listed explicitly under 'not done / deferred'"* applies with full force to a gate this branch walks through in silence.

Fix: amend the Verification section in this branch — keep "Status: NOT VERIFIED" for items 1–3, and replace the sharing sentence with what now governs it (*"Until this section is filled in, the deployment ships as a demonstration: registration closed, the demonstration notice on every member screen, and `/privacy` stating that the provider's retention and training settings cannot be confirmed. It is not offered as a service and no real resume should be pasted into it."*). Do not simply delete the sentence — the record of the gate is the point.

**MAJ-3. `docs/deploy.md` step 21 makes filling `IMPRESSUM_FILLED` a precondition of sharing the link; the README says the link is shared and never mentions that it is unfilled.**

`src/lib/copy.ts:103` → `IMPRESSUM_FILLED = false`. `docs/deploy.md:256-262` (step 21): *"**`/impressum` will say the operator's details are not published** until `IMPRESSUM_FILLED` in `src/lib/copy.ts` is set to `true`… **Do that before sharing the link with anyone.**"* The new deployment record does state it (`docs/deploy.md:315`), and the new backlog front matter ranks it as one of the two actions gating the link.

The README does neither. `README.md:459-460` lists *"**GDPR posture** — a complete `/privacy`, an `/impressum` route, an EU processing region, and the erasure evidence above"* with no qualifier, and the **Honest limitations** section — which is otherwise unusually good at naming what the project has not proved — omits it entirely. A section that names "Password reset is not implemented" and "English only" and is silent about an unfilled Impressum on a deployment it calls live is understating in the one place the branch was explicitly asked not to.

Fix: one clause, either on the Live-deployment bullet or in Honest limitations — *"`/impressum` currently states that the operator's details are not published (`IMPRESSUM_FILLED` is `false`); filling it is a precondition of sharing the link, in `docs/deploy.md` step 21."*

---

## Minors

**MIN-1. `README.md:131-132` — "50 `llm_calls` rows per user per rolling 24 hours" claims a tighter cap than the code enforces.**
Rule B7's ceiling counts CHAT steps only: `countCallsInLast24h()` (`src/lib/db/llmCalls.ts:136-138`) delegates to `countStepsInLast24h(CHAT_STEPS)`, and `src/lib/budget.ts:96-100` states the exclusion outright (*"Rule B7 excludes embeddings by definition"*). `embed` and `rescore` rows are counted separately, against `DAILY_RESCORE_LIMIT`. So the real bound is 50 chat rows **plus** an embedding spend B7 does not see, not 50 rows total. The error is in the direction of claiming more safety than exists, which is the one direction the README brief rules out. Fix: "50 chat calls per user per rolling 24 hours, and separately 100 re-score embedding rows".

**MIN-2. Six misfiled ids in "Grouped by what would reopen them" — each one is filed under a condition its own entry says is not the blocker.**
The group headings are the value of this section; an id in the wrong group is an item nobody will look at when its real condition arrives.

- **`p3-4` under *When the test suite can create accounts again*.** Its entry (`docs/backlog.md:390`) says the blocker is that *"`tests/` may not touch a DAL or the service-role key, so no spec can count `llm_calls` rows"* and that *"the `/quality` dashboard (Phase 6) is where this becomes observable"*. That is R6/R10, not the fixture — and `/quality` now exists, so the condition it named has already arrived. The group's own intro (*"Every evidence gap below is blocked on the same fixture problem"*) is false of it.
- **`p3-19` under *When a second calibration case exists*.** The entry (`:424`) asks for a unit assertion of the enumeration boundary — *"the unit tests cover a bulleted item, a prose item, a one-line item and a 600-character sentence, not the enumeration boundary itself"*. `tests/unit/chunking.test.mjs` can assert that today with no fixture, no account and no second case.
- **`p3-24` under the same group.** The entry (`:434`) names its own fix: *"the two tables have no shared label saying which corpus each is about"*. That is copy on the result screen, not calibration.
- **`p5-15` under *When `resume_versions` learns which model wrote a version*.** The entry (`:509`) ends *"One line there would close the last gap in the same class."* The judge card needs a sentence saying it describes the editor's text; it does not need the model column. `p5-14` in the same group genuinely does.
- **`p4-5` under *When the app runs on more than one instance, or a user opens two tabs*.** `p4-29`'s own entry (`:444`) draws the line explicitly: *"`p4-5` carries a DIFFERENT case in the same function (text identical to an OLDER version, which is not deduped at all); **this one** is two requests in flight."* The group intro — *"Each of these is a race that a single warm serverless instance hides"* — is not true of `p4-5`. The group line does explain the pairing ("One fix, if the version list ever starts reading as a download log"), so this is the softest of the six.
- **`n-5` under *When the test suite can create accounts again*.** *"asserts the item count by substring… use an exact or regex matcher"* is a one-line edit to a spec file. It is ordinary open work, and by the front matter's own rule (*"Anything not listed in a group up here is ordinary open work with no precondition"*) it belongs below the rule, not above it.

**MIN-3. `docs/eval/phase-6-e2e-run.txt:188` points at a backlog section that does not exist.**
*"it is carried in docs/backlog.md under "Testing"."* `docs/backlog.md` has no "Testing" heading — I enumerated all 34 of them. The item is carried in two places, both added by this same branch: "Read these first" item 6, and "Grouped by what would reopen them → When the test suite can create accounts again". This is the exact defect class R13 was built for (*"a stale note is an instruction to the next agent to do the wrong thing"*); it escapes R13 only because the reference is unbackticked and `docs/eval/*.txt` is outside R13's shelf scope. Fix: name the two real sections.

**MIN-4. `README.md:522-523` — "Not built, deliberately: … cron …" is contradicted by the repository and by the README itself.**
`supabase/migrations/002_audit_retention.sql` schedules a nightly `pg_cron` job, and `README.md:355-356` cites it approvingly three sections earlier: *"has its own 90-day purge with its own succeeded-run record"*. The succeeded run is in `docs/eval/audit-retention-evidence.md`, and R12 gates the `/privacy` sentence on it. `SPEC.md:44` (`M11 | Cron | NO | No time-driven behavior`) is the stale source the README is echoing, and it is now false of the repository too. Fix both to the true statement: *"no application cron; the only scheduled job is the 90-day auth audit-log purge, and it has a succeeded run behind it."*

**MIN-5. Two open defects the README's prose reads as closed, in the two sections a reviewer would use them to judge the app.**
Both are ranked #3 and #4 in this branch's own "Read these first", which is what makes the silence conspicuous rather than merely incomplete.

- `README.md:300` — *"Absent rows answer **404, never 403**"*. True of absent rows. But `src/app/api/career/items/[id]/route.ts` still parses no uuid, so a malformed segment reaches Postgres and answers **500** where Block D mandates 404 — on two verbs of a real user-facing endpoint.
- `README.md:128-135` — *"Model calls are metered, so they are bounded by arithmetic rather than by convention"*, followed by the four ceilings. `POST /api/career/import` spends its `import_resume` call before rule B9's item cap can refuse the save (`src/app/api/career/import/route.ts:45-60`), which is the one open item in the file that costs money every time it fires.

`README.md:524-525` does point at `docs/backlog.md` as *"the maintained list of everything else known and open"*, which is why this is a minor and not a major. One clause in Honest limitations naming both would close it.

**MIN-6. The deployment-record table's left column stops meaning "the step above".**
`docs/deploy.md:293-299` runs 12, 11, 14, 16, 18, 19, 19 — out of checklist order, and `19` labels two rows. The second is a sub-result of step 19's pipeline run rather than a separate step. Renumber to checklist order and label the second row `19a` (or fold it into the step-19 row), so a reader can walk the record against the checklist without back-tracking.

---

## Nits

**NIT-1. `README.md:162-164`** — *"the number of requirements won by a single chunk went 5-of-8 to 3-of-8"*. The source row (`docs/eval/coverage-thresholds.md:348`) is *"most requirements won by ONE chunk | 5 of 8 | 3 of 8"* — the single most-winning chunk took five, then three. As compressed, it can be read as "of eight requirements, five then three were won by a chunk", which is a different and meaningless claim.

**NIT-2. `README.md:200-202`** — *"no cheaper relative would have found a way through"*. `openai/gpt-5-mini` and `google/gemini-2.5-flash` are cheaper relatives and both serve. The source sentence carries the scope clause the README drops: *"no amount of picking a cheaper or a closer relative would have found a way through — **the five are the whole of what is reachable**"*. Restore the second half.

**NIT-3. `README.md:79`** — *"The corpus searched is **always** the career base, never a pasted source resume"*. True of `/api/scan`; `/api/applications/[id]/rescore` searches the editor's text through `editorTextCorpus` (`src/lib/coverage.ts`), which the README discloses 400 lines later under Honest limitations. Adding "on a scan" removes the collision.

**NIT-4. `README.md:119-121`** — *"If the second draft is also refused, the app returns it anyway"*. The route returns `bestVersion(original, revision)` (`src/app/api/applications/[id]/generate/route.ts:198`), which may be the **first** draft; the response even carries `revisionNotBetter` for exactly that case. "returns the better of the two anyway, with an honest card" is what the code does — and is the more interesting claim.

**NIT-5. `README.md:523-524`** — *"`SPEC.md`'s module checklist gives the reason for each"*. Agentic tool-calling retrieval is not a module-checklist row; it is CLAUDE.md's Phase-2 guardrail. Seven of the eight are in the checklist.

**NIT-6. `docs/backlog.md:30-32`** — *"Seven, chosen for consequence… **Three** are product findings, **two** are money or correctness, **two** are one-line owner actions."* The seven numbered entries do not partition that way: entry 7 holds both owner actions in one entry, and entry 6 (the Playwright fixture) belongs to none of the three categories. Either drop the breakdown or make it match the list.

**NIT-7. `README.md:238`** — *"R1/R2 `.from(` and `.rpc(` only inside `src/lib/db/`"*. `scripts/check.mjs` pins an explicit roster of eight DAL files, not the directory; `src/lib/db/types.ts` sits in that directory and is not on it. The distinction is the point of *"adding a table means adding a DAL and a line there"*, which the same row says — "only inside the eight files listed in `scripts/check.mjs`" would say both at once.

**NIT-8. `README.md:230-231`** — *"`npm run check` prints `check passed (13 rules)`"*. It prints that plus a colon and a one-line summary of all thirteen. Harmless, and quoting the fuller string would be slightly more useful to someone comparing output.

**NIT-9. `docs/backlog.md:127-129`** — the group lists `p3-24`, `p3-25`, `p3-26` in numeric order but glosses them in the order 24, 26, 25 (following the record's own out-of-order listing at `:434-436`). A reader mapping id to gloss by position gets `p3-25` and `p3-26` swapped.

**NIT-10. `docs/deploy.md:299`** — *"the first time on a deployment that the configured generator is the one that answered"*. True, and also the only deployment there has ever been (`docs/backlog.md`, "Phase 6 — from the first production deployment"). It reads as a comparison across deployments when the sample is one. *"On this deployment the generate step was served by the configured model, with no fallback — the condition that hid four phases of fallback-written resumes is closed"* says the same thing without the implied series.

---

## Truthfulness summary, by the four questions asked

1. **Checkable claims.** Every number, slug, path and ordering statement in `README.md` resolves against the file it names. The table above lists what I checked and where. The only factual errors found are MIN-1 (the 50-row cap counts chat only) and MIN-4 (cron), plus the NIT-level compressions NIT-1, NIT-2 and NIT-4.
2. **Does it oversell?** Rarely, and it under-claims more often than it over-claims — "one of the top two similarities of eight" where the source says 1st of 8; a unit-test list shorter than the test directory; a limitations section that names five things nobody would have asked about. The three places it does over-reach are MAJ-1 (analytics/trackers stated as settled), MAJ-3 (Impressum silence) and MIN-5 (two open defects the prose reads past). All three are omissions in the "Honest limitations" and "Security posture" sections rather than false sentences, which is the harder class to catch and the one worth fixing before this file is the first thing a reader opens.
3. **Contradictions.** One serious (MAJ-2, `docs/openrouter-processing.md`'s sharing gate — that file is the stale one), one internal (MIN-4, cron, where `SPEC.md:44` is the stale source), one soft (NIT-3, corpus). `src/app/privacy/page.tsx` and `CLAUDE.md` agree with the README everywhere I compared them: the three provider names and the United States transfer, the no-account-identifier claim, the "provider account is not ours" paragraph, the EU/Frankfurt storage, the 90-day audit carve-out, the account-level erasure limitation, the RLS matrix, the model list, the two gates and the chokepoint.
4. **The backlog restructure.** No existing entry text was rewritten (265/0, verified by `--numstat` and by a deletion scan). All six closure blockquotes are accurate against the code. The M-3/ns-4 and M-4 "still open" claims are correct — I re-checked both routes myself and reproduced the finding. Six ids are misfiled in the grouping (MIN-2), and the "Read these first" breakdown does not add up (NIT-6). The framing itself — record below, worklist above, closures marked in both places — is a genuine improvement and holds up to the promise it makes about itself.

**On the deploy record and the e2e note (question 5):** both are disciplined about the difference between what was observed and what was inferred. The e2e note's three options are honestly costed, its "WHAT THIS DOES NOT MEAN" paragraph is the right shape, and it adds nothing above the untouched run output. The deploy record's "What this record does not cover" is exactly the section such a record should have. My two findings against them are MAJ-1 (step 20's outcome is known-ambiguous, not merely unrecorded) and MIN-3 (the "Testing" pointer), plus MIN-6 and NIT-10.

**On the Documentation-voice rule (question 6):** clean. I scanned every added line for an external organisation named as the source of a requirement or a rule justified by "it is required of us" and found none. "GDPR posture" is used as a factual label in the same way CLAUDE.md's own Privacy heading uses it; "the open compliance finding" refers to this project's own gate report (`eu-2`); "Block D mandates 404" refers to `SPEC.md`. Every requirement in the new prose is stated as this project's own engineering standard with its own reason attached — the R12 and R13 paragraphs and the CSP `'unsafe-inline'` paragraph are the strongest examples of the voice the rule asks for.

**Checked:** secrets ✓ · RLS ✓ · chokepoints ✓ · zod ✓ (no code change; existing schemas and repair-retry path re-read and unaffected) · llm_calls logging ✓ (`src/lib/chat.ts:185-234` writes `ok: true` and `ok: false` rows with `fallback_used`, fire-and-forget through `after()`) · check.mjs ✓ 13/13 · unit tests ✓ 382/382 · tsc ✓ · deps unchanged ✓ · `308.md` untouched and not reviewed, per the standing exception.
