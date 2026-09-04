import 'server-only';

import type { User } from '@supabase/supabase-js';

import { chunksForItem, titleOf } from '@/lib/chunking';
import {
  deleteDocumentsForItem,
  insertDocuments,
  listDocumentsForItem,
  matchDocuments as matchDocumentsRpc,
  type NewDocument,
} from '@/lib/db/documents';
import { underRescoreCap } from '@/lib/budget';
import { countRescoreCallsInLast24h, logLlmCall } from '@/lib/db/llmCalls';
import { ERROR_MESSAGES } from '@/lib/copy';
import { AiUnavailableError, DailyLimitError, UnauthorizedError } from '@/lib/errors';
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
 * EVERY exported function calls getUser() FIRST — no exceptions, including the
 * two that index. Unlike `lib/chat.ts` this also guards spends that happen as a
 * SIDE EFFECT of saving a career item, which is why the two gates are separate
 * files (CLAUDE.md, "AI model calls").
 *
 * NO EXPORT TAKES A USER ID. The verified session is the only source of it, and
 * that omission is the design rather than a convenience: an id passed in as an
 * argument can disagree with the session, so the chokepoint would have moved out
 * of this module and into the discipline of every future caller — which is the
 * arrangement the rule replaces. RLS would still refuse a foreign `documents`
 * insert, but only AFTER the paid embedding call had gone out, so trusting an
 * argument here costs real money on a path that then reports itself as a routine
 * indexing failure.
 *
 * Two of the INDEXING exports must ALSO never throw, because indexing may never fail
 * a save that already succeeded (CLAUDE.md, Embeddings). They reconcile that with
 * the rule above by refusing rather than raising: no verified user means nothing
 * is embedded, nothing is written, and the outcome says so — which the caller
 * already surfaces as the non-blocking index warning.
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
 * The two outcomes of a search that RAN. Split out from `MatchOutcome` so a
 * batch can hand back one of these per query without `could_not_search` being
 * representable in that position — see `BatchMatchOutcome`.
 */
export type SearchedOutcome =
  | { status: 'found'; chunks: MatchedChunk[] }
  | { status: 'found_nothing'; chunks: [] };

/**
 * Three outcomes, never two. `could_not_search` must NEVER be reported as
 * `found_nothing`: calling a requirement a "gap" because the embeddings call
 * died is the app lying about data it never checked (CLAUDE.md, Retrieval).
 */
export type MatchOutcome = SearchedOutcome | { status: 'could_not_search'; error: string };

/**
 * The outcome of matching MANY queries in one run (SPEC Block D #4: "embed each
 * requirement (`embed` step, batched) -> match_documents per requirement").
 *
 * The third retrieval outcome is at the RUN level and nowhere else, which is the
 * whole point of the shape: a caller iterating `outcomes` has no
 * `could_not_search` case to forget, so a dead embeddings call cannot fall
 * through a per-item `else` and become a gap. Either every query was searched,
 * or none of them are reported at all.
 *
 * `outcomes` is index-aligned with the queries that were passed in.
 */
export type BatchMatchOutcome =
  | { status: 'searched'; outcomes: SearchedOutcome[] }
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
  err: unknown,
  applicationId: string | null,
): void {
  logLlmCall({
    user_id: userId,
    /**
     * The run this embedding belongs to, when there is one (SPEC v2.16, closing
     * backlog `p3-8`). Indexing a career item belongs to no application and
     * passes null; a scan, a generate and a re-score all pass theirs, so a
     * pipeline run's EMBEDDING spend is attributable to it and DoD item 7's
     * "one full pipeline run" is one set of linked rows rather than one linked
     * row plus orphans.
     *
     * An application id is not a user id, so this does not weaken the rule at
     * the top of this file: the identity still comes only from the session, and
     * `llm_calls`' insert policy still refuses a row for anyone else. A wrong
     * application id here mislabels a log line; it cannot reach another
     * account's data, because the FK and RLS both scope it to the caller.
     */
    application_id: applicationId,
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
 * Rule B7a — the re-score ceiling, checked ONCE per re-score run, in the GATE.
 *
 * The same shape as rule B7's check at the head of `lib/chat.ts`: read the
 * COMMITTED rows, refuse before the first request goes out, and let a run that
 * has started finish. It lives here and not in the route handler for the reason
 * this whole module exists — a fence a caller has to remember is a fence the
 * next caller does not have.
 *
 * DECLARED OVERSHOOT, the same bound rule B7 carries: `logLlmCall` writes through
 * `after()`, so a run's own batches are invisible to its own check and a run that
 * starts under the cap may finish over it by at most its batch count minus one —
 * 6 rows on the largest permitted input. Re-checking mid-run would refuse a
 * re-score whose first batch was already billed, which buys a half-measured score
 * for money already spent.
 *
 * `embed` is deliberately NOT capped: indexing must never be able to fail a save
 * (CLAUDE.md, Embeddings), and it is already bounded by rule B9 and by the
 * skip-when-unchanged rule. A ceiling on it would be a new way for a saved item
 * to lose its index, which is the failure those two rules exist to prevent.
 */
async function assertUnderRescoreCap(): Promise<void> {
  // `underRescoreCap` is the comparison, in `lib/budget.ts` where a unit test can
  // reach it (backlog p4-30). This is the query and the throw.
  if (!underRescoreCap(await countRescoreCallsInLast24h())) {
    throw new DailyLimitError(ERROR_MESSAGES.RESCORE_LIMIT);
  }
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
  applicationId: string | null = null,
): Promise<number[][]> {
  const user = await requireUser();
  // Rule B7a. The one step here whose spend is a repeatable user action.
  if (step === 'rescore') await assertUnderRescoreCap();
  return embedFor(user.id, texts, step, applicationId);
}

/** The batching core, for callers inside this module that already have the user. */
async function embedFor(
  userId: string,
  texts: string[],
  step: EmbedStep,
  applicationId: string | null = null,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const result = await createEmbeddings({ step, inputs: batch });
      logEmbedCall(userId, step, result, null, applicationId);
      vectors.push(...result.data);
    } catch (err) {
      logEmbedCall(userId, step, null, err, applicationId);
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
export async function indexCareerItems(items: IndexableItem[]): Promise<IndexOutcome> {
  /**
   * getUser() FIRST, before a single chunk is embedded — and by REFUSING, not
   * raising. A throw here would be the one thing this function may never do: the
   * career items are already written by the time it runs, so an exception would
   * turn a successful save into an error response and lose work the user has
   * already done. Refusing spends nothing, writes nothing, and is reported
   * through the warning channel that already exists for an unindexed item.
   */
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { indexed: 0, failed: items.length };
  }

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
export async function reindexCareerItem(item: IndexableItem): Promise<boolean> {
  // getUser() FIRST, and refusing rather than raising — same reasoning as
  // indexCareerItems: `false` means "not searchable", which is exactly what an
  // unverified caller should achieve, and the PATCH that called this has already
  // written the row.
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return false;
  }

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

/** What one item's re-index did, for the dev report. */
export type ReindexedItem = {
  careerItemId: string;
  title: string;
  /** `documents` rows the item had before. `null` when the count could not be read. */
  before: number | null;
  /** `documents` rows it has now. `null` when that is not knowable. */
  after: number | null;
  /**
   * THREE states, because two of them are not the same failure — and a boolean
   * `written` reported them as one, which was wrong:
   *
   *   reindexed        the swap completed; `after` is the new row count.
   *   old_rows_intact  the read or the DELETE failed, so NOTHING was deleted.
   *                    The item keeps its previous chunks and is still fully
   *                    searchable, just on the old chunking.
   *   unindexed        the delete succeeded and the INSERT failed. The only
   *                    state in which the item has no rows at all, and the only
   *                    one that costs searchability.
   *
   * That distinction is the whole point of reporting per item: "39 of 40 items
   * are searchable" is a true sentence only if the report can tell an item that
   * kept its old rows apart from one that lost them.
   */
  state: 'reindexed' | 'old_rows_intact' | 'unindexed';
};

export type ReindexOutcome = {
  items: ReindexedItem[];
  /** Embedding inputs sent — the size of the paid part of the run. */
  chunksEmbedded: number;
  /** Embedding REQUESTS sent, which is what the run is billed per. */
  embeddingRequests: number;
  /** Items that lost their rows: delete succeeded, insert failed. */
  unindexed: number;
  /** Items still searchable on their OLD chunks, because nothing was deleted. */
  oldRowsIntact: number;
};

/**
 * Re-index the caller's WHOLE career base against the current chunker
 * (SPEC v2.14, backlog p3-13). Dev-only in practice — the one route that calls
 * it refuses outside development — but the safety properties are the gate's, not
 * the route's.
 *
 * ORDER IS LOAD-BEARING, and here it is stricter than in `reindexCareerItem`:
 * EVERY item's chunks are embedded FIRST, and nothing is deleted until the last
 * embedding has come back. `documents` is select/insert/delete with no UPDATE
 * policy (CLAUDE.md, Embeddings), so re-indexing is delete-then-insert and the
 * old rows are the only copy of a working index. Embedding item by item and
 * writing as it goes would mean a failure on item 40 of 200 leaves 39 items on
 * the new chunking, one item with nothing at all, and 160 on the old — a base
 * that reports gaps for content it holds. With this order an embedding failure
 * changes NOTHING: the run throws before a single delete and the old index is
 * still there.
 *
 * The write phase is per item and each item is delete-then-insert, so a failure
 * there can still leave one item unindexed. That window is DB-only (no paid
 * call, no network to a third party) and it is reported per item in the THREE
 * states `ReindexedItem.state` distinguishes: a failed read or delete leaves the
 * old rows in place and the item searchable, and only a failed INSERT loses
 * them. Reporting those two as one boolean made "39 of 40 items are searchable"
 * a sentence the caller could not actually say.
 *
 * THE COST OF EMBEDDING FIRST is memory: every vector for the whole base is held
 * until the last one arrives — 1,536 floats per chunk, so a base at the cap
 * (200 items x 20 chunks) is on the order of 50 MB inside one request. That is
 * the real bound on this endpoint's size, ahead of `maxDuration`, and the second
 * reason p3-18's slicing is the right shape for a large base.
 *
 * No `userId` parameter, by design: `getUser()` runs here and the id comes from
 * the session. An id argument would be a way to re-index someone else's base
 * from a route that forgot to check — the defect the phase-2 review found in
 * this module's other two exported indexers.
 */
export async function reindexAllCareerItems(items: IndexableItem[]): Promise<ReindexOutcome> {
  const user = await requireUser();

  const groups = items
    .map((item) => ({ item, chunks: chunksForItem(item.title, item.content) }))
    .filter((group) => group.chunks.length > 0);

  /**
   * PHASE 1 — embed everything. A throw here reaches the caller with the old
   * index untouched, which is the whole point of doing it first.
   *
   * Through `batchByItem`, the same packer the save path uses: one request per
   * EMBEDDING_BATCH_SIZE chunks rather than one per ITEM. Embedding item by item
   * would cost ~200 requests for a full base where 63 do, and it would bypass
   * the invariant that packer exists for — a batch never splits an item, so one
   * failed request can never half-index one.
   */
  const embedded: { item: IndexableItem; chunks: string[]; vectors: number[][] }[] = [];
  let embeddingRequests = 0;
  for (const batch of batchByItem(groups)) {
    const inputs = batch.flatMap((group) => group.chunks);
    const vectors = await embedFor(user.id, inputs, 'embed');
    embeddingRequests += 1;
    if (vectors.length !== inputs.length) {
      // Mis-aligned vectors would store one bullet's embedding against another
      // bullet's text — a silently wrong index, which is worse than none.
      throw new AiUnavailableError(ERROR_MESSAGES.AI_UNAVAILABLE);
    }
    let offset = 0;
    for (const group of batch) {
      embedded.push({ ...group, vectors: vectors.slice(offset, offset + group.chunks.length) });
      offset += group.chunks.length;
    }
  }

  // PHASE 2 — swap the rows. DB only from here.
  const results: ReindexedItem[] = [];
  let unindexed = 0;
  let oldRowsIntact = 0;

  for (const { item, chunks, vectors } of embedded) {
    let before: number | null = null;
    try {
      before = (await listDocumentsForItem(item.id)).length;
      await deleteDocumentsForItem(item.id);
    } catch (err) {
      /**
       * Nothing was deleted. A failed count never touches a row, and the delete
       * is one statement that either applied or did not — so the item keeps its
       * old chunks and stays searchable, which is a different report from losing
       * them. Metadata only: never chunk text, never item content.
       */
      oldRowsIntact += 1;
      console.error('[retrieval] re-index could not clear an item; old rows left in place', {
        name: err instanceof Error ? err.name : typeof err,
      });
      results.push({
        careerItemId: item.id,
        title: item.title,
        before,
        after: before,
        state: 'old_rows_intact',
      });
      continue;
    }

    try {
      await insertDocuments(
        user.id,
        chunks.map((content, i) => ({
          career_item_id: item.id,
          content,
          embedding: vectors[i]!,
        })),
      );
      results.push({
        careerItemId: item.id,
        title: item.title,
        before,
        after: chunks.length,
        state: 'reindexed',
      });
    } catch (err) {
      /**
       * The one state that costs searchability: the old rows are gone and the
       * new ones did not land. Recoverable — the next edit of this item
       * re-indexes it, and so does a second call to this endpoint.
       */
      unindexed += 1;
      console.error('[retrieval] re-index insert failed; the item has no rows', {
        chunks: chunks.length,
        name: err instanceof Error ? err.name : typeof err,
      });
      results.push({
        careerItemId: item.id,
        title: item.title,
        before,
        after: 0,
        state: 'unindexed',
      });
    }
  }

  return {
    items: results,
    chunksEmbedded: embedded.reduce((sum, group) => sum + group.chunks.length, 0),
    embeddingRequests,
    unindexed,
    oldRowsIntact,
  };
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
  applicationId: string | null = null,
): Promise<MatchOutcome> {
  const user = await requireUser();

  let rows;
  try {
    const [queryEmbedding] = await embedFor(user.id, [queryText], step, applicationId);
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
 * Match MANY queries in one run — the scan path (SPEC Block D #4).
 *
 * Batched on purpose, and the batching is the reason this exists rather than a
 * loop over `matchDocuments`: that function embeds its own query, so one call
 * per requirement would issue one embeddings REQUEST per requirement. A
 * fifteen-requirement posting would make fifteen metered round trips where the
 * spec asks for one batch (`embedFor` already splits at EMBEDDING_BATCH_SIZE).
 *
 * The RPC still runs once per requirement, because `match_documents` ranks
 * against a single query vector — that is a database call, not a spend.
 *
 * A failure anywhere — embedding or RPC — fails the WHOLE run as
 * `could_not_search`. Partial results are deliberately not offered: the caller
 * would have to decide what an un-searched requirement means, and the only
 * honest answer is "we do not know", which is not a coverage status. The scan
 * fails with AI_UNAVAILABLE instead, and nothing renders as a gap.
 */
export async function matchDocumentsForTexts(
  queryTexts: string[],
  matchCount = 5,
  step: EmbedStep = 'embed',
  applicationId: string | null = null,
): Promise<BatchMatchOutcome> {
  const user = await requireUser();
  if (queryTexts.length === 0) return { status: 'searched', outcomes: [] };

  try {
    const vectors = await embedFor(user.id, queryTexts, step, applicationId);
    if (vectors.length !== queryTexts.length) {
      // Fewer vectors than queries would silently mis-align the results with the
      // requirements they belong to, which is worse than not searching.
      return { status: 'could_not_search', error: 'embeddings did not cover every query' };
    }

    const outcomes: SearchedOutcome[] = [];
    for (const vector of vectors) {
      const rows = await matchDocumentsRpc(vector, matchCount);
      const chunks: MatchedChunk[] = rows.map((row) => ({
        id: row.id,
        careerItemId: row.career_item_id,
        content: row.content,
        similarity: row.similarity,
      }));
      logConsideredChunks(chunks);
      outcomes.push(
        chunks.length === 0 ? { status: 'found_nothing', chunks: [] } : { status: 'found', chunks },
      );
    }
    return { status: 'searched', outcomes };
  } catch (err) {
    // The one branch that must never be mistaken for "found nothing".
    return { status: 'could_not_search', error: err instanceof Error ? err.name : 'search failed' };
  }
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
