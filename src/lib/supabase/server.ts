import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for Server Components, route handlers and Server Actions.
 * Carries the user's session cookies, so RLS enforces ownership on every query.
 *
 * The ONLY valid session check on the server is `supabase.auth.getUser()`
 * (CLAUDE.md, Authentication rule 2). `getSession()` does not validate the
 * token and must never gate access.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, which cannot write cookies.
            // Safe to ignore: src/middleware.ts refreshes the session cookie
            // on every request.
          }
        },
      },
    },
  );
}

/**
 * The verified current user, or null. Every gate and every DAL calls this.
 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
