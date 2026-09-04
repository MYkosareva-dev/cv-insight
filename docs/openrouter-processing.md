# Model provider processing — OpenRouter

Deployment configuration record for the model-inference path. This file states what
leaves the application, where it goes, and which provider-account settings the
deployment depends on.

## Route

All model calls leave through `lib/openrouter/server.ts` (the single connection
chokepoint) to the OpenRouter API. OpenRouter routes each call to the upstream
provider that serves the requested model slug:

| Purpose | Model slug | Upstream provider | Verified to serve on this key |
|---|---|---|---|
| Vacancy parsing (P1), judge (P3) | `anthropic/claude-haiku-4.5` | Anthropic (via Amazon Bedrock) | yes — HTTP 200, 2026-09-04 |
| Generation (P2) | `openai/gpt-5.4` | OpenAI | yes — HTTP 200, 2026-09-04 |
| Fallback (all chat steps) | `google/gemini-2.5-flash` | Google | yes — HTTP 200, 2026-09-04 |
| Embeddings | `openai/text-embedding-3-small` | OpenAI | in use since Phase 2 |

Every chat slug in that table was requested ALONE on this deployment's key — no
`models` array, so each answer is that model's own rather than the fallback's —
and the column records the result. The generation row is `openai/gpt-5.4` and not
the Anthropic Sonnet this project configured from Phase 4 because that model, and
every other Anthropic model except Haiku 4.5, is refused by a guardrail on the
provider account: see setting 4 below. The full probe of 23 candidate slugs, and
the measurement of what the substitution changed, are in
`docs/eval/generation-model-comparison.md`.

Two vendors, deliberately. The generator is OpenAI's, the parser and judge are
Anthropic's, and the fallback behind all of them is Google's — so no single
provider outage takes the app down, and the judge is a different vendor from the
generator as well as a different model, which is what CLAUDE.md's
self-preference rule is for.

## What is sent

Sent: vacancy text as pasted by the user; career-item content or the resume text the
user supplied for the scan; generated resume text on the judge and re-score paths; the
display name saved in Settings, because a resume carries a name line; the target role
label; the prompt template.

Not sent: the account email address, the account identifier, the session token, or any
Supabase row id. Prompts carry content only — the request body contains no field that
identifies the account behind it.

Also not sent, by decision rather than by omission: **the contact details saved in
Settings** — contact email address, phone number, location, LinkedIn URL, GitHub URL
and the open-to-remote flag. They are stored, rendered into the resume the user sees,
and written into the exported `.docx`; they reach no model call. The header block is
composed after a resume has been written and judged, and it is removed again from any
stored version before that text is sent for a quality check or a re-score. Neither
writing a resume nor scoring one uses a phone number, so transmitting the block would
widen the personal data leaving this deployment for no gain. Enforced in code rather
than by convention: `resumeTextForModel` in `src/lib/resumeHeader.ts` is the only
producer of the branded type every model-bound resume-text parameter is declared as, so
a call site that skips the strip does not compile.

## What is stored on our side

`llm_calls` records metadata only: step name, requested and returned model slug,
token counts, `cost_usd_micro`, `ok`, `fallback_used`, timestamp. Prompt bodies and
model outputs are not written to that table. Generated resume text is stored in
`resume_versions` because the user asked for it and owns it under RLS.

## Provider-account settings this deployment depends on

The API key used by this deployment must belong to an account configured as follows.
These are settings of the provider account, not of this codebase, and must be
re-checked whenever the key is rotated:

1. Prompt logging / training on prompts: disabled.
2. Prompt and completion retention: zero-retention routing where the provider offers
   it; otherwise transient-processing endpoints only.
3. No provider allowed that publishes prompts to a public dataset.
4. **Model guardrails: none blocking a slug in the table above.** A guardrail on the
   workspace removes a model's endpoints during routing, and because every chat call
   is sent as `models: [primary, fallback]`, a blocked primary is answered by using
   the second entry. The request succeeds, `fallback_used` is recorded, and nothing
   else reports it — so a guardrail is indistinguishable from a working deployment
   unless someone reads the per-step counts.

   **Observed on 2026-09-04. NOT FIXABLE BY THIS PROJECT — the key belongs to
   another party and the owner has no access to that workspace, so the guardrail
   stands and the CODE moved instead** (see the model table above, and SPEC
   v2.23). This entry is kept as the record of WHY the intended model is
   unreachable; it is not an open task.

   `anthropic/claude-sonnet-4.6` is blocked by a guardrail on the `default` workspace.
   Requested alone with this deployment's key it answers HTTP 404,
   `"0 endpoints out of 5 requested are available matching your guardrail restrictions
   and data policy … Model blocked by guardrail: 5 endpoints excluded"`, with
   `failed_routing_step: "Filter by Guardrails"`. The slug is not wrong — OpenRouter
   lists it with nine live provider endpoints — and the key is funded and unrestricted
   (`anthropic/claude-haiku-4.5` answers 200 on the same key, served by Amazon
   Bedrock). **Consequence while it stands: every tailored resume is written by
   `google/gemini-2.5-flash`, not by the model this deployment configures.** The
   product says which model wrote each resume and `/quality` announces a step whose
   every call fell back, so the condition can no longer hide. The guardrail itself
   is configured at https://openrouter.ai/workspaces/default/guardrails and can
   only be changed by whoever owns the workspace.

   **The consequence has been retired, not accepted.** Since v2.23 the generator
   is `openai/gpt-5.4`, which passes the guardrail, so resumes are no longer
   written by the fallback — the fallback is a fallback again. The eighteen
   refused slugs and the five that serve are tabulated in
   `docs/eval/generation-model-comparison.md`; if the workspace ever admits an
   Anthropic Sonnet, that table is where to check before changing anything back.

## Verification

Status: NOT VERIFIED

Record the check below before any externally reachable deployment. Replace the marker
with the date, the account label, and the observed value of each of the four settings
above. Item 4 is known to FAIL as of 2026-09-04 and is recorded there rather than
here, because a verification section that says "not verified" is silent about a setting
already known to be wrong. Items 1-3 are unaffected by the v2.23 model change and
still need checking against the account: a data-policy or logging setting is a
property of the workspace, not of which slug this app requests.

<PASTE VERIFICATION HERE>

Until this section is filled in, the deployment is development-only and no URL is
shared outside the owner.