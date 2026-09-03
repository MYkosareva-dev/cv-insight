import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * THE service-role client. The ONE module in this repo allowed to read
 * `SUPABASE_SERVICE_ROLE_KEY` — `scripts/check.mjs` R10 fails the build on a
 * read anywhere else, so this is enforced, not merely documented.
 *
 * The service role BYPASSES RLS entirely. Every fence this app has — the
 * owner-scoped policies, `match_documents`' `auth.uid()` filter, the 404-not-403
 * rule — is off for anything built here. So:
 *
 *  - It is a FUNCTION, not a module-level constant: the key is never read at
 *    import or build time, only inside a request that has already established
 *    who is calling.
 *  - The caller must verify the user FIRST. Today that is
 *    `requireApiUser()` in DELETE /api/account, the sole consumer.
 *  - `persistSession` and `autoRefreshToken` are off, and this client has no
 *    cookie adapter, so it can never write a session cookie or be mistaken for
 *    the caller's own client.
 *
 * If a second consumer is ever proposed, that is an owner decision and a SPEC
 * amendment — not a convenience import.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    // Names the variable, never its value.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
