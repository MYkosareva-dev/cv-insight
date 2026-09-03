# Backlog

Findings that are real but not blockers, carried forward instead of fixed in the
branch that raised them. One line each: severity, id, where it lives, and what to do.

Blockers never appear here — they are fixed on the branch that raised them, so an
entry in this file is by definition something the owner has agreed can wait. The id
is the one the review report used, so `docs/reviews/` stays the full record and this
stays the worklist.

## Phase 2 — from `docs/reviews/phase-2.md` (2026-09-03)

Reviewer note: M-1 and M-2 are the two the reviewer would have promoted to blocker.
They are first for that reason.

- **MAJOR M-1** — `src/components/career/import-resume-dialog.tsx` sets `notice` only on the zero-items branch, so `CAREER.truncated` never renders and a >20,000-character CV silently imports its first part; call `setNotice(payload.notice)` unconditionally in `receive` and assert it in `tests/e2e/career.spec.ts`.
- **MAJOR M-2** — `src/components/career/career-item-card.tsx` awaits the PATCH outside `startTransition`, so `pending` is never true: Block E's loading state is missing and a double-click buys two paid re-embeds; use the explicit `useState` pending the import dialog already uses, keeping the transition for `router.refresh()` only.
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
