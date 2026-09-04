# Phase 4 — ai-architect phase gate on the PLAN (2026-09-03)

Run before any code was written, on the branch `phase-4-generate` while it was still
empty, per CLAUDE.md ("ai-architect BEFORE implementing each phase"). The plan put to
it is the one summarised in the hand-over: DAL, call budget, retrieval for generation,
the grounding gate, the revision, the four endpoints, the rescore persistence question
and the UI restructure. Saved verbatim, in the run that produced it, before anything
was acted on.

---

# Phase 4 plan review — verdict

```
VERDICT: REVISE
```

Three BLOCKERs, eight MAJORs. The chokepoints are intact and the DAL/RLS story is clean — nothing here touches `.from(`, adds a policy, adds a retry, or moves a secret. What fails is (a) two undeclared substitutions for SPEC Block D contracts, (b) a lock that stops locking halfway through the run it guards, and (c) several unanswered questions the plan treats as settled.

---

## BLOCKERs

**1. [BLOCKER] `/rescore` silently replaces Block D #6's mechanism — undeclared.**
`D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md:619` states: *"embeds the edited text's bullets (`rescore` step) and recomputes similarity against the ALREADY-stored requirement embeddings."* Your plan (item 7) does the opposite: it re-embeds the **requirements** and re-runs `match_documents` against the **career base** via the extracted `coverageFor`. You declared the *persistence* deviation (item 8) and not this one — and this is the larger of the two.

It is also the answer to your question 8b. S cannot move because you inverted the corpus: Block D #6 embeds the *edited resume's bullets* and scores requirements against **those**, which is precisely the thing an edit changes. Under your substitution, [Re-score] spends a metered embeddings request per click to recompute a number that is arithmetically incapable of responding to the edit, and US-5's acceptance line *"Re-score changes the score"* (`SPEC.md:258`) is met only through K. That is a paid call that buys a foregone conclusion.

→ Required: implement #6 as written (embed the edited text into an ephemeral corpus, score the stored `vacancies.parsed` requirements against it), **or** amend SPEC Block D #6 with a `> Decision:` stating that rescore reuses the base-matching path and that S is therefore fixed — and then say so on screen, because a ring that visibly does not move on a re-score is worse than one that does not exist.

**2. [BLOCKER] `/export` does not save a version, against SPEC's own sentence.**
`SPEC.md:619` closes #6 with *"Does NOT save a version (saving happens via `/judge` or export)."* Your item 7 export bullet describes a file response and nothing else. Combined with item 8 (rescore persists nothing) and item 7's `/judge` (which saves only when the user presses [Check quality]), the reachable state is: user edits, downloads a .docx, reloads, and the editor shows the AI version — the file on their disk corresponds to no row in `resume_versions` and no judge record.

This is also the honest resolution of your question 8. The reason ephemeral rescore is defensible is that *export* is the persistence point SPEC already designated. Drop that and the ephemeral choice stops being a considered trade-off and becomes data loss.

→ Required: `/export` inserts a `source='user'` version (`judge: null`) before returning the file, or SPEC:619 is amended to say where an edit is persisted instead.

**3. [BLOCKER] The 120 s lock TTL under `maxDuration = 300` permits exactly the duplicate spend it exists to prevent.**
Item 7 sets both numbers side by side without reconciling them. Your own worst case (item 2) is four chat steps, each up to 60 s + a 2 s network-retry wait — ~248 s, which is why you raised `maxDuration` to 300 in the first place. The TTL expires at 120 s, mid-run. A second POST at t = 130 s acquires a free lock and starts a second full generate for the same application: up to eight more metered chat requests, two racing `resume_versions` insert pairs, and a response that may describe a version the user never sees.

`SPEC.md:964` (edge case N6) specifies the TTL as protection against an *orphaned* lock (tab closed, server completes). Your `maxDuration` makes it a protection that switches itself off before the guarded work finishes. CLAUDE.md's metered-call rule and the repo's own "a configured mechanism is not a working one" standard both land on this.

→ Required: release the lock in a `finally`, and set the TTL as a crash backstop at ≥ `maxDuration`, not below it. If N6's 120 s is to survive as a number, SPEC must say what it now means.

---

## MAJOR

**4. [MAJOR] Top-8 chunks → distinct items collapses to 1–3 items under v2.14 chunking.** `SPEC.md:781` and `docs/backlog.md:90`: chunking is now one chunk per *claim*, 80–300 chars, `MAX_CHUNKS_PER_ITEM` 2 → 20, and the measured base went 5 rows → 9 rows for five items. Block D #5's "top-8" was written when a chunk ≈ an item. Eight semantic chunks now plausibly resolve to two career items — and your expansion (item 3) then hands P2 a two-item corpus to write a whole resume from, while `bestChunk`-style concentration (v2.14 measured one chunk winning 3 of 8 requirements) makes that the *likely* case, not the edge one.
→ Retrieve to a target number of **distinct items**, not chunks (e.g. widen `match_count` until N distinct `career_item_id`s, N stated and justified), and put that number in the SPEC amendment alongside the expansion itself.

**5. [MAJOR] The generate path's own embeddings call is absent from the budget and from the ledger story.** Item 2 accounts for chat only. `/generate` also makes a metered embeddings request, and two things about it are unspecified: *what text is embedded* — Block D #5 says "the vacancy summary embedding" but `ParsedVacancy` (`src\lib\db\types.ts:62`) has no summary field, only title/company/requirements/keywords — and *how it is logged*: `logEmbedCall` hardcodes `application_id: null` (`src\lib\retrieval.ts:135`), so the generate run's embedding row is an orphan and DoD item 7's "one full pipeline run" stays partial (open as `p3-8`, `docs\backlog.md:75`).
→ Define the query text explicitly in the SPEC amendment, and either thread the application id through `matchDocumentsForTexts` → `embedFor` → `logEmbedCall` or declare that p3-8 remains open through Phase 4.

**6. [MAJOR] Rule B7 can refuse the judge step after the generate step has been billed.** `assertUnderDailyCap` runs per step (`src\lib\chat.ts:116`), against `committed + ledger`. A user at 49 committed calls passes the generate check, spends a Sonnet call, then gets 429 on the judge. Your item 2 has no branch for it, and US-4's error path is *"Generation failed — nothing was saved"* (`RESULT.generationFailed`, `src\lib\copy.ts:475`) — true, and the user paid for it. SPEC's own reasoning at `SPEC.md:795` ("the cap decides whether a step may START, not whether it may finish") was written about a step's retry budget, not about a four-step request.
→ Decide and declare: either save the un-judged `ai` version with an honest "not checked" card, or check the cap once against the whole run's ceiling before the first spend.

**7. [MAJOR] `needsRevision()` distrusts the model on grounding and trusts it on everything else.** P3 (`SPEC.md:919`) defines `verdict = "revise"` if grounding fails **OR any criterion ≤ 2**. Your gate (item 4) forces revise on grounding only and otherwise reads `report.verdict`. The argument for not trusting the field on grounding applies unchanged to the ≤2 half — a model that mislabels its own verdict does not do so selectively.
→ Compute both halves server-side in `lib/judge.ts`; the model's `verdict` should be input to nothing.

**8. [MAJOR] Feeding `missingHonest` into the revision prompt pushes the generator toward the violation the gate catches.** Item 5 appends `keywordCoverage.missingHonest` to `{{revisionFeedbackBlock}}`, which P2 renders as *"A reviewer found these issues — fix all of them"* (`src\lib\prompts.ts:132`). Rule B4 (`SPEC.md:761`) says the generator may use a keyword *only if supported by retrieved chunks*, and P3's `missingHonest` is defined as supported-but-absent — but a Sonnet call told to "fix all of them" against a keyword list has a direct incentive to manufacture support. That is the grounding violation B2 exists to catch, arriving via the app's own instruction.
→ The feedback block must carry B4's constraint in words ("add these only where the career items already support them; leave the rest out"), or `missingHonest` stays out of the revision.

**9. [MAJOR] `/judge`'s `<items>` block is unspecified.** P3 (`SPEC.md:928`) takes CAREER ITEMS as *"the only permitted source of facts"*. Item 7 says nothing about where they come from on the on-demand path. Empty ⇒ every claim in the user's edited resume is ungrounded and [Check quality] fails everything by construction; re-retrieved ⇒ an unaccounted embeddings spend per click, and a *different* item set from the one the resume was written against, so the grounding verdict is not comparable to the generate-time one.
→ State it. The defensible answer is to re-use the item set from the application's most recent AI version (which means storing the retrieved item ids, which means saying so in the amendment).

**10. [MAJOR] The metered buttons have no one-click-one-spend guard.** SPEC v2.11 (`SPEC.md:668`) established that every metered button is locked by a **ref set synchronously**, because a `disabled` prop cannot guard two clicks that fire before React re-renders — and that the e2e asserts the *request count*, not the UI. Phase 4 adds four such buttons ([Generate], [Re-score], [Check quality], [Download]) and item 9 does not mention the rule. Two of them are the first metered buttons built since it was written.

**11. [MAJOR] `SCAN.savedVersionUnavailable` becomes a false sentence the moment this phase merges.** Its text is *"Saved resume versions arrive with the tailored-resume editor."* (`src\lib\copy.ts:204`), thrown from `src\app\api\scan\route.ts:542`, and v2.12's reason for omitting the tab (`SPEC.md:593`, `SPEC.md:664`: rows do not exist) expires here. Item 10 defers the feature — fine — but the *copy* names a milestone that has arrived.
→ Restate the copy and the v2.12 note in the same branch, or build the source. Deferring the feature is a choice; shipping copy that says the opposite of the truth is not.

**12. [MAJOR] Skipping the revision on a finding-free report is a deviation from Block D #5's server steps and is not on your item-10 list.** `SPEC.md:614` and US-4 step 2 both say *revise once when verdict = revise*. Answering your question 5 directly: **yes, skipping is the right call** — a generic "try again" is a second Sonnet call bought with no information, and CLAUDE.md's metered rule makes an uninformative spend indefensible. But two things follow. First, it must be declared as a deviation, not implied. Second, the state it handles — `grounding.verdict === 'fail'` with `violations: []` — is a self-contradictory report against P3's own rule (*verdict "pass" only if zero violations*, `SPEC.md:912`), so treating it as a valid report you decline to act on is a weaker reading than treating it as a malformed one. Consider making it the schema's problem rather than the pipeline's; either way the resulting card must say what happened, and `RESULT` has no string for "the reviewer flagged this and gave no reason".

---

## MINOR

13. **[MINOR]** `SPEC.md:120` describes `errors.ts` as *"the Block D status table as classes (401/400/404/413/422/429/502/500)"* — adding `AlreadyRunningError` makes that line stale. Also `ERROR_MESSAGES` (`src\lib\copy.ts:615`) has no `ALREADY_RUNNING` string, only the code (`src\lib\copy.ts:600`); the 409 needs user-facing words.
14. **[MINOR]** `maxDuration = 300` is unverified against the deployment's function limit — the same open question as `p3-2` (`docs\backlog.md:69`), now on a route whose worst case is 4× longer. A platform cut below it kills `after()` and drops `llm_calls` rows for calls that *were* billed (rule B8).
15. **[MINOR]** New copy is needed and not enumerated: the rescore "unsaved measurement" label and its way back (item 8), the version list, the judge-card criteria rows. v2.12's note 9 (`SPEC.md:599`) set the precedent that new copy constants are enumerated in the SPEC amendment.
16. **[MINOR]** If `bestVersion` picks the `ai` original after a revision, the 200 body carries `source: 'ai'` with `autoRevised: true` and the card shows `RESULT.autoRevised` ("Auto-revised once") above the *pre-revision* text. State which version the badge describes.
17. **[MINOR]** Payload size: item rows carry `content` up to 4,000 chars (`SPEC.md:303`). Eight items ≈ 32 KB of text into P2 **and** P3, twice on a revised run. `MAX_TOKENS_BY_STEP` bounds output only. Put a bound on the `<items>` block and say what it is.
18. **[MINOR]** A `source='user'` version saved by export carries `judge: null`. The ATS/Quality bars must then still read `RESULT.notChecked`, not "0 issues" — the three-state discipline already encoded at `src\app\(app)\applications\[id]\page.tsx:186`. Item 9 says the bars "stop saying Not checked yet once a judge report exists", which is right only per-version.
19. **[MINOR]** `MAX_CHAT_REQUESTS_PER_GENERATE = 8` asserted *after* each step is a tripwire, not a control — the spend has happened by the time it throws, and `issue()` (`src\lib\chat.ts:145`) already makes it unreachable. Fine as a defect trap; label it as one. Also note `lib/budget.ts` is deliberately not `server-only`, so nothing in it may ever read env or grow a server import.

## NIT

20. **[NIT]** `{{revisionFeedbackBlock}}` is interpolated **outside** any tagged data block (`src\lib\prompts.ts:104`) — model-authored text entering P2 as instructions. SPEC's own P2 comment sanctions this shape, so it is not a defect; worth one sentence in the docblock saying the judge's output is trusted as instruction while the user's is not, and why.
21. **[NIT]** `result-workspace.tsx` reading `JudgeReport` from `server-only` `src\lib\db\types.ts:199` extends `p3-12` (`docs\backlog.md:79`) to a fifth client component.
22. **[NIT]** `docx` is named in the stack table (`SPEC.md:54`) and absent from `package.json:19` — adding it is SPEC-sanctioned, not a new dependency; the lockfile change belongs to this branch.

---

## Answers to your three questions

**Q3 — is the chunk→item expansion defensible?** Yes, on CLAUDE.md "Retrieval" grounds: items go into a model call as data, inside P2/P3's `<items>` block, and nothing reaches the client. Your `period` argument is verified — `chunksForItem(item.title, item.content)` (`src\lib\retrieval.ts:268`) never sees `period`, so P2 rule 4's `"Title — Company (period)"` is unachievable from chunks and the alternative is an invented date. Handing the judge the identical block is also right. What breaks is not the principle but the *arithmetic*: finding 4. Also note you are widening the grounding corpus — the model now sees whole items including the parts that did not match — which makes P3's "CAREER ITEMS" more literally true, and makes B4's "supported by retrieved chunks" a phrase the SPEC amendment has to restate.

**Q5 — is skipping the revision right?** Yes. See finding 12 for the two conditions.

**Q8 — is ephemeral rescore right?** Ephemeral is right *only because* export persists (finding 2). Fix that and the story is coherent: stored numbers are what a run measured, the in-place number is labelled as a live measurement of unsaved text. The second half of your question is the more serious one and it is finding 1 — S does not move because you changed which corpus is embedded, not because rescore is inherently limited.

---

## Deviations needing a SPEC/CLAUDE amendment

Committed in this branch or listed under "not done / deferred" — silence is a defect (CLAUDE.md, Process):

1. Block D #5: top-8 chunks → distinct career-item rows, with the widened retrieval budget and the `<items>` payload bound (findings 4, 17).
2. Block D #5: the vacancy query text actually embedded, since "vacancy summary" names no field (finding 5).
3. Block D #6: rescore's mechanism (finding 1) **and** its non-persistence (your item 8).
4. Block D #6/#9: where a user edit is persisted — export saving a `source='user'` version (finding 2).
5. Block D #5 / US-4 step 2: the no-specific-finding revision skip (finding 12).
6. Block D #7: `/judge`'s item source (finding 9).
7. Edge case N6: the lock TTL's relationship to `maxDuration` (finding 3).
8. Block A line 120: `errors.ts` gains 409; Block A stack: `docx` lands in `package.json`.
9. Block E: the new copy constants, enumerated (finding 15).
10. v2.12's `/scan` "Saved version" note and `SCAN.savedVersionUnavailable`'s wording (finding 11).
11. Rule B7: the cross-step cap policy for a four-step request (finding 6).

Not findings, confirmed clean: no new `.from(`/`.rpc(` site; `resumeVersions.ts` already in `DAL_FILES` (`scripts\check.mjs:89`); no new RLS policy needed (`resume_versions` S/I covers insert-only, `applications` S/I/U covers nothing new since rescore writes nothing); no new check rule; `lib/budget.ts` and `lib/judge.ts` pure-and-testable follows the `lib/pricing.ts` precedent and closes backlog `m-4` (`docs\backlog.md:25`); no page/component/route touches `lib/openrouter/server.ts`; no dependency outside the stack table.
