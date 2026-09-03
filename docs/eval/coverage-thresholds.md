# Coverage thresholds — calibration note (2026-09-03)

> Two parts, in the order they were measured. **Part 1** derived the thresholds
> against the chunker that stored one ~2,000-character blob per career item.
> **Part 2** is the semantic-chunking intervention (backlog p3-13) and re-measures
> the same case against it. Part 1's numbers are deliberately NOT overwritten:
> the before/after pair is the evidence that the intervention did what it did,
> and that it did not do what it could not.

# Part 1 — deriving the thresholds (blob chunking)

**This is a calibration NOTE, not a benchmark.** It rests on **seven** labeled
requirements from **one** scan of **one** posting against **one** career base.
Seven points can show that a threshold is in the wrong place — which is what they
did — and they cannot establish that a new one is right in general. Nothing here
should be read as a measured accuracy figure, and the numbers below are expected
to move when a second case is labeled. What makes them worth writing down is that
the shipped thresholds were chosen from no measurement at all.

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
`cost_usd_micro` 9** — for five career items. Per `llm_calls`, the whole
before/after exercise (five seeded runs: two Hiredbuddy before/after, one
Hiredbuddy re-index, one original case, plus the intermediate run) cost about
**32,000 micro-USD ≈ $0.032**, almost all of it the `import_resume` and
`parse_vacancy` chat calls at ~6,350 micro-USD per seeded run; the embedding half
is 8–9 micro-USD per run.

Extrapolated for a real base, the number that matters for a re-index: embedding
is priced per token, and chunking changes how text is DIVIDED, not how much of it
there is — the title prefix repeated per chunk is the only addition. A 200-item
base at the chunk cap is ~4,000 chunks, ~63 requests, on the order of **$0.01**.
Re-indexing is cheap; it is the writes, not the embeddings, that need the
ordering guarantee.
