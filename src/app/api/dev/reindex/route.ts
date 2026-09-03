import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import {
  CHUNK_HARD_MAX_CHARS,
  CHUNK_MIN_CHARS,
  CHUNK_TARGET_CHARS,
  MAX_CHUNKS_PER_ITEM,
} from '@/lib/chunking';
import { listCareerItems } from '@/lib/db/careerItems';
import { countDocuments } from '@/lib/db/documents';
import { NotFoundError, apiErrorResponse } from '@/lib/errors';
import { reindexAllCareerItems } from '@/lib/retrieval';

/**
 * POST /api/dev/reindex — DEVELOPMENT ONLY. Re-embed the caller's whole career
 * base against the current chunker (SPEC v2.14, backlog p3-13).
 *
 * WHY IT EXISTS. Changing the chunker changes what a `documents` row IS. Rows
 * written by the previous chunker are one ~2,000-character blob per item, and a
 * blob resembles every requirement a little, so it wins comparisons it should
 * lose — which is the defect the new chunker fixes. A base that is not re-indexed
 * keeps the defect while the code claims to have fixed it, so this endpoint is
 * part of the fix and not a convenience.
 *
 * POST, not GET: it writes. Nothing in the app calls it — it is an instrument,
 * exposed exactly as `/api/dev/coverage-probe` is, and the same four properties
 * keep it from becoming a feature:
 *   1. `NODE_ENV === 'production'` answers 404 before anything else runs.
 *   2. `requireApiUser()` on the next line — it is a metered path (one embedding
 *      request per batch of chunks), so the gate rules apply as they do to /api/scan.
 *   3. The USER COMES FROM THE SESSION. There is no user-id parameter here, and
 *      `reindexAllCareerItems` takes none: it calls `getUser()` itself. Nothing a
 *      caller sends can point this at another account's base, and RLS scopes
 *      every read and write underneath regardless.
 *   4. Embeddings go through the `lib/retrieval.ts` gate and `documents` through
 *      its DAL. This file touches neither the connection nor `.from(`.
 *
 * SAFETY IS THE GATE'S, and it is the ordering rule this repo already fixed
 * once: every chunk of every item is embedded BEFORE the first row is deleted.
 * A failed embedding leaves the old index completely intact, because
 * delete-then-insert is the only write shape `documents` allows (no UPDATE
 * policy) and the old rows are the only working copy until the new vectors are
 * in hand.
 *
 * WHAT IT RETURNS: per-item before/after row counts, titles, and which of the
 * three write states each item ended in — never chunk text. Titles and counts
 * are what the development match log may print (CLAUDE.md, Retrieval); the
 * chunks themselves are the user's own resume content.
 *
 * IT RE-EMBEDS EVERY ITEM, including items whose `title` and `content` did not
 * change — which the edit path is forbidden to do ("re-embed only when title or
 * content changed", CLAUDE.md Embeddings, honoured at
 * `api/career/items/[id]/route.ts`). The rule is about spending a paid call for
 * an item that has not changed; here the item is unchanged and its CHUNK TEXTS
 * are not, because the chunker itself changed. Skipping unchanged items would
 * leave exactly the rows this endpoint exists to replace.
 */

/**
 * One embedding request per `EMBEDDING_BATCH_SIZE` chunks, sequentially, through
 * the gate's own packer. A 200-item base at the chunk cap is 4,000 chunks, i.e.
 * 63 requests — comfortably past this budget, which is stated rather than
 * hidden: a base that large should be re-indexed in slices (the route is
 * per-user and idempotent, so a second call after a timeout costs money but
 * corrupts nothing), and 120 s is the honest number for the bases this phase
 * actually has. Memory is the other bound — see `reindexAllCareerItems`. Both
 * are backlog p3-18.
 */
export const maxDuration = 120;

export async function POST() {
  try {
    if (process.env.NODE_ENV === 'production') throw new NotFoundError();
    await requireApiUser();

    const items = await listCareerItems();
    const documentsBefore = await countDocuments();

    const outcome = await reindexAllCareerItems(
      items.map((item) => ({ id: item.id, title: item.title, content: item.content })),
    );

    return NextResponse.json({
      chunker: {
        floor: CHUNK_MIN_CHARS,
        target: CHUNK_TARGET_CHARS,
        hardMax: CHUNK_HARD_MAX_CHARS,
        maxChunksPerItem: MAX_CHUNKS_PER_ITEM,
      },
      careerItems: items.length,
      documentsBefore,
      documentsAfter: await countDocuments(),
      chunksEmbedded: outcome.chunksEmbedded,
      embeddingRequests: outcome.embeddingRequests,
      /**
       * Two failure counts, never one. `unindexed` items lost their rows;
       * `oldRowsIntact` items kept the previous chunks because nothing was
       * deleted, and are still searchable. Collapsing them would make the
       * report say an item has no index when it has a working one.
       */
      unindexed: outcome.unindexed,
      oldRowsIntact: outcome.oldRowsIntact,
      items: outcome.items,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
