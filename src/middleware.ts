import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Public routes — everything else under the matcher requires a session. */
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
  // Everything except static assets and API routes. Route handlers do their own
  // getUser() check and must answer 401 JSON, not a redirect to an HTML page.
  matcher: ['/((?!api|_next/static|_next/image|favicon[.]ico|.*[.](?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
