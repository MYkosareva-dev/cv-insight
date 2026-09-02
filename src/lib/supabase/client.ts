'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. Reads only the two public variables — the anon key is the
 * ONLY key that may reach the browser (SPEC Block F, Security).
 *
 * It never queries app tables: all data access goes through the DALs in
 * `lib/db/` on the server.
 *
 * Note on scope: sign in / sign up / sign out do NOT use this client. They run
 * as Server Actions (`lib/auth/actions.ts`) so the Zod parse is a real gate —
 * a Server Action is a public endpoint, and a client-side check validates
 * nothing — and so the cookie write happens where it works. This client is for
 * a client component that needs the user's own session state without a round
 * trip; SPEC Block A mandates it exists.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
