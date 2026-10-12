import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REFUSED_BUDGET,
  REFUSED_DEADLINE,
  REFUSED_INVALID,
  RoundFailedError,
  SEARCH_TOOL_NAME,
  SEARCH_UNAVAILABLE,
  executedSearches,
  runAgentLoop,
} from '@/lib/agentic';
import {
  AGENTIC_LOOP_DEADLINE_MS,
  MAX_SEARCH_CALLS,
  MAX_TOOL_ROUNDS,
} from '@/lib/budget';
import { MAX_ITEMS_CHARS } from '@/lib/generation';

/**
 * Rule B12 (SPEC v3.0): the agentic loop is bounded by ARITHMETIC, and these
 * cases drive it with a stub model and a stub search — no network, no database,
 * no gate. What they pin: the round cap, the search cap, the refusal message,
 * one tool message per call, the closing `tool_choice`, the three endings
 * (written / no tool calls / round error), the deadline, the items bound, and
 * that nothing the loop records carries chunk or item text.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const item = (id, title, content = `content of ${title}`) => ({
  id,
  type: 'role',
  title,
  period: '2020 – 2022',
  content,
});

const SEED = [item('s1', 'Seed role one'), item('s2', 'Seed role two')];

let callCounter = 0;
const call = (query, name = SEARCH_TOOL_NAME) => ({
  id: `call_${++callCounter}`,
  type: 'function',
  function: { name, arguments: JSON.stringify({ query }) },
});
const rawCall = (args) => ({
  id: `call_${++callCounter}`,
  type: 'function',
  function: { name: SEARCH_TOOL_NAME, arguments: args },
});

/**
 * A scripted model: each entry is one round's answer (or an Error to throw).
 * Records the tool_choice and a SNAPSHOT of the transcript per request — the
 * loop mutates the array it passes, so a reference would show only the end.
 */
function stubModel(script) {
  const requests = [];
  const requestRound = async (messages, toolChoice) => {
    requests.push({ toolChoice, messages: structuredClone(messages) });
    const next = script[requests.length - 1];
    if (next === undefined) throw new Error('stub model asked for more rounds than scripted');
    if (next instanceof Error) throw next;
    return { model: 'openai/gpt-5.4', content: next.content ?? null, toolCalls: next.toolCalls ?? [] };
  };
  return { requests, requestRound };
}

/** A stub search that returns one new item per query, named after it. */
function stubSearch(results = {}) {
  const queries = [];
  const search = async (query) => {
    queries.push(query);
    if (results[query]) return results[query];
    return {
      status: 'found',
      chunks: 3,
      bestSimilarity: 0.61,
      items: [item(`found-${query}`, `Item for ${query}`)],
    };
  };
  return { queries, search };
}

const write = (text = 'NAME\nRESUME TEXT') => ({ content: text });
const tools = (...calls) => ({ toolCalls: calls });

/** Every assistant turn with tool calls is followed by exactly one tool message per call, by id. */
function assertEveryCallAnswered(messages) {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.tool_calls) continue;
    const answers = messages.slice(i + 1, i + 1 + message.tool_calls.length);
    assert.deepEqual(
      answers.map((m) => [m.role, m.tool_call_id]),
      message.tool_calls.map((c) => ['tool', c.id]),
    );
  }
}

describe('runAgentLoop — rule B12 against a stub model', () => {
  test('the round cap: at most MAX_TOOL_ROUNDS requests, the last one closing with tool_choice none', async () => {
    const model = stubModel([
      tools(call('a')),
      tools(call('b')),
      tools(call('c')),
      write('final resume'),
    ]);
    const { search } = stubSearch();
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search });

    assert.equal(MAX_TOOL_ROUNDS, 4);
    assert.equal(model.requests.length, MAX_TOOL_ROUNDS);
    assert.deepEqual(
      model.requests.map((r) => r.toolChoice),
      ['auto', 'auto', 'auto', 'none'],
    );
    assert.equal(outcome.kind, 'written');
    assert.equal(outcome.content, 'final resume');
    assert.equal(outcome.rounds, 4);
    assertEveryCallAnswered(model.requests.at(-1).messages);
  });

  test('a model that never stops calling tools cannot buy a fifth round — the closing round errors and falls through', async () => {
    const model = stubModel([
      tools(call('a')),
      tools(call('b')),
      tools(call('c')),
      tools(call('d')), // disobeys tool_choice none
      tools(call('e')),
    ]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    assert.equal(model.requests.length, MAX_TOOL_ROUNDS);
    assert.equal(outcome.kind, 'round_error');
    assert.equal(outcome.reason, 'tool_calls_on_closing_round');
  });

  test('the search cap: a 7th call is refused with the exact message, still answered, and logged as budget', async () => {
    const model = stubModel([
      tools(call('q1'), call('q2'), call('q3'), call('q4')),
      tools(call('q5'), call('q6'), call('q7'), call('q8')),
      write(),
    ]);
    const stub = stubSearch();
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });

    assert.equal(MAX_SEARCH_CALLS, 6);
    assert.deepEqual(stub.queries, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    // The budget is spent after round 2, so round 3 is the closing round already.
    assert.deepEqual(
      model.requests.map((r) => r.toolChoice),
      ['auto', 'auto', 'none'],
    );
    const transcript = model.requests.at(-1).messages;
    assertEveryCallAnswered(transcript);
    const refusedMessages = transcript.filter(
      (m) => m.role === 'tool' && m.content === JSON.stringify(REFUSED_BUDGET),
    );
    assert.equal(refusedMessages.length, 2);
    assert.equal(JSON.stringify(REFUSED_BUDGET), '{"refused":"search budget exhausted"}');

    // ONE refusal entry for the reason, carrying the count, and no query.
    const refusedLog = outcome.log.filter((e) => e.refused);
    assert.deepEqual(
      refusedLog.map((e) => [e.query, e.reason, e.chunks, e.count]),
      [['', 'budget', null, 2]],
    );
    assert.equal(outcome.searches, 6);
    assert.equal(executedSearches(outcome.log), 6);
  });

  test('a parallel batch split by the budget: at 5 spent, 3 calls → one executed, two refused', async () => {
    const model = stubModel([
      tools(call('a1'), call('a2'), call('a3'), call('a4'), call('a5')),
      tools(call('b1'), call('b2'), call('b3')),
      write(),
    ]);
    const stub = stubSearch();
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });
    assert.deepEqual(stub.queries, ['a1', 'a2', 'a3', 'a4', 'a5', 'b1']);
    const round2 = outcome.log.filter((e) => e.round === 2);
    assert.deepEqual(
      round2.map((e) => [e.query, e.refused, e.count]),
      [
        ['b1', false, undefined],
        ['', true, 2],
      ],
    );
  });

  test('no tool call on round 1 (L9): the single-shot resume from the seed, an empty log, flagged as a fallback', async () => {
    const model = stubModel([write('resume from seed only')]);
    const stub = stubSearch();
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });
    assert.equal(outcome.kind, 'no_tool_calls');
    assert.equal(outcome.content, 'resume from seed only');
    assert.deepEqual(outcome.items, SEED);
    assert.deepEqual(outcome.log, []);
    assert.equal(model.requests.length, 1);
    assert.equal(stub.queries.length, 0);
  });

  test('an erroring round ends the loop: no retry, the SEED comes back, the log keeps earlier searches and a terminal entry', async () => {
    const model = stubModel([tools(call('first')), new RoundFailedError('request'), write()]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    assert.equal(model.requests.length, 2, 'no retry inside the loop');
    assert.equal(outcome.kind, 'round_error');
    assert.equal(outcome.reason, 'request');
    // Seed, not the assembled set: the fall-through writer and its judge read the seed.
    assert.deepEqual(outcome.items, SEED);
    assert.deepEqual(outcome.log.at(-1), { round: 2, ended: 'round_error' });
    assert.equal(outcome.log[0].query, 'first');
  });

  test('round 1 erroring leaves a terminal entry, so the screen never shows it as "ran no extra searches"', async () => {
    const model = stubModel([new RoundFailedError('request')]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    assert.equal(outcome.kind, 'round_error');
    assert.deepEqual(outcome.log, [{ round: 1, ended: 'round_error' }]);
  });

  test('an empty round (no content, no tool calls) is an erroring round', async () => {
    const model = stubModel([tools(call('x')), { content: '   ' }]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    assert.equal(outcome.kind, 'round_error');
    assert.equal(outcome.reason, 'empty');
  });

  test('a programming error is NOT laundered into a fall-through', async () => {
    const model = stubModel([new TypeError('bug')]);
    await assert.rejects(
      runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() }),
      TypeError,
    );
  });

  test('invalid arguments and an unknown tool are refused for that reason, not counted, and store no raw arguments', async () => {
    const model = stubModel([
      tools(rawCall('{not json'), call('ok query', 'some_other_tool'), rawCall('{"query":"   "}'), call('real')),
      write(),
    ]);
    const stub = stubSearch();
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });
    assert.deepEqual(stub.queries, ['real']);
    assert.equal(outcome.searches, 1);
    const invalid = outcome.log.filter((e) => e.reason === 'invalid_arguments');
    assert.equal(invalid.length, 1, 'one entry for the reason, not one per call');
    assert.equal(invalid[0].count, 3);
    assert.ok(invalid.every((e) => e.query === '' && e.refused));
    const transcript = model.requests.at(-1).messages;
    assertEveryCallAnswered(transcript);
    assert.equal(
      transcript.filter((m) => m.role === 'tool' && m.content === JSON.stringify(REFUSED_INVALID)).length,
      3,
    );
  });

  test('a search that could not run is FAILED — counted, answered as unavailable, never "0 found"', async () => {
    const model = stubModel([tools(call('dead')), write()]);
    const stub = stubSearch({ dead: { status: 'could_not_search' } });
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });
    const [entry] = outcome.log;
    assert.equal(entry.failed, true);
    assert.equal(entry.chunks, null, 'a dead search has no count — null, never 0');
    assert.equal(entry.refused, false);
    assert.equal(outcome.searches, 1);
    assert.equal(executedSearches(outcome.log), 1);
    const toolMessage = model.requests.at(-1).messages.find((m) => m.role === 'tool');
    assert.equal(toolMessage.content, JSON.stringify(SEARCH_UNAVAILABLE));
    assert.equal(outcome.kind, 'written');
  });

  test('the deadline: past it, the next round closes and further searches are refused for the clock', async () => {
    let now = 0;
    const model = stubModel([tools(call('early'), call('late')), write()]);
    const stub = stubSearch();
    const search = async (query) => {
      const result = await stub.search(query);
      now += AGENTIC_LOOP_DEADLINE_MS; // the first search eats the whole budget
      return result;
    };
    const outcome = await runAgentLoop({
      firstPrompt: 'P2',
      seed: SEED,
      ...model,
      search,
      now: () => now,
    });
    assert.deepEqual(stub.queries, ['early']);
    assert.deepEqual(
      outcome.log.map((e) => [e.query, e.refused, e.reason]),
      [
        ['early', false, null],
        ['', true, 'deadline'],
      ],
    );
    assert.deepEqual(
      model.requests.map((r) => r.toolChoice),
      ['auto', 'none'],
    );
    assert.ok(
      model.requests.at(-1).messages.some(
        (m) => m.role === 'tool' && m.content === JSON.stringify(REFUSED_DEADLINE),
      ),
    );
  });

  test('seeded, so it can only ADD: the seed stays, held items are not resent, MAX_ITEMS_CHARS bounds the whole set', async () => {
    const big = 'x'.repeat(Math.floor(MAX_ITEMS_CHARS / 2));
    const seed = [item('s1', 'Seed', big)];
    const model = stubModel([tools(call('more')), write()]);
    const stub = stubSearch({
      more: {
        status: 'found',
        chunks: 4,
        bestSimilarity: 0.5,
        items: [
          seed[0], // already held
          item('n1', 'Fits', 'short'),
          item('n2', 'Too big', big), // would cross the bound
        ],
      },
    });
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed, ...model, search: stub.search });
    assert.deepEqual(
      outcome.items.map((i) => i.id),
      ['s1', 'n1'],
    );
    const used = outcome.items.reduce(
      (sum, i) => sum + i.title.length + i.content.length + (i.period?.length ?? 0),
      0,
    );
    assert.ok(used <= MAX_ITEMS_CHARS);
    const toolMessage = model.requests.at(-1).messages.find((m) => m.role === 'tool');
    assert.match(toolMessage.content, /"newItems":1,"alreadyProvided":1,"omittedForSize":1/);
    assert.match(toolMessage.content, /<items>.*"Fits".*<\/items>/s);
    assert.doesNotMatch(toolMessage.content, /Too big/);
  });

  test('the log holds queries, counts, scores and titles — never item content or chunk text', async () => {
    const secret = 'CONFIDENTIAL CHUNK TEXT 42';
    const model = stubModel([tools(call('find')), write()]);
    const stub = stubSearch({
      find: {
        status: 'found',
        chunks: 2,
        bestSimilarity: 0.7,
        items: [item('n1', 'Visible title', secret)],
      },
    });
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search: stub.search });
    const [entry] = outcome.log;
    assert.deepEqual(Object.keys(entry).sort(), [
      'bestSimilarity',
      'chunks',
      'failed',
      'itemTitles',
      'query',
      'reason',
      'refused',
      'round',
    ]);
    assert.deepEqual(entry.itemTitles, ['Visible title']);
    assert.equal(entry.bestSimilarity, 0.7);
    assert.doesNotMatch(JSON.stringify(outcome.log), new RegExp(secret));
  });

  test('50 refused calls add ONE log entry, and the log stays far under the 64 KB CHECK', async () => {
    const long = 'x'.repeat(2_000); // cut to MAX_SEARCH_QUERY_CHARS, and never stored on a refusal
    const flood = Array.from({ length: 50 }, (_, i) => call(`${long}${i}`));
    const model = stubModel([
      tools(call('s1'), call('s2'), call('s3'), call('s4'), call('s5'), call('s6'), ...flood),
      write(),
    ]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    const refused = outcome.log.filter((e) => e.refused);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].count, 50);
    assert.equal(refused[0].query, '');
    // Every one of the 56 calls still got its own tool message.
    assertEveryCallAnswered(model.requests.at(-1).messages);
    const bytes = new TextEncoder().encode(JSON.stringify(outcome.log)).length;
    assert.ok(bytes < 64 * 1024 / 8, `log is ${bytes} bytes`);
  });

  test('a flood of malformed calls across rounds is still ONE entry per reason', async () => {
    const junk = (n) => Array.from({ length: n }, () => rawCall('{}'));
    const model = stubModel([tools(...junk(300)), tools(...junk(300)), tools(...junk(300)), write()]);
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    assert.equal(outcome.log.length, 1);
    assert.equal(outcome.log[0].count, 900);
    assert.ok(new TextEncoder().encode(JSON.stringify(outcome.log)).length < 1_000);
  });

  test('a search that THROWS is a failed search: the run continues and nothing escapes (code review M1)', async () => {
    const model = stubModel([tools(call('flaky'), call('fine')), write('resume')]);
    const stub = stubSearch();
    const search = async (query) => {
      if (query === 'flaky') {
        const err = new Error('plan read failed');
        err.name = 'PlanRequiredError';
        throw err;
      }
      return stub.search(query);
    };
    const outcome = await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, search });
    assert.equal(outcome.kind, 'written');
    assert.deepEqual(
      outcome.log.map((e) => [e.query, e.failed, e.chunks]),
      [
        ['flaky', true, null],
        ['fine', false, 3],
      ],
    );
    assert.equal(outcome.searches, 2, 'a search that could not run was still executed');
    const toolMessages = model.requests.at(-1).messages.filter((m) => m.role === 'tool');
    assert.equal(toolMessages[0].content, JSON.stringify(SEARCH_UNAVAILABLE));
  });

  test('the loop itself writes nothing to the console — no query, no content, no transcript', async () => {
    const seen = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    for (const key of Object.keys(original)) console[key] = (...args) => seen.push(args);
    try {
      const model = stubModel([tools(call('private query')), new RoundFailedError('request')]);
      await runAgentLoop({ firstPrompt: 'P2', seed: SEED, ...model, ...stubSearch() });
    } finally {
      Object.assign(console, original);
    }
    assert.deepEqual(seen, []);
  });

  test('the chat gate declares the tool on EVERY round, the closing one included', () => {
    // The loop chooses tool_choice; the round request is built in lib/chat.ts,
    // which a test cannot load. This pins the source: one unconditional
    // declaration in the only function that issues a round.
    const source = readFileSync(path.join(ROOT, 'src/lib/chat.ts'), 'utf8');
    const body = source.slice(source.indexOf('async function issueToolRound'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    assert.match(fn, /tools: \[SEARCH_CAREER_BASE_TOOL\],/);
    assert.match(fn, /toolChoice,/);
    // Exactly one `tools:` key, and it is the constant declaration — no ternary.
    assert.equal(fn.match(/\btools:/g)?.length, 1, 'tools must be declared exactly once, unconditionally');
  });
});
