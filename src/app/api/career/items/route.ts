import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { CAREER, ERROR_MESSAGES } from '@/lib/copy';
import {
  MAX_CAREER_ITEMS,
  countCareerItems,
  insertCareerItems,
  listItemSignatureFields,
} from '@/lib/db/careerItems';
import { MAX_CHUNKS_PER_ITEM } from '@/lib/chunking';
import { MAX_DOCUMENTS, countDocuments } from '@/lib/db/documents';
import { insertImport } from '@/lib/db/imports';
import { dedupeItems, itemSignature } from '@/lib/dedupe';
import { ValidationError, apiErrorResponse } from '@/lib/errors';
import { indexCareerItems } from '@/lib/retrieval';
import { saveCareerItemsSchema } from '@/lib/validation';

/**
 * POST /api/career/items — SPEC Block D #2, US-1 steps 4–5, extended in v2.11.
 *
 * Saves the reviewed items, records which import RUN produced them, and indexes
 * them into `documents`.
 *
 * Order, and why each step is where it is:
 *
 *   1. requireApiUser() — 401 or a verified user, before the body is read and
 *      before any count query. Middleware excludes /api, so this is the only
 *      fence (S4). The returned `user.id` is the ONLY source of `user_id`;
 *      nothing in the body can name an owner.
 *   2. Zod on every field. The client may have EDITED these items in the review
 *      list, so nothing is trusted because it once came out of our own parse.
 *   3. The duplicate guard, BEFORE the cap. Skipped items are never written, so
 *      they must not consume capacity either — refusing a batch for exceeding a
 *      limit it does not actually reach would be the app enforcing arithmetic it
 *      invented.
 *   4. Rule B9 on what SURVIVES, rejecting the batch WHOLE. Saving the first N
 *      that fit would be a partial write (rule B6) and would silently drop items
 *      the user explicitly chose to keep.
 *   5. The `imports` row — only when something survived. An import that
 *      contributed nothing new leaves no row behind, or re-importing one file
 *      five times accumulates five empty sources.
 *   6. Insert — one statement, so there is no half-saved batch.
 *   7. Index — AFTER the write has succeeded, and unable to fail it. An
 *      embedding failure returns a warning alongside the saved items
 *      (CLAUDE.md, Embeddings).
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError(CAREER.saveFailed);
    }

    const parsed = saveCareerItemsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? CAREER.saveFailed);
    }
    const { items, import: importMeta } = parsed.data;

    /**
     * v2.11: the owner imported the same text twice and got an exact second copy
     * of every item, because nothing compared an incoming item against what was
     * already stored.
     *
     * The comparison runs SERVER-side against the user's own rows. A
     * client-supplied "I already have these" list would let a caller suppress
     * real items or force duplicates straight back in.
     */
    const stored = await listItemSignatureFields();
    const { keep, skipped } = dedupeItems(items, stored.map(itemSignature));

    // Everything was already in the base. A 200 that says so, not an error: the
    // request was valid and the app simply had nothing to add. No import row,
    // because this run contributed nothing.
    if (keep.length === 0) {
      return NextResponse.json({
        items: [],
        indexed: 0,
        indexWarning: null,
        skipped,
        import: null,
      });
    }

    await assertUnderB9(keep.length);

    const importRow = importMeta
      ? await insertImport(user.id, {
          name: importMeta.name,
          target_role: importMeta.targetRole,
          source_kind: importMeta.sourceKind,
        })
      : null;

    const saved = await insertCareerItems(
      user.id,
      keep.map((item) => ({
        ...item,
        // Everything created through this endpoint came from an import; the
        // column defaults to 'manual', which would quietly mislabel every one.
        source: 'import' as const,
        import_id: importRow?.id ?? null,
      })),
    );

    // Indexing is a side effect of the save and never a precondition for it.
    const index = await indexCareerItems(saved);

    // US-1: "Saved items appear in the career base list without page reload."
    // /career is a Server Component, so the client refresh needs the cached
    // render invalidated — without this the list is stale until a hard reload.
    revalidatePath('/career');

    return NextResponse.json({
      items: saved,
      /**
       * Three states, not two, for the same reason retrieval has three: "saved
       * and searchable", "saved but not searchable yet", and — because a batch
       * fails per item — "partly searchable". A single boolean would report the
       * third as one of the first two.
       */
      indexed: index.indexed,
      indexWarning: indexWarningFor(saved.length, index.failed),
      skipped,
      import: importRow,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

/**
 * The warning copy for however much of the batch failed to index.
 *
 * Three outcomes, not two — the same shape as the three retrieval outcomes and
 * for the same reason: "saved and searchable", "saved but not searchable", and
 * "partly searchable" are genuinely different states, and a boolean would have to
 * report one of them as another.
 */
function indexWarningFor(savedCount: number, failedCount: number): string | null {
  if (failedCount === 0) return null;
  if (failedCount < savedCount) return CAREER.indexWarningPartial(failedCount);
  // Everything failed. SPEC's verbatim D3 string is singular, so it is used only
  // where it is actually true.
  return savedCount === 1 ? CAREER.indexWarning : CAREER.indexWarningBulk(savedCount);
}

/**
 * Rule B9's two ceilings: ≤200 `career_items` and ≤4,000 `documents` per user (v2.14).
 *
 * Both are checked, and each has its OWN message. "Career base limit reached
 * (200 items)" is false when the document cap is what tripped, and reporting it
 * anyway would be the app describing a state that is not the one the user is in.
 * (Chunking is bounded so the document cap cannot be reached through the item
 * cap — see `lib/chunking.ts` — which makes this branch a safety net that must
 * fail loudly if those constants ever change.)
 *
 * `incoming` is the count AFTER de-duplication, because a skipped item is never
 * written and so never consumes capacity.
 *
 * The count-then-insert race is accepted, deliberately and in the same spirit as
 * edge case D6: this is a single-user tool, two concurrent saves by one person
 * are already unusual, and the cost of overshooting by one batch is a slightly
 * larger career base — not data loss and not a security boundary. A transaction
 * or an advisory lock would be real machinery guarding nothing.
 */
async function assertUnderB9(incoming: number): Promise<void> {
  const [items, documents] = await Promise.all([countCareerItems(), countDocuments()]);

  if (items + incoming > MAX_CAREER_ITEMS) {
    throw new ValidationError(CAREER.limitReached);
  }
  // Accounts for what this batch will ADD, not just what is already stored.
  // `documents >= MAX_DOCUMENTS` would let a 14-item save land past the ceiling
  // from a starting point just under it — a net that only catches an overshoot
  // after it has happened is not a net. Unreachable while MAX_CHUNKS_PER_ITEM
  // holds the relation (v2.14: 200 x 20 = 4,000 = MAX_DOCUMENTS), which is
  // exactly why it must stay correct on its own terms: if either constant ever
  // changes, this is what fails first.
  if (documents + incoming * MAX_CHUNKS_PER_ITEM > MAX_DOCUMENTS) {
    throw new ValidationError(ERROR_MESSAGES.DOCUMENT_LIMIT);
  }
}
