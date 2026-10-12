# Agentic vs single-shot retrieval: an observation, not a benchmark

Status: SKELETON. The method is fixed below. The results tables are empty until
the runs are made on the Pro account, and nothing in this file is a finding
until they are filled in.

Branch: `feature/agentic-retrieval` · SPEC v3.0 (Block D §5 item 8, DoD item 14)

## What this measures, and what it does not

The question: on the same career base and the same posting, does letting the
writer search the base step by step (the Pro path) change what the resume
covers, whether it stays grounded, and what it costs?

The writer model is the same on both paths (`openai/gpt-5.4`, see
`tool-calling-probe.md`), and so are the judge, the seed retrieval and the
prompt. The only difference is the `search_career_base` tool and the
evidence it adds. Three fixtures and one run per path per fixture is an
observation of one day. It is not a benchmark, and the conclusions below
claim no more than that.

## Method

1. **Account.** One Pro account (an `active` ledger row), with migration
   `007_agentic_step.sql` applied. Before the first run, confirm that 007 holds:
   ```sql
   select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'llm_calls'::regclass and contype = 'c';
   ```
2. **Base.** The same career base for every run, imported once and not edited
   during the session.
3. **Fixtures.** The two existing calibration postings,
   `calibration-case-hiredbuddy.json` and `calibration-case-vinterlys.json`,
   plus one new posting chosen because the seed retrieval is likely to miss
   something the base holds: at least one requirement worded differently from
   the item that covers it. The new posting is added to `docs/eval/` as
   `calibration-case-<name>.json` in the same commit as its results.
4. **Runs.** On the same day, for each fixture: scan once, then generate on
   the single-shot path (a direct `POST …/generate` with `{}`) and on the
   agentic path (`{ "mode": "agentic" }`). One run each. A regenerate is a new
   run and is not used here.
5. **Read off, per run, from the app's own records:**
   - **Covered** — requirements whose coverage status is `covered` after
     [Re-score] on the generated text, unedited;
   - **Grounding** — the judge's `grounding.verdict` and violation count on
     the version the editor opens with, and whether rule B3's revision ran;
   - **Searches** — for the agentic run, executed searches and refusals from
     the version's `retrieval_log` (the research section on screen), and
     whether the run fell back (`no_tool_calls` or a `round_error` entry);
   - **Cost** — the sum of `cost_usd_micro` over the run's `llm_calls` rows
     (`generate` / `generate_agentic` / `judge` / `embed`), read on /quality
     or by SQL over that application's rows in the run's time window;
   - **Requests** — chat rows and embeddings rows for the run, checked
     against the declared ceilings (single 8, agentic 12; embeddings 1 seed
     plus up to 6 searches).
6. **Privacy.** Record titles, counts, verdicts and costs only. No resume text,
   no vacancy text beyond the fixture file that is already in the repo, and no
   chunk text.

## Results

Run date: `<YYYY-MM-DD>` · Account: Pro, test-mode subscription · Operator: owner

| Fixture | Path | Covered | Grounding (violations) | Revised | Searches (refused) | Fallback | Chat rows | Embed rows | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Hiredbuddy | single | | | | — | — | | | |
| Hiredbuddy | agentic | | | | | | | | |
| Vinterlys | single | | | | — | — | | | |
| Vinterlys | agentic | | | | | | | | |
| `<new>` | single | | | | — | — | | | |
| `<new>` | agentic | | | | | | | | |

### Evidence that the agentic rows were written

Migration 007 is a configured mechanism. This section records that it works:
one real `generate_agentic` row with `ok = true`, as returned by

```sql
select step, model, fallback_used, ok, tokens_in, tokens_out, cost_usd_micro, created_at
from llm_calls where step = 'generate_agentic' order by created_at desc limit 5;
```

`<PASTE QUERY OUTPUT HERE>`

### Observed `tool_choice: "none"` behaviour

The probe recorded `tool_choice: "auto"` only. If any closing round answered
with tool calls despite `none`, which the loop treats as an erroring round,
note it here with the run and the serving model.

## Reading

`<filled in after the runs: what changed in Covered and grounding, what it
cost per run on each path, and whether the difference is worth the Pro
price. Say plainly if three fixtures show no difference.>`
