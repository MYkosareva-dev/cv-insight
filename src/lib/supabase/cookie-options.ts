import type { CookieOptions } from '@supabase/ssr';

/**
 * Cookie options for EVERY `createServerClient` call site (SPEC Block F,
 * Sessions). One constant, because the middleware writes these cookies far more
 * often than any action does and the two must not drift.
 *
 * The library's own defaults are `{ path, sameSite: 'lax', httpOnly: false,
 * maxAge: 400 days }` and no `secure` — see
 * node_modules/@supabase/ssr/dist/main/utils/constants.js. That default assumes
 * a BROWSER client reads the session out of `document.cookie`; this app has no
 * browser client, so nothing needs JS access and the tokens can be closed off.
 *
 *  - httpOnly: the access and refresh tokens stop being readable by any script
 *    on the page. On a personal-data app that is the difference between an XSS
 *    being a bug and an XSS being an account takeover.
 *  - secure in production: without it the session cookie can be emitted over,
 *    and overwritten via, a plaintext request to the same host. Off in dev
 *    because localhost is http and the cookie would simply never be set.
 *  - sameSite 'lax': keeps the cookie off cross-site requests, which is one of
 *    the two things making DELETE /api/account un-forgeable.
 *  - maxAge 30 days, replacing the library's 400. Middleware rewrites the cookie
 *    on every request, so this is a SLIDING 30-day inactivity window rather than
 *    a hard expiry: an active job search keeps working, an abandoned session
 *    stops being a credential. The access token inside still expires hourly and
 *    rotates independently. 400 days of a resurrectable session is not
 *    data-minimisation on an app holding CVs.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_MAX_AGE_SECONDS,
};

/**
 * Caps a cookie's lifetime at SESSION_MAX_AGE_SECONDS, for use inside a
 * `setAll` adapter.
 *
 * This exists because `cookieOptions.maxAge` ALONE DOES NOT WORK. @supabase/ssr
 * builds its write options as
 *   `{ ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge: DEFAULT.maxAge }`
 * (node_modules/@supabase/ssr/dist/main/cookies.js:325-329) — our value is
 * spread in and then overwritten by the library's own 400 days. Verified
 * empirically: with `maxAge` in AUTH_COOKIE_OPTIONS the browser still received
 * `Max-Age=34560000`. The only place left that we control is the adapter, so
 * the cap is applied there.
 *
 * `Math.min` and not an assignment, because DELETION passes `maxAge: 0` through
 * the same path: `Math.min(0, cap)` is 0, so sign-out still clears the cookie.
 * An unset maxAge (a session cookie) is left alone.
 */
export function cappedMaxAge(options: { maxAge?: number } | undefined) {
  if (!options || options.maxAge === undefined) return options;
  return { ...options, maxAge: Math.min(options.maxAge, SESSION_MAX_AGE_SECONDS) };
}
