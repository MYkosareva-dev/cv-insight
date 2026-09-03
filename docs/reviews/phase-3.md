# Phase 3 — ai-architect report (both passes)

**Branch:** `phase-3-scan` (11 commits ahead of `main`) · **Date:** 2026-09-03
**Scope:** `git diff main...HEAD` — 28 files, +3792/−60. SPEC v2.12 (US-2, US-3, Block D #4 and #8's PATCH half, Block E `/scan`, `/applications`, `/applications/[id]`), CLAUDE.md as amended 2026-09-03.
**Gate runs recorded here:** two `ai-architect` passes — one on the PLAN before any code was written, one on the DIFF after the phase was built.

**VERDICT: APPROVE.** Both passes are closed. The plan pass produced two BLOCKERs and a set of MAJORs, all fixed in the plan before implementation and declared as SPEC v2.12's nine deviations. The diff pass produced one BLOCKER and two MAJORs, all fixed on this branch in `33c416e`. What is left is twelve backlog entries, `p3-1` … `p3-12`. No secret exposure, no chokepoint breach, no migration, no RLS change, no `.from(`/`.rpc(` outside `lib/db`, and no new enforcement rule — the 13 stay frozen.

**Gates run on this branch, quoted (re-run at `0554512`, clean tree):**
- `node scripts/check.mjs` → `check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; next.config.* clean of secrets and env injection; no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to server.ts + middleware.ts with shared cookieOptions, no createBrowserClient; AUDIT_RETENTION_VERIFIED only with real evidence behind it; every backticked repo path in the docs/ shelf resolves against the tree.`
- `npm test` → `tests 149 · suites 25 · pass 149 · fail 0` (101 at the end of Phase 2; `tests/unit/scoring.test.mjs` and the `validation.test.mjs` additions are this phase's).
- `npx tsc --noEmit` → clean · `npx eslint .` → clean · `npm run build` → compiled in 12.5 s, TypeScript clean, 15/15 pages, `ƒ Proxy (Middleware)` wired, `/api/scan` and `/api/applications/[id]` present as dynamic routes.
- `npx playwright test` → **24 passed, 1 skipped**, and the skipped case passed on its own broken-key server. Verbatim output for both halves is `docs/eval/phase-3-e2e-run.txt`. That file was re-run against `67affa3` after the diff pass changed `src/`, because an evidence file whose commit no longer matches the code is worse than no evidence file (`0554512`).
- Secrets inspected by NAME only (`grep -o '^[A-Z_]*' .env.example`); every recursive search excluded `.env*`. No new environment variable is introduced by this diff, so `.env.example` needed no change.

---

# Pass 1 — the plan gate (before implementation)

Run on the Phase-3 implementation plan against SPEC Block D #4's stated server
step order and Block E's two screens. Its output survives in the tree as the nine
declared deviations under SPEC's `v2.12 — endpoint #4, as built` note, the Block E
`as built` notes for both screens, and backlog `p3-1` … `p3-7`.

**On the record.** The gate's per-finding severity labels are NOT preserved in the
repository. `docs/backlog.md` records the count — "its two BLOCKERs and every MAJOR
are fixed on this branch" — and SPEC records each finding with its fix, but which
two of the nine carried the BLOCKER label is not recoverable from the tree. By the
gate's own definition (*"a broken chokepoint, a missing RLS story, a secret
reaching the client boundary, or an undeclared SPEC deviation"*) three of the nine
are candidates: deviations 1, 3 and 7, the three that cite a CLAUDE.md rule rather
than only a SPEC contract. This report does not guess between them. Every finding
and every fix is below; the missing piece is two labels, and inventing them would
be worse than recording the gap.

## What it found, and how each was closed

Each one is now a `> v2.12` declaration in SPEC — silence is a defect, not a
deferral. Numbered as SPEC numbers them.

1. **The step order put the `applications` insert AFTER the score.** Three defects
   in one ordering: rule B7's cap is checked inside `lib/chat.ts`, i.e. after the
   `vacancies` insert, so a 429 left an orphan vacancy row that no screen can
   reach and no policy can delete; `llm_calls` is append-only, so a `parse_vacancy`
   row logged before the application existed could never be linked to it, which
   weakens DoD item 7's "one full pipeline run"; and US-2 step 5's "your vacancy
   was saved" had to be kept by a catch-branch write that could itself fail.
   **Fixed:** the DRAFT `applications` row is written BEFORE the parse and the
   score and coverage are committed onto it with an UPDATE — `applications` already
   has an UPDATE policy, so no policy changed. `src/app/api/scan/route.ts`, in
   `0c082fb` and `55df506`.
2. **`coverage` was to store the entries array alone.** A career-base scan has no
   `source_resume_text` (null by design), so recomputing "In resume" at render
   would count against the LIVE base and put a fresh number beside a stored score
   taken from a different moment of the same base. **Fixed:** `coverage` stores
   `{ entries, keywords }` — the measured counts as measured. Same argument as edge
   case D4. No migration: the column was already `jsonb`, and its comment now says
   what NULL and an empty `entries` array each mean.
3. **`SCAN.aiUnavailable` promised "retry from Applications" with no retry.** A
   user-facing promise may not ship ahead of the mechanism (CLAUDE.md, Process).
   **Fixed:** a second request shape, `{ applicationId }`, re-runs a draft from the
   stored row — so a retry cannot analyse something other than what it claims to be
   retrying, and the resume text does not travel the wire twice. It is a retry the
   USER presses; the two in-request exceptions in `lib/chat.ts` are a separate
   budget and unaffected. Pass 2 then found this shape accepted too much — see its
   BLOCKER.
4. **The Upload PDF tab had no endpoint.** **Fixed:** `/api/scan` also accepts
   `multipart/form-data` (`file` + `vacancyText`), extracted server-side with
   `lib/pdf.ts` and no model call. A separate extract-only endpoint would put the
   resume on the wire twice, add a second auth fence, and let a caller substitute
   arbitrary "extracted" text between the two requests. `Content-Length` is checked
   before the body is buffered and `file.size` before `arrayBuffer()` (L5); an
   extraction over the scan's 15,000-character bound is TRUNCATED and the cut is
   REPORTED (`SCAN.resumeTruncated`), because Block F defined truncation only for
   the import branch — which left the scan branch answering "at least 100
   characters" to an input that was too long.
5. **`scanSchema`'s refine covered `paste` only.** A JSON body claiming `file` with
   no text reached the source resolver as a server-side anomaly and would have
   answered 500 to a malformed request. **Fixed:** the refine covers `file` too
   (`src/lib/validation.ts:329`).
6. **`resumeSource: 'resume_version'` is a legal value of the column's CHECK
   constraint whose rows do not exist until Phase 4.** **Fixed:** refused with copy
   (`SCAN.savedVersionUnavailable`), not with a Zod shape error.
7. **The plan matched per requirement by looping `matchDocuments`.** That issues one
   embeddings REQUEST per requirement, against Block D #4's own word "batched" —
   and worse, it makes `could_not_search` representable in a per-query position,
   where a caller's `else` turns a dead embeddings call into a gap: the app
   reporting a finding about data it never searched (CLAUDE.md, Retrieval).
   **Fixed:** one gate call, `matchDocumentsForTexts`, embedding once and calling
   the RPC per vector. Its per-query type `SearchedOutcome`
   (`src/lib/retrieval.ts:88`) has exactly two cases; the third outcome exists only
   at the RUN level (`:112`), so a caller mapping requirements to statuses has no
   third case to forget. A failed run fails the scan with `AI_UNAVAILABLE` and
   leaves `coverage` null. Partial results are deliberately not offered: the only
   honest answer for an un-searched requirement is "we do not know", which is not a
   coverage status. `be796fb`.
8. **No function-duration budget on the route.** A platform cap below the worst case
   kills the request before `after()` runs and drops the `llm_calls` row for a call
   that WAS billed — rule B8 stops holding, with `/quality` as the only witness.
   **Fixed:** `maxDuration = 120` (`src/app/api/scan/route.ts:89`), the honest
   budget for a 60 s chat attempt, the 2 s network-retry wait, a second 60 s
   attempt, then the embeddings and one RPC per requirement. The deployment's own
   limit must still be checked against this number before deploy — carried as
   `p3-2` for the vercel-security gate.
9. **Block E's copy was not enumerated.** **Fixed:** the `SCAN`, `RESULT` and
   `APPLICATIONS` constants are enumerated in SPEC, and `UNREADABLE_PDF`,
   `FILE_TOO_LARGE`, `NOT_PDF`, `RESUME_PASTE_PLACEHOLDER` and `VACANCY_LENGTH` are
   PROMOTED to module level the way `PDF_DROPZONE` was in v2.10 — each is now one
   sentence on two screens, and a second copy of the words is a second place for
   them to drift.

Two further deviations from the same pass are Block E's rather than Block D's, and
are declared with the screens: three resume sources instead of four, because "Saved
version" would be a Select of nothing until `resume_versions` exists; and two of the
four category bars reading "Not checked yet", because the judge is Phase 4 and an
"0 issues" bar there would be a measurement nobody took.

---

# Pass 2 — the diff gate (after the phase was built)

Run on `git diff main...HEAD` at `6343933`. One BLOCKER, two MAJORs, and a set of
render-state findings. All fixed on this branch in `33c416e`; the residue is `p3-8`
… `p3-12`.

## BLOCKER

**The re-run accepted any owned application, not an unanalysed draft.**
`src/app/api/scan/route.ts` (`rerunPlan`).

`{ applicationId }` checked ownership and nothing else, so POSTing the id of a
FINISHED scan silently re-analysed it. `match_score` and `coverage` were
overwritten — including the stored keyword counts, whose entire justification
(deviation 2) is that they are the numbers THAT run measured — while `created_at`
went on reporting the original date. The screen would then show a fresh measurement
of a base that had since moved, dated to a scan that no longer existed. Re-scoring
an edited resume is a different feature with its own endpoint (Block D #6,
Phase 5), so there was nothing to reconcile: the shape simply accepted too much.

**Fixed:** `if (application.coverage !== null) throw new ValidationError(SCAN.alreadyAnalysed)`
(`src/app/api/scan/route.ts:420`), with its own copy — "This scan has already been
analysed." — rather than a shape error. SPEC deviation 3 was rewritten to say
UNANALYSED draft and to state why.

## MAJOR

**M-1 — `z.union([rescanSchema, scanSchema])` erased every Block F message on `/api/scan`.**
`src/lib/validation.ts` (`scanRequestSchema`, now removed).

Zod reports a union failure as ONE top-level `invalid_union` issue whose message is
the literal "Invalid input". `readScanRequest` answers with
`parsed.error.issues[0]?.message`, so a 25,000-character paste — edge case S7 — was
answered with "Invalid input" instead of `VACANCY_LENGTH`, the sentence Block D
quotes verbatim as this endpoint's canonical error body. Every other Block F string
on the endpoint had the same fate.

**Fixed:** the two shapes are told apart BEFORE either schema runs.
`isRescanBody(body)` (`src/lib/validation.ts:386`) branches on the presence of
`applicationId`, then the matching schema runs alone and `issues[0].message` is the
field's own message again (`src/app/api/scan/route.ts:284`). Declared as SPEC
deviation 12. Evidence: `tests/e2e/scan.spec.ts:239` asserts 400 ·
`VALIDATION_ERROR` · `VACANCY_LENGTH` exactly — which nothing observed before. That
case needed one follow-up (`67affa3`): Playwright's `request` fixture is a separate
context with no session cookie, so it got the 401 that `requireApiUser()` correctly
answers first. It uses `page.request` now, which carries the browser's cookies.

**M-2 — a SPEC declaration misdescribed the code, and the screen followed the declaration.**
`SPEC.md` Block E note, and `src/app/(app)/applications/[id]/page.tsx`.

The note read *"The vacancy's `parsed` column is NOT the discriminator: it is also
null on the failure path"*. That is false for a MATCH failure: `setVacancyParsed`
runs before matching, so that path stores a perfectly good parse. The discriminator
was right — `coverage` is correct and `parsed` would be wrong — but the reason was
wrong, and the consequence was real: the not-analysed branch rendered only
`vacancy.raw_text`, hiding a requirement list the user had already paid a
`parse_vacancy` call to extract.

**Fixed:** the note now states both failure shapes and why `coverage` is still the
discriminator; the not-analysed branch renders the parsed requirements when they
exist (`src/app/(app)/applications/[id]/page.tsx:122`), above the raw posting.
Throwing away a measurement the user paid for is the same defect class as reporting
one nobody took.

## Also from the same pass — four places that showed a state the data did not support

Fixed in the same commit. Recorded because each is a state-honesty defect of the
kind this SPEC keeps legislating against, not a cosmetic fix.

- **A measured emptiness read "Not checked yet."** `Bar` collapsed `issues === null`
  (the check has not happened) and `total === 0` (the check RAN and had nothing to
  look at — no keywords extracted, or N4) into one caption, while the Analysis tab
  on the same screen said the opposite. `RESULT.nothingToCheck` now names the second
  state.
- **The 60/40 explainer rendered on a draft**, where no weighting ever ran. Rendered
  only when `score !== null` now (`page.tsx:86`). The nice-only case, where B1 drops
  S and scores `round(100 × K)`, is still one sentence describing two formulas —
  `p3-11`.
- **An analysed posting with no title** rendered a blank heading or claimed it was
  unanalysed. `APPLICATIONS.untitledPosting` is a third case on both the detail
  heading (`page.tsx:68`) and the list's Position cell.
- **`bestChunk` turned a MISSING outcome into a measured zero.** `if (!outcome ||
  outcome.status === 'found_nothing') return null` mapped "the gate returned no
  outcome for this query" onto "found nothing", i.e. onto a gap — the exact hole the
  run-level outcome type exists to close. A missing outcome now throws `ServerError`
  (`src/app/api/scan/route.ts:256`) and only `found_nothing` returns null.

Housekeeping from the same pass: two constants added on this branch
(`RESULT.vacancyShowRaw`/`vacancyHideRaw`) were unreachable and are gone;
`APPLICATIONS.noCompany` no longer aliases `NO_SCORE` — the same glyph with a
different meaning, where aliasing means that changing the score placeholder silently
changes the Company column. `APPLICATIONS.loadFailed` stays unused and is DECLARED
as such: the list is a Server Component, so a DAL throw reaches `app/error.tsx` and
there is no client render in which that toast could fire.

---

# Backlog — the twelve entries this phase filed

All of them are in `docs/backlog.md` under "Phase 3": `p3-1` … `p3-7` from the plan
pass, `p3-8` … `p3-12` from the diff pass. The full text lives there; this is the
index, so `docs/reviews/` stays the record and the backlog stays the worklist.

| id | severity | one line |
|---|---|---|
| `p3-1` | MINOR | `MAX_SCAN_BODY_BYTES` and `MAX_PDF_BYTES` advertise 5 MB over a serverless body limit commonly capped at 4.5 MB — backlog `m-3`'s ceiling question now on a second endpoint; reconcile the number once, before deploy. |
| `p3-2` | MINOR | `maxDuration = 120` is unverified against the deployment's own function-duration limit; a platform cut below it drops the `llm_calls` row for a call that WAS billed (B8). vercel-security gate. |
| `p3-3` | MINOR | A SUCCESSFUL re-run of a draft has no test: the failing-service path is covered and the success path is the same server code as a first scan, but nothing exercises draft → scored. |
| `p3-4` | MINOR | "Exactly one `parse_vacancy` row per scan" is structural and asserted nowhere — `tests/` may not touch a DAL or the service-role key, so no spec can count `llm_calls` rows. Observable in the app at `/quality` in Phase 6. |
| `p3-5` | MINOR | A career-base scan's `inResume` counts are as-of scan time by design, but the screen does not say when the measurement was taken. |
| `p3-6` | NIT | Block E says the keywords table is "sortable by gap"; it is sorted by gap and the column headers are not interactive. |
| `p3-7` | NIT | Dev-mode `Error: The destination stream closed early.` on mid-stream navigation; worth confirming it stays absent from a production build's logs. |
| `p3-8` | MINOR | The scan's `embed` rows are logged with `application_id: null`, so the embedding half of a run's spend is unattributable and DoD item 7 is one linked row plus orphans. |
| `p3-9` | MINOR | The multipart `Content-Length` check fails OPEN on an absent or unparseable header; the comment now says it is a shortcut and not the fence. Decide which cost is right. |
| `p3-10` | MINOR | The re-run has no in-flight lock, while Block D #5 gives `/generate` a 409 `ALREADY_RUNNING`; same shape, same mechanism when #5's lock is built in Phase 4. |
| `p3-11` | MINOR | `RESULT.scoreExplainer` states B1's 60/40 weighting even for a nice-only posting, where B1 scores `round(100 × K)` — one sentence describing two formulas. |
| `p3-12` | NIT | `src/lib/db/types.ts` is `server-only` yet four client components read row shapes from it; it holds only because `import type` is elided. Drop the marker or move the client-facing types out of `lib/db/`. |

---

# Owner decision on the phase's one open question

**The `[Add to resume]` stub keeps the label "Copy to clipboard."** (Owner,
2026-09-03.) The Base-matches card copies the requirement text under a label that
says exactly that; `RESULT.addToResume` stays declared and unused, because it names
US-3 step 4's insertion into an editor that does not exist yet. It becomes
`[Add to resume]` in Phase 4 when the editor exists. **No change now** — a button
labelled for a mechanism the app does not have is the promise-ahead-of-mechanism
defect this branch already fixed once, in deviation 3.

---

# What the branch gets right

Recorded because it is the part a later reviewer should not re-litigate.

- **The three-outcome rule is enforced by the TYPE, not by discipline.**
  `SearchedOutcome` cannot express `could_not_search`, so the failure CLAUDE.md
  names — telling the user a requirement is a gap because an embeddings call died —
  has no syntax available to it in the position where a caller would make that
  mistake. The diff pass found the one place that still leaked (`bestChunk`'s
  missing-outcome case), and it is a throw now.
- **Every metered path is inside the gates and behind `requireApiUser()`.** One chat
  call per scan (P1 through `lib/chat.ts`), one batched embedding run through
  `lib/retrieval.ts`, and no ledger passed, because this route is single-call and
  passing one would tell the next reader otherwise. No new retry, no debounce, no
  background refresh; the re-run is a button the user presses.
- **The vacancy and the draft application are written before the model call**, so
  US-2 step 5's "your vacancy was saved" is a statement about a row that exists —
  proved by the broken-key run rather than by reading the code.
- **The score renders through ONE rule.** `renderableScore()`
  (`src/lib/scoring.ts:202`) decides null-versus-number for both screens from the
  stored row alone, so the list's chip and the ring can never disagree. Rule B1b is
  inside it, and the endpoint returns the STORED number with B1b declared as a
  render rule (deviation 10).
- **`keywordPresent` is defined as `keywordCount > 0`** on the same B1a boundary
  regex, with a unit test pinning the equivalence — the two can never disagree about
  a keyword.
- **The e2e suite asserts the CONTRACT, not numbers a model cannot guarantee** — the
  `e-1` lesson from the Phase-2 review, applied without being asked: the ring's
  colour is recomputed from the score the endpoint returned, the keyword counts are
  checked against the text the test itself pasted, and the AI-unavailable case SKIPS
  VISIBLY rather than passing when it could not run.
- **The evidence file was re-run rather than re-worded** when the diff pass changed
  `src/`. That is the "a configured mechanism is not a working one" discipline
  applied to the branch's own paperwork.
- **Privacy holds on every path checked.** No resume or vacancy content in any log
  line, error message or HTTP body; retrieved chunks are never echoed to the client
  — which is why the Base-matches card ships requirement + career-item title +
  similarity and defers US-3's "ready-to-insert bullet" to Phase 4, rather than
  leaking a chunk to fake it.

**Checked:** secrets ✓ · RLS ✓ (unchanged — no migration, least-privilege intact) · chokepoints ✓ (`check.mjs` 13/13, R5/R6 hold, and the gate invariant holds for every function reached this phase) · zod ✓ (both request shapes, the P1 output, and the PATCH body) · `llm_calls` logging ✓ (`parse_vacancy` linked to the application; `embed` rows unlinked — `p3-8`)

**Still open for the owner, unchanged from Phase 2:** `eu-compliance-reviewer` has
not been run on the Phase-2 owner-feedback round, which touched personal data. This
phase puts vacancy text and resume text through a new endpoint, so it is due here
too — together with `nextjs-security` on the two new route handlers.
