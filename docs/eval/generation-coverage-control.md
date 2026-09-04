# Grounding against a base that COVERS the vacancy — the p5-16 control

Date: 2026-09-04 · Branch `phase-7-release` · Fixture
`docs/eval/calibration-case-vinterlys.json` · Seeded and measured with
`scripts/demo-seed.mjs` against the real models.

**One run, one fixture, two judged versions. This is an OBSERVATION, not a rate,
and the number of runs is one — lower than the three the sibling file already
warns about.** What it can do is separate two explanations that were previously
entangled; what it cannot do is establish a frequency.

---

## The question

`docs/eval/generation-model-comparison.md` found grounding failing on the first
draft in **3 of 3 runs, on both generators**, and named the confound in its own
conclusion: every one of those runs used
`docs/eval/calibration-case-hiredbuddy.json`, whose career base *deliberately does
not cover* the posting. So "the writer over-claims" and "the corpus is thin" both
predicted the same result, and nothing measured could tell them apart.

Backlog `p5-16` asked for the control: a second fixture whose base genuinely
covers the vacancy. This is that run.

## The fixture did cover the vacancy — measured, not asserted

A career-base scan of the invented Kai Lindqvist base against the invented
Vinterlys Data posting. **Match Rate 82.** Nine of twelve requirements Covered:

| Requirement | Status | Best similarity |
|---|---|---|
| 3+ years building and maintaining production data pipelines | covered | 0.5599 |
| Strong SQL and solid Python | covered | 0.5902 |
| Production experience with Apache Airflow | covered | 0.5686 |
| Hands-on experience with dbt | covered | 0.5349 |
| A cloud data warehouse such as Snowflake or BigQuery | covered | 0.5842 |
| **Streaming data using Apache Kafka** | **gap** | 0.4248 |
| **Working knowledge of Terraform** | **gap** | 0.4199 |
| Comfortable with Docker and a CI pipeline | covered | 0.5491 |
| Data modelling: star schemas, slowly changing dimensions | covered | 0.7394 |
| Good written English | covered | 0.5263 |
| **Apache Spark or Databricks** (nice) | **gap** | 0.4985 |
| Schema-drift detection or data contracts (nice) | covered | 0.4185 |

**All three gaps were produced by rule B1's lexical evidence gate, and all three
sit ABOVE `COVERAGE_THRESHOLD = 0.36`.** Similarity alone would have called every
one of them Covered — 0.4985 for Apache Spark is higher than four of the nine
genuine matches. The base does adjacent work in each case and never names the
tool, which is exactly the false positive the gate was built for, and this is the
first time it has been demonstrated on a corpus that is otherwise well covered.
`docs/images/scan-coverage.png` is that table.

That is the precondition this file needed. The base covers the posting.

## The answer: no. Grounding still fails, on both versions

From `/quality`, which counts every stored verdict:

> **Grounding (a gate, not a score): 0 passed · 2 failed** — over 2 judged versions.

and the run classification:

> Passed the rubric on the first attempt — **0 / 1**
> Needed the one rewrite, and passed after it — **0 / 1**
> **Needed the rewrite and still failed after it — 1 / 1**

| Version | Grounding | Keyword | Relevance | ATS | Verdict |
|---|---|---|---|---|---|
| `ai` (first draft) | **fail** | 2/5 | 4/5 | 5/5 | revise |
| `ai_revision` | **fail** (1 violation) | 3/5 | 5/5 | 5/5 | revise |

The revision's row is read directly off its card. **The draft's three scores are
a deduction, and are labelled as one**: `/quality`'s score distribution over the
two versions gives keyword {2, 3}, relevance {4, 5}, ATS {5, 5}, and the revision
holds the 3, the 5 and one of the 5s. The draft's own *violation count* is not
witnessed anywhere — the judge card describes the version the editor opened with,
which after a rewrite is the revision (backlog `p5-15`), and there is no
`GET /api/applications/[id]` to read the stored report from. Only its pass/fail
is on record, and the pass/fail is what the question asked for.

One detail worth keeping: the draft's keyword coverage of **2** is at
`WEAK_CRITERION_SCORE`, so `needsRevision()` in `src/lib/judge.ts` would have
ordered the rewrite on that criterion alone. The rewrite was over-determined —
grounding was sufficient but not necessary.

## What the comparison supports, and what it does not

**Supported.** The first draft fails grounding whether or not the career base
covers the vacancy. Four first drafts have now been judged across two fixtures,
two corpora and two generators, and four have failed. The thin-corpus explanation
that `docs/eval/generation-model-comparison.md` could not rule out is now ruled
out as a *sufficient* explanation: this base covers three quarters of the
posting, scores 82, and its draft failed anyway. **The remaining suspect is
prompt P2.** That is the honest reading and it is the uncomfortable one.

**Not supported.** Nothing here is a rate. One run on one fixture cannot say how
often P2 over-claims, and it cannot say the two fixtures fail for the same
reason — only that both fail. Nor does it exonerate the corpus in general: a base
covering 9 of 12 requirements still leaves three it does not cover, and the one
recorded violation is attached to one of exactly those three.

**And the failure is a different shape, which the binary outcome hides.** On the
under-covering fixture the drafts carried 2 to 5 violations and the fallback's
rewrite made grounding worse (3 → 5). Here the surviving version carries **one**,
and it is this:

> Working knowledge of Terraform for infrastructure as code — Resume states
> 'Provisioned the warehouse, its roles, and its access policies as
> infrastructure-as-code modules' but career items do not specify Terraform as
> the tool used. Infrastructure-as-code is mentioned generically; Terraform is
> not named in any career item.

The quoted sentence **is in the career base, close to verbatim**. So this is not
an invented achievement of the kind the earlier runs produced; it is the reviewer
refusing an adjacent line as evidence for a named tool. **That is the same
judgement rule B1's lexical gate makes about the same word**, three sections up
in this file, using `keywordPresent` in `src/lib/scoring.ts` — the gate called
Terraform a gap at 0.4199 and the judge called it an unsupported claim. Two
independent halves of the pipeline, one conclusion. Whether that is the judge
being right or the judge being lexical is the question a second run would have to
answer, and it is a better question than the one this file started with.

## Run metadata

Nine `llm_calls` rows, **$0.0473**, `0 / 9` served by the fallback. Per step:
`generate` 2 calls on `openai/gpt-5.4`; `judge`, `import_resume` and
`parse_vacancy` on `anthropic/claude-haiku-4.5`; `embed` on
`text-embedding-3-small`. The generator this project configures is the generator
that answered — which is what makes this comparable to the gpt-5.4 half of
`docs/eval/generation-model-comparison.md` rather than to its fallback half.

## Re-running it

```
node scripts/demo-seed.mjs
```

It needs the demonstration account's credentials in `.env.demo.local` and a
career base that is empty — the script refuses to run against an account that
already holds items, because it publishes its screenshots. It spends one import,
one parse, the embeddings, and one generate-and-judge pair.
