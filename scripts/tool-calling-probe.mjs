#!/usr/bin/env node
/**
 * Tool-calling probe — DEVELOPMENT ONLY. The instrument behind
 * `docs/eval/tool-calling-probe.md` (SPEC v3.0, Block D §5 item 7; DoD item 10).
 *
 * Asks ONE question per slug on the key's allow-list: given `tools` declared and
 * `tool_choice: "auto"`, does this model answer with a `tool_calls` finish? The
 * agentic generate step is only safe on a model that does — one that ignores
 * `tools` answers round one with prose, and the loop has to treat that as a
 * fallback to the single-shot result.
 *
 * SAME SHAPE AS THE v2.23 PROBE. Each slug is requested ALONE — no `models`
 * array — so every answer is that model's own and not the fallback's. The
 * request carries the exact tool declaration the loop sends (SPEC Block F,
 * "v3.0 — tool calling"), and a synthetic user message with no personal data in
 * it: a probe has no business sending anyone's resume to five providers.
 *
 * WHY IT LIVES IN scripts/. It names the OpenRouter host and reads a secret,
 * which check.mjs R5/R7 forbid in APP code, correctly — and this is not app
 * code. `scripts/` is outside check.mjs's code scope for exactly that reason.
 *
 *   node --env-file=.env.local scripts/tool-calling-probe.mjs
 *
 * SPENDS REAL MONEY: one small chat request per slug, five in all.
 * Prints status, the serving model, finish_reason, tool-call names and the
 * query each model wrote. The key is read from the environment and never printed.
 */

const SLUGS = [
  'openai/gpt-5.4',
  'openai/gpt-5.2',
  'openai/gpt-5-mini',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
];

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_career_base',
      description:
        "Search the candidate's own career base for evidence relevant to a requirement. Returns matching career items.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

const MESSAGES = [
  {
    role: 'system',
    content:
      'You write tailored resumes from a candidate career base. Before writing, use the ' +
      'search_career_base tool to look for evidence for any requirement the supplied items ' +
      'do not cover.',
  },
  {
    role: 'user',
    content:
      '<requirements>\n- Kubernetes operations in production\n- Mentoring junior engineers\n</requirements>\n' +
      '<items>\n[1] Backend Engineer, Example GmbH — built REST services in Go.\n</items>\n' +
      'The items above do not mention Kubernetes or mentoring. Search the career base before you write.',
  },
];

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  // Names the variable, never a value.
  console.error('OPENROUTER_API_KEY is not set — run with --env-file=.env.local');
  process.exit(1);
}

const rows = [];
for (const slug of SLUGS) {
  const startedAt = Date.now();
  let row = { slug };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: slug,
        messages: MESSAGES,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    row.status = res.status;
    const json = await res.json().catch(() => null);
    const choice = json?.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];
    row = {
      ...row,
      served: json?.model ?? '—',
      provider: json?.provider ?? '—',
      finish: choice?.finish_reason ?? '—',
      nativeFinish: choice?.native_finish_reason ?? '—',
      toolCalls: calls.length,
      calls: calls.map((c) => ({ name: c.function?.name, args: c.function?.arguments })),
      hasText: typeof choice?.message?.content === 'string' && choice.message.content.trim() !== '',
      tokensIn: json?.usage?.prompt_tokens ?? 0,
      tokensOut: json?.usage?.completion_tokens ?? 0,
      error: res.ok ? null : (json?.error?.message ?? 'non-2xx'),
    };
  } catch (err) {
    row.status = 'transport error';
    row.error = err instanceof Error ? err.name : 'unknown';
  }
  row.latencyMs = Date.now() - startedAt;
  rows.push(row);
  console.log(JSON.stringify(row));
}

console.log('\nslug | status | served by | finish_reason | tool_calls');
for (const r of rows) {
  console.log(
    `${r.slug} | ${r.status} | ${r.provider ?? '—'} | ${r.finish ?? '—'} | ${r.toolCalls ?? 0}`,
  );
}
