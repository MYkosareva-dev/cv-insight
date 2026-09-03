import 'server-only';

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { RESULT } from '@/lib/copy';
import { updateApplication } from '@/lib/db/applications';
import { NotFoundError, ValidationError, apiErrorResponse } from '@/lib/errors';
import { patchApplicationSchema } from '@/lib/validation';

/**
 * PATCH /api/applications/[id] — SPEC Block D #8: status and notes.
 *
 * The status Select on `/applications` and the Notes box on the result screen
 * both land here. Nothing about the SCAN is patchable through this endpoint —
 * `match_score` and `coverage` are written by /api/scan alone, so a caller
 * cannot hand the app a score it never measured.
 *
 * Order: verified user → the id's SHAPE → the body → the update.
 *
 *   - `requireApiUser()` is line one, before the body is read: middleware
 *     excludes /api, so this is the only fence (auth rule 3, S4).
 *   - The route segment is parsed as a UUID before it reaches Postgres. Without
 *     it, `/api/applications/nope` is `invalid input syntax for type uuid`,
 *     which surfaces as a 500 where Block D mandates 404 (docs/backlog.md M-3,
 *     raised against the career endpoints and closed here rather than repeated).
 *   - A miss is 404 whether the row is absent or owned by someone else. RLS
 *     scopes the UPDATE to auth.uid(), so user B patching user A's row matches
 *     zero rows (S6); a 403 would confirm that someone else's row exists.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();

    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new NotFoundError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError(RESULT.notesFailed);
    }

    const parsed = patchApplicationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? RESULT.notesFailed);
    }

    const application = await updateApplication(id, parsed.data);
    if (!application) throw new NotFoundError();

    // Both screens that write here are Server Components, so their cached
    // render has to be invalidated or the saved value only appears after a hard
    // reload.
    revalidatePath('/applications');
    revalidatePath(`/applications/${id}`);

    return NextResponse.json({ application });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
