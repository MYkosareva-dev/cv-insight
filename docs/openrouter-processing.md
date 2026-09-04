# Model provider processing — OpenRouter

Deployment configuration record for the model-inference path. This file states what
leaves the application, where it goes, and which provider-account settings the
deployment depends on.

## Route

All model calls leave through `lib/openrouter/server.ts` (the single connection
chokepoint) to the OpenRouter API. OpenRouter routes each call to the upstream
provider that serves the requested model slug:

| Purpose | Model slug | Upstream provider |
|---|---|---|
| Vacancy parsing (P1), judge (P3) | `anthropic/claude-haiku-4.5` | Anthropic |
| Generation (P2) | `anthropic/claude-sonnet-4.6` | Anthropic |
| Fallback (all chat steps) | `google/gemini-2.5-flash` | Google |
| Embeddings | `openai/text-embedding-3-small` | OpenAI |

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

## Verification

Status: NOT VERIFIED

Record the check below before any externally reachable deployment. Replace the marker
with the date, the account label, and the observed value of each of the three settings
above.

<PASTE VERIFICATION HERE>

Until this section is filled in, the deployment is development-only and no URL is
shared outside the owner.