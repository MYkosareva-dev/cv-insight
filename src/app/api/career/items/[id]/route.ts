import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { CAREER } from '@/lib/copy';
import { deleteCareerItem, getCareerItem, updateCareerItem } from '@/lib/db/careerItems';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { reindexCareerItem } from '@/lib/retrieval';
import { patchCareerItemSchema } from '@/lib/validation';

/**
 * PATCH / DELETE /api/career/items/[id] — SPEC Block D #3, edge cases D3 and S6.
 *
 * Both verbs start with requireApiUser(): middleware excludes /api by design, so
 * the handler is the only fence, and a signed-out caller gets 401 rather than a
 * redirect (auth rule 3, S4).
 *
 * Neither verb trusts the id as an ownership claim. RLS scopes every statement to
 * `auth.uid()`, so user B acting on user A's item matches zero rows and the
 * answer is 404 — never 403, which would confirm that the row exists (S6).
 */

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireApiUser();
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError(CAREER.updateFailed);
    }

    const parsed = patchCareerItemSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? CAREER.updateFailed);
    }
    const patch = parsed.data;

    /**
     * Read the STORED row first, for two reasons at once.
     *
     * It is how this handler knows whether a paid re-embed is needed: the
     * comparison must be made against what the database holds, never against an
     * "original" supplied by the client. A client-supplied baseline lets a caller
     * force embeddings (spend money) by claiming the text changed, or suppress
     * them (leave the index stale and wrong) by claiming it did not.
     *
     * It is also where S6 is answered: no row here means no such item for this
     * user, and the 404 happens before any write is attempted.
     */
    const before = await getCareerItem(id);
    if (!before) throw new NotFoundError();

    const after = await updateCareerItem(id, patch);
    // Lost the row between the two statements (a concurrent delete). Still 404.
    if (!after) throw new NotFoundError();

    /**
     * Re-embed ONLY when the embedded text actually changed. `type` and `period`
     * are not part of a chunk's content, so editing them must not trigger a paid
     * call — skipping the spend when nothing changed is an explicit rule
     * (CLAUDE.md, Embeddings), not an optimisation.
     */
    const textChanged = after.title !== before.title || after.content !== before.content;
    const reindexed = textChanged ? await reindexCareerItem(after.user_id, after) : true;

    revalidatePath('/career');

    return NextResponse.json({
      item: after,
      // D3: the item is saved either way. On failure the PREVIOUS chunks are
      // still in place and still searchable — which is exactly what this copy
      // promises, and is only true because the re-index embeds before deleting.
      indexWarning: reindexed ? null : CAREER.indexWarning,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireApiUser();
    const { id } = await params;

    /**
     * No embedding call belongs on this path. `documents.career_item_id` is
     * `on delete cascade`, so the item's chunks go with it in the same statement
     * — and cascades are not blocked by the deliberately absent DELETE policies.
     */
    const deleted = await deleteCareerItem(id);
    if (!deleted) throw new NotFoundError();

    revalidatePath('/career');
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
