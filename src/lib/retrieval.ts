import 'server-only';

import type { User } from '@supabase/supabase-js';

import { chunksForItem, titleOf } from '@/lib/chunking';
import {
  deleteDocumentsForItem,
  insertDocuments,
  matchDocuments as matchDocumentsRpc,
  type NewDocument,
} from '@/lib/db/documents';
import { logLlmCall } from '@/lib/db/llmCalls';
import { ERROR_MESSAGES } from '@/lib/copy';
import { AiUnavailableError, UnauthorizedError } from '@/lib/errors';
import { getUser } from '@/lib/supabase/server';
import {
  EMBEDDING_BATCH_SIZE,
  type ConnectionResult,
  type LlmStep,
  OpenRouterError,
  createEmbeddings,
} from '@/lib/openrouter/server';

/**
 * GATE — embeddings, and the ORCHESTRATOR for vector search and indexing.
 *
 * Every embedding call (indexing, matching, re-scoring) goes through here, and
 * the gate calls getUser() FIRST. Unlike `lib/chat.ts` this also guards spends
 * that happen as a SIDE EFFECT of saving a career item, which is why the two
 * gates are separate files (CLAUDE.md, "AI model calls").
 *
 * The `match_documents` call itself lives in `lib/db/documents.ts`, because
 * that DAL owns every route to the `documents` table (SPEC v1.9 Block A). This
 * module embeds the query, calls the DAL, and turns the result into one of the
 * three retrieval outcomes.
 *
 * Retrieved chunks are DATA: they go into a model call inside a tagged block,
 * are never stored in prompts, never echoed verbatim to the client, and never
 * appended to any transcript.
 *
 * NO RETRIES on this endpoint, ever — not even the two the chat gate is allowed.
 * The recovery path for indexing is the one the embeddings rules already
 * specify: the save succeeds, the user sees a warning, the next edit re-indexes.
 * The recovery path for matching is `could_not_search`, which fails the scan
 * honestly instead of inventing gaps.
 */

/** Throws the SHARED UnauthorizedError from lib/errors (→ 401, Block D). */
async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

// The coverage threshold is rule B1 arithmetic and lives in lib/scoring.ts —
// one source for one constant. Re-exported here for callers of this gate.
export { COVERAGE_THRESHOLD } from '@/lib/scoring';

export type MatchedChunk = {
  id: string;
  careerItemId: string;
  /** `title + "\n\n" + chunk text` — the title is STORED, not merely embedded. */
  content: string;
  similarity: number;
};

/**
 * Three outcomes, never two. `could_not_search` must NEVER be reported as
 * `found_nothing`: calling a requirement a "gap" because the embeddings call
 * died is the app lying about data it never checked (CLAUDE.md, Retrieval).
 */
export type MatchOutcome =
  | { status: 'found'; chunks: MatchedChunk[] }
  | { status: 'found_nothing'; chunks: [] }
  | { status: 'could_not_search'; error: string };

type EmbedStep = Extract<LlmStep, 'embed' | 'rescore'>;

/**
 * One `llm_calls` row per embeddings REQUEST, success or failure (rule B8).
 *
 * Written here and not in the connection for the same structural reason as in
 * the chat gate: `llm_calls.user_id` is NOT NULL and its insert policy is
 * `auth.uid() = user_id`, so the row needs the identity the connection is
 * defined not to have.
 */
function logEmbedCall(
  userId: string,
  step: EmbedStep,
  result: ConnectionResult<number[][]> | null,
  err?: unknown,
): void {
  logLlmCall({
    user_id: userId,
    // Indexing is not tied to an application; a re-score is, and passes it via
    // the caller in a later phase.
    application_id: null,
    step,
    model: result?.model ?? (err instanceof OpenRouterError ? err.attemptedModel : 'unknown'),
    fallback_used: false,
    ok: result !== null,
    tokens_in: result?.tokensIn ?? 0,
    tokens_out: 0,
    cost_usd_micro: result?.costUsdMicro ?? 0,
    cost_known: result?.costKnown ?? true,
    latency_ms: result?.latencyMs ?? (err instanceof OpenRouterError ? err.latencyMs : 0),
  });
}

/**
 * Embed texts for the verified user. Batched at EMBEDDING_BATCH_SIZE.
 *
 * Throws AiUnavailableError on failure — `OpenRouterError` never escapes this
 * module, because a route handler that wanted to catch it would have to import
 * the connection, which check.mjs R6 forbids.
 */
export async function embedTexts(
  texts: string[],
  step: EmbedStep = 'embed',
): Promise<number[][]> {
  const user = await requireUser();
  return embedFor(user.id, texts, step);
}

/** The batching core, for callers inside this module that already have the user. */
async function embedFor(userId: string, texts: string[], step: EmbedStep): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const result = await createEmbeddings({ step, inputs: batch });
      logEmbedCall(userId, step, result);
      vectors.push(...result.data);
    } catch (err) {
      logEmbedCall(userId, step, null, err);
      throw new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE);
    }
  }
  return vectors;
}

/** One career item as the indexer sees it. */
export type IndexableItem = { id: string; title: string; content: string };

export type IndexOutcome = {
  /** Items whose chunks are all in `documents`. */
  indexed: number;
  /** Items that were saved but are NOT searchable yet. */
  failed: number;
};

/**
 * Group items into embedding batches WITHOUT splitting an item across two
 * batches.
 *
 * That constraint is the whole point. If one item's chunks straddle a batch
 * boundary and the second batch fails, the item ends up with chunk 1 indexed and
 * chunk 2 missing — and a half-indexed item is the worst of the three states: it
 * looks healthy, it matches queries, and it silently cannot match anything in the
 * paragraph that went missing. Keeping an item whole makes the failure unit an
 * ITEM, which is the unit the warning copy can honestly describe.
 */
function batchByItem(
  groups: { item: IndexableItem; chunks: string[] }[],
): { item: IndexableItem; chunks: string[] }[][] {
  const batches: { item: IndexableItem; chunks: string[] }[][] = [];
  let current: { item: IndexableItem; chunks: string[] }[] = [];
  let size = 0;

  for (const group of groups) {
    if (size > 0 && size + group.chunks.length > EMBEDDING_BATCH_SIZE) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(group);
    size += group.chunks.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Zip one batch's flat vector list back onto its items, in order. */
function rowsFor(
  batch: { item: IndexableItem; chunks: string[] }[],
  vectors: number[][],
): NewDocument[] {
  const rows: NewDocument[] = [];
  let offset = 0;
  for (const { item, chunks } of batch) {
    for (const content of chunks) {
      rows.push({ career_item_id: item.id, content, embedding: vectors[offset]! });
      offset += 1;
    }
  }
  return rows;
}

/**
 * Index newly-saved career items. NEVER THROWS.
 *
 * Indexing happens AFTER the career-item write has succeeded and must never be
 * able to fail that save (CLAUDE.md, Embeddings). So every failure here is
 * counted and reported back as a non-blocking warning, and the caller returns
 * 200 with the saved items either way. An unindexed item is a recoverable state —
 * the next edit re-indexes it — whereas a failed save has thrown away work the
 * user already did.
 *
 * Failure granularity is one BATCH, and a batch never splits an item, so an
 * item is either fully searchable or not in `documents` at all.
 */
export async function indexCareerItems(
  userId: string,
  items: IndexableItem[],
): Promise<IndexOutcome> {
  const groups = items
    .map((item) => ({ item, chunks: chunksForItem(item.title, item.content) }))
    .filter((group) => group.chunks.length > 0);

  let indexed = 0;
  let failed = 0;

  for (const batch of batchByItem(groups)) {
    const inputs = batch.flatMap((group) => group.chunks);
    try {
      const vectors = await embedFor(userId, inputs, 'embed');
      await insertDocuments(userId, rowsFor(batch, vectors));
      indexed += batch.length;
    } catch (err) {
      failed += batch.length;
      // Metadata only: never the chunk text, never the item content.
      console.error('[retrieval] indexing failed for a batch of career items', {
        items: batch.length,
        chunks: inputs.length,
        name: err instanceof Error ? err.name : typeof err,
      });
    }
  }

  return { indexed, failed };
}

/**
 * Re-index ONE edited career item. NEVER THROWS. Returns whether it is now
 * searchable.
 *
 * ORDER IS LOAD-BEARING: embed first, hold the vectors, and only then
 * delete-and-insert. The obvious sequencing — delete the stale rows, then embed
 * the new ones — leaves the item with ZERO `documents` rows whenever the paid
 * call fails. That is not a stale index, it is a MISSING one: the item drops out
 * of `match_documents` entirely, and every later scan reports its content as a
 * `gap` — the app stating a finding about data it never searched, which is the
 * exact lie the three-outcomes rule exists to prevent. With this order, an embed
 * failure changes nothing at all and the old chunks stay searchable.
 *
 * The WRITE shape is still delete-then-insert, never upsert: `documents` has no
 * UPDATE policy and RLS would refuse one. Only the sequencing relative to the
 * paid call changed.
 */
export async function reindexCareerItem(userId: string, item: IndexableItem): Promise<boolean> {
  const chunks = chunksForItem(item.title, item.content);
  if (chunks.length === 0) return false;

  let vectors: number[][];
  try {
    vectors = await embedFor(userId, chunks, 'embed');
  } catch (err) {
    // Nothing has been deleted. The item keeps its previous, now slightly stale,
    // chunks — which is what `CAREER.indexWarning` actually promises.
    console.error('[retrieval] re-indexing failed; previous chunks left in place', {
      chunks: chunks.length,
      name: err instanceof Error ? err.name : typeof err,
    });
    return false;
  }

  try {
    await deleteDocumentsForItem(item.id);
    await insertDocuments(
      userId,
      chunks.map((content, i) => ({
        career_item_id: item.id,
        content,
        embedding: vectors[i]!,
      })),
    );
    return true;
  } catch (err) {
    console.error('[retrieval] re-indexing write failed', {
      name: err instanceof Error ? err.name : typeof err,
    });
    return false;
  }
}

/**
 * Vector search over the caller's own base: embed the query here, then call
 * `lib/db/documents.ts` for the `match_documents` RPC (security invoker;
 * filters on auth.uid() inside the function, with RLS on `documents` as the
 * fence underneath).
 *
 * Returns one of THREE outcomes. A thrown RPC or embedding error becomes
 * `could_not_search`, never `found_nothing` — the caller must fail the scan
 * with AI_UNAVAILABLE rather than render the requirements as gaps.
 *
 * In development every run logs one line per considered chunk — career item
 * title and similarity, including below-threshold ones. This is an acceptance
 * mechanism, not a convenience. Chunk TEXT is never printed, in either mode.
 */
export async function matchDocuments(
  queryText: string,
  matchCount = 5,
  step: EmbedStep = 'embed',
): Promise<MatchOutcome> {
  const user = await requireUser();

  let rows;
  try {
    const [queryEmbedding] = await embedFor(user.id, [queryText], step);
    if (!queryEmbedding) return { status: 'could_not_search', error: 'query was not embedded' };
    rows = await matchDocumentsRpc(queryEmbedding, matchCount);
  } catch (err) {
    // The one branch that must never be mistaken for "found nothing".
    return {
      status: 'could_not_search',
      error: err instanceof Error ? err.name : 'search failed',
    };
  }

  const chunks: MatchedChunk[] = rows.map((row) => ({
    id: row.id,
    careerItemId: row.career_item_id,
    content: row.content,
    similarity: row.similarity,
  }));

  logConsideredChunks(chunks);

  return chunks.length === 0 ? { status: 'found_nothing', chunks: [] } : { status: 'found', chunks };
}

/**
 * The development acceptance log: one line per CONSIDERED chunk, including the
 * ones below the coverage threshold — a log of only the winners cannot show that
 * a near-miss was near.
 *
 * It prints the career item TITLE and the score, and never the chunk text. That
 * is possible only because the title is stored as the first line of every chunk
 * (CLAUDE.md, Embeddings), so naming the match costs no extra query and leaks no
 * resume content. Silenced outside development by NODE_ENV.
 */
function logConsideredChunks(chunks: MatchedChunk[]): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (chunks.length === 0) {
    console.log('[retrieval] considered 0 chunks — the base has no matching rows');
    return;
  }
  for (const chunk of chunks) {
    console.log(`[retrieval] ${chunk.similarity.toFixed(4)}  ${titleOf(chunk.content)}`);
  }
}
