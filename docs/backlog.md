# Backlog

Findings that are real but not blockers, carried forward instead of fixed in the
branch that raised them. One line each: severity, id, where it lives, and what to do.

Blockers never appear here — they are fixed on the branch that raised them, so an
entry in this file is by definition something the owner has agreed can wait. The id
is the one the review report used, so `docs/reviews/` stays the full record and this
stays the worklist.

## How to read this file

Two halves, and the second one is the reason the first can be short.

**This half is the worklist**: what a reader should know before touching anything,
then the items that are waiting on a CONDITION rather than on someone's time,
grouped by the condition. **The half below the rule is the record**, one section
per review round in the order the rounds happened. Entry text there is never
rewritten — a closure is marked with a blockquote beside the entry, the way this
file has always marked one, so the reasoning that produced a fix survives the fix.

An id appearing in a group up here is a pointer. Its full entry, with the argument
behind it, is in the round that raised it.

Anything not listed in a group up here is ordinary open work with no precondition:
it is in the rounds below, waiting on nothing but a decision to do it.

---

## Read these first

Seven, chosen for consequence rather than for severity label — two product
findings about the pipeline, two open code defects, one migration risk, one gap
in the evidence, and one entry holding the two owner actions that gate sharing
the link.

1. **`p5-16` — grounding fails on the first draft in 3 of 3 measured runs, on
   BOTH generators.** The strongest open finding in the file, and the one most
   likely to be misread: changing the model did not fix it, so the remaining
   suspects are prompt P2 and a fixture whose career base deliberately
   under-covers its vacancy. Nothing about prompt quality should be concluded
   from the one case that exists. Phase 5, guardrail round.

2. **`p3-23` — the coverage gate compares term FORMS.** A base saying
   "Microsoft Office" or "NodeJS" does not satisfy a posting saying "MS Office"
   or "Node.js", and that row is a false Gap at any similarity — the same class
   of error the gate was built to remove, narrowed from topic to spelling.
   User-visible on every scan. Phase 3, lexical-gate round.

3. **`M-3` (= `ns-4`) — the career `[id]` route still does not parse its
   segment**, so a non-UUID reaches Postgres and returns 500 where Block D
   mandates 404. Open since Phase 2 across two review rounds, and easy to believe
   is fixed: a comment on `src/app/api/applications/[id]/route.ts` says the
   finding was "closed here rather than repeated", which it was — for that route
   only. Phase 2, and again Phase 6.

4. **`M-4` — `POST /api/career/import` spends a metered model call before rule
   B9's cap refuses the save.** Re-checked while writing this section and still
   open: the handler has no item count in front of the model call. It is the one
   open item that costs money every time it fires. Phase 2.

5. **`p4-27` — the committed migrations may not run on a fresh project.**
   `001_init.sql` installs and uses `moddatetime`, which was not available on the
   project this app actually runs against; `004_profiles.sql` was rewritten to
   match reality and the other three were not re-read. SPEC Block C reproduces
   `001_init.sql` verbatim, so the canonical set-up script carries the same
   assumption, and Block C never gained `profiles` at all. This is what a reader
   following the README's local-setup steps would hit first. Phase 4.

6. **The Playwright suite can no longer create accounts on this project.**
   Registration is closed in Supabase and that setting is the deployment's only
   gate, so all four specs now fail at their fixture. The next change to a tested
   path has no green suite behind it until a second Supabase project exists or the
   specs sign in to pre-created accounts. Recorded at the end of
   `docs/eval/phase-6-e2e-run.txt` with the three options and their costs.
   Phase 6, owner triage.

7. **Two one-line owner actions gate sharing the link.** `IMPRESSUM_FILLED` is
   still `false`, so `/impressum` correctly states the operator is not published —
   accurate, and not a substitute for filling it in. And **Speed Insights must be
   off** in the Vercel dashboard: it beacons per-visit data to a third party, and
   `/privacy` states in its own words that there are no analytics and no trackers.
   The CSP would currently stop the beacon leaving, which is a reason to turn the
   setting off, not a reason to lean on a header to keep a promise the page makes
   in prose. Phase 6.

---

## Grouped by what would reopen them

These are not waiting on someone's time. Each is waiting on a condition, named
here so that when the condition arrives the work is already identified.

### When a second real person holds an account

- **`eu-8`** — granular erasure. Carried by owner decision precisely because the
  store holds one person's own data today and account deletion removes all of it.
  A second account holder is the event that makes it an exposure rather than a
  limitation `/privacy` states plainly. The fix needs an owner amendment to
  CLAUDE.md's RLS matrix, which is deliberate and should stay deliberate.

### When the test suite can create accounts again

Every evidence gap below is blocked on the same fixture problem, not on anyone
being unwilling to write the test.

- **`e-1`, `e-2`, `e-3`, `e-4`** — the Phase-2 evidence gaps: the dedup bound, the
  Edit-save request count, `CAREER.truncated` reaching a screen, the target-role
  round trip.
- **`p3-3`** — a successful draft re-run has no test; the failing-service path
  does.
- **`p4-6`** — the auto-revision wiring has no deterministic test.
- **`p5-8`** — [Regenerate] has no request-count assertion, the only one of five
  metered buttons without one.
- **`m-5`** — edge case S6 is cited as the reason for a design decision in three
  files and asserted in none.

`p3-4` used to sit in this group and does not belong here: its own entry says the
blocker is that `tests/` may reach neither a DAL nor the service-role key, so no
spec can count `llm_calls` rows at all — R6 and R10, not the fixture — and the
`/quality` dashboard it named as the place this becomes observable now exists.
`n-5` is not here either: a substring count assertion that also matches the wrong
number is a one-line edit to a spec file with no precondition on it.

### When a second calibration case exists

Everything here is entangled with one fixture whose career base deliberately
under-covers its vacancy, so none of it can be separated from the corpus until a
second, well-covered case is built.

- **`p3-14`, `p3-15`** — seven labeled requirements, and the weakest number in the
  set is `SIMILARITY_FLOOR`.
- **`p4-11`** — the thresholds are reused against the re-score's ephemeral corpus,
  which no labeled set has been run against.
- **`p5-16`, `p5-17`** — the grounding finding, and the fact that the comparison
  used the same case but a fresh account each time rather than the same row.
- **`p3-26`** — `keywordRegex` escapes a term verbatim with no whitespace
  normalization, so a copy carrying a line-wrap or a double space never matches.
- **`p3-25`** — `terms` are bounded and never rendered except as the one missing
  term, so a parser returning twenty near-duplicates would go unseen.

Two ids were filed here and moved out. `p3-24` — the keywords table counts against
the scored source while the gate searches the base, so the two can legitimately
disagree — names its own fix in its entry, and it is a shared label on the result
screen, not a calibration question. `p3-19` — the enumeration split is a shape
test — asks for a unit assertion of that boundary, which `tests/unit/chunking.test.mjs`
can make today against no fixture at all. Both are ordinary open work.

### When `resume_versions` learns which model wrote a version

One migration, and two things resolve with it.

- **`p5-14`** — "written by" describes the application's most recent generation,
  not the version on screen.
- The measurement this unlocks is the one worth having: rubric outcomes grouped
  BY MODEL on `/quality`, which turns "does the fallback fail grounding more
  often" from an impression into rows.

`p5-15` was filed here and is not waiting on the column: its entry ends "one line
there would close the last gap in the same class", and that line is copy on the
judge card.

### When the app runs on more than one instance, or a user opens two tabs

Each of these is a race that a single warm serverless instance hides.

- **`p4-4`** — the generate lock is per-instance, so two instances can each hold
  one for the same application and run two full pipelines.
- **`p3-10`** — the draft re-run has no in-flight lock at all, while `/generate`
  has a 409.
- **`p4-29`** — two concurrent exports both read the latest version before either
  inserts, and both append. `p4-5` is a DIFFERENT case in the same function —
  text identical to an OLDER version is not deduped at all — and it is not a
  race, so it is ordinary open work; the two become one fix only if the version
  list ever starts reading as a download log.
- **`a-3`, `a-5`** — the import's two statements have no transaction; the dedup
  guard is not idempotent under concurrency.
- **`p4-14`** — no server-side one-click guard on `POST …/judge`, which has only
  the client's own ref in front of it.

### When the thirteen check rules are unfrozen

- **`vs-10`** — nothing stops a THIRD `src/app/api/dev/` route shipping without
  its production 404 guard. An R14 asserting the guard is the first statement of
  every such handler would convert code review into a build failure. It needs an
  owner decision because it means unfreezing the rule set, which is why it is
  here and not done.

### On the next deployment, or the next dashboard change

- **`vs-8`** — pin the Vercel project's Node version to 22.x rather than
  inheriting a default that moves. It is in `docs/deploy.md` as a precondition;
  what is missing is a record that it was set.
- **`vs-9`** — if any Deployment Protection is ever enabled, its bypass token is a
  secret under CLAUDE.md's rules and `scripts/check.mjs` would not catch it pasted
  into a config file.
- **`vs-11`** — the middleware calls `getUser()` on every non-excluded request.
  Now that functions are in `fra1`, measure a signed-in navigation from a European
  client before doing anything; it is a NIT precisely because it is unmeasured.
- **The `reportAllChanges` console error** — established as NOT this app's code,
  with the investigation recorded so nobody repeats it. Kept because it is a
  finding about the platform, and the next person to see it should find the answer
  rather than the search.
- **Speed Insights**, above.

### Parked product decisions, not defects

Four **FEATURE** entries in the Phase-2 owner-feedback section: grouping `/career`
by source, near-duplicate detection on the review screen, a `summary` item type,
and an inline import panel on the empty state. Asked for explicitly and not built.
They reopen when the owner wants them, and on no other condition.

---

## Closed since Phase 5

Marked here and again beside the entries below, because a closure that exists in
only one place is a closure the next reader argues with.

| id | Closed by | What makes it checkable |
|---|---|---|
| `p4-30` | Phase 5, SPEC v2.20 | `DAILY_CALL_LIMIT` and `DAILY_RESCORE_LIMIT` are in `src/lib/budget.ts` with `underDailyCallCap` / `underRescoreCap`, and `tests/unit/budget.test.mjs` pins the boundaries |
| `p3-1`, `m-3`, `ns-5`, `vs-7` | Phase 6, SPEC v2.25 | `MAX_PDF_BYTES` is 4 MB in `src/lib/copy.ts`, under the platform's 4.5 MB body limit, and `src/app/api/career/import/route.ts` checks `Content-Length` before buffering |
| `p3-2`, `p4-1` | Phase 6, SPEC v2.24 | the function-duration table in SPEC Block D, measured against the verified plan ceiling |
| `ns-1`, `vs-3` | Phase 6 | `docs/eval/dev-routes-production-evidence.md` — the fence run against a production build |
| `eu-9` | Phase 6 | `docs/eval/erasure-evidence.md` — all eight owner-scoped tables to zero, deleted through the app's own control |
| `eu-11`, `eu-14`, `eu-15` | Phase 6 | the `/privacy` rewrite and the Impressum work |
| `vs-1`, `vs-4`, `vs-5`, `vs-6`, `ns-2`, `eu-2`, `eu-5`, `eu-6`, `eu-7`, `eu-10` | Phase 6, SPEC v2.25 | the owner triage round — its own section below says what each one was |
| `p3-13`, `p3-17`, `p4-19`, `p3-8`, `m-4` (budget half only) | Phases 3–4 | already marked beside their entries |
| `eu-12` | Phase 7 | `README.md` now points at `docs/openrouter-processing.md` for the provider retention decision, which is what the finding asked for |

Two things this table deliberately does not say. `p3-22` is not a closure — it
**moved**, from a backlog item to a pre-deploy gate, and its entry says so.
`M-3`/`ns-4` and `M-4` are **not** closed; both were re-checked against the code
while this section was written and both are still open, which is why they are in
*Read these first* above.

---

# The record, by round

Everything below is the history, in the order it was written. Entry text is not
rewritten here; closures are marked beside the entries.

## Phase 2 — from `docs/reviews/phase-2.md` (2026-09-03)

> **M-1 and M-2 were CLOSED in the owner-feedback round** (commit "feat(career):
> named imports with provenance, and a duplicate guard") and are struck from this
> list rather than left as instructions to redo finished work. M-1's `setNotice`
> now runs on both branches; M-2's metered buttons are locked by a ref set
> synchronously, since a `disabled` prop cannot guard two clicks that fire before
> React re-renders. Their remaining EVIDENCE gaps are e-2 and e-3 below.

- **MAJOR M-3** — the `[id]` route segment is unvalidated, so a non-UUID id reaches Postgres and returns 500 where Block D mandates 404; parse it with `z.string().uuid()` after `requireApiUser()` in both verbs of `src/app/api/career/items/` and throw `NotFoundError` on failure.
- **MAJOR M-4** — rule B9 says "block import", but `src/app/api/career/import/route.ts` checks no cap and spends an `import_resume` call before the save path refuses; count items after `requireApiUser()` and before the model call, and disable the trigger at the cap using the `itemCount` the dialog already receives.
- **MINOR m-1** — SPEC's declared B7 bound says the overshoot is zero, but a step that spends its second retry request commits two `llm_calls` rows against one cap check; restate as "zero per user-initiated step, at most +1 per step that retries" in `SPEC.md` and in the `CallLedger` doc block in `src/lib/chat.ts`.
- **MINOR m-2** — two Zod bounds in `src/lib/validation.ts` carry no message, so raw Zod text ("Too big: expected string to have <=20000 characters") renders in the app's own voice; give both constants in `src/lib/copy.ts` and extend `ItemFieldErrors` to cover `period`, which currently has no field to attach to.
- **MINOR m-3** — the 5 MB ceiling is checked after `formData()` has already buffered the body, and `MAX_PDF_BYTES` exceeds Vercel's 4.5 MB request limit, so a 4.6 MB PDF fails with the generic copy instead of edge case L5's exact string; pre-check `Content-Length`, correct the comment in `src/app/api/career/import/route.ts`, and reconcile the advertised ceiling before deploy.

> **`m-3` is CLOSED** — as `ns-5`/`vs-7` in Phase 6, which answered the ceiling
> question this entry opened: the platform limit is 4.5 MB, `MAX_PDF_BYTES` is
> now 4 MB, and the `Content-Length` pre-check is in the import route. **`M-3`
> and `M-4` above are NOT closed** and were re-checked against the code in
> Phase 7 — the career `[id]` route still has no uuid parse, and the import
> route still has no item count in front of its model call.

- **MINOR m-4** — load-bearing pure logic is untested or untestable where it sits: `importedResumeText` and `isPdfUpload` in `src/lib/validation.ts` have no test, `indexWarningFor` is pure but buried in `src/app/api/career/items/route.ts`, and the retry budget cannot be tested at all from `server-only` `src/lib/chat.ts`; extract the budget arithmetic into a pure module (the same argument that moved the price table into `src/lib/pricing.ts`) and pin "two requests maximum, in either order of exception".
- **MINOR m-5** — edge case S6 is cited as the reason for a design decision in `src/lib/db/careerItems.ts`, `src/lib/errors.ts` and the `[id]` handler but asserted nowhere; add a two-account test that PATCHes and DELETEs user A's item as user B and expects 404 with `NOT_FOUND`.
- **MINOR m-6** — stale annotations now that `tests/e2e/career.spec.ts` ships: `playwright.config.ts` still says the suite is auth-only until Phase 7, and the `SPEC.md` Block A layout still enumerates only auth/scan/privacy specs; correct both, and Block H item 3's green-suite list with them.
- **NIT n-1** — `extractedItemSchema.period` in `src/lib/validation.ts` is `.nullable()` but not `.optional()`, so a model that omits the key rather than emitting `null` burns the one repair retry on a formatting nit; use `.nullish()` with a `?? null` transform.
- **NIT n-2** — the Edit dialog in `src/components/career/career-item-card.tsx` seeds state once and is never re-keyed, so cancelling an edit and reopening shows the abandoned draft instead of the stored row.
- **NIT n-3** — `batchByItem` in `src/lib/retrieval.ts` gives an item with more than `EMBEDDING_BATCH_SIZE` chunks its own batch, which `embedFor` then splits across two requests, defeating the "a batch never splits an item" invariant the three-state warning rests on; unreachable at `MAX_CHUNKS_PER_ITEM = 20` (v2.14 raised it from 2; still below `EMBEDDING_BATCH_SIZE` 64), so add the explicit throw that makes it fail loudly if that constant changes — it changed once already, in the round that closed p3-13, and this entry was the thing that should have caught it.
- **NIT n-4** — both client components walk `res.json()` results untyped (`payload?.error?.message`), keeping the Block D shape in four places; a shared `parseApiError` would hold it in one.
- **NIT n-5** — `tests/e2e/career.spec.ts` asserts the item count by substring, so "1 item" also matches "11 items"; use an exact or regex matcher.
- **NIT n-6** — `fillPrompt` in `src/lib/prompts.ts` interpolates user text verbatim, so a CV containing a literal closing `</resume>` tag ends the data block early; the tagged-data plus output-validation design is the accepted containment (S1), but stripping the closing tag from interpolated values costs nothing.
- **NIT n-7** — `assertUnderB9` maps both capacity ceilings to 400 `VALIDATION_ERROR`; defensible since Block D has no capacity row and the copy is exact, but a limit is not a malformed body, so either add the row to `SPEC.md` or record the decision there.

## Phase 2 owner-feedback round — deferred by the owner (2026-09-03)

Asked for explicitly and NOT built. Each is a product decision the owner has
parked, not a defect found in review.

- **FEATURE** — group the `/career` list by source with a toggle, so a base built from several resumes can be read one document at a time instead of only by item type; the provenance chip already carries the name, and `listImports()` already returns the runs the toggle would group by.
- **FEATURE** — near-duplicate detection on the review screen: flag proposed items whose embedding similarity to a stored item is >= 0.95 and let the user decide, rather than silently keeping both. Deliberately not what `src/lib/dedupe.ts` does — that guard is exact-match only, because a threshold that discards without asking is the one failure mode this app cannot see.
- **FEATURE** — a `summary` career-item type, pinned first within its own source, so a resume's opening profile paragraph reads as a summary rather than as another role; needs a `career_items.type` CHECK change and an ordering rule inside each group.
- **FEATURE** — an inline import panel on the empty state, so a first-time user starts pasting without opening a dialog; the empty state currently renders the same dialog trigger as the header.

## Phase 2 owner-feedback round — from the ai-architect re-review (2026-09-03)

Its BLOCKER (the /privacy data-category list) and the factual drift my own
migration caused are fixed on this branch. These are the rest. Recorded in
`docs/reviews/phase-2.md` under the addendum.

- **MAJOR a-1** — a changed `period` is silently discarded: `period` is correctly out of the dedup key, but `dedupeItems` drops the whole incoming item and nothing updates the stored row, so a newer resume's "01/2025 – 08/2026" never replaces a stored "01/2025 – present" and the user sees only a skipped count with no names; name the skipped items on the saved step so the one that moved can be edited.
- **MAJOR e-1** — the duplicate e2e asserts `saved === 0`, which holds only while the primary model serves at temperature 0; the bound is now declared in `src/lib/dedupe.ts` and SPEC, but the assertion still reads as a guarantee the guard cannot give — assert the contract (`skipped > 0`) alongside the DoD number, or drive the case through a stub.
- **MAJOR e-2** — the M-2 fix on the Edit save (`src/components/career/career-item-card.tsx`) has no test: the request-count case double-clicks the IMPORT Save instead, so the button the review actually flagged is unverified; add a case that double-clicks Edit → Save and asserts exactly one PATCH.
- **MAJOR e-3** — `CAREER.truncated` still has no evidence of reaching a screen; the code fix landed but the >20,000-character paste assertion promised in the phase-2 report was never written.
- **MAJOR e-4** — the target-role half of the request is unverified end to end: `importMetaSchema`'s blank-to-null transform has no unit test and no e2e import fills the field, so `CAREER.fromImport`'s two-part branch has never rendered in a test.
- **MINOR a-2** — the B9 headroom alert in `src/components/career/import-resume-dialog.tsx` counts pre-dedup selections, so a mostly-duplicate batch can warn about a limit the server will never reach; word it as headroom or show it after the server answers.
- **MINOR a-3** — `insertImport` then `insertCareerItems` is two statements with no transaction, so a failed item insert leaves a run row that no policy can delete, advancing the count and letting a retry create a second row with the same name; declare the race or look up an empty same-name run first.
- **MINOR a-4** — the "Resume N" default is derived from a COUNT and never from stored names, so it disagrees with storage after any rename and two runs can both render `from: Resume 2`; `imports.name` has no uniqueness, so disambiguate the chip by date on collision or declare collisions accepted.
- **MINOR a-5** — the dedup guard is not idempotent under concurrency: two saves in flight both read the signatures before either inserts, and no unique constraint backs the key, so exact duplicates can still land; same class as the declared B9 race, so declare it in the route docblock.
- **MINOR a-6** — `src/components/career/career-item-card.tsx` seeds Edit state once and never re-keys, so cancelling and reopening shows the abandoned draft and Save then buys a re-embed for an intention the user withdrew; `key={item.updated_at}` on the dialog. (Supersedes NIT n-2, which the architect argues is above NIT now that this component's spend path was reworked.)

## Phase 4 — closed here, from earlier rounds

Struck rather than left as instructions to redo finished work.

> **MINOR m-4** (phase-2) is CLOSED for the metered-request budget: the retry
> arithmetic moved out of `server-only` `src/lib/chat.ts` into pure
> `src/lib/budget.ts`, and `tests/unit/budget.test.mjs` pins "two requests
> maximum per step, in either order of exception" plus the derived
> generate ceiling. The rest of m-4 (`importedResumeText`, `isPdfUpload`,
> `indexWarningFor`) is untouched and still open.
> **MINOR p3-8** (phase-3) is CLOSED: an optional application id is threaded
> through `matchDocuments` / `matchDocumentsForTexts` / `embedTexts` →
> `embedFor` → `logEmbedCall` in `src/lib/retrieval.ts`, so a scan's, a
> generate's and a re-score's embedding rows all carry the run they belong to.
> Indexing a career item still passes null, which is correct — it belongs to no
> application.

## Phase 4 — from building it (2026-09-03)

The ai-architect gate ran on the PLAN before any code existed
(`docs/reviews/phase-4-architect-plan.md`); its three BLOCKERs and eight MAJORs
are fixed on this branch and declared in SPEC v2.16. What is below is what the
build itself turned up, plus the architect items that were agreed to be
non-blockers.

- **MINOR p4-1** — `maxDuration = 300` in `src/app/api/applications/[id]/generate/route.ts` is the honest budget for four chat steps, and nothing verifies it against the deployment plan's own function-duration limit; this is `p3-2`'s question on a route whose worst case is four times longer, and a platform cut below it kills `after()` and drops the `llm_calls` rows for calls that WERE billed (rule B8). Check both numbers at the vercel-security gate, before deploy.

> **CLOSED by SPEC v2.24, together with `p3-2`.** Block D’s "Function duration
> on the deployment plan" carries the verified ceiling, every route’s declared
> value and what a run exceeding one actually does. `maxDuration = 300` on
> `/generate` stands against a worst case of roughly 248 s, which is the
> comparison this entry asked for and nobody had made.

- **MINOR p4-2** — ~~diagnosed as schema strictness~~ **re-diagnosed on the architect's diff review, and half-fixed on this branch.** A real run logged `[chat] judge output failed validation, one repair retry`. The likelier cause is not the schema but the OUTPUT CEILING: `MAX_TOKENS_BY_STEP.judge` was 1200 against a `judgeReportSchema` that permits fifty violations with two 2,000-character fields each, plus a 4,000-character `evidence` and three more lists. A token cut produces a TRUNCATED JSON, which is non-empty, so it returns as a success, fails Zod, and spends the single repair retry at the same ceiling to truncate in the same place — two Haiku calls, a 502, and on `/judge` nothing saved. Raised to 3000 here. What is still open: **`chatCompletion` does not read `finish_reason`**, so a length cut is indistinguishable from a model that got the JSON wrong, and only the second of those is worth a retry — the same argument the connection already makes for a non-2xx response ("the service answered; asking again buys the same refusal at the same price"). Treat `finish_reason === 'length'` as its own failure, and measure the retry rate on `/quality` before touching the schema.
- **MINOR p4-3** — `POST /api/applications/[id]/judge` re-retrieves its own career items, so [Check quality] can judge against a different item set than the one the AI draft was written from, and the two grounding verdicts are not strictly comparable. Declared in SPEC v2.16 and honest for what the button means ("is what I have now supported by what I have now"), but the fix is to store the retrieved item ids on the version row — which needs a `resume_versions` column and therefore a migration this phase does not make.
- **MINOR p4-4** — the generate lock in the same route is per-INSTANCE, so two serverless instances can each hold one for the same application and run two full pipelines. It closes the double click and the second tab, which is what actually happens; a concurrent-invocation race needs a row or an advisory lock, and `applications` has no column for one. Decide before the app has more than one warm instance.
- **MINOR p4-5** — `POST …/export` skips the `source='user'` insert only when the content equals the LATEST version, so exporting text identical to an OLDER version appends a duplicate row. Correct as "unchanged since I last saved" and wrong as "this text is already stored"; compare against the whole history if the version list starts reading as a download log.
- **MINOR p4-6** — the auto-revision WIRING has no deterministic test. Both branches were observed in real runs (one approve, several revise-and-rewrite) and the DECISION is unit-tested in `tests/unit/judge.test.mjs`, but which branch a run takes is the model's choice, so `tests/e2e/generate.spec.ts` asserts it conditionally and the coverage is opportunistic. A stubbed chat gate — the same instrument `p3-3` wants for the draft re-run — would pin both.
- **NIT p4-7** — the generated resume's header depends on a name the career base does not contain: `P4` splits a resume into items and the name line becomes part of none of them, so there is nothing for P2 to put on the first line. One early run emitted the literal placeholder `NAME`, which then became the export filename (`CV_NAME_…`); it has not recurred since the vacancy keyword list left the prompt, and it is not reproducible on demand. Refusing to invent a name is the generator behaving correctly, so the fix is to ASK for one — a name field on the editor, or a `profiles` row, which Block C decided against for MVP.
- **NIT p4-8** — `GenerateOutcome.revisionWithheld` is unreachable in practice, because `needsRevision()` already requires at least one finding; it is kept as the explicit statement of the branch rather than as an implication of another function, and `RESULT.reviseWithoutFindings` renders it. Delete both only if the schema is ever changed to reject a `fail` verdict with no violations.
- **NIT p4-9** — `p3-12` widens: `result-workspace.tsx`, `resume-editor.tsx` and `judge-card.tsx` all read row shapes from `server-only` `src/lib/db/types.ts`. It holds because `import type` is elided and the module reads no secret, but that is now eight client components resting on the same argument — either drop the marker or move the client-facing types out of `lib/db/`.
- **NIT p4-10** — `RESULT.generateSteps` (US-4 step 1's "Retrieving your experience… Writing… Quality check…") is declared and unused: the button shows one label for the whole run rather than cycling three, because nothing on the client knows which server step is running and a timer-driven cycle would be a progress bar that reports the passage of time as progress. Declared rather than deleted, because the Block E state it names is real; wire it if `/generate` ever streams its stage.

## Phase 4 — owner-testing round (2026-09-03)

Two defects, a UI gap and a product decision, from the owner using the live app.
Both defects and the gap are fixed on this branch and declared in SPEC v2.17.
What is below is what the round turned up alongside them.

- **MINOR p4-17** — the display-name gate matches FORMS, the same limitation `p3-23` already carries for rule B1's lexical gate, because it is the same function: a base writing "Microsoft Office" does not satisfy a reviewer's "MS Office", so that term lands under "not in your career base" and the user is told to add something they already have. The direction of error is the conservative one here — a suggestion not made, rather than the app telling someone to claim what they have not done — but the two gates now share one alias problem, and a fix to `p3-23` fixes both.
- **MINOR p4-18** — `getDisplayName()` swallows a failed read and falls back to the placeholder so an optional field can never destroy a paid run, while `getProfile()` (Settings) still throws. That split is right, and it means a `profiles` outage is invisible on the generation path except in a server log. If `/quality` ever grows a health panel, a "profile unreadable" counter belongs in it; until then the only witness is `console.error`.
> **p4-19 is CLOSED by the PR-review run (SPEC v2.18).** 004 is applied, the suite was re-run, and `docs/eval/phase-4-e2e-run.txt` carries it: 32 passed, 1 skipped, with the display-name path and the `profiles` cascade both witnessed for the first time. The entry was right that the feature was unwitnessed and wrong about why it would stay that way — the PROBE was broken, not the migration. `locator.isVisible()` does not auto-wait and ignores the timeout it is handed, so the guard could only ever pass as a skip, and applying 004 turned it red because the feature started working and the probe could not see it. Struck rather than deleted: "a never-executed guard eventually produces a finding about itself" is the reasoning worth keeping. The item as written:
>
> ~~**MINOR p4-19** — the display-name e2e SKIPS until `004_profiles.sql` is applied, probing by performing the feature's own first save. That is the right shape (it starts running by itself, and it cannot drift from what it guards), but it means the whole feature is unwitnessed on any machine where the migration has not been run — including a fresh clone. Re-run the suite once after applying 004 and record it in `docs/eval/phase-4-e2e-run.txt`.~~

- **MINOR p4-20** — the `X-Name-Placeholder` response header is a private contract between the export route and one client, and nothing types it: a rename on either side fails silently and the warning stops appearing. It is a header rather than a body field because the response IS the file, which is the right trade; pin the name in a shared constant if a second such header ever appears.
- **NIT p4-21** — the judge panel's "supported by your base" split is computed at THREE sites (the detail page, `/generate`, `/judge`) from one pure function. The card's required prop makes forgetting a compile error, so the invariant holds, but a fourth render site would mean a fourth call; if one appears, move the partition into a small server helper that returns the report and its terms together.
- **NIT p4-22** — `RESULT.generating` lost its ellipsis so `<BusyDots />` can supply it, while `rescoring` / `checkingQuality` / `exporting` keep theirs. Deliberate — only the generate button runs long enough to need motion — but it makes one of four sibling constants shaped differently, which is the kind of thing a later reader "tidies".
- **NIT p4-23** — a stray control byte reached a committed test: `literalNamePlaceholder` was checking `/^NAME<BS>/`, a literal backspace where `\b` was intended, so it reported false on every run and the eval file drew a conclusion from it. Fixed, and a sweep found no other occurrence on the branch — but nothing PREVENTS it. The check-rule set is frozen, so this is a note rather than an R14: if the set ever reopens, "no C0 control characters outside tab/newline in a source file" is a two-line rule that would have caught it.

## Phase 4 — from the ai-architect review of the OWNER-TESTING ROUND (2026-09-04)

Its BLOCKER (the display name reaching P2 and P3 as instruction text) is fixed on
this branch, and so are findings 2, 3, 4, 6, 7, 9, 10 and 11 — they were either
documentation that had stopped being true or one-line changes whose absence was
the defect. The report is `docs/reviews/phase-4-owner-round.md`. What is left:

- **MINOR p4-24** — `JudgeReport.keywordCoverage.missingHonest` still crosses the wire in both route bodies and in `versions[].judge`, so the type system closes the render site that exists (`JudgeCard`'s required `terms` prop) and not the SHAPE. A future component could read the raw list. SPEC v2.17 note 4 now says so rather than claiming more; the fix, if one is wanted, is a client-facing report type with the field stripped — which means a second shape and a mapping, so it is worth doing only when a second consumer appears.
- **NIT p4-25** — `result-workspace.tsx` re-syncs `versions` from `initialVersions` on prop-identity change but deliberately does NOT re-sync `review.terms` from `initialJudgeTerms`: for a report the client just fetched, its own partition is the fresher answer. Correct, and now that all three sites use the same corpus the two can no longer disagree about a term — but the docblock does not say the two halves of one refresh are treated differently on purpose.
- **NIT p4-26** — the display-name gate strips `<` and `>` so `<candidate_name>` cannot be closed early, which is the containment `n-6` accepts NOT having for `<resume>` and `<items>`: a resume legitimately contains angle brackets, so there the tagged block plus output validation is the declared answer. Two policies for two values, each right for its own value — but if `n-6` is ever revisited, this is the precedent for what a full fix looks like.
- **MAJOR p4-27** — `004_profiles.sql` was rewritten to match what actually ran on the live project, because `moddatetime` is not available there and the committed version assumed it; re-read `001_init.sql`, `002_audit_retention.sql` and `003_imports.sql` for the same assumption (001 installs the extension and uses it for the `career_items` and `applications` touch triggers), since a migration that only runs on this project is not a migration — the committed file has to be runnable as-is on a fresh one, or the repo's schema and production's are two different things nobody is comparing. **WIDENED by the PR review (`docs/reviews/phase-4.md` M-2):** the three `.sql` files are not the whole scope. SPEC Block C reproduces `001_init.sql` VERBATIM, `create extension if not exists moddatetime;` included, so the spec's canonical set-up script fails on its second line against the project it describes, and a reader following it on a fresh project gets no touch trigger on `career_items` or `applications` — `updated_at` silently stops advancing and nothing in the app notices. Block C also never gained `profiles` at all, so the eighth table's shape is written down only in the migration file, which is the file that just changed. Re-read Block C alongside the three migrations.

## Phase 4 — from the ai-architect DIFF review (2026-09-03)

Both BLOCKERs and every MAJOR are fixed on this branch and declared in SPEC v2.16
(the keyword-list split, the revision step's own refusal, rule B1b on the
re-scored number, the judge token ceiling, the re-score chunk cap, and the
threshold-calibration gap). The report is `docs/reviews/phase-4-architect-diff.md`.
What is below is the rest.

- **MINOR p4-11** — rule B1's thresholds are calibrated against ONE corpus (the career base through `match_documents`) and reused unchanged against the re-score's ephemeral single-resume corpus. The reuse is argued rather than measured, so a delta in the ring after [Re-score] is not attributable to the edit alone. Seed the calibration case, re-score its own generated draft UNEDITED as a baseline, and compare the two distributions before deciding whether the re-score path needs its own numbers. Recorded at the top of `docs/eval/coverage-thresholds.md`.
- **MINOR p4-12** — `RetrievedItems.droppedForSize` is computed in `src/lib/tailoring.ts` and read by neither route, so an item dropped by the `MAX_ITEMS_CHARS` budget is silent — against this codebase's own standard two files away, where `lib/coverage.ts` logs the keyword drop with a count. Log it, or return it as a `notice` the way endpoints #1 and #4 already do. Also `itemsPayload`'s size arithmetic in `src/lib/generation.ts` counts `title + content + period` and omits `type` and the JSON envelope, so the real `<items>` block runs roughly 60 characters per item over the declared 24,000 — harmless at this scale, wrong as a stated bound.
- **MINOR p4-13** — the "Auto-revised once" badge in `src/components/applications/result-workspace.tsx` is derived from `versions.some(v => v.source === 'ai_revision')`, so it survives into states it no longer describes: after [Check quality] appends a `user` version, the badge sits above the user's own text and the user's own report. Derive it from the version being SHOWN rather than from the history.
- **NIT p4-14** — no server-side one-click guard on `POST …/judge`: it is a metered chat endpoint with only the client's synchronous ref in front of it, while `/generate` has its 409 lock. Same shape as `p3-10`, which already carries the `/scan` re-run; one mechanism should close all three.
- **NIT p4-15** — the render-time re-sync in `result-workspace.tsx` (`setVersions` when the `initialVersions` prop identity changes) is React's documented pattern and correct, but `run()` serialises the REQUESTS and not the `router.refresh()` calls they fire: a refresh from action N−1 resolving after action N's `setVersions` would show the pre-N rows until the next refresh. Self-healing and cosmetic; close it by awaiting the refresh inside the lock if the version list ever gains an action that matters.
- **NIT p4-16** — `FS_UNSAFE` in `src/lib/utils.ts` is `/[<>:"/\|?*]/gu`, in which `\|` escapes the pipe and leaves no literal backslash in the class, so a backslash in the resume's first line survives into the export filename. Pre-existing and outside this branch's diff; add the backslash and a case to `tests/unit/export-filename.test.mjs`.

## Phase 3 — from the ai-architect phase gate (2026-09-03)

Its two BLOCKERs and every MAJOR are fixed on this branch; SPEC v2.12 declares the
deviations they produced. What is left is below. The `p3-` ids are this gate's.

- **MINOR p3-1** — `MAX_SCAN_BODY_BYTES` and `MAX_PDF_BYTES` advertise 5 MB while a serverless request body is commonly capped lower (4.5 MB on Vercel), so a 4.6 MB PDF fails with a platform error instead of edge case L5's exact copy; this is backlog `m-3`'s ceiling question now reaching a second endpoint — reconcile the advertised number once, before deploy, and adopt the `Content-Length` pre-check in `src/app/api/career/import/route.ts` too (the scan route already has it).
- **MINOR p3-2** — `maxDuration = 120` in `src/app/api/scan/route.ts` is the honest budget for two 60 s chat attempts plus embeddings, but nothing verifies it against the deployment plan's own function-duration limit; check it at the vercel-security gate, because a platform cut below it drops the `llm_calls` row for a call that WAS billed (rule B8) with /quality as the only witness.

> **`p3-1` and `p3-2` are both CLOSED, by different rounds.** `p3-1` went with
> `ns-5`/`vs-7` in Phase 6: the ceiling is 4 MB, under the platform’s 4.5 MB
> request limit, and the import route adopted the `Content-Length` pre-check
> this entry asked it to. `p3-2` is closed by SPEC v2.24’s function-duration
> table in Block D, which is what "check it at the vercel-security gate"
> asked for — the number was checked against the verified plan ceiling and it
> stands. Both entries kept: they are the questions that produced the table.

- **MINOR p3-3** — a successful RE-RUN of a draft has no test: `tests/e2e/scan.spec.ts` proves the button is wired and honest against a failing service, and the success path is the same server code as a first scan, but nothing exercises draft → scored. Needs either two dev servers in one run or a stubbed chat gate.
- **MINOR p3-4** — "exactly one `parse_vacancy` row per scan" is structural (one call site, plus check.mjs R5/R6) and not asserted anywhere: `tests/` may not touch a DAL or the service-role key, so no spec can count `llm_calls` rows. The `/quality` dashboard (Phase 6) is where this becomes observable in the app; until then it is an owner query.
- **MINOR p3-5** — the keyword table's `inResume` count for a **career-base** scan is measured against the base as it stood AT SCAN TIME (stored in `coverage.keywords`), so an item added later is invisible until a re-scan; correct and deliberate, but the screen does not say when the measurement was taken. Consider showing the scan's timestamp beside the ring.
- **NIT p3-6** — `src/components/applications/result-tabs.tsx` sorts the keywords table by gap and offers no other order, while Block E says "sortable by gap"; the default is the useful one, but the column headers are not interactive.
- **NIT p3-7** — the dev server logs `Error: The destination stream closed early.` when a client navigates away mid-stream (the scan's redirect, and the deletion redirect in the e2e teardown); a Next dev-mode artefact with no user-visible effect, worth confirming it stays absent from a production build's logs.
- **MINOR p3-8** — the scan's `embed` rows are logged with `application_id: null`, so the embedding half of a run's spend is unattributable and DoD item 7's "one full pipeline run" is one linked row plus orphans; thread an optional application id through `matchDocumentsForTexts` → `embedFor` → `logEmbedCall` in `src/lib/retrieval.ts` (an application id is not a user id, so the gate's no-id rule is not in the way).
- **MINOR p3-9** — the multipart `Content-Length` check in `src/app/api/scan/route.ts` fails OPEN when the header is absent or unparseable, falling through to the buffered read; refusing a multipart body that declares no usable length would close it but also refuse a legitimate chunked upload, so decide which cost is right rather than leaving the comment to imply the fence is unconditional (it now says so).
- **MINOR p3-10** — the re-run has no in-flight lock, while Block D #5 gives `/generate` a 409 `ALREADY_RUNNING` keyed on application id; two tabs or two direct POSTs can both re-analyse one draft, and the client ref guards only a single mounted button. Same shape, same mechanism when #5's lock is built in Phase 4.
- **MINOR p3-11** — `RESULT.scoreExplainer` states rule B1's 60/40 weighting even for a nice-only posting, where B1 drops S and scores `round(100 × K)`; it is now hidden when there is no number at all, but the nice-only wording is still one sentence describing two formulas.
- **NIT p3-12** — `src/lib/db/types.ts` is `server-only` yet four client components read row shapes from it; it holds because `import type` is elided, and it reads no secret, so either drop the marker or move the client-facing types out of `lib/db/`.

## Phase 3 — from the owner's testing round (2026-09-03)

The round's defect (non-literal keywords), its calibration (rule B1's thresholds)
and its two questions (the score arithmetic, the embedding log rows) are closed on
this branch — see `docs/reviews/phase-3.md` and `docs/eval/coverage-thresholds.md`.
These are the parts that were deliberately not done.

> **p3-13 is CLOSED by SPEC v2.14** (commit "feat(retrieval): one chunk per claim…"). Semantic-unit chunking ships, existing rows are re-indexable through a dev-only endpoint, and the before/after is measured in `docs/eval/coverage-thresholds.md`. It fixed what chunk size can fix — attribution and concentration — and did NOT fix the two named-tool false positives, which is now `p3-17`. Struck rather than deleted, because the original entry is the reasoning that produced the fix. The item as written:
>
> ~~**MAJOR p3-13** — chunk granularity is the underlying cause of the compressed similarity band: `CHUNK_TARGET_CHARS = 2_000` with `MAX_CHUNKS_PER_ITEM = 2` embeds a career item as one or two ~2,000-character blobs, so a 60-character requirement can never score high against it however well one sentence of that blob answers it — the measured band tops out at 0.43 and the generic "Skills" item was the best match for three of seven requirements, twice for requirements its own text answers literally. The fix is **one chunk per resume bullet** (~80–300 chars, split on bullet and sentence boundaries): a requirement then meets a claim its own size. Not done here because it is a Phase-2 rebuild with three consequences — every `documents` row must be deleted and re-inserted (no UPDATE policy, by design), B9's `200 × 2 = 400 ≤ 500` reconciliation breaks and the document ceiling has to be re-derived, and the thresholds in `docs/eval/coverage-thresholds.md` are calibrated against blob-sized chunks and would have to be re-derived after it.~~ (All three consequences were paid: every row re-embedded through the dev endpoint, `MAX_DOCUMENTS` raised 500 → 4,000 so the item cap stays binding, and the thresholds re-derived — and left unchanged, because the best cut moved one hundredth.)

- **MINOR p3-14** — the calibration rests on SEVEN labeled requirements from ONE case, and the weakest number in it is `SIMILARITY_FLOOR = 0.20`, which rests on a single labeled gap (0.1759). A second labeled case would either confirm the floor or show unrelated requirements landing at 0.25–0.30, in which case the S term is crediting noise; run `node scripts/coverage-probe.mjs --seed <case>` on a second posting and append to the same file.
- **MINOR p3-15** — the 0.36 threshold knowingly admits one of the two labeled-partial requirements as "covered" (the annotation-platform one, 0.4319, against a base that names no platform), because no single number can separate covered from partial in the labeled set — the highest similarity in it is a partial. A third coverage status ("partially supported") would express what a threshold cannot, and needs a Block D status value, Block E copy and a migration-free `CoverageStatus` widening.
- **MINOR p3-16** — `coverage.keywordsDropped` is stored and never surfaced: nothing renders it and `/quality` (Phase 6) is where a parser drifting back to canonical forms would become visible. Until then it is an owner query against the column.

## Phase 3 — from the semantic-chunking round (2026-09-03)

`p3-13` is closed above. What the measurement turned up while closing it.

> **p3-17 is CLOSED by SPEC v2.15** (commit "feat(scan): a lexical evidence gate on coverage"). P1 classifies each requirement by the evidence it demands and copies the verbatim terms; rule B1 refuses `covered` for a tool or credential requirement whose terms are absent from the CAREER BASE, and the entry names the missing term so Block E can say why. Measured in `docs/eval/coverage-thresholds.md` Part 3: both false positives are Gaps naming their term, all five `general` requirements unchanged, and the one tool requirement the base DOES satisfy (Python) stayed Covered. Struck rather than deleted — the entry is the reasoning that produced the fix. The item as written:
>
> ~~**MAJOR p3-17** — a requirement naming tools the base does not contain is still Covered, and chunking made it stronger, not weaker: "Experience with annotation tools such as Labelbox or Supervisely" scores 0.4587 and "Proficient with MS Office or Google Suite" 0.4438 against a base mentioning none of them — the top two of eight similarities, so no threshold can exclude them without excluding every true positive. Cosine similarity between short texts measures TOPICAL resemblance and both requirements are adjacent to work the base does contain; the distinguishing evidence is LEXICAL. The app already stores it one field away: the same `coverage` payload records `'Labelbox' inResume=0` and `'MS Office' inResume=0` from rule B1a, so the result screen asserts both things at once. The fix is to gate the `covered` decision on that evidence (or to introduce the third status the two signals together support) — a change to rule B1 and to keyword matching, which the p3-13 task placed out of scope. Measured in `docs/eval/coverage-thresholds.md`, Part 2.~~

- **MINOR p3-18** — `POST /api/dev/reindex` re-embeds the whole base in ONE REQUEST-CYCLE, and two bounds break before `maxDuration = 120` does on a base near the item cap: ~4,000 chunks are ~63 sequential embedding requests, and every vector is held in memory until the last arrives (1,536 floats per chunk, ~50 MB at the cap). It is idempotent, so a timeout costs money and corrupts nothing, but a base that large needs slicing (a `?from=&to=` window or a cursor) before the endpoint is useful at that size.
- **MINOR p3-19** — the enumeration split is a SHAPE test (≥4 comma-separated segments averaging ≤45 characters), so a prose sentence built from four short clauses is split like a list and a two-item list is not split at all. Both failure modes are self-healing at the floor — fragments merge with their neighbour — but neither is asserted: the unit tests cover a bulleted item, a prose item, a one-line item and a 600-character sentence, not the enumeration boundary itself.
- **MINOR p3-20** — indexing cost per career item rose with the chunk count (5 rows → 9 rows for the same five items) and every chunk repeats the item title, so the embedded token count grows by roughly `title length × chunks per item`. Measured at 8 → 9 micro-USD for a five-item base, i.e. nothing at this size; worth a number before a 200-item base is re-indexed on a paid plan.
- **MINOR p3-21** — the floor merge can push one chunk past `CHUNK_HARD_MAX_CHARS`: a 79-character bullet followed by a 600-character sentence stores one 680-character chunk, because merging a sub-floor fragment wins over the split bound on purpose. The docblock now says so instead of calling 600 a ceiling on stored length, but nothing asserts an upper bound on a stored chunk and no test covers the collision of the two rules; decide whether the merge should cap (leaving a fragment alone) or the bound should be documented as split-only, and assert whichever it is.
- **MOVED — p3-22 is now a PRE-DEPLOY GATE, not a backlog item.** The `NODE_ENV === 'production'` fence on both `/api/dev/*` routes is sound but unmechanised and unwitnessed: it cannot be unit-tested (the handlers import `server-only`), the e2e suite only ever runs against a development server, and a third dev route that forgot the guard would pass `check`, every test and every gate. A fence with no evidence behind it is the "configured mechanism is not a working one" case, so it is not something to carry indefinitely at MINOR — it is a condition of deploying. It moves to **SPEC Block H item 9**: closed by an OWNER-RUN verification against a production build, recorded in `docs/eval/dev-routes-production-evidence.md` the way the auth audit-retention run is recorded beside it. Phase 6 (pre-deploy) owns it.

## Phase 3 — from the lexical-gate round (2026-09-03)

`p3-17` is closed above. What building it turned up.

- **MAJOR p3-23** — the gate compares term FORMS, so a base that says the same thing differently reads as a gap: the vacancy's "MS Office" does not match a resume's "Microsoft Office", nor "Node.js" a base writing "NodeJS", nor "MS Office" a base writing "MS-Office". Casing is handled (the boundary rule is case-insensitive) and spacing/punctuation/abbreviation variants are not, so this is the exact error the round was told to avoid — a FALSE gap — just narrowed to the cases where the two texts name one product two ways. It cannot be fixed by loosening the match (substring matching would let "SQL" satisfy "MySQL"), so it needs either a small curated alias table for the common products or a second signal; both are new mechanisms and neither belongs in a round that was scoped to connect two things the app already had. Until then the gate is right about ABSENCE and can be wrong about SPELLING, which is worth saying out loud on the result screen before it is worth saying in code.
- **MINOR p3-24** — the keywords table counts `inResume` against the SCORED SOURCE while the gate searches the CAREER BASE, so on a pasted-resume scan the screen can legitimately show "Labelbox: 0 in resume" beside a Covered Labelbox requirement — the base has it, the pasted page does not. Both statements are true and they answer different questions, which is exactly what v2.12 decided for the keyword counts; but the pair reads as a contradiction in the one place a reader is most likely to compare them, and the two tables have no shared label saying which corpus each is about.
- **MINOR p3-26** — `keywordRegex` escapes a term verbatim with no whitespace normalization, so a term whose copy carries a line-wrap or a double space ("Google  Suite") can never match any text, in the gate OR the keywords table; collapsing internal whitespace runs to `\s+` in the pattern would fix both at once, and it is deliberately not done in this round because that regex is rule B1a's shared boundary rule and keyword counting was out of scope — the change needs its own measurement of the keyword table before it lands.
- **MINOR p3-25** — `terms` are bounded (20 per requirement, 200 chars each) and never rendered except as the ONE missing term, so a parser that returned twenty near-identical spans would cost nothing visible while making the any-of test trivially satisfiable. Nothing asserts the shape of what P1 returns there beyond the bounds; a unit test on the seeded case's stored parse would pin it.

## Phase 4 — carried by owner triage of `docs/reviews/phase-4.md` (2026-09-04)

Ten of the twelve outstanding findings were fixed in that round (SPEC v2.19). These two
the owner decided can wait, which is what an entry in this file means.

- **MINOR p4-28** — `Rubric` (`src/lib/judge.ts:29-36`) and `JudgeReport` (`src/lib/db/types.ts:241-248`) are structurally identical, and `src/lib/tailoring.ts` crosses between them with three `as Rubric` / `as JudgeReport` assertions. The DUPLICATION is justified and should stay: `types.ts` is `server-only` and `judge.ts` has to remain unit-testable, the same argument that moved `lib/pricing.ts` and `lib/budget.ts`. The CASTS are the part with no defence — the two types are mutually assignable, so all three assertions are no-ops today, and they are precisely what would absorb a future divergence without a build error. Drop the three casts and add a mutual-assignability assertion in `tests/unit/judge.test.mjs` so the compiler holds the two shapes together. Type hygiene: nothing observable today, which is why it is here.
- **NIT p4-29** — `POST …/export`'s dedupe has a race: two concurrent exports both read `getLatestResumeVersion` before either inserts, both see `latest.content !== content`, and both append. `p4-5` carries a DIFFERENT case in the same function (text identical to an OLDER version, which is not deduped at all); this one is two requests in flight. Cosmetic on an append-only table whose duplicates are visible in the version list, and there is no single-statement fix available — `resume_versions` has no uniqueness to lean on and adding one would forbid a legitimate re-save of unchanged text. Worth doing only if the version list ever starts reading as a download log, at which point `p4-5` and this are one fix.

## Phase 5 — first item, RULED by the owner (2026-09-04)

Not an open question. The decision is made and recorded here so Phase 5 starts with it
rather than re-litigating it.

- **RULED p4-30** — **`DAILY_CALL_LIMIT` and `DAILY_RESCORE_LIMIT` both move to `lib/budget.ts`, as the first item of Phase 5.** Both ceilings currently live in `src/lib/db/llmCalls.ts`, which imports `server-only`, and check.mjs R6 keeps `tests/` away from it — so rule B7's 50 and rule B7a's 100 are untestable by construction, exactly as `MAX_CHAT_REQUESTS_PER_STEP` was until backlog `m-4` moved it. That precedent is the whole argument: the untestable file is where the arithmetic bug hides, `m-4` was raised because the retry budget's number could not be pinned, and `tests/unit/budget.test.mjs` now pins it in both orders of exception. B7a arrived in v2.18 with the same defect and it was raised in the same breath as shipping it (`docs/reviews/phase-4.md`, the hand-over after rule B7a). The two ceilings were deliberately kept TOGETHER in the DAL rather than split so one became testable and the other did not; moving both is what closes it. `lib/budget.ts` is already the home for metered-request arithmetic, is not `server-only`, and reads no environment — so the move is a re-export plus a test, not a redesign. What the tests should pin: the rolling-window comparison at the boundary (committed + ledger vs the ceiling, at limit-1, limit and limit+1) for B7, and the same for B7a's committed-rows-only check, since neither boundary has ever been asserted.

> **CLOSED in Phase 5 (SPEC v2.20).** Both ceilings are in `src/lib/budget.ts`
> as `DAILY_CALL_LIMIT` and `DAILY_RESCORE_LIMIT`, with `underDailyCallCap`
> and `underRescoreCap` beside them, and `tests/unit/budget.test.mjs` pins the
> boundaries the entry named. The queries stayed in `src/lib/db/llmCalls.ts`;
> only the numbers moved, which is what made it a re-export and not a
> redesign. Struck rather than deleted: the argument from `m-4` — the
> untestable file is where the arithmetic bug hides — is the reasoning that
> produced the fix.

## Phase 5 — from the ai-architect diff gate (2026-09-04)

Its BLOCKER and every MAJOR is fixed on this branch, and SPEC v2.20 declares what
each fix changed; the report is `docs/reviews/phase-5-architect-diff.md`. The
`p5-` ids are this gate's. Two of the MINORs and two NITs are what is left.

- **MINOR p5-1** — a stored contact URL is one more author of the text P3 reads inside its `<resume>` block, and the only bound on it is `MAX_LINK_CHARS`. Angle brackets are now refused at the Zod boundary (`src/lib/validation.ts`), so the block cannot be closed early, but a 200-character path of prose still reaches the prompt as data — the same pre-existing class backlog `n-6` records for a pasted CV, where the tagged block plus output validation is the declared containment. Decide whether a `hostname`/`pathname`-shaped restriction is worth it, or state in one place that the tagged block is the whole defence for every author of that region.
- **MINOR p5-2** — `isHeading` in `src/lib/docx.ts` still bolds a one-field contact line: a profile whose only contact detail is a capitalised location produces one short all-caps line with no separator, no `@` and no `://`, which is indistinguishable in shape from a section heading. Same declared class as `ACME LOGISTICS` two comments up, and it cannot be closed by passing the header's identity down — the text this function reads is the text the USER edited, so the app no longer knows which lines it wrote. Needs either a heading word list (rejected, see the docblock) or a marker the editor would let a user delete.
- **NIT p5-3** — `src/app/(app)/layout.tsx` justifies the footer privacy link with "Art. 12(1)", i.e. by an external requirement, which CLAUDE.md's Documentation voice rule forbids; SPEC Block E carries the same citation. Pre-existing and outside this branch's subject — worth one sweep of the repo for external attributions rather than a one-line edit here.
- **NIT p5-4** — `RESULT.notesLabel` is both a heading and the textarea's `aria-label` in `src/components/applications/notes-form.tsx`, so the accessible name is duplicated in the tree the way `RESULT.editorLabel` was on the resume tab (which `tests/e2e/generate.spec.ts` already has a note about). Harmless for a reader, ambiguous for a locator; give the field a `htmlFor`/`id` pair and drop the `aria-label`.

## Phase 5 — from the ai-code-reviewer PR round (2026-09-04)

`docs/reviews/phase-5.md`, verdict REVISE with no blockers. M2–M5, m1, m4, m5 and
n1 are fixed on this branch and SPEC v2.20 records what each fix changed.
**M1 is CLOSED**: the owner applied `005_profile_contacts.sql`, the contact half of
`tests/e2e/generate.spec.ts` stopped self-skipping, and the run is committed as
`docs/eval/phase-5-e2e-run.txt` — which is also where A7's header block is now
visible in a real generated resume. What is left:

- **MINOR p5-5 (was m2)** — `localeCompare` is the comparator for ISO timestamps in `src/lib/quality.ts` and `src/lib/judge.ts`, and ICU ranks `…:00:00+00:00` AFTER `…:00:00.5+00:00`: PostgREST omits a zero fraction, so two rows in the same second can order backwards, misplacing a run's pair and `openingVersion`'s comparison. Plain `<` and `Date.parse` both order it correctly. ~1e-6 per row, and what makes it worth doing is that no test can currently see it — every fixture builds timestamps with `toISOString()` or a hand-written `Z` literal, i.e. a 3-digit fraction, which is a format the database never emits. Fix the comparator and seed a fixture in PostgREST's own shape.
- **MINOR p5-6 (was m3)** — the cost half of the helper copy is exact on `rescoreHelp` and approximate on the other three: `checkQualityHelp` says "one AI call" for a path that is one embeddings request plus a judge step (up to 2 chat requests), `generateHelp` omits the run's one embeddings row, and `rescoreHelp` itself still says "a paid AI call" for what is 2–7 `rescore` rows. Every number is checkable against `/quality` now, which is exactly why the row of four should be priced by one rule rather than three.
- **MINOR p5-7 (was m6)** — `withContactHeader`'s docblock says the first blank line is "the end of the name-and-title header", but P2 output shaped `NAME

TITLE
…` (a blank line after the name, which nothing forbids) makes the block land between the name and the target title — precisely the layout the comment says the design avoids. `tests/unit/resume-header.test.mjs` covers the two-line header and the no-blank-line case and not this one; decide whether to look past a single blank line or to narrow the claim, and assert whichever it is.
- **NIT p5-8 (was n2)** — [Regenerate] has no request-count assertion, while SPEC v2.16 note 9's one-click-one-spend rule now covers five metered buttons and `tests/e2e/generate.spec.ts` witnesses it for [Generate] alone. The shared `inFlight` ref does cover it; nothing observes that for the most expensive button in the app.
- **NIT p5-9 (was n3)** — `rescore()` in `src/components/applications/result-workspace.tsx` reads `shownScore`, a `const` declared below it. Correct today because the closure only runs after render, and a `ReferenceError` the moment anything calls it during one.
- **NIT p5-10 (was n4)** — `QUALITY.rubricLead` describes a run as "an ai row, and the ai_revision row that follows it" and does not mention the orphan-rewrite rule `classifyRuns` now implements, so at a full window a reader reconciling the bucket total against `resume_versions` finds one run the caption cannot explain. The screen's own rule is that every figure names its rows.

## Phase 5 — from the owner's contact-transfer decision (2026-09-04)

The decision itself is done and declared in SPEC v2.21: the contact block reaches
no model call, held by `ModelResumeText` and asserted in
`tests/unit/resume-header.test.mjs`. What building it left open.

- **MINOR p5-11** — `p5-6`'s cost-copy item is now wrong in a second way: `rescoreHelp` says "Costs a paid AI call", and a re-score's spend is embeddings only, which is exactly the distinction the same round drew for `/privacy` and `docs/openrouter-processing.md`. Price the row of four buttons by one rule that names the KIND of call as well as the count, since `/quality` now lets a user check every number.
- **MINOR p5-12** — the strip is line-based, so a saved `location` of `Berlin` would remove a body line consisting only of the word `Berlin`. Reachable and harmless in practice (a resume line that is one city name and nothing else is a header line by any reading), and the alternative — redacting mid-sentence — is worse, which is why the scope is stated in `stripContactHeader`'s docblock and pinned by a test rather than fixed. Revisit only if a real resume loses a line to it.
- **NIT p5-13** — `runGenerateWithJudge` still receives `contacts` and passes them on to `generateResume`, which no longer takes them; the spread makes it legal and it is dead weight. Thread the argument only to the two functions that use it (`judgeOrNull`'s defensive strip, and `withHeader`).

## Phase 5 — from the first use of /quality (2026-09-04)

Both findings are fixed on this branch and SPEC v2.22 declares them. One is not a
code item at all, and it is the important one.

- **OWNER ACTION, not a backlog item — the guardrail.** `anthropic/claude-sonnet-4.6` is blocked by a model guardrail on the `default` OpenRouter workspace, so every tailored resume is written by `google/gemini-2.5-flash`. Diagnosed, not guessed: requested alone the slug answers HTTP 404 with `failed_routing_step: "Filter by Guardrails"`, while `anthropic/claude-haiku-4.5` answers 200 on the same key. Lift it at https://openrouter.ai/workspaces/default/guardrails; the verbatim error and the consequence are recorded in `docs/openrouter-processing.md` as provider-account setting 4. Until then the rubric's grounding failures are a fact about Gemini Flash's output, not about P2 — **and no conclusion about prompt quality drawn since Phase 4 should be trusted**, which is the part worth re-reading the phase-4 and phase-5 reports with in mind.
- **MINOR p5-14** — the "written by" line speaks about the APPLICATION's most recent generation, not about the version on screen, because `resume_versions` has no model column and `llm_calls` is per call. Accurate as worded, and one migration away from being per-version — which would also let `/quality` report the rubric outcome BY MODEL, i.e. answer "does the fallback actually fail grounding more often" with rows instead of an impression. Worth doing when the guardrail is lifted and both models have runs behind them.
- **NIT p5-15** — `newestJudgedVersion` fixes the rail, and the JUDGE CARD still describes the version the editor opened with, which is correct (the card is about the text you are reading) but means the two can legitimately differ. The rail names whose measurement it shows; the card does not name that it is about the editor's text. One line there would close the last gap in the same class.

## Phase 5 — from the guardrail being unliftable (2026-09-04)

The generation model changed because the configured one is unreachable and the
workspace is not the owner's. SPEC v2.23 declares it; the probe and the
before/after are `docs/eval/generation-model-comparison.md`.

> **CLOSED — CLAUDE.md's model list was amended by the owner (2026-09-04).** Its "AI model calls" section named `anthropic/claude-sonnet-4.6` as the generation model, and CLAUDE.md wins on conflict, so the rule book was naming a model the code does not use and this key cannot reach. The owner dictated the amendment: the generation slug is now `openai/gpt-5.4`, embeddings are named in that section for the first time, and the list carries a new rule — a model named there must be one verified to serve on the configured key, with the verification in `docs/openrouter-processing.md`. The replacement sentence this entry was holding is gone because it is no longer waiting: it is in the file.

- **MAJOR p5-16 — grounding fails on the first draft in 3 of 3 runs, on BOTH models, so P2 is the remaining suspect.** The model change did not rescue it; it only made the single rewrite capable of converging (once in two). The next step is not another model: it is either a second fixture whose career base DOES cover the vacancy — which would separate "the writer over-claims" from "the corpus is thin", the same confound backlog `p3-14` records for the thresholds — or a P2 change measured against both. Nothing about prompt quality should be concluded from one deliberately under-covered case.
- **MINOR p5-17** — the comparison ran on the same FIXTURE but a fresh account each time, so the application row differs. A true same-row comparison needs the generate model switchable per run rather than per deployment, which is a dev-only affordance nobody should ship as product surface. Worth building only if a second model comparison is ever run.
- **NIT p5-18** — `MAX_TOKENS_BY_STEP.generate = 2500` was chosen for Sonnet. gpt-5.4 accepts `temperature` silently (it is not in its supported parameters) and billed 0 reasoning tokens at default effort, both verified — but a future OpenRouter default that turns reasoning on would spend that budget before any resume text, and the app would report a truncated draft rather than a refusal. If the generator stays a reasoning-capable model, send an explicit low reasoning effort rather than relying on a default.


## Phase 6 — from the three pre-deploy gates (2026-09-04)

`nextjs-security`, `vercel-security` and `eu-compliance-reviewer` each ran for the
first time. The three reports are `docs/reviews/phase-6-nextjs-security.md`,
`docs/reviews/phase-6-vercel-security.md` and
`docs/reviews/phase-6-eu-compliance.md`, saved verbatim before anything was acted
on. Blockers were fixed on the branch or, where the fix is a dashboard setting
this repository cannot reach, put to the owner in the hand-over. Majors are the
owner's call and are NOT carried here — they are in the hand-over, undecided, per
the Phase-4 triage contract. What follows is minors and nits only.

> **CLOSED IN THIS BRANCH, so they are recorded rather than listed as work.**
> `eu-11` (four stored data categories missing from /privacy — the retained scan
> resume text, the derived search index, application notes and application
> status) is fixed in the rewrite; the owner's task named "every data category"
> and these were part of it. `eu-14` (no last-updated date) is fixed by
> `PRIVACY_UPDATED`. `eu-15` (a section whose body was the word "Placeholder")
> is gone with the Impressum work. `ns-1`/`vs-3` (the dev-route fence
> unwitnessed) is closed by `docs/eval/dev-routes-production-evidence.md`.
> `p3-2` and `p4-1` are closed by SPEC v2.24's function-duration table.

- **MINOR ns-4** — `src/app/api/career/items/[id]/route.ts` is the last `[id]` route that does not parse its segment, so a non-UUID reaches Postgres and returns 500 where Block D mandates 404; every other handler does `if (!z.uuid().safeParse(id).success) throw new NotFoundError();` first. This is backlog `M-3` from Phase 2, still open, and the comment at `src/app/api/applications/[id]/route.ts` saying the finding was "closed here rather than repeated" is easy to misread as meaning the career endpoints were fixed too. They were not. Add the parse to both verbs and close `M-3`.
- **MINOR ns-5 / vs-7 / p3-1 / m-3** — the same ceiling question, now answered: Vercel's request-body limit is **4.5 MB** (`/docs/functions/limitations`, verified 2026-09-04), and the app advertises 5 MB while `/api/scan`'s outer bound is 5 MB + 64 KB. A 4.6 MB PDF is legal by the app's copy and refused by the platform, so the user gets an opaque 413 instead of edge case L5's exact string and the careful `Content-Length` pre-check never runs. Lower `MAX_PDF_BYTES` to 4 MB and update the two copy strings; and adopt the pre-check in `src/app/api/career/import/route.ts`, which still calls `request.formData()` before it looks at the size.

> **CLOSED in this branch, and it closed `p3-1` and `m-3` with it.**
> `MAX_PDF_BYTES` is 4 MB in `src/lib/copy.ts`, under the platform limit, and
> `src/app/api/career/import/route.ts` checks `Content-Length` before
> `formData()` buffers the body — the pre-check half this entry asked for.
> Both halves re-verified against the code in Phase 7.

- **MINOR vs-8** — `prebuild` runs `check` + `test`, which is right and should stay, but it makes a docs edit able to fail a production deploy (R12 and R13 both read files under `docs/`), and `npm test` needs Node ≥ 22 for its glob. Pin the Vercel project's Node version to 22.x explicitly rather than inheriting a default that moves.
- **MINOR vs-9** — if any Deployment Protection is enabled, Vercel offers a Protection Bypass token that defeats it, optionally as `VERCEL_AUTOMATION_BYPASS_SECRET`. It is a secret under CLAUDE.md's rules and `scripts/check.mjs` would not catch it pasted as a literal into a config file. Do not enable automation bypass unless CI needs it; never commit the value.
- **MINOR vs-10** — the `/api/dev/*` production fence is now witnessed for the two routes that exist, but nothing stops a THIRD dev route shipping without the guard: the thirteen check rules are frozen and none covers it, so the control is code review. An R14 asserting the guard is the first statement of every `route.ts` under `src/app/api/dev/` would convert that into a build failure. Needs an owner decision, because it means unfreezing the rule set.
- **MINOR eu-12** — SPEC Block G edge case G2 says the retention decision is "documented in README", and README is five lines that do not contain it; the decision lives in `docs/openrouter-processing.md`, which is the better home. Either point README at it or amend G2 to name the doc. Block H item 8 wants a full README anyway.

> **CLOSED in Phase 7.** `README.md` now points at
> `docs/openrouter-processing.md` for the model-provider retention decision,
> which is the first of the two options this entry offered. SPEC Block G edge
> case G2 keeps its wording and is now true of the file it names.

- **MINOR eu-13** — the EU AI Act classification is favourable and is argued in full in `docs/reviews/phase-6-eu-compliance.md`, but nowhere a reader would look for it, and it is not self-evident: a model scoring a CV against a job posting *looks* like Annex III(4)(a), and the reason it is not is a fact about who the user is. Lift that section into a new docs/ai-act-note.md file (deliberately not backticked: R13 requires a backticked repo path to resolve, and this one is a proposal rather than a file), especially the four tripwires that would change the answer — an employer-facing mode, offering it to recruiters, any output a third party acts on, or a claim that the score predicts hiring outcomes.
- **NIT ns-6** — only `/export` sets `Cache-Control: no-store`. Harmless today (every other handler is POST/PATCH/DELETE and the only GET is dev-only), but the default is safe by accident rather than by design; setting it in `apiErrorResponse` and the data-returning handlers would make the next authenticated GET inherit the right thing.
- **NIT ns-7** — `apiErrorResponse` logs `err.name`, which is `'object'` for a PostgREST error, so a UUID syntax error, an RLS refusal and a connection failure are indistinguishable in the log. `saveContactsAction` already solved this leak-free by logging the `code` alongside; Postgres codes are fixed identifiers and carry no user content.
- **NIT vs-11** — the middleware calls `getUser()` on every non-excluded request, a round trip to Frankfurt. Once the function region is `fra1`, measure a signed-in navigation from a European client before doing anything; this may be a non-issue and is a NIT precisely because it is unmeasured.

## Phase 6 — owner triage of the three gates (2026-09-04)

The gating mechanism changed during triage: Vercel Password Protection is a Pro
feature, so the deployment is REACHABLE and closed to registration instead — new
sign-ups disabled in Supabase, accounts created by hand. SPEC v2.25 declares the
round and `docs/deploy.md` is the ordered procedure.

> **CLOSED BY THIS ROUND, recorded so nobody reopens finished work.** `vs-1`
> (/signup explains rather than offering a form that cannot succeed) · `eu-2`
> (demonstration notice on the authenticated shell) · `ns-2`/`vs-5` (CSP and four
> security headers, measured against a production build — the strict policy was
> tried first and broke every page) · `vs-6`/`eu-10` (`fra1` pinned in
> `vercel.json`) · `vs-4` (preview deployments disabled, secrets scoped to
> Production — `docs/deploy.md` steps 8 and 9) · `vs-7`/`ns-5` (4 MB ceiling,
> closing `p3-1` and `m-3` with it) · `eu-6` (the target-role over-declaration
> removed from the processing record) · `eu-5` and `eu-7` (accepted as folded
> into the v2.24 privacy rewrite) · the model-slug wording on `/privacy`, replaced
> by the three provider names on owner instruction.

- **CARRIED by owner decision — `eu-8`, granular erasure.** Only career items are individually deletable; job postings, scans, generated versions, import records and `llm_calls` rows go with the account. The reasoning for carrying it: with registration closed, the store holds only the owner's own data, and account deletion already removes all of it — so the Art. 17 exposure the finding describes has no third-party data to attach to. `/privacy` states the limitation plainly rather than implying the erasure story is complete. **This reopens the moment a second real person holds an account**, which is exactly when the deployment stops being a single-user demo — revisit it then, and note that adding the missing DELETE policies needs an owner amendment to CLAUDE.md's RLS matrix, which is deliberate and should stay deliberate.
- **CLOSED — `eu-9`, `0 owned rows` after deletion is now witnessed.** Owner-run on 2026-09-04 against the live project and recorded in `docs/eval/erasure-evidence.md`: a throwaway account populated until all eight owner-scoped tables held rows, deleted through the app's own [Delete account and data] control rather than by SQL, with per-user counts taken before and after — all eight to zero, and the `auth.users` row gone. It closed the way the finding recommended, with a SQL-level check recorded in `docs/eval/` rather than an R10 carve-out, so `SUPABASE_SERVICE_ROLE_KEY` is still read in exactly one module and the thirteen rules are still frozen. SPEC Block H item 3 carries the same conclusion.
- **MINOR — the Playwright suite cannot create accounts once registration is closed.** All four specs sign up through the `/signup` form against the same Supabase project the deployment uses. `docs/deploy.md` step 1 handles it by ordering (run the suite before closing registration), which is correct once and useless the second time. A durable fix is a second Supabase project for tests, or pre-created accounts the suite signs into instead of registering. Needed before the suite can be run again after deploy.
- **NIT — `IMPRESSUM_FILLED` is still `false`.** The page correctly says the operator's details are not published rather than rendering placeholder tokens, and `docs/deploy.md` step 20 makes filling it a condition of sharing the link. It is a one-line edit with two real values and is nobody's work but the owner's.

## Phase 6 — from the first production deployment (2026-09-04)

- **NOT OURS — the `reportAllChanges` / web-vitals console error is not this app's code, and the investigation is recorded so nobody repeats it.** Symptom on member screens: `Uncaught TypeError: Cannot read properties of undefined (reading 'startTime') at et.reportAllChanges`, with frames in `<anonymous>` / `VM…` rather than `/_next/static/chunks/*`. Checked, in order: no `web-vitals`, `@vercel/speed-insights` or `@vercel/analytics` in `package.json`; `npm ls web-vitals` is empty and the package appears nowhere in `package-lock.json` or `node_modules`; no `reportWebVitals` or `useReportWebVitals` anywhere in `src/`; the single repository match is `eslint-config-next/core-web-vitals` in `eslint.config.mjs`, which is a lint ruleset and is never bundled. Next.js does VENDOR web-vitals at `next/dist/compiled/web-vitals` — and `reportAllChanges` appears **nowhere in a clean `.next/` build**, client or server, because nothing registers a callback for it to tree-shake in. The served HTML references only `/_next/static/chunks/*` and contains no occurrence of "vitals". Our own code contains no `eval`, `new Function` or script injection. **Conclusion: injected at run time by the platform or the browser, not shipped by us.** The two candidates worth checking in the Vercel dashboard are the **Vercel Toolbar** (injected for a visitor authenticated to Vercel — which fits an error only the owner sees) and **Speed Insights** (injectable from project settings with no package installed).
- **MAJOR if Speed Insights turns out to be enabled — it would be a tracker, and this project has a rule about that.** CLAUDE.md's Privacy section says adding ANY tracker re-opens the no-consent-banner decision, and `/privacy` states in its own words that there are no analytics and no trackers. Speed Insights beacons per-visit performance data to a third party, so switching it on silently makes that sentence false. Note the CSP would currently stop the beacon leaving — `connect-src 'self'` permits no third-party endpoint — so the practical position today is "a script that errors and cannot phone home". **That is a reason to turn it off in the dashboard, not a reason to rely on the CSP**: a header is the wrong place to enforce a privacy promise the page makes in prose. If the owner wants it, it needs the `/privacy` wording changed and the consent question re-opened first.
