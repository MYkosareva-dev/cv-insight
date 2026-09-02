import 'server-only';

import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { ERROR_CODES, SETTINGS } from '@/lib/copy';
import { isApiError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/account — right to erasure (SPEC Block D #10, US-6, GDPR).
 *
 * The only consumer of the service-role client. Order is not negotiable:
 *
 *   1. requireApiUser() — a verified user via getUser(), or 401. The service
 *      role bypasses RLS entirely, so nothing may touch it before the caller is
 *      known.
 *   2. Delete ONLY that caller's own id. The id comes from the verified
 *      session; this handler takes no Request parameter at all, so there is no
 *      body and no id for a caller to forge.
 *   3. HARD delete. `deleteUser(id)` defaults to `shouldSoftDelete: false` and
 *      it must stay that way — a soft delete keeps the auth.users row, fires no
 *      cascades, and would silently turn GDPR erasure into a no-op.
 *   4. Owned rows in all six tables follow via FK ON DELETE CASCADE. Cascades
 *      run as the table owner with RLS bypassed, so the deliberately missing
 *      DELETE policies do not block them. (Adding `force row level security` to
 *      a future migration WOULD break this.)
 *   5. Clear the session cookies — best effort, see below.
 *
 * Middleware deliberately excludes /api, so this handler owns its own auth
 * check and answers 401 JSON rather than redirecting to an HTML page.
 */
export async function DELETE() {
  let userId: string;
  try {
    const user = await requireApiUser();
    userId = user.id;
  } catch (err) {
    if (isApiError(err)) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error('[account] admin client unavailable', (err as Error).message);
    return NextResponse.json(
      { error: { code: ERROR_CODES.SERVER_ERROR, message: SETTINGS.deleteFailed } },
      { status: 500 },
    );
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[account] deleteUser failed', error.message);
    return NextResponse.json(
      { error: { code: ERROR_CODES.SERVER_ERROR, message: SETTINGS.deleteFailed } },
      { status: 500 },
    );
  }

  /**
   * BEST EFFORT, and deliberately after the point of no return. The account is
   * already gone; `signOut` still round-trips to /logout even with
   * scope 'local', and a network failure there must not surface to the user as
   * "Deletion failed" for an account that no longer exists. auth-js clears the
   * local session on every non-'others' path regardless of what the request
   * returns, so the cookies come off either way — and even if they did not,
   * getUser() on the next request returns null and middleware bounces to
   * /login.
   */
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.error('[account] post-deletion signOut failed; cookies expire on next request', err);
  }

  return new NextResponse(null, { status: 204 });
}
