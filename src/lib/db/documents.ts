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

/** SPEC rule B9: <= 500 documents rows per user. */
export const MAX_DOCUMENTS = 500;

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

export async function insertDocuments(_userId: string, _rows: NewDocument[]): Promise<void> {
  throw new Error('insertDocuments is a phase-0 stub — implemented with the indexing phase.');
}

/** RPC wrapper lives in lib/retrieval.ts (the gate), not here. */
