# Grounding against a base that COVERS the vacancy — the p5-16 control

Date: 2026-09-04 · Branch `phase-7-release` · Fixture
`docs/eval/calibration-case-vinterlys.json` · Seeded and measured with
`scripts/demo-seed.mjs` against the real models.

**One run, one fixture, two judged versions. This is an OBSERVATION, not a rate,
and the number of runs is one — lower than the three the sibling file already
warns about.** What it can do is separate two explanations that were previously
entangled; what it cannot do is establish a frequency.

> **READ THE CLASSIFICATION SECTION BEFORE QUOTING THE HEADLINE.** A later pass
> over the stored verdicts (2026-09-04, same day, no model calls) found that
> **every grounding violation this run recorded is a COVERAGE judgement, not a
> faithfulness one** — the reviewer refusing sentences the career base does
> contain, because they do not name a tool the posting names. On one of them the
> reviewer says so in writing, inside the violation it is filing. Strike out the
> reading that this run is evidence about P2's faithfulness: for this run it is
> evidence about P3's criterion boundary. The measurements below are unchanged
> and correct; what changed is what they can be used to conclude.

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

Both rows are read from the STORED verdicts, recovered in full — see the
classification section. An earlier version of this file derived the draft's three
scores by subtraction from `/quality`'s distribution and warned that they were a
deduction; the recovered row confirms all three exactly (keyword 2, relevance 4,
ATS 5), so the deduction was right and is no longer needed. The draft carried
**2** grounding violations, which nothing had witnessed until that pass.

One detail worth keeping: the draft's keyword coverage of **2** is at
`WEAK_CRITERION_SCORE`, so `needsRevision()` in `src/lib/judge.ts` would have
ordered the rewrite on that criterion alone. The rewrite was over-determined —
grounding was sufficient but not necessary.

## Every grounding violation this run produced, classified

The stored verdicts for both versions, read back out of the application's own
page (the server-rendered payload the app delivers to its owner's session — no
model call, no DAL, no service-role key). Reproduced verbatim here because the
demonstration account will not live forever and this is the only surviving copy.

**Classification scheme**, as put to this analysis:

- **(a) a true grounding failure** — the resume asserts something the career base
  does not contain.
- **(b) a coverage judgement wearing grounding's clothes** — the resume asserts
  something the base DOES contain, refused because it does not match a term the
  posting names.
- **(c) neither** — described case by case.

### First draft (`source: "ai"`) — 2 violations

**V1 — category (b).**

> `claim`: "Working knowledge of Terraform for infrastructure as code"
> `issue`: "Resume states 'infrastructure-as-code modules' and
> 'infrastructure-as-code' in skills, but career items specify only generic
> 'infrastructure-as-code modules reviewed in pull requests'—no mention of
> Terraform by name. **The vacancy requires Terraform specifically; the resume
> does not honestly support this.**"

The quoted resume sentence is in the career base almost verbatim. Nothing was
invented. The stated reason for the violation is what the VACANCY requires.

**V2 — category (b), and the reviewer says so itself.**

> `claim`: "Experience with streaming data using Apache Kafka"
> `issue`: "Resume mentions 'streaming ingestion from checkout event topics into
> a near-real-time inventory table' and lists 'near-real-time ingestion' in
> skills. Career items confirm 'streaming ingestion from the checkout event
> topics' but do not name Apache Kafka. The resume does not explicitly claim
> Kafka, but the vacancy requires it; absence of grounding is a violation only if
> claimed. **Resume does NOT claim Kafka, so this is not a grounding
> violation—it is a coverage gap.**"

The reviewer reasons its way to the correct answer, states the correct answer,
and files the entry as a grounding violation anyway.

### Revision (`source: "ai_revision"`) — 1 violation

**V3 — category (b).** Same requirement as V1, same shape: the resume carries the
base's own sentence about infrastructure-as-code modules, and the issue is that
"career items do not specify Terraform as the tool used".

### Counts

| Category | First drafts | Both versions |
|---|---|---|
| (a) true grounding failure | **0** | **0** |
| (b) coverage judgement in grounding's clothes | **2** | **3** |
| (c) neither | 0 | 0 |

**Category (b) does not merely dominate — it is the whole of the classifiable
sample.** And the consequence is direct: remove the two (b) entries from the
first draft and its `violations` array is empty, so `grounding.verdict` becomes a
pass. **The one thing this run was built to measure — does the first draft pass
grounding when the base covers the vacancy — is decided entirely by violations
that are not about grounding.**

### Three structural tells, none of which needs a second run

1. **The `claim` field holds vacancy requirements, not resume sentences.** P3
   defines `claim` as "every factual claim in the resume". All three claims here
   are requirement strings copied from the posting. Whatever the reviewer was
   enumerating, it was not the resume's assertions.
2. **P3's framing sentence licenses it.** The prompt opens "Evaluate the RESUME
   against the VACANCY REQUIREMENTS and the CAREER ITEMS", and criterion 1 —
   correctly base-relative on its own terms — never re-scopes away from the
   requirements the framing just introduced. The requirements are also in the
   context window, as `VACANCY REQUIREMENTS`.
3. **`groundingFailed()` makes a mislabelled entry uncompensatable.** It returns
   true when the model says `fail` **or** when the violations array is non-empty
   (`src/lib/judge.ts`). So V2 — an entry whose own text says it is not a
   grounding violation — is converted into a hard rule-B2 failure by our
   arithmetic. Both halves contribute: the reviewer files it, and the code
   refuses to look inside it.

### The feedback loop this creates, in the app's own words

`feedbackForGenerator` is appended to P2 on the rewrite (rule B3). The first
draft's list opens:

> "GROUNDING FAILURE: Resume claims 'infrastructure-as-code' in the skills block
> but does not name Terraform. Career items do not mention Terraform. Vacancy
> requires 'Working knowledge of Terraform for infrastructure as code' as a
> must-have. **Either add Terraform experience to a career item (if true) or
> remove the claim from the resume.**"

and contains four further entries labelled `COVERAGE GAP` or `CRITICAL COVERAGE
GAP`. So a coverage finding is re-entering the generator as a grounding
instruction, and the only two moves it offers are to acquire the tool or to
delete an honest sentence. **The generator was penalised for not claiming
Terraform, and then told to fix it.** That is the mechanism the hypothesis
predicted, recorded in stored rows rather than argued.

## What this supports, and what it cannot

**Supported, for this run.** The 4-of-4 first-draft grounding-failure figure
cannot be read as evidence about P2's faithfulness, because on the one run whose
violation text survives, P2 invented nothing: both of its violations are the
reviewer answering the coverage question. The earlier reading of this file — "the
thin corpus is ruled out, so what remains is P2" — was wrong in its second half
and is corrected here rather than left standing.

**Not supported: any claim about the other three drafts.** Their violation text
no longer exists. The three `docs/eval/calibration-case-hiredbuddy.json` runs each
used a fresh throwaway account, all of which were deleted, and only violation
COUNTS were recorded (3, 2 and 3 on the first drafts —
`docs/eval/generation-model-comparison.md`). **So 8 of the 10 first-draft
violations across both fixtures are permanently unclassifiable**, and nothing
here says which category they fell into. What can be said is that the same
collision was AVAILABLE to them: that fixture's posting also names tools the base
does not contain — Labelbox, Supervisely, MS Office, Google Suite — which is the
exact condition that produced all three violations here. Available is not
occurred.

**Not supported: that P2 is faithful.** This run gives no evidence either way. It
removes an argument against P2; it puts nothing in its place. A draft that
invents nothing on one fixture may invent freely on another.

**Not supported: a rate, of anything.** One run, one fixture, three violations.
The fixture was also *designed* with three named tools absent from the base,
which is the setup most likely to provoke a coverage/grounding collision — so
this sample is not merely small, it is selected in the direction of the finding.
A fixture with no named-tool gaps would be the control for this control.

**The narrowing this suggests is NOT made here.** Changing P3's criterion 1 would
invalidate every rubric number this project has taken against it, including the
six versions in `docs/eval/generation-model-comparison.md` and the two above, with
no budget to re-baseline. It is recorded as a backlog item with this evidence
attached, and the criterion is untouched.

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
