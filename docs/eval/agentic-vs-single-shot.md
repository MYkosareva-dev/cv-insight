# Agentic vs single-shot retrieval: an observation, not a benchmark

Status: RECORDED, one fixture, 2026-10-12. The two further fixtures and a base
large enough to exercise retrieval are backlog `ag-2`.

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

Run date: 2026-10-12 · Fixture: Hiredbuddy (`calibration-case-hiredbuddy.json`),
the same `resumeText` and `vacancyText` on both accounts · Career base: the
fixture's imported items only, on both accounts · Operator: owner

| Path | Account | 1 Score (scan → re-score) | 2 Covered (scan → re-score) | 3 Grounding (violations) | 4 Kw / Rel / ATS | 5 Revised | 6 Writer | 7 Searches / ending | 8 Chat rows | 9 Embed rows | 10 Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| agentic | Pro (`pro-test2`), generate 19:38:16 | 56% → 59% | 4/8 → 5/8 | fail (3) | 4 / 4 / 5 | yes, still *revise* | `openai/gpt-5.4`, no fallback | 0 searches; "ran no extra searches" (L9) | 4 | 1 | $0.0296 |
| single | Free (`free-test3`, new), generate 19:48:11 | 56% → 58% | 4/8 → 4/8 | fail (2) | 4 / 4 / 4 | yes, still *revise* | `openai/gpt-5.4`, no fallback | — (no section, correct for Free) | 5 | 1 | $0.0456 |

Row 11 on both accounts: failed 0, and no fallback badge (Pro 0 of 10 rows on
/quality, Free 0 of 11). No row was *unpriced*.

**Row 8, broken down.**
- Pro: *Generate (agentic)* 1, *Generate* 1 (the rule-B3 revision), *Quality
  check* 2. That is 4 rows, inside the agentic ceiling of 12.
- Free: *Generate* 2, *Quality check* 3. That is 5 rows, inside the single
  ceiling of 8.

The pipeline accounts for two judge rows. **The third (1,852 tokens in, 2,464
out) is the owner-approved repair retry on one judge step, confirmed from the
dev-server log of the Free run** (application `f7d8970e-…`):

```
[chat] judge output failed validation, one repair retry { issues: [ { path: '', code: 'invalid_json', message: 'not valid JSON' } ] }
```

The judge's first answer on that step was not parseable JSON. It was still a
successful HTTP response and was billed, so it is logged `ok = true`, and the
repair request is the extra row. This is exception (a) of the metered-call
rules, spending the step's second and last request. It agrees with the failed
count of 0: a network retry would have left an `ok = false` row.

**Row 3, the violations.**
- Pro: MS Office / Google Suite, Labelbox / Supervisely, and "reliable
  internet connection". All three are shaped like coverage gaps: vacancy
  requirements the base does not claim, reported as grounding failures. This is
  the pattern recorded in `generation-coverage-control.md` and backlog `p7-1`.
- Free: the "98 percent" metric and the "for the team" scope. Both are claims
  about the resume's own sentences.

**Row 4, ATS.** The one-point ATS difference is an account difference, not a
path difference. `free-test3` has no display name, so its resume carries the
`[YOUR NAME]` placeholder and the judge reports it under ATS format, as P3
tells it to. `pro-test2` has a display name.

### Evidence that the agentic rows were written (migration 007)

Migration 007 was applied before the runs. The Pro run's row on /quality's
recent-calls table reads:

| Time | Step | Model | Fallback | Result |
|---|---|---|---|---|
| 2026-10-12 19:38 | *Generate (agentic)* | `openai/gpt-5.4` | no | *ok* |

/quality renders `llm_calls` rows through the DAL, so this row exists in the
table. Before 007, Postgres would have refused it at the CHECK, and the
fire-and-forget logger would have dropped it with nothing on screen. The
*Agentic generations* tile counted this run (1 run · 0 searches per run), and
*Cost per run, by path* read *Agentic $0.0296*. Both are computed over the
same rows.

The row itself, read from the SQL editor by the owner:

```sql
select step, model, ok, tokens_in, tokens_out, cost_usd_micro, created_at
from llm_calls where step = 'generate_agentic' order by created_at desc limit 1;
```

| step | model | ok | fallback_used | tokens_in | tokens_out | cost_usd_micro | created_at |
|---|---|---|---|---|---|---|---|
| `generate_agentic` | `openai/gpt-5.4` | true | false | 1105 | 436 | 9303 | 2026-10-12 17:38:16.669148+00 |

The timestamp is the 19:38:16 local generate (UTC+2). The cost agrees with the
price table: 1,105 × $2.50 + 436 × $15.00 per Mtok = 9,302.5 µ$, stored as
9,303. A single row means one round, which matches the `no_tool_calls`
ending below.

### Observed `tool_choice: "none"` behaviour

Not exercised. The agent wrote on round one with `tool_choice: "auto"`, so no
closing round was sent.

## Reading

**This run exercised L9, not retrieval.** The fixture's career base holds five
items, fewer than `MAX_GENERATION_ITEMS = 8`, so the seed (the single-shot
retrieval) already carried the whole base into the first message. The Pro
run's dev-server log (application `6d314e12-…`) shows the seed retrieval
considering 9 chunks across those 5 items (best similarity 0.5071, *Data
Quality Specialist*). The agent had nothing left to search for, wrote on round
one without calling the tool, and the loop ended as `no_tool_calls`. That
ending was logged as a fallback, as specified, confirmed from the same log:

```
[chat] generate_agentic fell back to the single-shot path { fallback: 'no_tool_calls', rounds: 1, searches: 0 }
```

The empty research log and the *"ran no extra searches"* line on screen are the
same ending, as the user sees it. What this comparison measures is therefore:
- the loop's behaviour on a saturated seed, which was correct: one round, no
  search, no refusal, no error;
- the cost of each path on this case.

It does not measure whether searching adds coverage.

**The coverage difference is not attributable to the path.** The agentic run
searched nothing, so its writer saw exactly the evidence the single-shot writer
saw. Its re-score moved one requirement (ML exposure) to *Covered* (5/8 against
4/8), and that is run-to-run variation of one generation each. Both runs failed
grounding and were revised once. Pro's three violations are coverage-shaped
(`p7-1`), and Free's two are claims about its own sentences. With one run per
path, neither difference supports a conclusion.

**The cost difference is mostly the single-shot run's extra judge call, not the
path.** The gap is $0.0456 − $0.0296 = $0.0160. The third *Quality check* row (the confirmed repair retry)
priced at Haiku 4.5's $1 / $5 per Mtok is 1,852 × $1 + 2,464 × $5 per million,
about $0.0142, which is roughly nine tenths of the gap. The remaining ~$0.0018
is token-count variation between the two generations and their reviews. On a
saturated seed the agentic path costs the same as the single-shot path, plus
its tool declaration and the addendum in one prompt.

**What it would take to measure retrieval:** a career base larger than eight
items, with at least one requirement covered by an item the seed retrieval
ranks below the cut-off. Then the agent has something to find. That, and the
two further fixtures SPEC §5 item 8 names, are backlog `ag-2`.
