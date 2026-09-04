# Phase 4 — ai-architect on the DIFF (2026-09-03)

Run against `git diff main...HEAD` on `phase-4-generate`, after the five
implementation commits and the SPEC v2.16 amendment. Its companion is
`phase-4-architect-plan.md`, the gate that ran on the plan before any code
existed; this run's first job was to check whether that one's findings were
closed in the CODE rather than only declared in SPEC.

Saved verbatim, in the run that produced it, before anything was acted on.

---

I have read the plan review, SPEC v2.16, the backlog, the eval run, and every file in scope. Verdict below.

```
VERDICT: REVISE
```

Two BLOCKERs. Both are cases where SPEC v2.16 declares something the code does not do, which is the failure mode your own brief calls worse than silence. Everything else is MAJOR and below.

## Architect-gate closure (checked in code, not in SPEC)

| # | item | closed |
|---|---|---|
| B1 | `/rescore` embeds the editor text | yes — `src/lib/coverage.ts:158-213` |
| B2 | `/export` saves a `source='user'` row | yes — `src/app/api/applications/[id]/export/route.ts:70-82` |
| B3 | lock `finally` + TTL ≥ `maxDuration` | yes — `generate/route.ts:65,187-191` (TTL 300 000 = `maxDuration` 300) |
| M4 | top-8 chunks → distinct items | yes — `src/lib/generation.ts:36,47,101-108` |
| M5 | query text defined + `application_id` threaded | yes — `generation.ts:79-88`, `retrieval.ts:149` |
| M6 | B7 refusing a step after a billed step | **half** — see BLOCKER 2 |
| M7 | verdict computed, both halves | yes — `src/lib/judge.ts:60-63` |
| M8 | `missingHonest` carries B4 in words | yes — `judge.ts:96-103` |
| M9 | `/judge`'s `<items>` source stated | yes — declared, backlog `p4-3` |
| M10 | synchronous ref on metered buttons | yes — `result-workspace.tsx:108,116-118` |
| M11 | `SCAN.savedVersionUnavailable` reworded | yes — `copy.ts:220` |
| M12 | revision skip declared | yes — SPEC:642, `RESULT.reviseWithoutFindings` |

Chokepoints verified intact: no new `.from(`/`.rpc(` outside `lib/db/` (the one new site is `src/lib/db/careerItems.ts:66`); no import of `lib/openrouter/server.ts` outside the two gates; `budget.ts`/`judge.ts`/`generation.ts` read no env and import nothing server-side; no `getSession(`; no migration; RLS matrix untouched (`supabase/migrations/001_init.sql:111` still `select,insert`); check.mjs's 13 rules and `DAL_FILES` unchanged. No chunk text or career-item content reaches the client, a log or a stored prompt — `itemsJson` (`tailoring.ts:142`) is used only inside `fillPrompt`, `logConsideredChunks` prints titles only, and the e2e's three `console.log` calls are counts and verdicts.

## Findings

**1. [BLOCKER] `src/lib/tailoring.ts:133-139` — the vacancy keyword list was removed from BOTH prompts, and SPEC v2.16 does not declare it.**
`requirementsJson()` emits `{title, company, requirements:[{text, kind}]}`. `parsed.keywords` and each requirement's `keyword` are gone. The removal is real and the reason is good (`docs/eval/phase-4-e2e-run.txt:133-142` — the generator pasted the keyword list into a SKILLS line), but it is recorded only in a code docblock and an eval file. SPEC's twelve v2.16 items for endpoint #5 (SPEC.md:636-647) do not contain it. It changes three things SPEC states as rules:
- P2 rule 3 ("Use the vacancy's exact keyword spelling", `prompts.ts:96`) is now unactionable — the generator has no spellings.
- P3 criterion 2 ("of vacancy keywords honestly supported by career items, how many appear in the resume?", `prompts.ts:114`) asks the judge to score against a list it is not given.
- Rule B4 (SPEC.md:814) defines `missingHonest` as supported-but-absent *vacancy keywords*; that field now carries the judge's reconstruction of a list nobody supplied — and `judge.ts:96-103` feeds it into a paid revision.

→ Required on this branch: a `> Decision:` amendment against Block D #5 / Block F rule B4 / prompt P3 stating that neither prompt receives the keyword list, and what `keywordCoverage`/`missingHonest` are therefore measured against. If the answer is "the requirement texts", say so — the judge card renders `missingHonest` to the user under `RESULT.missingHonestHeading`.

**2. [BLOCKER] `src/lib/tailoring.ts:290` — the revision's generate step is unguarded, and SPEC v2.16 #9 declares the opposite.**
`judgeOrNull` (`tailoring.ts:312-327`) covers both judge steps. The third step does not go through it:
```ts
const revised = await generateResume({ ...args, findings });
```
`assertUnderDailyCap` runs at the head of every step against `committed + ledger` (`chat.ts:130-135`). A user at 48 committed calls passes step 1 (48+0), passes step 2 (48+1), and is refused on step 3 (48+2 = 50). The `DailyLimitError` propagates out of `generateWithJudge`, past the route's `catch`, and **`outcome.original` — already generated, already judged, already billed twice — is never saved.** The same holds for an `AiUnavailableError` on step 3. SPEC.md:644 justifies letting a generate failure propagate with "there is no resume, and nothing is saved"; on the revision step there *is* a resume and it is discarded. This is architect MAJOR 6 closed on one of its two branches.

→ Required: wrap step 3 the way step 2 is wrapped — on `DailyLimitError`/`AiUnavailableError`, return `{ original, revision: null, revisionWithheld: … }` so the paid draft is saved with its honest card — or amend SPEC.md:644 to say the revision step discards a billed draft and why.

**3. [MAJOR] `src/app/api/applications/[id]/rescore/route.ts:97` + `src/components/applications/result-workspace.tsx:225` — rule B1b is not applied to the re-scored number.**
`page.tsx:59` runs `renderableScore(application)`; the re-score returns `matchScore` raw and the client does `shownScore = rescored ? rescored.matchScore : score`, so the raw value goes straight into `ScoreRing`. SPEC v2.12 note 10 (SPEC.md:615) is explicit: *"A client reading `matchScore` must apply `renderableScore()` rather than print it."* On a nice-only posting with no extracted keywords, `matchScore()` returns a hard 0 (`scoring.ts:244`) and the ring flips from "—" to a red 0% on [Re-score] — the app reporting a measurement it did not take, which is the exact defect B1b exists to prevent, and it breaks Block E's "Same rule everywhere a score renders".
→ Apply `insufficientSignal`/`renderableScore` to the re-score result, on the server or in `result-workspace.tsx`.

**4. [MAJOR] The ring swaps two measurements of different quantities, and the eval reads the delta as causal.**
Stored S ranks requirements against the **career base** through `match_documents` over the whole index (top 5 per requirement). Live S ranks them against **≤20 ephemeral chunks of one resume** (`coverage.ts:167-209`). `SIMILARITY_FLOOR`, `COVERAGE_THRESHOLD` and `SIMILARITY_SPAN` (`scoring.ts:67-78`) are calibrated in `docs/eval/coverage-thresholds.md` against the first corpus only. The two numbers then occupy the same ring, with the same colour bands, one replacing the other. `docs/eval/phase-4-e2e-run.txt:110` reads the result as *"The re-score moved 57% -> 65% ... after two lines were added to the editor"* — a delta that is dominated by the corpus change, not the edit, and the run recorded no unedited baseline that would separate them.
→ Either record a re-score of the *unedited* draft in the eval so the delta is attributable, or say on screen that the two numbers are not comparable. `RESULT.rescoredExplainer` describes the new computation but never says the old number was a different one. Note the calibration gap in `docs/eval/coverage-thresholds.md` either way.

**5. [MAJOR] `src/lib/openrouter/server.ts:67` — `judge: 1200` output tokens against a schema that permits ~100× that, with no `finish_reason` check.**
`judgeReportSchema` (`validation.ts:513-569`) allows 50 violations × 2×2 000 chars, a 4 000-char `evidence`, 100 `missingHonest`, 50 `atsFormat.issues`, 50 feedback lines. A truncated completion is non-empty, so `chatCompletion` returns it as success (the guard at `openrouter/server.ts:309` only catches empty content), Zod fails, and the repair retry goes out **at the same 1 200-token ceiling** and truncates identically → 502 with two Haiku calls billed. Your own run logged `[chat] judge output failed validation, one repair retry`, on a report with 5 violations. On `POST …/judge` that 502 costs two calls and saves nothing (the insert at `judge/route.ts:96` is never reached). `docs/backlog.md:89` (p4-2) records the symptom but diagnoses it as schema strictness; its proposed remedy — listing the four criteria in P3's "Return ONLY JSON" line — cannot fix a token cut.
→ Correct p4-2's diagnosis, and either raise `MAX_TOKENS_BY_STEP.judge`, bound the arrays P3 may return in the prompt, or treat `finish_reason === 'length'` as a distinct failure so the repair retry is not spent reproducing it.

**6. [MAJOR] `src/lib/coverage.ts:168` — the re-score corpus is capped by a constant that means something else.**
`chunkContent` applies `capChunks(…, MAX_CHUNKS_PER_ITEM = 20)`, and that 20 is derived from rule B9's `documents` ceiling (`src/lib/chunking.ts:88-104`) — a per-career-item storage cap with no meaning for an ephemeral corpus that is never stored. At the editor's own 15 000-char bound it forces ~750-char chunks; at a typical P2 output (`max_tokens 2500` ≈ 8 000 chars) it forces ~400-char chunks. Both are above the 80-300 band v2.14 established, and `chunking.ts:16-28` records exactly what a coarse chunk does to a similarity ranking: it resembles every requirement a little and wins almost every comparison. So a *long* edited resume scores systematically differently from a short one, for a reason that is an accident of a storage constant. The docblock at `coverage.ts:153-156` claims the two sides are "one claim on each side", which the cap makes untrue above ~4 000 characters.
→ Give `chunkContent` an explicit cap argument and pass none (or a corpus-appropriate one) on the re-score path.

**7. [MINOR] `src/lib/judge.ts:159-163` — `openingVersion` states a symmetry it does not implement.**
The docblock says the `ai`/`ai_revision` pair "is then compared the same way whichever way round it arrives, because `bestVersion` is symmetric". It is not: the function only reaches `bestVersion` when `versionsNewestFirst[0].source === 'ai_revision'` (`judge.ts:170`). If the pair ever came back ai-first it would return the original uncompared. Not reachable today — the two inserts are separate transactions, so `now()` differs — but the comment promises a property the code lacks, and `tests/unit/judge.test.mjs:221-228` only covers the revision-first order.
→ Either compare the pair in both orders, or replace the sentence with "this relies on `created_at` being distinct across the two inserts".

**8. [MINOR] `src/lib/scoring.ts:358-364` and `:314` — the `baseText` docblocks now contradict a live caller.**
Both say `baseText` is the CAREER BASE and that passing `sourceText` "would make the gate lie in the other direction". `coverage.ts:348` passes `corpus.corpusText`, which on the re-score path *is* `sourceText`. The behaviour is declared and defensible (SPEC.md:657); the comment is now an instruction to the next agent to undo it.

**9. [MINOR] `src/lib/db/types.ts:132` — "it reaches the database on no path at all" is false.**
`coverage.ts:363` sets `matchedText` on every entry including the scan's (as `null`), and `updateApplication(…, { coverage })` writes them. No data leaks — the value is always null on that path — but the sentence is wrong and it is the sentence that justifies the field's safety.

**10. [MINOR] `src/lib/validation.ts:466-473` — "`resume_versions.content`'s own CHECK" overstates the constraint.** The CHECK is `char_length(content) <= 15000` only (`supabase/migrations/001_init.sql:70`); there is no minimum. `MIN_RESUME_CHARS = 100` is an app rule. SPEC.md:664 repeats the claim.

**11. [MINOR] `rescore/route.ts:46-49` and `coverage.ts:143` — "ONE embeddings run" is not guaranteed.** `embedFor` splits at `EMBEDDING_BATCH_SIZE`; `parsedVacancySchema` allows 200 requirements, so a large parse issues several `rescore` rows. Harmless under rule B7 (embeddings excluded) but the declared cost is stated as one.

**12. [MINOR] `src/lib/tailoring.ts:51` — `droppedForSize` is computed and never read.** Neither `generate/route.ts:121` nor `judge/route.ts:80` uses it, so a `MAX_ITEMS_CHARS` drop is silent — against this module's own standard elsewhere (`coverage.ts:243-248` logs the keyword drop). Also `itemsPayload`'s `size` (`generation.ts:124`) omits `type` and the JSON envelope, so the real `<items>` block runs ~60 characters per item over the declared 24 000.

**13. [MINOR] `result-workspace.tsx:95` — the "Auto-revised once" badge outlives the drafts it describes.** `autoRevised` is `versions.some(v => v.source === 'ai_revision')`, so after [Check quality] appends a `user` version the badge sits above the user's own text and the user's own report. Architect MINOR 16 was closed for the ai/ai_revision pair only.

**14. [NIT] `src/components/applications/judge-card.tsx:27` — "A Server Component: no state, no handlers, no JavaScript shipped" is false.** It is imported by `resume-editor.tsx:5`, which is `'use client'`, so it compiles into the client bundle. Harmless (it reads only pure `lib/judge` exports) but the docblock states a boundary property the tree does not have.

**15. [NIT] `result-workspace.tsx:81-84` — the render-time re-sync is correct React and has one narrow loss window.** `setVersions` during render on prop-identity change is React's documented pattern. `run()` serialises the *requests* but not the `router.refresh()` calls they fire, so a refresh from action N-1 resolving after action N's `setVersions` would reset the list to the pre-N rows. Self-heals on the next refresh.

**16. [NIT] No server-side one-click guard on `/judge`.** It is a metered chat endpoint with only the client ref in front of it; `/generate` has its 409. Same shape as `p3-10`, which already carries the `/scan` re-run.

**17. [NIT] `src/lib/utils.ts:9` — `FS_UNSAFE = /[<>:"/\|?*]/gu` does not contain a literal backslash** (`\|` escapes the pipe), so a backslash in the resume's first line survives into the filename. Pre-existing, outside this branch.

## Deviations needing a SPEC/CLAUDE amendment

1. Block D #5 / Block F rule B4 / prompt P3 — the vacancy keyword list leaves both prompts, and what `keywordCoverage`/`missingHonest` are measured against instead (finding 1). **Blocking.**
2. SPEC.md:644 — the revision generate step discards a billed, judged draft, or the code is changed to match the sentence (finding 2). **Blocking.**
3. SPEC.md:615's "a client reading `matchScore` must apply `renderableScore()`" — either honoured on the re-score path or amended (finding 3).
4. `docs/eval/coverage-thresholds.md` — the thresholds are calibrated against the career-base corpus only and are reused unchanged on the editor corpus (findings 4, 6).
5. SPEC.md:664 — `resume_versions.content`'s CHECK has no lower bound (finding 10).

## Already carried, not re-raised

`p4-1` (`maxDuration` vs the platform limit), `p4-3` (`/judge` re-retrieval), `p4-4` (per-instance lock), `p4-5` (export dedupe against the latest only — confirmed correct as "unchanged since I last saved"), `p4-6` (auto-revision wiring untested), `p4-7` (`NAME` placeholder), `p4-8` (`revisionWithheld` unreachable — confirmed: `needsRevision` requires findings, so `tailoring.ts:284` cannot fire), `p4-9`, `p4-10`.

## Checked and clean

`generateResume`'s `.slice(0, MAX_RESUME_CHARS)` cannot truncate anything real — `MAX_TOKENS_BY_STEP.generate = 2500` bounds output at roughly 10 000 characters against a 15 000 ceiling, and the truncation happens before the judge sees the text, so the two never disagree. No nesting in the retry path: `runChatJson` → `runChatWithin` → `issue` all share one `Budget`, and `issue` refuses at `spent >= 2` (`chat.ts:159`), so a repair around a network retry issues 2 requests, not 4; four steps × 2 = the declared 8, and there is no arrangement of verdicts that reaches a fifth step. `judgeOrNull` swallows exactly `DailyLimitError` and `AiUnavailableError` and rethrows everything else. The three retrieval outcomes survive the `lib/coverage.ts` extraction — `CorpusOutcome` has no per-requirement `could_not_search`, and `bestChunk` throws rather than returning null on a missing outcome (`coverage.ts:391`). `sourceIsBase`/`corpusIsSource` is faithful: `scan/route.ts:185` passes the old `plan.sourceIsBase`, `editorTextCorpus` hard-codes `true`. `/rescore` vector alignment is correct — `[...requirements, ...units]` in, length asserted, `slice(requirementTexts.length)` out, `cosineSimilarity` on pgvector's own scale. `Content-Disposition` cannot be injected: `\p{C}` strips control characters in `exportFilename` and `asciiFallback` strips the rest.
