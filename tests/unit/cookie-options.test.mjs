import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  AUTH_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  cappedMaxAge,
} from '../../src/lib/supabase/cookie-options.ts';

/**
 * `cappedMaxAge` is the three most consequential lines in the auth phase.
 *
 * `cookieOptions.maxAge` is DISCARDED by @supabase/ssr — it builds each write as
 * `{ ...DEFAULT, ...cookieOptions, maxAge: DEFAULT.maxAge }`
 * (cookies.js:325-329) — so this adapter-level clamp is the only thing standing
 * between the session and a 400-day cookie. Nothing else observes it: the
 * failure mode is a silent downgrade with every rule and test still green,
 * which is exactly why it is tested here and pinned by check.mjs R11d.
 */

const LIBRARY_DEFAULT = 400 * 24 * 60 * 60;

describe('cappedMaxAge — the clamp the library cannot discard', () => {
  test('clamps the library default down to 30 days', () => {
    const out = cappedMaxAge({ maxAge: LIBRARY_DEFAULT });
    assert.equal(out.maxAge, SESSION_MAX_AGE_SECONDS);
    assert.equal(out.maxAge, 2592000, '30 days in seconds');
    assert.ok(out.maxAge <= 2592000);
  });

  test('PRESERVES 0 — deletion goes through the same adapter', () => {
    // Math.min, not assignment. If this ever returns 2592000, sign-out and
    // account deletion silently stop clearing the session cookie.
    assert.equal(cappedMaxAge({ maxAge: 0 }).maxAge, 0);
  });

  test('leaves an absent maxAge alone, so a session cookie stays one', () => {
    assert.deepEqual(cappedMaxAge({ path: '/' }), { path: '/' });
    assert.equal(cappedMaxAge(undefined), undefined);
  });

  test('does not raise a shorter lifetime', () => {
    assert.equal(cappedMaxAge({ maxAge: 60 }).maxAge, 60);
    assert.equal(cappedMaxAge({ maxAge: SESSION_MAX_AGE_SECONDS }).maxAge, SESSION_MAX_AGE_SECONDS);
  });

  test('passes every other cookie attribute through untouched', () => {
    const out = cappedMaxAge({
      maxAge: LIBRARY_DEFAULT,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      domain: 'example.test',
    });
    assert.equal(out.path, '/');
    assert.equal(out.httpOnly, true);
    assert.equal(out.sameSite, 'lax');
    assert.equal(out.secure, true);
    assert.equal(out.domain, 'example.test');
  });

  test('does not mutate its input', () => {
    const input = { maxAge: LIBRARY_DEFAULT };
    cappedMaxAge(input);
    assert.equal(input.maxAge, LIBRARY_DEFAULT, 'the caller object must be untouched');
  });
});

describe('AUTH_COOKIE_OPTIONS', () => {
  test('is httpOnly and sameSite=lax', () => {
    assert.equal(AUTH_COOKIE_OPTIONS.httpOnly, true);
    assert.equal(AUTH_COOKIE_OPTIONS.sameSite, 'lax');
  });

  test('never exceeds the 30-day cap', () => {
    assert.ok(AUTH_COOKIE_OPTIONS.maxAge <= SESSION_MAX_AGE_SECONDS);
  });

  test('secure follows NODE_ENV — false under test/dev, true in production', () => {
    // Read at module load; the test runner is not production.
    assert.equal(AUTH_COOKIE_OPTIONS.secure, process.env.NODE_ENV === 'production');
  });
});
