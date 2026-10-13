/**
 * Which paths the middleware lets a visitor through, and which it bounces a
 * member away from. Pure, so `tests/unit/middleware-matcher.test.mjs` can pin
 * the decision itself rather than a copy of it.
 *
 * Public routes — everything else under the matcher requires a session.
 * `/privacy` and `/impressum` are also excluded from the matcher, so their
 * entries are belt-and-braces: if the matcher is ever widened, the public pages
 * must still not redirect. Both exist to be readable by someone with no account
 * (v2.24) — an Impressum a visitor is redirected away from does not identify
 * anyone, and a privacy statement you must sign up to read is the same defect.
 */
export const PUBLIC_PATHS: readonly string[] = ['/login', '/signup', '/privacy', '/impressum'];

/**
 * Public as the page ONLY, never as a subtree (v3.0d). `/pricing` is the one
 * public page the middleware RUNS on, because it is the one public page that
 * reads the session: the page's `getUser()` can refresh the session, and only
 * the middleware can write the rotated cookie back. Being inside the matcher,
 * a prefix rule here would let a future `/pricing/<anything>` past the fence,
 * so the match is exact.
 */
export const PUBLIC_EXACT_PATHS: readonly string[] = ['/pricing'];

/** Signed-in users are bounced away from these. */
export const AUTH_PATHS: readonly string[] = ['/login', '/signup'];

function startsWithPath(pathname: string, paths: readonly string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** A visitor on this path is NOT redirected to /login. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT_PATHS.includes(pathname) || startsWithPath(pathname, PUBLIC_PATHS);
}

/** A member on this path IS redirected to /scan. */
export function isAuthPath(pathname: string): boolean {
  return startsWithPath(pathname, AUTH_PATHS);
}
