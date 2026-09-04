# Coverage thresholds — calibration note (2026-09-03)

> Three parts, in the order they were measured. **Part 1** derived the thresholds
> against the chunker that stored one ~2,000-character blob per career item.
> **Part 2** is the semantic-chunking intervention (backlog p3-13) and re-measures
> the same case against it. **Part 3** is the lexical evidence gate (p3-17), which
> fixes the two false positives Part 2 proved were not a chunking problem. No
> part's numbers are overwritten by a later one: the before/after chain is the
> evidence that each intervention did what it did, and that it did not do what it
> could not.

# Part 1 — deriving the thresholds (blob chunking)

**This is a calibration NOTE, not a benchmark.** It rests on **seven** labeled
requirements from **one** scan of **one** posting against **one** career base.
Seven points can show that a threshold is in the wrong place — which is what they
did — and they cannot establish that a new one is right in general. Nothing here
should be read as a measured accuracy figure, and the numbers below are expected
to move when a second case is labeled. What makes them worth writing down is that
the shipped thresholds were chosen from no measurement at all.

## v2.16 — a SECOND corpus these numbers were not calibrated against

`SIMILARITY_FLOOR`, `COVERAGE_THRESHOLD` and `SIMILARITY_SPAN` were derived here
against ONE corpus: the career base, ranked through `match_documents` over the
whole `documents` index. Phase 4 added a second caller with a different one.
`POST /api/applications/[id]/rescore` scores the same requirements against the
resume in the EDITOR — an ephemeral corpus of one document, chunked by the same
splitter into the same 80–300 character band and compared with the same
`openai/text-embedding-3-small` cosine similarity, but never stored and never
ranked by pgvector.

The thresholds are reused there unchanged, and the argument for reusing them is
real: same embedding model, same units, same distance measure, so the scale is
the same one this file measured. But an argument is not a measurement, and no
labeled set has been run against the second corpus. Two consequences follow, and
both are stated rather than left to a reader of the ring:

1. **A change in the ring after [Re-score] is not attributable to the edit
   alone.** Part of any delta is the change of corpus. `docs/eval/phase-4-e2e-run.txt`
   records one run at 57% → 65% and an earlier one at 57% → 57%, and neither
   separates the two effects, because no re-score of the UNEDITED draft was taken
   as a baseline.
2. **A single-document corpus is smaller and less varied than a career base**, so
   the similarity distribution it produces may sit differently against a cut
   derived from the other one. Whether it does is the open question.

Carried as backlog `p4-11`: seed the calibration case, re-score its own generated
draft unedited, and compare the two distributions before deciding whether the
re-score path needs its own numbers. Until that is done, the numbers this file
defends are defended for the scan and reused for the re-score.


## Why this exists

Owner testing, 2026-09-03: a senior AI-quality career base (LLM evaluation,
annotation QA, Python pipelines) scanned against an entry-level Data Annotator
posting returned **Gap on all ten requirements**, best similarities 0.20–0.43.
One of them — *"0-2 years of experience in data entry, data annotation, or
similar role"* — is plainly covered by that base, and it scored 0.43 against a
line about evaluating and annotating LLM outputs.

Rule B1's numbers (floor 0.30, span 0.55, covered at **0.60**) predate any
measurement against `openai/text-embedding-3-small`. The instruction was not to
lower them until the screen looked better, so:

1. `src/app/api/dev/coverage-probe/route.ts` — a dev-only endpoint that re-runs
   the match for one application and returns, per requirement, the ranked
   career-item titles and RAW similarities, including the ones the coverage map
   discards because a gap names no item.
2. `scripts/coverage-probe.mjs` — signs in through the app (the only way to get a
   session this repo allows) and prints the table. `--seed` builds a throwaway
   account, imports a resume, runs one scan, probes it and deletes the account
   again, so the case below is reproducible without anybody's real credentials.
3. `docs/eval/calibration-case.json` — the case itself: the repo's fictional
   persona (SPEC v1.2) as a senior AI-quality base, and an entry-level
   annotation posting written around the phrases the owner quoted from theirs.

Reproduce with a dev server running:

```
node scripts/coverage-probe.mjs --seed docs/eval/calibration-case.json
```

It spends real money — one `import_resume` call, one `parse_vacancy` call and two
`embed` requests — because a threshold calibrated against a mocked embedding
would be a threshold for a model this app does not use.

## The run

`application 77539dc8-93c9-4660-8956-f63ea9737f81`, career-base source, 5 career
items indexed, 7 parsed requirements (5 must, 2 nice), **stored score 17**.

The owner's own scan had ten requirements and no keywords present in the resume;
this reconstruction produced seven and two keyword hits. The similarity band is
the same, which is what the calibration turns on.

## The labeled set

Labels are hand-assigned by reading the matched career item against the
requirement. Chunk text is deliberately not reproduced here — item titles and
scores only, which is what the probe returns and what the development match log
is allowed to print (CLAUDE.md, Retrieval). The items' content is in
`docs/eval/calibration-case.json`.

| # | kind | requirement | best | best-matching item | label |
|---|---|---|---|---|---|
| 1 | must | 0-2 years of experience in data entry, data annotation, or similar role | **0.4245** | Data Quality Specialist — BotWorks Labs | **covered** |
| 2 | must | Attention to detail and patience for repetitive work | 0.3492 | Data Quality Specialist — BotWorks Labs | partial |
| 3 | must | Good written English; a second language is welcome | 0.3707 | Skills | **covered** |
| 4 | must | Comfortable working with spreadsheets and simple web tools | 0.3819 | Skills | **covered** |
| 5 | must | Reliable home internet for remote work and a quiet place to work | 0.1759 | Data Quality Specialist — BotWorks Labs | gap |
| 6 | nice | Experience with annotation platforms such as Label Studio or CVAT | **0.4319** | Skills | partial |
| 7 | nice | Basic Python for small data clean-up tasks | 0.3629 | Data Quality Specialist — BotWorks Labs | **covered** |

Why each label:

- **1 covered.** The base holds a Data Quality Specialist role reviewing and
  correcting labelled training data, and an AI Prompt Evaluator role annotating
  LLM outputs. The requirement asks for 0–2 years of it.
- **2 partial.** The base evidences detail work (a 98% QA score, per-annotator
  error rates) but says nothing about repetitive work or patience. Half the
  requirement is supported.
- **3 covered.** The Skills item literally lists *English C1, Russian native,
  German B2*.
- **4 covered.** The Skills item literally lists *spreadsheets*.
- **5 gap.** Nothing in the base speaks to home internet or a workspace. This is
  a true gap, and the only one in the set.
- **6 partial.** The base has annotation QA experience but names no platform;
  neither Label Studio nor CVAT appears anywhere.
- **7 covered.** *Built Python pipelines that de-duplicated incoming datasets.*

## The distribution

```
0.1759  gap
0.3492  partial
0.3629  covered
0.3707  covered
0.3819  covered
0.4245  covered
0.4319  partial
```

n=7 · min 0.1759 · median 0.3707 · mean 0.3567 · max 0.4319

Two things are visible immediately.

**The shipped threshold admits nothing.** At **0.60**, zero of the four
labeled-covered requirements are admitted: 4 false negatives out of 4. That is
the reported defect, and it is not a matter of degree — the top of the whole
observed band is 0.43, so 0.60 is not a strict threshold, it is an unreachable
one. Every scan against this model reads "Gap" on everything.

**No threshold can separate covered from partial in this set.** The highest score
in the table (0.4319) is a *partial*, above all four *covered* ones. So a single
number cannot express "partially supported"; the most it can separate is
**evidence** from **no evidence**.

## The thresholds, and what the split costs

| constant | was | now | why |
|---|---|---|---|
| `COVERAGE_THRESHOLD` | 0.60 | **0.36** | The highest cut that admits all four labeled-covered requirements (min 0.3629). |
| `SIMILARITY_FLOOR` | 0.30 | **0.20** | Just above the observed minimum (0.1759, the one labeled gap): at or below this, nothing in the base is measurably related. |
| `SIMILARITY_SPAN` | 0.55 | **0.16**, derived | Not declared: `COVERAGE_THRESHOLD − SIMILARITY_FLOOR`, so the identity below cannot rot — and because a hard-coded `0.16` does not even satisfy it (`(0.36 − 0.2) / 0.16` is 0.9999999999999998 in binary floating point, so a covered requirement would fall a hair short of full credit). |

**The cost of the 0.36 cut, stated as asked:**

- Labeled **covered** admitted: **4 of 4**. (At 0.60 it was 0 of 4.)
- Labeled **partial** admitted as covered: **1 of 2** — requirement 6. The screen
  will call *"annotation platforms such as Label Studio or CVAT"* covered when
  the base names no platform. That is the price of a cut low enough to admit
  requirement 7 (0.3629), and it is a real over-claim, not a rounding artefact.
- Labeled **gap** admitted: **0 of 1**. The one true gap (0.1759) is nowhere near
  the cut.
- Excluded: requirement 2 (partial, 0.3492) still reads as a gap, which for a
  half-supported requirement is the conservative error.

So the split trades a 100% false-negative rate on covered requirements for one
over-claim per two partials. There is no cut in this set that does better, and
the reason is the overlap above, not the choice of number.

**The `FLOOR + SPAN = COVERAGE_THRESHOLD` identity is deliberate.** Rule B1 has
two halves that both answer "how well is this requirement met": the binary
`isCovered` and the continuous S term. Making S reach 1 exactly where `isCovered`
turns true means the two can never disagree about what a fully met requirement
is — previously S needed 0.85 to saturate, a level `isCovered` had already called
covered 0.25 earlier, so a "covered" requirement could still contribute a third
of its weight. `tests/unit/scoring.test.mjs` pins the identity so a future edit
to one number has to move the other.

**Effect on the calibration scan:** 17% → **57%**. S rises from 0.1186 to 0.7865
(K is unchanged at 0.25). For a base that covers four of the five must-have
requirements, 57% is a defensible reading and 17% was not.

## Verified in the app, not only in the arithmetic

The same case re-run against the calibrated constants
(`application b455f329-8191-48e4-a63b-3c3993cb5177`, a second throwaway account):

```
score 57  (predicted 57)
covered 0.4243  0-2 years of experience in data entry, data annotation, or similar role
gap     0.3499  Attention to detail and patience for repetitive work
covered 0.3706  Good written English; a second language is welcome
covered 0.3817  Comfortable working with spreadsheets and simple web tools
gap     0.1763  Reliable home internet for remote work and a quiet place to work
covered 0.4316  Experience with annotation platforms such as Label Studio or CVAT
covered 0.3623  Basic Python for small data clean-up tasks
```

Five of seven covered: the four labeled-covered requirements, plus requirement 6
— the over-claim this note declared in advance. The one true gap and the one
excluded partial still read as gaps. The split behaves exactly as the labels
predicted, which is the difference between a calibrated threshold and a lucky
one.

**Similarities are not bit-stable across runs.** The same text embedded twice
gave 0.4245 and 0.4243, 0.3492 and 0.3499, 0.3819 and 0.3817 — a drift of up to
±0.0007. It is far below the ~0.01 margins this calibration turns on, but it
means these thresholds must never be tuned to the fourth decimal, and a
requirement sitting within a thousandth of the cut can legitimately flip between
two scans of the same posting.

**The weakest number here is the floor.** It rests on ONE labeled gap. If a
second case shows unrelated requirements landing at 0.25–0.30, the floor is too
low and the S term is crediting noise. That is the first thing a second
calibration should look at.

## The underlying cause: chunk granularity

The compressed band is not a property of the embedding model in general. It is a
property of what this app compares.

`CHUNK_TARGET_CHARS = 2_000` with `MAX_CHUNKS_PER_ITEM = 2` (`src/lib/chunking.ts`)
means a career item is embedded as one or two ~2,000-character blocks. A
requirement is one sentence, typically 40–90 characters. Cosine similarity
between a sentence and a 2,000-character block about eight different things is
structurally low, no matter how well one of those eight things answers the
sentence — the other seven are still in the vector.

The evidence for that being the cause, rather than a guess:

- The generic **Skills** item is the best match for **three of seven**
  requirements, including two that its own text answers *literally* ("Comfortable
  working with spreadsheets" → an item listing "spreadsheets"; "Good written
  English" → an item listing "English C1"). A literal answer scores 0.37–0.38.
  A chunk containing only that line would score far higher; the rest of the
  Skills blob dilutes it.
- The whole band tops out at 0.43. Nothing reaches 0.6 because no chunk is ever
  *about* one requirement.

**The granularity that would fix it: one chunk per resume bullet** — roughly
80–300 characters, split on bullet and sentence boundaries rather than packed to
a 2,000-character target — so that a requirement is compared against a claim of
the same size as itself.

**Not done now, and deliberately not.** It is a Phase-2 rebuild with three
consequences: every `documents` row must be deleted and re-embedded (chunk text
changes, so the stored vectors are stale — and `documents` has no UPDATE policy
by design); `MAX_CHUNKS_PER_ITEM = 2` is what makes rule B9 self-consistent
(200 items × 2 = 400 ≤ 500 documents), so a ~10-chunk item breaks that
reconciliation and the document ceiling has to be re-derived; and the thresholds
in this file would have to be recalibrated afterwards, because they are
calibrated against blob-sized chunks. Recorded as backlog `p3-13`.

Until then these thresholds are calibrated for the chunking the app actually
ships, which is the honest pairing.

---

# Part 2 — semantic chunking (2026-09-03, backlog p3-13)

Everything above stays as recorded: those numbers were measured against
~2,000-character blob chunks and they are the "before" half of this section. The
thresholds derived from them are the ones the app shipped when the owner found
the defect below, which is what makes the comparison worth keeping.

## Why the chunker changed

Owner testing on the recalibrated build: **four of five Covered rows attributed
to one blob chunk**, and among them

- *"Proficient with MS Office or Google Suite"* — Covered,
- *"Experience with annotation tools such as Labelbox or Supervisely"* — Covered,

against a career base that contains none of MS Office, Google Suite, Labelbox or
Supervisely. The earlier recalibration had traded false negatives for false
positives, and the owner's diagnosis was that no threshold can fix it: a chunk
holding eight claims resembles every requirement a little and therefore wins any
comparison.

`src/lib/chunking.ts` now splits a career item into semantic units — one chunk
per bullet, prose split at sentence boundaries, target 80–300 characters, units
under the floor merged with a neighbour, sentences over 600 characters split on
word boundaries. `MAX_CHUNKS_PER_ITEM` went 2 → 20 and `MAX_DOCUMENTS` 500 →
4,000 to keep rule B9's item ceiling the binding one.

## The case, reproducible

`docs/eval/calibration-case-hiredbuddy.json` — the Mira persona base against the
Hiredbuddy Data Annotator posting, carrying the three requirement lines the DoD
names verbatim. Run it with a dev server up:

```
node scripts/coverage-probe.mjs --seed docs/eval/calibration-case-hiredbuddy.json --reindex
```

Both halves below are seeded runs: a throwaway account, one import, one scan, one
probe, then the account is deleted through the app's own flow.

## Before and after, same case, same posting

| # | requirement | before (blob) | after (semantic) | Δ |
|---|---|---|---|---|
| 1 | 0-2 years of experience in data entry, data annotation, or similar role | 0.4244 · Data Quality Specialist | 0.4002 · Data Quality Specialist | −0.024 |
| 2 | **Proficient with MS Office or Google Suite** | 0.4149 · Skills | **0.4438 · Skills** | **+0.029** |
| 3 | **Experience with annotation tools such as Labelbox or Supervisely** | 0.4280 · Skills | **0.4587 · Skills** | **+0.031** |
| 4 | Excellent attention to detail and patience for repetitive work | 0.3986 · Data Quality Specialist | 0.4149 · Data Quality Specialist | +0.016 |
| 5 | Good written English; a second language is a plus | 0.3983 · Skills | 0.3813 · Skills | −0.017 |
| 6 | Reliable internet connection and quiet place to work from home | 0.1653 · Data Quality Specialist | 0.1916 · Data Quality Specialist | +0.026 |
| 7 | Basic Python for small data clean-up tasks | 0.3629 · Data Quality Specialist | 0.3791 · Data Quality Specialist | +0.016 |
| 8 | Any exposure to machine-learning projects | 0.3614 · Data Quality Specialist | 0.3481 · Data Quality Specialist | −0.013 |

Distributions:

```
before   0.1653  0.3614  0.3629  0.3983  0.3986  0.4149  0.4244  0.4280
         n=8  min 0.1653  median 0.3986  mean 0.3692  max 0.4280   score 54

after    0.1916  0.3481  0.3791  0.3813  0.4002  0.4149  0.4438  0.4587
         n=8  min 0.1916  median 0.4002  mean 0.3772  max 0.4587   score 54
```

Rows per base: **5 documents → 9 documents** for the same five career items
(3 + 2 + 1 + 2 + 1). Match Rate: **54 → 54** — the flips cancelled, which is
itself worth knowing: the score is not the instrument that reveals this defect.

## What the intervention fixed, with the number

**Best-match concentration, which was the owner's diagnosis.** Counting the
`documents` row that actually won each requirement, not the item it belongs to:

| | before | after |
|---|---|---|
| distinct chunks winning at least one requirement | **2** | **4** |
| most requirements won by ONE chunk | **5 of 8** | **3 of 8** |
| most won by one chunk, counting only requirements that MATCHED | **4** | **2** |

The third row is the honest form of the DoD's "no requirement takes its best
match from the same chunk more than twice": the after-run's third win is
requirement 6, the reliable-internet line, whose best match is 0.1916 — a chunk
"winning" a comparison in which nothing matched at all. Among the requirements
that cleared the threshold, no chunk wins more than twice. **DoD item 4: met.**

**Attribution.** A generic skills enumeration no longer answers experience
requirements: requirement 1 attributes to a role item, not the skills list
(**DoD item 3, in the form this base can express** — the persona has two
annotation-adjacent roles, and the Data Quality Specialist item is the one whose
text is about correcting labelled data, so it is the better match than the AI
Prompt Evaluator item the DoD names).

**True positives rose.** On the original calibration case, "Comfortable working
with spreadsheets and simple web tools" went 0.3819 → 0.4709 against the same
base: a requirement that one line of the resume answers literally now matches
that line instead of the paragraph containing it.

## What it did NOT fix, and why no threshold will

**DoD items 1 and 2 are NOT met.** Both false positives are still Covered, and
both got STRONGER:

- *Proficient with MS Office or Google Suite* — 0.4149 → **0.4438**
- *Experience with annotation tools such as Labelbox or Supervisely* — 0.4280 → **0.4587**

They are now the **top two similarities of the eight**. No threshold can exclude
them without excluding every true positive underneath, so the same argument that
condemned 0.60 condemns any cut that would fix these.

**Why finer chunks made them worse, measured rather than guessed.** The premise
was that these requirements win because a blob resembles everything. That is true
of concentration and false of these two rows. Splitting the skills enumeration
did not dilute the match — it CONCENTRATED it: the chunk that used to hold twelve
skills now holds four, so the chunk nearest to "office software" is purer office
software than before, and the chunk nearest to "annotation tooling" is purer
annotation tooling. Cosine similarity between short texts measures TOPICAL
resemblance, and both requirements are topically adjacent to work the base really
does contain (spreadsheets; annotation quality assurance). What distinguishes
them from a real match is LEXICAL: the specific proper nouns — MS Office, Google
Suite, Labelbox, Supervisely — appear nowhere in the base. Chunk size cannot
carry that distinction, at any size.

**The app already holds the missing evidence, one field away.** The same
`coverage` payload that calls those two requirements Covered also stores, from
rule B1a:

```
'MS Office'     inResume=0  inVacancy=1
'Google Suite'  inResume=0  inVacancy=1
'Labelbox'      inResume=0  inVacancy=1
'Supervisely'   inResume=0  inVacancy=1
```

So the result screen states both things at once: the keywords table says the
resume never mentions Labelbox, and the coverage table says the Labelbox
requirement is Covered. Reconciling them — refusing `covered` for a requirement
whose own literal terms are absent, or introducing the third status those two
signals together can support — is a change to rule B1's coverage DECISION and to
keyword matching, which this task placed out of scope. Recorded as **p3-17**, and
it is the next thing to do about coverage accuracy; chunking was the necessary
half, not the sufficient one.

## Thresholds after chunking: unchanged, and why that is the finding

The original calibration case re-run on the new chunker, against the labels
recorded in Part 1. The matched CHUNK changed for one requirement (the Label
Studio line moved from the skills list to the Data Quality Specialist role) but
no label changes: the evidence behind each label is the same text, differently
divided.

```
label      before            after
gap        0.1759            0.2084
partial    0.3492            0.3577
covered    0.3629            0.3701
covered    0.3707            0.3791
covered    0.3819            0.4709
covered    0.4245            0.4002
partial    0.4319            0.4537     <- still above three of four covered
```

- Highest cut admitting all four labeled-covered requirements: **0.3701** (was
  0.3629). So the best cut moved from 0.36 to **0.37** — one hundredth.
- Cost of that cut, unchanged: 4 of 4 covered admitted, **1 of 2 partials
  admitted** (the Label Studio line, again), 0 of 1 gaps.
- Margin between the lowest covered and the highest excluded partial:
  **0.0137 before → 0.0124 after.**

**Asked directly: do the covered and partial bands now separate? No.** They
overlap by the same requirement they overlapped by before, and the margin is
0.0013 NARROWER rather than wider. One hundredth of movement in the optimal cut,
on seven labeled points, with ±0.0007 of run-to-run embedding jitter, is not a
recalibration — it is noise, and chasing it would be the thing this file was
created to refuse. **`SIMILARITY_FLOOR` 0.20, `COVERAGE_THRESHOLD` 0.36 and the
derived span therefore stay exactly as they were.**

That is the honest summary of the intervention: chunking fixed what chunk size
can fix — which chunk answers a requirement, and how many requirements one chunk
can answer — and left the threshold arithmetic where it was, because the
remaining error is not a size problem.

## Cost of the re-index

Measured on the seeded runs: **9 chunks embedded per base, 1 embedding request,
`cost_usd_micro` 9** — for five career items, whose nine chunks fit in one
`EMBEDDING_BATCH_SIZE` batch. Per `llm_calls`, the whole
before/after exercise (five seeded runs: two Hiredbuddy before/after, one
Hiredbuddy re-index, one original case, plus the intermediate run) cost about
**32,000 micro-USD ≈ $0.032**, almost all of it the `import_resume` and
`parse_vacancy` chat calls at ~6,350 micro-USD per seeded run; the embedding half
is 8–9 micro-USD per run.

Extrapolated for a real base, the number that matters for a re-index: embedding
is priced per token, and chunking changes how text is DIVIDED, not how much of it
there is — the title prefix repeated per chunk is the only addition. A 200-item
base at the chunk cap is ~4,000 chunks, which the gate's own packer sends as ~63
requests (one per `EMBEDDING_BATCH_SIZE` chunks, never splitting an item across
two), on the order of **$0.01**. Re-indexing is cheap; it is the writes, not the
embeddings, that need the ordering guarantee.

---

# Part 3 — the lexical evidence gate (2026-09-03, backlog p3-17)

Parts 1 and 2 stay as recorded. Part 2 ended with two requirements Covered that
the base does not support, and with the reason they could not be fixed by
chunking or by a threshold. This part fixes them, and the argument for HOW is the
measurement in Part 2.

## Why a purely semantic decision cannot separate "adjacent to" from "has"

Cosine similarity between two short texts measures how much they are ABOUT the
same thing. "Worked on data labelling" and "worked in Labelbox" are about the
same thing. So are "annotation quality assurance" and "annotation tools such as
Labelbox or Supervisely". A vector model is doing its job when it puts them close
together, and the coverage decision is asking a different question — does this
person have this thing — which the distance does not answer.

The two measured pairs, same career base, three chunkings:

| requirement | base contains | blob chunks | semantic chunks | rank in its scan |
|---|---|---|---|---|
| Experience with annotation tools such as **Labelbox or Supervisely** | annotation QA, no tool named | 0.4280 | **0.4587** | 1st of 8 |
| Proficient with **MS Office or Google Suite** | "spreadsheets", no product named | 0.4149 | **0.4438** | 2nd of 8 |

Three things follow, and each closes a door:

1. **They are the top two similarities of the eight.** Every true positive in the
   same scan scored LOWER. A threshold that excluded them would exclude the whole
   result, so no value of `COVERAGE_THRESHOLD` fixes this.
2. **Finer chunking made them stronger, not weaker.** The v2.14 hypothesis was
   dilution — a blob resembles everything a little. Splitting the skills
   enumeration raised both numbers, because the chunk nearest to "office
   software" became *purer* office software. So no chunk size fixes this either;
   the direction of the effect is the opposite of the one that would help.
3. **The distinguishing evidence is a NAME**, and the app already had it. The same
   `coverage` payload carried rule B1a's keyword rows: `'Labelbox' inResume=0`,
   `'MS Office' inResume=0`, `'Google Suite' inResume=0`, `'Supervisely'
   inResume=0`. The screen asserted "Covered" and "0 in resume" side by side.

So the gate is not a new signal. It is a join between two things the app already
computed, and the only new work is P1 saying which requirements the join applies
to.

## What was built

P1 classifies each requirement by the evidence it demands — `tool`, `credential`,
`general` — and copies the verbatim `terms` that would prove it, any one of them
being enough. Rule B1 then requires, for `tool` and `credential` only, that one
of those terms be literally present in the **career base**; absent, the row is a
Gap whatever the similarity, and the entry records the missing term so the screen
can name it. No extra model call: both fields ride in the existing P1 response.

Two design points that decide whether the gate lies in the other direction:

- **Conservative classification, stated in the prompt in those words.** A general
  requirement misfiled as `tool` invents a gap that is not there — the error this
  entire round of work exists to remove — while a tool requirement left as
  `general` merely keeps the previous behaviour. The prompt says to answer
  `general` whenever the requirement does not clearly name a product or a
  qualification, and `parsedVacancySchema` defaults a missing value to `general`.
- **The corpus is the base, never the pasted source.** They are different bodies
  of text. Searching a one-page pasted resume for "Python" would refuse a tool
  the career base really holds; the base is what the retrieval searched, so the
  base is what the gate reads. The source resume keeps its own job — deciding
  US-3's hidden match.

## Before and after, every requirement in the seeded case

`docs/eval/calibration-case-hiredbuddy.json`, career base as source. Both columns
are seeded runs on the same fixture; "before" is the v2.14 run from Part 2.

| # | kind | evidence | requirement | before | after | missing term |
|---|---|---|---|---|---|---|
| 1 | must | general | 0-2 years of experience in data entry, data annotation, or similar role | covered 0.4002 | covered 0.4002 | — |
| 2 | must | **tool** | Proficient with MS Office or Google Suite | covered 0.4438 | **gap 0.4438** | **MS Office** |
| 3 | must | **tool** | Experience with annotation tools such as Labelbox or Supervisely | covered 0.4587 | **gap 0.4587** | **Labelbox** |
| 4 | must | general | Excellent attention to detail and patience for repetitive work | covered 0.4149 | covered 0.4142 | — |
| 5 | must | general | Good written English; a second language is a plus | covered 0.3813 | covered 0.3813 | — |
| 6 | must | general | A reliable internet connection and a quiet place to work from home | gap 0.1916 | gap 0.1832 | — |
| 7 | nice | **tool** | Basic Python for small data clean-up tasks | covered 0.3791 | **covered 0.3800** | none — the base says Python |
| 8 | nice | general | Any exposure to machine-learning projects | gap 0.3481 | gap 0.3492 | — |

**Classification: 5 general, 3 tool, 0 credential** (this posting asks for no
diploma, degree or licence).

**No requirement classified `general` changed status.** Three covered stayed
covered, two gaps stayed gaps. That was the condition for calling this a result
rather than an over-firing classifier, and it is the property to re-check on any
future posting: a general row that moves means the classifier has started
claiming requirements it should have left alone.

**Requirement 7 is the case that shows the gate discriminating rather than
refusing.** "Basic Python" is classified `tool`, its term is `Python`, and the
base says Python — so it stays Covered. A gate that simply distrusted tool
requirements would have failed this row, and the difference between those two
behaviours is the whole value of the feature.

## The score moved, and NOT because of the gate

Match Rate **54 → 57**. The gate cannot move the score at all, and the numbers
show it: rule B1's S term is a function of SIMILARITY, not of status, and S is
identical across the two runs at **0.8333**. The whole difference is K, which
went from 1/10 to 2/11 keywords present, because the P1 edit changed the keyword
list (the parser now also returns "annotation guidelines", which the base
contains).

That is worth stating plainly rather than leaving as a coincidence: a scan can
gain two Gaps and a higher score in the same round, and if the two had been
connected the arithmetic would have been wrong. They are not connected. The
coverage table and the Match Rate answer different questions — which
requirements are met, and how close the base is overall — and only the first one
changed here.

**One side effect, caught and fixed rather than shipped.** The first version of
the P1 edit narrowed the top-level `keywords` list from 10 terms to 5: asked for
per-requirement `terms`, the parser started treating the keyword list as the same
job. That halved K's denominator for no good reason. The prompt now says the two
are separate jobs and asks for 8–15 keywords; the list came back at 11. Measured,
not assumed — it took a second seeded run to see it.
