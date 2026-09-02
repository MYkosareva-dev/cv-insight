import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  if (!user && !startsWithPath(pathname, PUBLIC_PATHS)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && startsWithPath(pathname, AUTH_PATHS)) {
    const url = request.nextUrl.clone();
    url.pathname = '/scan';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Must be returned as-is so the refreshed cookies reach the browser.
  return supabaseResponse;
}

export const config = {
  // Excluded, deliberately:
  //  - `api`     — route handlers verify the session themselves via
  //                lib/auth/requireApiUser() and must answer 401 JSON, never a
  //                redirect to an HTML page.
  //  - `privacy` — a public static page; running getUser() on it would buy a
  //                pointless auth round trip and force the route dynamic
  //                (SPEC Block F, Route protection).
  //  - static assets.
  // Dots are written [.] so a later edit cannot silently un-escape them into
  // "any character".
  matcher: [
    '/((?!api|privacy|_next/static|_next/image|favicon[.]ico|.*[.](?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
