# Agentic vs single-shot retrieval: an observation, not a benchmark

Status: SKELETON. The method is fixed below. The results table is empty until
the runs are made, and nothing in this file is a finding until it is filled in.

Branch: `feature/agentic-retrieval` · SPEC v3.0b (Block D §5 item 8, DoD item 14)

## What this measures, and what it does not

The question: on the same career base and the same posting, does letting the
writer search the base step by step (the Pro path) change what the resume
covers, whether it stays grounded, and what it costs?

Both paths use the same writer model (`openai/gpt-5.4`, see
`tool-calling-probe.md`), the same judge, the same seed retrieval and the same
prompt. The only difference is the `search_career_base` tool and the evidence
it adds. **This is ONE fixture and one run per path on one day.** It is an
observation of a single case. It is not a benchmark, and the reading at the end
claims no more than that.

**Scope, by owner decision (2026-10-12):** one fixture today. SPEC §5 item 8
asks for three (the two existing calibration postings plus a new one). The
other two are backlog: `calibration-case-vinterlys.json`, and a new posting
chosen because the seed retrieval is likely to miss something the base holds,
meaning a requirement worded differently from the item that covers it.

## Inputs

One file holds both inputs, and it is the one the e2e suite uses
(`tests/e2e/generate.spec.ts` and `tests/e2e/plan-gating.spec.ts` both read it):
`docs/eval/calibration-case-hiredbuddy.json`, keys `resumeText` (1,780
characters) and `vacancyText` (1,325 characters). The file is a
reconstruction built for testing, with no real person's data in it. Print each
value for pasting:

```
node -e "console.log(require('./docs/eval/calibration-case-hiredbuddy.json').resumeText)"
node -e "console.log(require('./docs/eval/calibration-case-hiredbuddy.json').vacancyText)"
```

## Method

1. **Accounts.**
   - Pro: `pro-test2`, with an `active` ledger row.
   - Free: a new account, with no ledger row.

   Migration `007_agentic_step.sql` is applied to the project before either
   run.
2. **Same base on both.** On each account, import `resumeText` once through
   Career base → Import → paste, and accept the items as proposed. If
   `pro-test2` already holds other career items, delete them first, or record
   here that its base differs. A larger base changes what retrieval can
   find, and then the comparison is no longer about the path.
3. **Same posting on both.** New scan → paste `vacancyText` → source *career
   base* → run. One scan per account.
4. **One generation per account.** [Generate tailored resume]. Pro sends
   `mode: "agentic"`, and the rail reads *Pro · agentic retrieval*. Free sends
   nothing, and the rail reads *Free · one retrieval pass*. No regenerate.
5. **One re-score per account**, on the generated text exactly as it was
   written, before any edit.
6. **Privacy.** Record titles, counts, verdicts and costs only. Do not record
   resume text or chunk text, and do not record vacancy text beyond the
   fixture already in the repo.

## What to read off

**On the application's result screen** (after step 5, before any edit):

| # | Where | What to record |
|---|---|---|
| 1 | Rail, under the ring | The re-scored match score (%) |
| 2 | Analysis tab, coverage table | Count of rows whose status is *Covered*, out of the total rows (equivalently: total minus the *Coverage* bar's "N issues") |
| 3 | Tailored-resume tab, judge card | Grounding *pass* / *fail*, and the number of violations listed |
| 4 | Judge card | Keyword coverage, relevance and ATS format scores (1–5), and the verdict |
| 5 | Judge card | Whether the *Auto-revised once* badge is shown |
| 6 | Line under the judge card | *This version was written by …*: the model named, and whether it says FALLBACK |
| 7 | *How this draft was researched* (Pro only; expand it) | Number of rows. For each row: searches that ran, *Search budget reached*, *Time budget reached*, *malformed*, *could not run*. Also whether it says *The agent used the initial retrieval and ran no extra searches* (no tool call) or ends with *The research stopped on an error* (fall-through). The Free run shows no section at all, which is correct |

**On /quality, the recent-calls table**, for each account: take the rows from
the moment [Generate] was pressed until the generation finished. Leave out the
scan's *Parse vacancy* and *Embed* rows that came before it, and the *Re-score*
rows that came after it.

| # | What to record |
|---|---|
| 8 | The number of chat rows in the run: *Generate (agentic)*, *Generate* and *Quality check*. Ceilings: single 8, agentic 12 |
| 9 | The number of *Embed* rows in the run: single 1; agentic 1 seed + one per search, at most 7 |
| 10 | The sum of the *Cost* column over the rows in 8 and 9: this run's cost. Note any row marked *unpriced* |
| 11 | Any row with *failed*, or with a *fallback* badge on the model |

**On /quality, the tiles** (Pro account only):

| # | What to record |
|---|---|
| 12 | *Agentic generations*: runs and searches per run. Expect 1 run here |
| 13 | *Cost per run, by path*: the agentic figure. If `pro-test2` has earlier single-shot runs, its *Single* figure averages over them and is not this comparison's number. Use row 10 for both paths |

## Results

Run date: `<YYYY-MM-DD>` · Fixture: Hiredbuddy (`calibration-case-hiredbuddy.json`)

| Path | Account | 1 Score | 2 Covered | 3 Grounding (violations) | 4 Kw / Rel / ATS | 5 Revised | 6 Writer | 7 Searches (refused, failed) / ending | 8 Chat rows | 9 Embed rows | 10 Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| single | Free (new) | | | | | | | — | | | |
| agentic | Pro (`pro-test2`) | | | | | | | | | | |

### Evidence that the agentic rows were written

Migration 007 is a configured mechanism, and this section records that it
works. Either row 8 of the Pro run lists *Generate (agentic)* rows with result
*ok*, or the SQL editor returns at least one `ok = true` row for:

```sql
select step, model, fallback_used, ok, tokens_in, tokens_out, cost_usd_micro, created_at
from llm_calls where step = 'generate_agentic' order by created_at desc limit 5;
```

`<PASTE QUERY OUTPUT, OR THE /quality ROWS, HERE>`

### Observed `tool_choice: "none"` behaviour

The probe recorded `tool_choice: "auto"` only. If the closing round answered
with tool calls despite `none` (the loop treats that as an erroring round, and
row 7 then ends with *The research stopped on an error*), note it here with the
serving model.

## Reading

`<filled in after the runs: what changed in Covered and grounding, what each
run cost, and whether one fixture shows any difference at all. Say plainly
if it shows none.>`
