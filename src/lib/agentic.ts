/**
 * The agentic loop's control flow (SPEC v3.0 §5 items 1–9, rule B12) — PURE.
 *
 * WHY IT IS NOT IN `lib/chat.ts`. That file is `server-only` and check.mjs R6
 * keeps `tests/` away from it, while rule B12's acceptance is a unit test that
 * drives this loop with a STUB model. The precedent is `lib/budget.ts`,
 * `lib/pricing.ts` and `lib/quality.ts`: load-bearing arithmetic moves to a file
 * a test can load. The property the chokepoint rule protects is unchanged:
 *
 *  - this module imports nothing that can reach the network, the database, a
 *    secret or a gate (check.mjs R6b), so on its own it can spend NOTHING;
 *  - it spends only through the two effects it is handed — `requestRound`, built
 *    inside `lib/chat.ts` after `getUser()` → `currentPlan()` → the grant check,
 *    and `search`, a `lib/retrieval.ts` export that runs its own `getUser()`;
 *  - `lib/chat.ts` is its only caller (R6b again).
 *
 * WHAT IT GUARANTEES, each pinned by `tests/unit/agentic.test.mjs`:
 *  - at most `MAX_TOOL_ROUNDS` model requests, the last with `tool_choice: none`;
 *  - at most `MAX_SEARCH_CALLS` searches, executed one at a time in call order;
 *  - every tool call answered with exactly one `tool` message, refusals included;
 *  - the seed is never replaced — searches only add, inside `MAX_ITEMS_CHARS`;
 *  - no retry: a round that errors ends the loop, and the caller falls through
 *    to the single-shot writer on the seed;
 *  - the log holds queries, counts, scores and item TITLES — never chunk text,
 *    never item content.
 */
import {
  AGENTIC_LOOP_DEADLINE_MS,
  MAX_SEARCH_CALLS,
  MAX_SEARCH_QUERY_CHARS,
  MAX_TOOL_ROUNDS,
} from '@/lib/budget';
import { type GenerationItem, MAX_ITEMS_CHARS, itemChars } from '@/lib/generation';
import type { RefusalReason, RetrievalLogEntry, SearchLogEntry } from '@/lib/retrievalLog';

// The log's shape lives in a dependency-free module so the browser can read it.
export type { RefusalReason, RetrievalLogEntry, SearchLogEntry } from '@/lib/retrievalLog';
export { executedSearches, isEndedEntry } from '@/lib/retrievalLog';

/** The one tool's name. The declaration itself is server-built in `lib/prompts.ts`. */
export const SEARCH_TOOL_NAME = 'search_career_base';

/** The tool message a call past the search budget receives (SPEC §5 item 3, L8). */
export const REFUSED_BUDGET = { refused: 'search budget exhausted' } as const;
/** …a call whose arguments are not `{ "query": string }`, or names another tool. */
export const REFUSED_INVALID = { refused: 'invalid arguments' } as const;
/** …a call that arrives after the loop's wall-clock budget is spent. */
export const REFUSED_DEADLINE = { refused: 'time budget exhausted' } as const;
/** …a search that ran and could not complete (the third retrieval outcome). */
export const SEARCH_UNAVAILABLE = { error: 'search unavailable' } as const;

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/** Structurally the connection's `ToolChatMessage`; restated so this file imports nothing server-side. */
export type LoopMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolChoice = 'auto' | 'none';

export type RoundResult = {
  content: string | null;
  toolCalls: ToolCall[];
  /** The model that ACTUALLY served this round. */
  model: string;
};

/**
 * The ONLY failure `requestRound` may report as "this round errored". Anything
 * else it throws is a defect and propagates — a programming error must not be
 * laundered into a quiet fall-through.
 */
export class RoundFailedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`agentic round failed: ${reason}`);
    this.name = 'RoundFailedError';
    this.reason = reason;
  }
}

/** One search as the retrieval gate answers it. `items` are rows, best rank first. */
export type SearchResult =
  | {
      status: 'found' | 'found_nothing';
      chunks: number;
      bestSimilarity: number | null;
      items: GenerationItem[];
    }
  | { status: 'could_not_search' };

export type AgentLoopOutcome =
  /** The model searched (or chose not to after round 1) and wrote. */
  | {
      kind: 'written';
      content: string;
      model: string;
      items: GenerationItem[];
      log: RetrievalLogEntry[];
      rounds: number;
      searches: number;
    }
  /** Round 1 answered with prose: the single-shot resume, written from the seed (L9). */
  | {
      kind: 'no_tool_calls';
      content: string;
      model: string;
      items: GenerationItem[];
      log: [];
      rounds: 1;
      searches: 0;
    }
  /** A round errored. No resume: the caller runs the single-shot writer on the seed. */
  | {
      kind: 'round_error';
      reason: string;
      items: GenerationItem[];
      log: RetrievalLogEntry[];
      rounds: number;
      searches: number;
    };

export type AgentLoopArgs = {
  /** P2 filled with the SEED items plus the agentic addendum — server-built. */
  firstPrompt: string;
  /** The single-shot retrieval's items: the baseline the agent can only add to. */
  seed: GenerationItem[];
  requestRound: (messages: LoopMessage[], toolChoice: ToolChoice) => Promise<RoundResult>;
  search: (query: string) => Promise<SearchResult>;
  /** Injected so the deadline is testable; `Date.now` in production. */
  now?: () => number;
  deadlineMs?: number;
};

/** Parse a call's arguments to a usable query, or null when they are not one. */
export function queryOf(call: ToolCall): string | null {
  if (call.function.name !== SEARCH_TOOL_NAME) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const query = (parsed as { query?: unknown }).query;
  if (typeof query !== 'string') return null;
  const trimmed = query.trim().slice(0, MAX_SEARCH_QUERY_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

/** The fields of an item a prompt may carry — the same four the `<items>` block holds. */
const promptItem = (item: GenerationItem) => ({
  type: item.type,
  title: item.title,
  period: item.period,
  content: item.content,
});

export async function runAgentLoop(args: AgentLoopArgs): Promise<AgentLoopOutcome> {
  const now = args.now ?? Date.now;
  const deadlineMs = args.deadlineMs ?? AGENTIC_LOOP_DEADLINE_MS;
  const startedAt = now();
  const pastDeadline = () => now() - startedAt >= deadlineMs;

  const messages: LoopMessage[] = [{ role: 'user', content: args.firstPrompt }];
  const items: GenerationItem[] = [...args.seed];
  const held = new Set(items.map((item) => item.id));
  let usedChars = items.reduce((sum, item) => sum + itemChars(item), 0);
  const log: RetrievalLogEntry[] = [];
  let searches = 0;

  const fallThrough = (round: number, reason: string): AgentLoopOutcome => ({
    kind: 'round_error',
    reason,
    // The fall-through writer sees the SEED, so the judge must see the seed too:
    // P3's grounding corpus is always the set the writer of that draft was given.
    items: [...args.seed],
    log: [...log, { round, ended: 'round_error' }],
    rounds: round,
    searches,
  });

  /**
   * ONE ENTRY PER REFUSAL REASON PER RUN, carrying a count (security review,
   * MAJOR). Nothing bounds how many tool calls a model puts in one round, and an
   * instruction injected into a pasted posting can ask for hundreds. Logged one
   * entry each, they could push `retrieval_log` past its 64 KB CHECK and fail the
   * version insert after the whole run was paid for. Every call still gets its
   * own refused `tool` message — the transcript stays well-formed — but the LOG
   * grows by at most three refusal entries, and none of them stores a query.
   */
  const refusalEntries = new Map<RefusalReason, SearchLogEntry>();

  /** Answer ONE tool call: execute it or refuse it, log it, return the tool message. */
  const answer = async (call: ToolCall, round: number): Promise<string> => {
    const query = queryOf(call);
    const refuse = (reason: RefusalReason, body: object): string => {
      const existing = refusalEntries.get(reason);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
      } else {
        const entry: SearchLogEntry = {
          round,
          // No query on a refusal: an unparseable argument is model output of
          // unknown shape, and the count is what the screen needs.
          query: '',
          chunks: null,
          bestSimilarity: null,
          itemTitles: [],
          refused: true,
          reason,
          failed: false,
          count: 1,
        };
        refusalEntries.set(reason, entry);
        log.push(entry);
      }
      return JSON.stringify(body);
    };

    if (query === null) return refuse('invalid_arguments', REFUSED_INVALID);
    if (searches >= MAX_SEARCH_CALLS) return refuse('budget', REFUSED_BUDGET);
    if (pastDeadline()) return refuse('deadline', REFUSED_DEADLINE);

    // Counted BEFORE the search runs: a search that could not complete was still
    // executed, and the budget counts executions.
    searches += 1;
    let result: SearchResult;
    try {
      result = await args.search(query);
    } catch {
      // A search that THROWS — a transient auth or plan read, an embeddings
      // error the effect did not convert — is a search that could not run (code
      // review M1). The run has already spent; it continues on the evidence it
      // holds, and the failure is the third retrieval outcome, never "0 found".
      result = { status: 'could_not_search' };
    }

    if (result.status === 'could_not_search') {
      log.push({
        round,
        query,
        chunks: null,
        bestSimilarity: null,
        itemTitles: [],
        refused: false,
        reason: null,
        failed: true,
      });
      return JSON.stringify(SEARCH_UNAVAILABLE);
    }

    const added: GenerationItem[] = [];
    let alreadyProvided = 0;
    let omittedForSize = 0;
    for (const item of result.items) {
      if (held.has(item.id)) {
        alreadyProvided += 1;
        continue;
      }
      const size = itemChars(item);
      // The same bound the seed was built under, over the WHOLE running set.
      if (usedChars + size > MAX_ITEMS_CHARS) {
        omittedForSize += 1;
        continue;
      }
      held.add(item.id);
      items.push(item);
      added.push(item);
      usedChars += size;
    }

    log.push({
      round,
      query,
      chunks: result.chunks,
      bestSimilarity: result.bestSimilarity,
      itemTitles: result.items.map((item) => item.title),
      refused: false,
      reason: null,
      failed: false,
    });

    const summary = JSON.stringify({
      newItems: added.length,
      alreadyProvided,
      omittedForSize,
    });
    return `${summary}\n<items>${JSON.stringify(added.map(promptItem))}</items>`;
  };

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    // The closing round: the last one, or the first one after the budget or the
    // clock has run out — paying for a round only to refuse every call it makes
    // would be spend with nothing to show for it.
    const closing = round === MAX_TOOL_ROUNDS || searches >= MAX_SEARCH_CALLS || pastDeadline();

    let result: RoundResult;
    try {
      result = await args.requestRound(messages, closing ? 'none' : 'auto');
    } catch (err) {
      if (err instanceof RoundFailedError) return fallThrough(round, err.reason);
      throw err;
    }

    if (result.toolCalls.length === 0) {
      if (result.content === null || result.content.trim() === '') {
        return fallThrough(round, 'empty');
      }
      if (round === 1) {
        // L9: never called the tool. What it wrote came from the seed alone, which
        // is the single-shot resume — and the caller logs it as a fallback.
        return {
          kind: 'no_tool_calls',
          content: result.content,
          model: result.model,
          items: [...args.seed],
          log: [],
          rounds: 1,
          searches: 0,
        };
      }
      return {
        kind: 'written',
        content: result.content,
        model: result.model,
        items,
        log,
        rounds: round,
        searches,
      };
    }

    // Tool calls on a `none` round: the model disobeyed the one instruction that
    // guarantees the loop ends with a resume. Treated as an erroring round.
    if (closing) return fallThrough(round, 'tool_calls_on_closing_round');

    messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });
    // Sequentially, in call order, never `Promise.all`: the search budget is then
    // counted against what was actually sent, deterministically.
    for (const call of result.toolCalls) {
      const content = await answer(call, round);
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }

  // Unreachable: the last iteration is a closing round, and every branch of a
  // closing round returns. Kept as a loud statement rather than an implication.
  throw new Error('agentic loop exited without an outcome');
}
