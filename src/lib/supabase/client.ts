'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. Reads only the two public variables — the anon key is the
 * ONLY key that may reach the browser (SPEC Block F, Security).
 *
 * Used for auth forms (sign in / sign up / sign out). It never queries app
 * tables: all data access goes through the DALs in `lib/db/` on the server.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
