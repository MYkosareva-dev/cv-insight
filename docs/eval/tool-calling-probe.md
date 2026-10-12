# Tool calling: which models on this key honour `tools`

Date: 2026-10-12 · Branch: `feature/agentic-retrieval` · SPEC v3.0 (Block D §5 item 7, DoD item 10)

The agentic generate step declares one tool, `search_career_base(query)`, and is
only safe on a model that answers a declared tool with a `tool_calls` finish. A
model that ignores `tools` answers round one with prose, which the loop treats as
the end of the loop and a fallback to the single-shot result — never as a resume
written by a model that never searched. This file is the record of which models
on the key's allow-list do honour it, and therefore which one
`MODEL_BY_STEP.generate_agentic` may name.

## Method

Instrument: `scripts/tool-calling-probe.mjs`, run as
`node --env-file=.env.local scripts/tool-calling-probe.mjs`. Same shape as the
v2.23 probe in `generation-model-comparison.md`:

- each slug requested **alone** — no `models` array — so each answer is that
  model's own and not the fallback's;
- the request carries the loop's literal tool declaration (SPEC Block F,
  "v3.0 — tool calling"): one function, one `query: string` parameter,
  `additionalProperties: false`;
- `tool_choice: "auto"`, `max_tokens: 600`, no `temperature`;
- a synthetic system and user message (two requirements, one placeholder item
  that covers neither, an instruction to search before writing). No personal
  data: the probe sends nobody's resume to five providers.

The slugs are the five that serve on this key (v2.23). The key was read from the
environment and never printed.

## Result

**All five honour `tools`.** Every request answered HTTP 200 with
`finish_reason: "tool_calls"` and at least one well-formed `search_career_base`
call whose `arguments` parse as `{ "query": string }`.

| Model | Status | Served by | finish_reason | native finish | tool_calls | Prose alongside |
|---|---|---|---|---|---|---|
| `openai/gpt-5.4` | 200 | OpenAI | `tool_calls` | `completed` | 2 | no |
| `openai/gpt-5.2` | 200 | OpenAI | `tool_calls` | `completed` | 2 | no |
| `openai/gpt-5-mini` | 200 | OpenAI | `tool_calls` | `completed` | 1 | no |
| `anthropic/claude-haiku-4.5` | 200 | Amazon Bedrock | `tool_calls` | `tool_use` | 2 | yes |
| `google/gemini-2.5-flash` | 200 | Google | `tool_calls` | `STOP` | 2 | no |

The queries each model wrote (synthetic input, so safe to record):

| Model | Queries |
|---|---|
| `openai/gpt-5.4` | `Kubernetes operations in production, cluster administration, deployments, Helm, monitoring, incident response` · `mentoring junior engineers, coaching, onboarding, code reviews, technical guidance` |
| `openai/gpt-5.2` | `Kubernetes production operations SRE on-call clusters Helm deployments monitoring incident response` · `mentored junior engineers coaching onboarding code reviews pairing tech lead` |
| `openai/gpt-5-mini` | `Kubernetes operations production OR Kubernetes OR K8s OR mentoring junior engineers OR mentorship OR mentored OR mentor` |
| `anthropic/claude-haiku-4.5` | `Kubernetes operations production` · `mentoring junior engineers` |
| `google/gemini-2.5-flash` | `Kubernetes operations in production` · `Mentoring junior engineers` |

## Decision

`MODEL_BY_STEP.generate_agentic = 'openai/gpt-5.4'` — it honours `tools`, it is
the strongest model the key reaches, and it is the same writer as the single-shot
`generate` step, so `docs/eval/agentic-vs-single-shot.md` compares retrieval and
not models.

## What the probe changes in the loop

1. **Parallel tool calls are the norm, not the exception.** Four of five models
   issued two calls in ONE round. `MAX_SEARCH_CALLS = 6` therefore counts tool
   EXECUTIONS, not rounds, and every call in a round receives its own `tool`
   message — including the ones past the budget, which get
   `{ "refused": "search budget exhausted" }`.
2. **The fallback honours `tools` too.** `google/gemini-2.5-flash` answered with a
   `tool_calls` finish, so keeping the `models: [primary, fallback]` array on the
   agentic step does not route a round to a model that cannot search.
3. **A tool-call round may carry prose.** Haiku returned text alongside its calls.
   The loop reads `tool_calls` first and ignores interleaved prose; only a round
   with NO tool calls is a writing round.
4. **`finish_reason` is normalised; `native_finish_reason` is not.** Gemini's
   native finish is `STOP` even on a tool call. The loop keys on the presence of
   `message.tool_calls`, never on a finish string.

This records the models on 2026-10-12. If the allow-list changes, re-run the
script before changing `MODEL_BY_STEP.generate_agentic`.
