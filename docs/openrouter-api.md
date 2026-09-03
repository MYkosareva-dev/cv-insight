Source: https://openrouter.ai/docs/guides/routing/model-fallbacks (see also https://openrouter.ai/docs/api-reference/embeddings/create-embeddings)
Retrieved: 2026-08-30 · Notes for CV Insight (chat pipeline + embeddings, server-side only)

# OpenRouter API — working notes

## Auth (both endpoints)
`Authorization: Bearer ${process.env.OPENROUTER_API_KEY}` — server-side only, never in
browser code, never NEXT_PUBLIC_.

## Chat completions — POST https://openrouter.ai/api/v1/chat/completions
Standard OpenAI-compatible body: `messages`, `max_tokens`, `temperature`,
`response_format: { "type": "json_object" }` for JSON-mode steps (parse, judge).

### Model fallbacks — the `models` array
Instead of a single `model`, pass an array in priority order:
```json
{
  "models": ["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash"],
  "messages": [ ... ]
}
```
- Fallback triggers on ANY error from the earlier entry: rate-limiting, downtime,
  context-length validation, moderation filtering.
- **Billing follows the model that actually answered, and that model is returned in the
  response body's `model` attribute** — this is what CV Insight logs into
  `llm_calls.model`, with `fallback_used = (returned model !== primary)`.
- If the last fallback also errors, that error is returned to the client (our 502
  AI_UNAVAILABLE path).
- This is the chat-completions endpoint's mechanism; the Anthropic-style
  `/api/v1/messages` endpoint uses a different `fallbacks` parameter — we use
  chat/completions only, so `models` is the one that applies.

### Usage / cost
The response `usage` object carries token counts (and a `cost` field). CV Insight
computes `cost_usd_micro` (INTEGER micro-USD) from usage × a pinned price table in
`lib/pricing.ts` (Sonnet 4.6: $3/$15 per 1M in/out; Haiku 4.5: $1/$5; Gemini 2.5
Flash: $0.30/$2.50; embeddings: $0.02) keyed by the RETURNED model, so fallback runs
are priced correctly — and NORMALIZED before lookup, because the returned id is not
always the slug that was sent (see the embeddings annotation below). `Math.ceil`, so
a sub-micro call never rounds to a zero that reads as free; an id with no price entry
is written `cost_known=false` rather than as a free call.

## Embeddings — POST https://openrouter.ai/api/v1/embeddings
```json
{
  "model": "openai/text-embedding-3-small",
  "input": ["chunk one text", "chunk two text"]
}
```
- `input` accepts a single string or an array of strings → batch several chunks per
  request (CV Insight batches ≤64).
- Response:
```json
{
  "object": "list",
  "data": [ { "object": "embedding", "embedding": [0.0023, -0.0093, ...], "index": 0 } ],
  "model": "text-embedding-3-small",
  "usage": { "prompt_tokens": 8, "total_tokens": 8, "cost": 0.0001 }
}
```
> **ANNOTATION — the returned `model` is BARE, not the slug you sent.** This entry
> previously showed `"model": "openai/text-embedding-3-small"`, echoing the request.
> The Phase-2 e2e run against the live API proved otherwise: the request carries
> `openai/text-embedding-3-small` and the response comes back
> `text-embedding-3-small`, with the provider namespace stripped. That single
> character difference made an exact-match price lookup miss on EVERY embedding
> call, so each row was written `cost_known=false, cost_usd_micro=0` — a priced
> call recorded as one whose price we did not know. `lib/pricing.ts` therefore
> normalizes the id (provider prefix and any `:suffix` removed, lower-cased) before
> looking up a price, and `lib/openrouter/server.ts` uses the same normalization to
> decide `fallback_used`. Keep this line as measured, not as documented elsewhere.
  `data[i].index` maps each embedding back to `input[i]`. Vector length must be 1536 —
  assert it before insert (a silent dimension mismatch corrupts retrieval).
- `dimensions` and `encoding_format` are optional; we use defaults (1536, float).
- Embedding calls are logged to `llm_calls` with step `embed`/`rescore`; they are cheap
  ($0.02 per 1M tokens) and excluded from the daily chat-call cap.

## CV Insight invariants (recap)
- Connection module: `lib/openrouter/server.ts`; gates with `getUser()`:
  `lib/chat.ts` (completions), `lib/retrieval.ts` (embeddings).
- Timeout 60 s per request; retries limited to the two owner-approved single-shot
  exceptions (one Zod-repair, one network retry) — no ladders. They CAP rather than
  compose: `MAX_CHAT_REQUESTS_PER_STEP = 2` in `lib/chat.ts` is one shared budget, so
  a step issues at most two metered requests total, not 2 × 2 (SPEC v2.10). The
  network retry covers a request that ERRORED — a fetch rejection or the 60 s abort —
  and never a response that arrived with a non-2xx status, which is the service
  answering. The embeddings endpoint gets no retry at all and no `models` fallback
  array: the only fallback available is a chat model, and any other embedding model is
  a different vector space.
- Never change the embedding model without dropping and re-embedding all documents.
