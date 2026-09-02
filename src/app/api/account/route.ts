import 'server-only';

import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { requireApiUser } from '@/lib/auth/requireApiUser';
import { ERROR_CODES, SETTINGS } from '@/lib/copy';
import { isApiError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/account — right to erasure (SPEC Block D #10, US-6, GDPR).
 *
 * THE ONLY SERVICE-ROLE CONSUMER IN THE REPO. `SUPABASE_SERVICE_ROLE_KEY` is
 * read here and nowhere else (CLAUDE.md, Secrets), because deleting an auth
 * user is an admin operation the anon key cannot perform. The client is built
 * inside the handler rather than at module scope, so the key is never read
 * during a build or an import of this file.
 *
 * Order matters and is not negotiable:
 *   1. requireApiUser() — a verified user via getUser(), or 401. The service
 *      role bypasses RLS entirely, so nothing may touch it before the caller is
 *      known.
 *   2. Delete ONLY that caller's own id. The id comes from the verified session,
 *      never from the request body — there is no body, deliberately, so there is
 *      no id for a caller to forge.
 *   3. Owned rows in all six tables go with it via FK ON DELETE CASCADE.
 *      Cascades run as the table owner with RLS bypassed, so the missing DELETE
 *      policies do not block them.
 *   4. Clear the session cookies locally. Scope 'local' because the user this
 *      token belongs to no longer exists — a round trip to the Auth server would
 *      only fail on an already-dead token.
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

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    // Never name the variable's value, only the fact that it is unset.
    console.error('[account] service-role key is not configured; deletion refused');
    return NextResponse.json(
      { error: { code: ERROR_CODES.SERVER_ERROR, message: SETTINGS.deleteFailed } },
      { status: 500 },
    );
  }

  const admin = createServiceRoleClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[account] deleteUser failed', error.message);
    return NextResponse.json(
      { error: { code: ERROR_CODES.SERVER_ERROR, message: SETTINGS.deleteFailed } },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });

  return new NextResponse(null, { status: 204 });
}
