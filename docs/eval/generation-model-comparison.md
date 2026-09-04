# Generation model: what the key can reach, and what changing it did

Date: 2026-09-04 · Branch: `phase-5-quality` · SPEC v2.23

This file exists because the app's configured generator had never served a single
call, and replacing it is a change to the thing every Phase-4 conclusion rests
on. Two questions, answered with runs rather than with preference: **which models
can this key actually reach**, and **what did changing the primary do to the
rubric**.

---

## Part 1 — the probe: which models this key can reach

Method, identical to the diagnosis that found the guardrail: each model requested
**alone**, with no `models` array, so the answer is that model's own rather than
the fallback's. The probe lives outside the repository — it names the OpenRouter
host and reads a secret, both of which `scripts/check.mjs` R5/R7 forbid in app
code, correctly, because it is not app code. It never printed the key.

23 slugs were requested. **Five serve. Every refusal is the same refusal.**

| Model | Status | Served by | Reason if refused |
|---|---|---|---|
| `openai/gpt-5.4` | **200** | OpenAI | — |
| `openai/gpt-5.2` | **200** | OpenAI | — |
| `openai/gpt-5-mini` | **200** | OpenAI | — |
| `anthropic/claude-haiku-4.5` | **200** | Amazon Bedrock | — |
| `google/gemini-2.5-flash` | **200** | Google | — |
| `anthropic/claude-sonnet-4.6` | 404 | — | `model-ignored-by-guardrail` — 0 of 5 endpoints available |
| `anthropic/claude-sonnet-4.5` | 404 | — | `model-ignored-by-guardrail` — 0 of 5 |
| `anthropic/claude-sonnet-4` | 404 | — | `model-ignored-by-guardrail` — 0 of 3 |
| `anthropic/claude-sonnet-5` | 404 | — | `model-ignored-by-guardrail` — 0 of 6 |
| `anthropic/claude-opus-4.5` | 404 | — | `model-ignored-by-guardrail` — 0 of 5 |
| `anthropic/claude-opus-5` | 404 | — | `model-ignored-by-guardrail` — 0 of 6 |
| `anthropic/claude-fable-5.1` | 404 | — | `model-ignored-by-guardrail` — 0 of 4 |
| `google/gemini-2.5-pro` | 404 | — | `model-ignored-by-guardrail` — 0 of 4 |
| `openai/gpt-5.6-sol` | 404 | — | `model-ignored-by-guardrail` — 0 of 3 |
| `openai/gpt-5.5` | 404 | — | `model-ignored-by-guardrail` — 0 of 3 |
| `openai/gpt-5.2-pro` | 404 | — | `model-ignored-by-guardrail` — 0 of 1 |
| `openai/gpt-5` | 404 | — | `model-ignored-by-guardrail` — 0 of 2 |
| `openai/gpt-4.1` | 404 | — | `model-ignored-by-guardrail` — 0 of 2 |
| `x-ai/grok-4.6` | 404 | — | `model-ignored-by-guardrail` — 0 of 2 |
| `deepseek/deepseek-chat-v3.1` | 404 | — | `model-ignored-by-guardrail` — 0 of 8 |
| `mistralai/mistral-large-2512` | 404 | — | `model-ignored-by-guardrail` — 0 of 2 |
| `qwen/qwen3-max` | 404 | — | `model-ignored-by-guardrail` — 0 of 1 |

The refusal, verbatim, and it is the same string for all eighteen:

```
HTTP 404
"0 endpoints out of N requested are available matching your guardrail
 restrictions and data policy. We removed them for the following reasons (an
 endpoint may have matched multiple reasons): Model blocked by guardrail: N
 endpoints excluded; configurable at
 https://openrouter.ai/workspaces/default/guardrails"
metadata.ineligibility_reasons[0].reason = "model-ignored-by-guardrail"
metadata.failed_routing_step             = "Filter by Guardrails"
```

**What the shape of that list tells us.** The guardrail is an ALLOW-LIST of five
specific models, not a tier or a price ceiling and not a vendor rule: it admits
`openai/gpt-5.4` at \$2.50/\$15.00 per Mtok while refusing `openai/gpt-5` and
`openai/gpt-4.1`, and it admits one Anthropic model while refusing seven. So no
amount of picking a cheaper or a closer relative would have found a way through —
the five are the whole of what is reachable, and the choice had to be made inside
them.

### The second probe: does the winner serve THIS APP'S request?

Passing a one-token ping is not the same as serving the generate step, and
`openai/gpt-5.4` had two properties that could have broken it: `temperature` is
**not** in its `supported_parameters`, and `reasoning` **is**. The app sends
`temperature: 0.4` with `max_tokens: 2500` and expects plain text back, so a
reasoning model could have spent the whole output budget thinking and returned
nothing — a paid run producing an empty resume, which is worse than the fallback.

So the app's own body was sent, with a P2-shaped prompt:

| Model | HTTP | finish_reason | completion tokens | reasoning tokens | content |
|---|---|---|---|---|---|
| `openai/gpt-5.4` | 200 | `stop` | 149 | **0** | 686 chars, real resume text |
| `openai/gpt-5.2` | 200 | `stop` | 158 | 0 | 697 chars |
| `google/gemini-2.5-flash` | 200 | `stop` | 108 | 0 | 500 chars |

The unsupported `temperature` is dropped by OpenRouter rather than refused, and
no reasoning tokens are billed at the default effort. **Verified, not assumed.**

### The decision

**Primary for P2: `openai/gpt-5.4`.** The strongest of the five that serve — the
highest tier that passes the guardrail, in the same \$/Mtok band the blocked
Sonnet 4.6 occupied (\$2.50/\$15.00 against \$3.00/\$15.00) — and the only reason
it is not Sonnet is the table above.

**Fallback: `google/gemini-2.5-flash`**, unchanged, and now a genuine one: a
different vendor from the OpenAI primary on this step and from the Anthropic
primary on the other three, verified to serve on this key by the same probe.

**The judge stays `anthropic/claude-haiku-4.5`**, by owner decision. It serves,
its verdicts are the only rubric baseline this project has, and it is still a
different model from the generator — now a different vendor too, which is
strictly better for CLAUDE.md's self-preference rule than the Anthropic-reviews-
Anthropic arrangement it replaces.

---

## Part 2 — what changing it did to the rubric

**SAMPLE SIZE, STATED FIRST: three runs on one fixture — one on the fallback, two
on the new primary — six judged versions in total. That is an OBSERVATION, not a
benchmark, and nothing below should be read as a rate.** The fixture is
`docs/eval/calibration-case-hiredbuddy.json`, the owner's own reconstruction: a
senior AI-quality career base scanned against an entry-level annotation role, so
the base deliberately does **not** cover every requirement. It is the hardest
honest case for a grounded generator and the reason it was chosen; it is also why
a low keyword score here is not evidence of a bad writer.

Same fixture, same vacancy, same career base, same judge (`claude-haiku-4.5`),
same prompts. A fresh account per run, so the application row differs — the case
does not.

| Run | Generator | Draft | Grounding | Violations | Verdict | Keyword | Relevance | ATS | ATS issues |
|---|---|---|---|---|---|---|---|---|---|
| A | `google/gemini-2.5-flash` (fallback) | `ai` | **fail** | 3 | revise | 3/5 | 4/5 | 4/5 | 2 |
| A | `google/gemini-2.5-flash` | `ai_revision` | **fail** | **5** | revise | 3/5 | 4/5 | 4/5 | 1 |
| B | `openai/gpt-5.4` | `ai` | **fail** | 2 | revise | 3/5 | 4/5 | 4/5 | 6 |
| B | `openai/gpt-5.4` | `ai_revision` | **pass** | **0** | **approve** | 3/5 | 4/5 | **5/5** | 0 |
| C | `openai/gpt-5.4` | `ai` | **fail** | 3 | revise | 3/5 | 3/5 | 4/5 | 1 |
| C | `openai/gpt-5.4` | `ai_revision` | **fail** | 3 | revise | 3/5 | 4/5 | 4/5 | 5 |

### What this says, and what it does not

**1. Grounding fails on the FIRST draft in 3 of 3 runs, on both models. The
finding is largely about P2, not about the fallback.** This is the answer the
owner asked for and it is the less comfortable one: the 5-of-5 grounding failures
were NOT an artefact of the wrong model writing the resumes. A stronger generator
with the same prompt and the same corpus still reaches for claims the career
items do not support, on the first attempt, every time. Whatever else changing
the model bought, it did not buy grounding.

**2. The REVISION step behaves differently, and that is the real change.** Rule
B3's single rewrite is handed the reviewer's specific findings. Under the
fallback it made grounding **worse** — 3 violations became 5, and the rewrite was
refused. Under `gpt-5.4` it converged completely once (2 → 0, the first
`approve` this project has ever produced) and not at all the other time (3 → 3).
One-of-two is not a rate; what it does establish is that the rewrite is *capable*
of converging, which the single fallback observation did not show at all.

**3. Keyword coverage is 3/5 with `missingHonest = 5` in ALL SIX versions,
across both models.** A number that does not move when the writer changes is
telling us about the CORPUS, not the writer: the vacancy asks for five keywords
this career base does not honestly support, and both models correctly declined to
claim them. That is rule B4 working, and it is the strongest evidence in this
table that the fixture is doing its job.

**4. ATS format is noisy in both directions and should not be read.** 4/5 → 5/5
with 6 issues → 0 in run B, and 4/5 → 4/5 with 1 → 5 in run C. Two observations
of a 1-to-5 integer moving in opposite directions is noise.

### What would make this a benchmark rather than an observation

- More runs per model. Three is not enough to state a first-draft grounding rate,
  let alone a revision convergence rate.
- A second fixture, one whose career base DOES cover the vacancy. Every number
  here is entangled with a deliberately under-covered base, so nothing separates
  "the model over-claims" from "the corpus is thin" — backlog `p3-14` makes the
  same point about the similarity thresholds.
- The comparison run against the SAME application row rather than the same case,
  which needs the model to be switchable per run instead of per deployment.
- Rubric outcomes grouped BY MODEL on `/quality`, which needs the serving model
  stored on the version rather than only in `llm_calls` — backlog `p5-14`.

Until then this file is what it says on its first line: two questions answered
with six versions, and the honest half of the answer is finding 1.
