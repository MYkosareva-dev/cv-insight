import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The middleware matcher decides which requests reach the auth fence at all, so
 * a mistake in it is invisible: nothing errors, the fence simply is not there.
 *
 * The pattern is EXTRACTED FROM src/middleware.ts rather than copied here. A
 * copy would keep passing after someone edited the real one — which is the only
 * failure mode this test exists to catch.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');

function shippedMatcher() {
  const matcherBlock = SOURCE.slice(SOURCE.indexOf('matcher: ['));
  const pattern = matcherBlock.match(/'(\/\(\(\?![\s\S]*?)'/)?.[1];
  assert.ok(pattern, 'could not find the matcher pattern in src/middleware.ts');
  // Count entries by their distinctive opening, not by the first ']' — the
  // pattern itself contains ']' (from [^/] and [.]), which made an earlier
  // version of this guard find the wrong array close.
  const entries = SOURCE.match(/'\/\(\(\?!/g) ?? [];
  assert.equal(
    entries.length,
    1,
    'matcher has more than one entry — this test only covers the first',
  );
  return new RegExp(`^${pattern}$`);
}

const RUNS = true;
const BYPASSED = false;

/**
 * The first four were live bypasses before this was anchored: an unanchored
 * `api` also excluded /apifoo, `privacy` excluded /privacyleak, and the
 * extension alternative excluded ANY path ending in an image suffix — so
 * /applications/x.png skipped the fence entirely.
 */
const EXPECTATIONS = [
  ['/applications/x.png', RUNS],
  ['/applications/abc.svg', RUNS],
  ['/apifoo', RUNS],
  ['/privacyleak', RUNS],
  // v2.24: the same lookalike, one page later. `impressum` unanchored would
  // also excuse /impressumleak from the fence.
  ['/impressumleak', RUNS],
  // v3.0: and once more for /pricing.
  ['/pricingleak', RUNS],

  ['/', RUNS],
  ['/scan', RUNS],
  ['/career', RUNS],
  ['/settings', RUNS],
  ['/applications', RUNS],
  ['/applications/9f2a6c1e-4b7d-4f7a-9e2b-3c8d1a5e7f90', RUNS],
  ['/login', RUNS],
  ['/signup', RUNS],

  // Route handlers answer 401 JSON themselves; a redirect to HTML would be wrong.
  ['/api/account', BYPASSED],
  ['/api', BYPASSED],
  // v3.0: Stripe carries no session, so the webhook must never meet the
  // fence. The existing `api` exclusion is the mechanism — no pattern of its own,
  // which would be dead regex beside it. Its fence is the signature.
  ['/api/stripe/webhook', BYPASSED],
  // The two member billing routes are route handlers too: they verify the
  // session themselves and answer 401 JSON.
  ['/api/billing/checkout', BYPASSED],
  ['/api/billing/portal', BYPASSED],
  // Public page — no getUser() round trip. EXACT path only: /privacy has no
  // subtree, and a prefix exclusion would put a future child outside the fence.
  ['/privacy', BYPASSED],
  ['/privacy/export', RUNS],
  ['/privacy/dpa', RUNS],
  // The Impressum is public for the same reason and on the same terms (v2.24).
  ['/impressum', BYPASSED],
  ['/impressum/contact', RUNS],
  // /pricing is public on the same terms (v3.0): the page, never a subtree.
  ['/pricing', BYPASSED],
  ['/pricing/checkout', RUNS],
  // Real static assets.
  ['/favicon.ico', BYPASSED],
  ['/logo.png', BYPASSED],
  ['/_next/static/chunk.js', BYPASSED],
  ['/_next/image', BYPASSED],
];

describe('middleware matcher — the fence must cover every member route', () => {
  const matcher = shippedMatcher();

  for (const [pathname, shouldRun] of EXPECTATIONS) {
    test(`${shouldRun ? 'runs on' : 'skips'} ${pathname}`, () => {
      assert.equal(
        matcher.test(pathname),
        shouldRun,
        shouldRun
          ? `${pathname} must reach middleware — it is a member route or an unanchored lookalike`
          : `${pathname} must not reach middleware`,
      );
    });
  }

  test('every exclusion is anchored to a path segment or the end of the string', () => {
    const pattern = matcher.source;
    for (const bare of [
      'api|',
      'privacy|',
      'privacy(?:/|$)|',
      'impressum|',
      'impressum(?:/|$)|',
      'pricing|',
      'pricing(?:/|$)|',
    ]) {
      assert.ok(
        !pattern.includes(bare),
        `"${bare.slice(0, -1)}" is excluded without a segment anchor — it would also match a prefix`,
      );
    }
  });
});
