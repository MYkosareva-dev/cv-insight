import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_COOKIE_OPTIONS } from '@/lib/supabase/cookie-options';

/**
 * Public routes — everything else under the matcher requires a session.
 * `/privacy` is also excluded from the matcher below, so this entry is
 * belt-and-braces: if the matcher is ever widened, the public page must still
 * not redirect.
 */
const PUBLIC_PATHS = ['/login', '/signup', '/privacy'];
/** Signed-in users are bounced away from these. */
const AUTH_PATHS = ['/login', '/signup'];

function startsWithPath(pathname: string, paths: readonly string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(): this call is what
  // refreshes the session cookie, and anything in between causes random logouts.
  // getUser() is the only valid server-side session check (CLAUDE.md auth rule 2).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /**
   * A bare NextResponse.redirect() would DISCARD everything getUser() just
   * wrote — including a rotated refresh token. The old token is already spent
   * on the Auth server, so dropping the new one leaves the browser holding a
   * dead credential and the user is logged out at random. It does not reproduce
   * locally: a dev session rarely lives long enough to cross the refresh
   * boundary. Every redirect out of this function carries the cookies.
   */
  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    const response = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    return response;
  };

  if (!user && !startsWithPath(pathname, PUBLIC_PATHS)) {
    return redirectTo('/login');
  }

  if (user && startsWithPath(pathname, AUTH_PATHS)) {
    return redirectTo('/scan');
  }

  // Returned as-is so the refreshed cookies reach the browser — the same
  // guarantee redirectTo() makes for the two branches above.
  return supabaseResponse;
}

export const config = {
  // Excluded, deliberately:
  //  - `api`     — route handlers verify the session themselves via
  //                lib/auth/requireApiUser() and must answer 401 JSON, never a
  //                redirect to an HTML page.
  //  - `privacy` — a public static page; running getUser() on it would buy a
  //                pointless auth round trip and force the route dynamic
  //                (SPEC Block F). Excluded as an EXACT path, not a subtree:
  //                `api` keeps `(?:/|$)` because it genuinely has children,
  //                but /privacy has none, and a prefix exclusion would put a
  //                future /privacy/export outside the fence.
  //  - static assets.
  // Dots are written [.] so a later edit cannot silently un-escape them into
  // "any character".
  // Every exclusion is ANCHORED to a path segment. An unanchored `api` also
  // excluded /apifoo, `privacy` excluded /privacyleak, and the trailing
  // extension alternative excluded ANY path ending in an image suffix — so
  // /applications/x.png skipped the fence entirely. The (app) layout caught
  // those, but a second net is not the boundary.
  matcher: [
    '/((?!api(?:/|$)|privacy$|_next/static(?:/|$)|_next/image(?:/|$)|favicon[.]ico$|[^/]+[.](?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)',
  ],
};
