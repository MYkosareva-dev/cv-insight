# Backlog

Findings that are real but not blockers, carried forward instead of fixed in the
branch that raised them. One line each: severity, id, where it lives, and what to do.

Blockers never appear here — they are fixed on the branch that raised them, so an
entry in this file is by definition something the owner has agreed can wait. The id
is the one the review report used, so `docs/reviews/` stays the full record and this
stays the worklist.

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
- **MINOR m-4** — load-bearing pure logic is untested or untestable where it sits: `importedResumeText` and `isPdfUpload` in `src/lib/validation.ts` have no test, `indexWarningFor` is pure but buried in `src/app/api/career/items/route.ts`, and the retry budget cannot be tested at all from `server-only` `src/lib/chat.ts`; extract the budget arithmetic into a pure module (the same argument that moved the price table into `src/lib/pricing.ts`) and pin "two requests maximum, in either order of exception".
- **MINOR m-5** — edge case S6 is cited as the reason for a design decision in `src/lib/db/careerItems.ts`, `src/lib/errors.ts` and the `[id]` handler but asserted nowhere; add a two-account test that PATCHes and DELETEs user A's item as user B and expects 404 with `NOT_FOUND`.
- **MINOR m-6** — stale annotations now that `tests/e2e/career.spec.ts` ships: `playwright.config.ts` still says the suite is auth-only until Phase 7, and the `SPEC.md` Block A layout still enumerates only auth/scan/privacy specs; correct both, and Block H item 3's green-suite list with them.
- **NIT n-1** — `extractedItemSchema.period` in `src/lib/validation.ts` is `.nullable()` but not `.optional()`, so a model that omits the key rather than emitting `null` burns the one repair retry on a formatting nit; use `.nullish()` with a `?? null` transform.
- **NIT n-2** — the Edit dialog in `src/components/career/career-item-card.tsx` seeds state once and is never re-keyed, so cancelling an edit and reopening shows the abandoned draft instead of the stored row.
- **NIT n-3** — `batchByItem` in `src/lib/retrieval.ts` gives an item with more than `EMBEDDING_BATCH_SIZE` chunks its own batch, which `embedFor` then splits across two requests, defeating the "a batch never splits an item" invariant the three-state warning rests on; unreachable at `MAX_CHUNKS_PER_ITEM = 2`, so add the explicit throw that makes it fail loudly if that constant changes.
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

## Phase 3 — from the ai-architect phase gate (2026-09-03)

Its two BLOCKERs and every MAJOR are fixed on this branch; SPEC v2.12 declares the
deviations they produced. What is left is below. The `p3-` ids are this gate's.

- **MINOR p3-1** — `MAX_SCAN_BODY_BYTES` and `MAX_PDF_BYTES` advertise 5 MB while a serverless request body is commonly capped lower (4.5 MB on Vercel), so a 4.6 MB PDF fails with a platform error instead of edge case L5's exact copy; this is backlog `m-3`'s ceiling question now reaching a second endpoint — reconcile the advertised number once, before deploy, and adopt the `Content-Length` pre-check in `src/app/api/career/import/route.ts` too (the scan route already has it).
- **MINOR p3-2** — `maxDuration = 120` in `src/app/api/scan/route.ts` is the honest budget for two 60 s chat attempts plus embeddings, but nothing verifies it against the deployment plan's own function-duration limit; check it at the vercel-security gate, because a platform cut below it drops the `llm_calls` row for a call that WAS billed (rule B8) with /quality as the only witness.
- **MINOR p3-3** — a successful RE-RUN of a draft has no test: `tests/e2e/scan.spec.ts` proves the button is wired and honest against a failing service, and the success path is the same server code as a first scan, but nothing exercises draft → scored. Needs either two dev servers in one run or a stubbed chat gate.
- **MINOR p3-4** — "exactly one `parse_vacancy` row per scan" is structural (one call site, plus check.mjs R5/R6) and not asserted anywhere: `tests/` may not touch a DAL or the service-role key, so no spec can count `llm_calls` rows. The `/quality` dashboard (Phase 6) is where this becomes observable in the app; until then it is an owner query.
- **MINOR p3-5** — the keyword table's `inResume` count for a **career-base** scan is measured against the base as it stood AT SCAN TIME (stored in `coverage.keywords`), so an item added later is invisible until a re-scan; correct and deliberate, but the screen does not say when the measurement was taken. Consider showing the scan's timestamp beside the ring.
- **NIT p3-6** — `src/components/applications/result-tabs.tsx` sorts the keywords table by gap and offers no other order, while Block E says "sortable by gap"; the default is the useful one, but the column headers are not interactive.
- **NIT p3-7** — the dev server logs `Error: The destination stream closed early.` when a client navigates away mid-stream (the scan's redirect, and the deletion redirect in the e2e teardown); a Next dev-mode artefact with no user-visible effect, worth confirming it stays absent from a production build's logs.
