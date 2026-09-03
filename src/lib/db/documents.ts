import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { DocumentRow } from '@/lib/db/types';

/**
 * DAL for `documents` (the pgvector index). Policies: select / insert / DELETE
 * only — there is deliberately NO UPDATE policy, so re-embedding is
 * delete-then-insert, never upsert. Do not add an UPDATE policy to restore
 * upserts (CLAUDE.md, Embeddings).
 *
 * Every stored chunk's `content` is `title + "\n\n" + chunk text`, so an item
 * stays findable by its own name in every chunk — the title is STORED.
 *
 * Indexing happens AFTER the career-item write succeeds and must never be able
 * to fail that save.
 */

/** SPEC rule B9: <= 4,000 documents rows per user (v2.14). Single-sourced in `lib/limits.ts`. */
export { MAX_DOCUMENTS } from '@/lib/limits';

export async function countDocuments(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function listDocumentsForItem(careerItemId: string): Promise<DocumentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('documents')
    .select('id, user_id, career_item_id, content, created_at')
    .eq('career_item_id', careerItemId);
  if (error) throw error;
  return (data ?? []) as DocumentRow[];
}

export async function deleteDocumentsForItem(careerItemId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('documents').delete().eq('career_item_id', careerItemId);
  if (error) throw error;
}

export type NewDocument = {
  career_item_id: string;
  /** `title + "\n\n" + chunk text` */
  content: string;
  embedding: number[];
};

/**
 * Insert chunk rows. One statement, so a batch cannot land half-written.
 *
 * `userId` is stamped here from the caller's verified user, never taken from a
 * request body — the insert policy is `auth.uid() = user_id`.
 *
 * There is no upsert variant and there must not be one: this table has no UPDATE
 * policy, so RLS refuses one, and re-embedding is delete-then-insert by design
 * (CLAUDE.md, Embeddings).
 */
export async function insertDocuments(userId: string, rows: NewDocument[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from('documents')
    .insert(rows.map((row) => ({ ...row, user_id: userId })));
  if (error) throw error;
}

/** One row from `match_documents`, in the RPC's own snake_case shape. */
export type MatchDocumentsRow = {
  id: string;
  career_item_id: string;
  content: string;
  similarity: number;
};

/**
 * The `match_documents` RPC — vector search over the caller's own base.
 *
 * The call lives HERE and not in the retrieval gate, because this DAL owns
 * every route to the `documents` table and the RPC is one of them
 * (SPEC v1.9 Block A). `scripts/check.mjs` allows `.rpc(` only inside lib/db,
 * so a page or handler cannot reach the function directly.
 *
 * `match_documents` is `security invoker` and filters on `auth.uid()` INSIDE
 * the function, with RLS on `documents` as the fence underneath. Both must stay
 * true — making it `security definer` would turn the filter into the whole
 * access decision, and `npm run check` fails on `security definer` anywhere in
 * `supabase/`.
 *
 * Errors are thrown, never swallowed into an empty array: the caller has to be
 * able to tell "found nothing" apart from "could not search" (CLAUDE.md,
 * Retrieval — three outcomes, never two).
 *
 * CALL THIS THROUGH `lib/retrieval.ts`. That gate verifies the user, embeds the
 * query and maps the result onto the three-outcome `MatchOutcome`. Importing
 * this function directly gets you a raw row array and a THROW — and a thrown
 * error that reaches a scan as "no rows" is the exact failure the three-outcome
 * rule exists to prevent: a requirement reported as a "gap" because the search
 * never ran. A direct caller owns that mapping itself.
 */
export async function matchDocuments(
  queryEmbedding: number[],
  matchCount: number,
): Promise<MatchDocumentsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw error;
  return (data ?? []) as MatchDocumentsRow[];
}
