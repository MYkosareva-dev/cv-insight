# ai-architect — the p3-17 lexical evidence gate (2026-09-03)

**Scope:** commit `d3dbc7c` on `phase-3-scan`, one change only — rule B1's lexical
evidence gate (SPEC v2.15, backlog p3-17). Not the branch.

**Saved verbatim, before any of it was acted on** (CLAUDE.md, Process). Everything
between the rules below is the agent's own text, unedited. What was done about it
is in `docs/reviews/phase-3.md`, not here — this file is the record, not the
response.

**Two earlier attempts at this gate produced nothing**: both ran in the
background against a wider scope and stalled without writing a report. The run
below differs in two ways — it was scoped to this single change with an explicit
file list, and it ran in the FOREGROUND. It completed in under two minutes. Worth
knowing next time a gate appears to hang.

---

VERDICT: APPROVE WITH CHANGES

1. [MAJOR] `src/lib/validation.ts:300-304` + `src/app/api/scan/route.ts:183,266` — `terms` are never verified as literal spans of the vacancy text, though `keywords` are (`literalKeywords`, the v2.13 fix that exists because owner testing caught P1 returning "Quality assurance" for "quality checks"). A generalized/expanded term ("Microsoft Office" for a posting saying "MS Office") now flips a coverage status, a worse consequence than the incoherent table row v2.13 dropped → filter `terms` by `keywordCount(plan.vacancyText, term) > 0` before the gate; if nothing survives, withhold the gate (the same conservative direction as `terms.length === 0`), and record the drop count like `keywordsDropped`.
2. [MAJOR] `src/lib/scoring.ts:277` — the gate requires the posting's surface form in the user's own prose: base "PostgreSQL"/posting "Postgres", "Node.js"/"NodeJS", "MS Office"/"Microsoft Office" all yield a FALSE GAP at similarity 0.9 → this direction of error is not named in SPEC.md:779 ("What this does NOT do") → declare it there, or gate only when the term is also absent from the source resume's own text.
3. [MINOR] `src/lib/scoring.ts:108-115` — `keywordRegex` escapes verbatim with no whitespace normalization, so a term copied across a posting line-wrap ("Google\nSuite", double spaces) can never match any base → collapse internal whitespace runs to `\s+`.
4. [MINOR] `src/lib/scoring.ts:35-42` — the comment's invariant ("S reaches 1 exactly where `isCovered` turns true, so they cannot disagree about what a fully met requirement is") is now false: a lexical gap still contributes full S credit → restate it as similarity-only.
5. [MINOR] `SPEC.md:758` — "the gate and the keywords table can never disagree about whether a term is present" holds only for the boundary rule; for a pasted source the gate reads the base and the table reads the paste, so "Covered" beside "Labelbox: 0 in resume" is still reachable → narrow the claim.

Q1 Yes — two paths: an unenforced-verbatim term (finding 1) and a surface-form mismatch between posting and base (finding 2). The other cases are safe: blanks trimmed in validation.ts:304, empty `terms` withheld (scoring.ts:276), pre-v2.15/unknown `evidence` defaults to `general` (validation.ts:290-293), an empty base cannot reach the gate because similarity is 0 and `isCovered` already returns `gap` (scoring.ts:319).
Q2 Corpus is right — `baseText` comes from `careerBaseCorpus(await listCareerItems())` in both branches of `resolveSource` (route.ts:510,529), never `sourceText`; DAL-only reads, chokepoints intact.
Q3 Order is right and matches SPEC.md:773 (after `isCovered`, before the `sourceIsBase` split, scoring.ts:319-339); the one caller (route.ts:266) destructures the new `{status, missingTerm}` return — no stale callers.
Q4 No CLAUDE.md conflict: no new model call, no retry, no new dependency, `terms`/`evidence` ride the existing P1 response. Only the two documentation overstatements above (findings 4, 5).

---

*End of the agent's report.*
