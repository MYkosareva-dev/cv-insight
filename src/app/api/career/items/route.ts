import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { CAREER, ERROR_MESSAGES } from '@/lib/copy';
import { MAX_CAREER_ITEMS, countCareerItems, insertCareerItems } from '@/lib/db/careerItems';
import { MAX_CHUNKS_PER_ITEM } from '@/lib/chunking';
import { MAX_DOCUMENTS, countDocuments } from '@/lib/db/documents';
import { ValidationError, apiErrorResponse } from '@/lib/errors';
import { indexCareerItems } from '@/lib/retrieval';
import { saveCareerItemsSchema } from '@/lib/validation';

/**
 * POST /api/career/items — SPEC Block D #2, US-1 steps 4–5.
 *
 * Saves the reviewed items and indexes them into `documents`.
 *
 * Order, and why each step is where it is:
 *
 *   1. requireApiUser() — 401 or a verified user, before the body is read and
 *      before any count query. Middleware excludes /api, so this is the only
 *      fence (S4). The returned `user.id` is the ONLY source of `user_id`;
 *      nothing in the body can name an owner.
 *   2. Zod on every field. The client may have EDITED these items in the review
 *      list, so nothing is trusted because it once came out of our own parse.
 *   3. Rule B9, checked against the user's stored counts and REJECTING THE BATCH
 *      WHOLE. Saving the first N that fit would be a partial write (rule B6) and
 *      would silently drop items the user explicitly chose to keep.
 *   4. Insert — one statement, so there is no half-saved batch.
 *   5. Index — AFTER the write has succeeded, and unable to fail it. An
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
    const items = parsed.data.items;

    await assertUnderB9(items.length);

    const saved = await insertCareerItems(
      user.id,
      // Everything created through this endpoint came from an import; the column
      // defaults to 'manual', which would quietly mislabel every imported item.
      items.map((item) => ({ ...item, source: 'import' as const })),
    );

    // Indexing is a side effect of the save and never a precondition for it.
    const index = await indexCareerItems(user.id, saved);

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
 * Rule B9's two ceilings: ≤200 `career_items` and ≤500 `documents` per user.
 *
 * Both are checked, and each has its OWN message. "Career base limit reached
 * (200 items)" is false when the document cap is what tripped, and reporting it
 * anyway would be the app describing a state that is not the one the user is in.
 * (Chunking is bounded so the document cap cannot be reached through the item
 * cap — see `lib/chunking.ts` — which makes this branch a safety net that must
 * fail loudly if those constants ever change.)
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
  // `documents >= MAX_DOCUMENTS` would let a 14-item save land 527 rows from a
  // starting point of 499 — a net that only catches an overshoot after it has
  // happened is not a net. Unreachable while MAX_CHUNKS_PER_ITEM holds the
  // relation (200 x 2 = 400), which is exactly why it must stay correct on its
  // own terms: if that constant ever changes, this is what fails first.
  if (documents + incoming * MAX_CHUNKS_PER_ITEM > MAX_DOCUMENTS) {
    throw new ValidationError(ERROR_MESSAGES.DOCUMENT_LIMIT);
  }
}
