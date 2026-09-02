import 'server-only';

import type { User } from '@supabase/supabase-js';

import { UnauthorizedError } from '@/lib/errors';
import { getUser } from '@/lib/supabase/server';

/**
 * The API-side twin of the two model-call gates.
 *
 * `src/middleware.ts` deliberately excludes `/api`, because a route handler must
 * answer 401 JSON rather than redirect to an HTML page. That means middleware
 * protects no endpoint: every route handler verifies the session itself, and
 * this is the one helper that does it.
 *
 * Uses `getUser()` — the only valid server-side session check (CLAUDE.md
 * Authentication rule 2). Throws the SHARED UnauthorizedError, so a handler's
 * error mapping turns it into 401 UNAUTHORIZED per Block D.
 *
 * A signed-out visitor must not be able to view, create, edit or delete any
 * data, including via direct `/api/*` calls (auth rule 3).
 */
export async function requireApiUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
