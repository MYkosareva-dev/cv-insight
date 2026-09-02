import 'server-only';

import type { User } from '@supabase/supabase-js';

import { UnauthorizedError } from '@/lib/errors';
import { getUser } from '@/lib/supabase/server';
import { type ConnectionResult, createEmbeddings } from '@/lib/openrouter/server';

/**
 * GATE — embeddings + vector search. Phase 0 stub.
 *
 * Every embedding call (indexing, matching, re-scoring) goes through here, and
 * the gate calls getUser() FIRST. Unlike `lib/chat.ts` this also guards spends
 * that happen as a SIDE EFFECT of saving a career item, which is why the two
 * gates are separate files (CLAUDE.md, "AI model calls").
 *
 * Retrieved chunks are DATA: they go into a model call inside a tagged block,
 * are never stored in prompts, never echoed verbatim to the client, and never
 * appended to any transcript.
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

/** Embed texts for the verified user. Batched at EMBEDDING_BATCH_SIZE. */
export async function embedTexts(_texts: string[]): Promise<ConnectionResult<number[][]>> {
  await requireUser();
  void createEmbeddings; // wired up in the AI-pipeline phase
  throw new Error('Retrieval gate is a phase-0 stub — not implemented yet.');
}

/**
 * Vector search over the caller's own base via the `match_documents` RPC
 * (security invoker; filters on auth.uid() inside the function, with RLS on
 * `documents` as the fence underneath).
 *
 * In development every run logs one line per considered chunk — career item
 * title and similarity, including below-threshold ones. This is an acceptance
 * mechanism, not a convenience. Chunk TEXT is never printed, in either mode.
 */
export async function matchDocuments(
  _queryText: string,
  _matchCount = 5,
): Promise<MatchOutcome> {
  await requireUser();
  throw new Error('Retrieval gate is a phase-0 stub — not implemented yet.');
}
