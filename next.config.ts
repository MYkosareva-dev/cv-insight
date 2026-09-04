import type { NextConfig } from 'next';

/**
 * Content-Security-Policy, built from what this app ACTUALLY loads (v2.25, gate
 * findings `ns-2` / `vs-5`) rather than from a template.
 *
 * The inventory that produced it, each item verified against the tree:
 *
 *   - **No external scripts, styles, fonts or images.** There is no CDN, no
 *     analytics package, no font host, and no `public/` directory. Tailwind and
 *     `tw-animate-css` are bundled at build time. The only external host named
 *     anywhere in `src/` is `openrouter.ai`, and that is reached from the server
 *     inside `lib/openrouter/server.ts` — never from a browser.
 *   - **The browser never contacts Supabase.** `createBrowserClient` is banned
 *     and R11 enforces it, so the session is written server-side and every
 *     database read happens in a Server Component or a route handler. This is
 *     why `connect-src` is `'self'` and not a Supabase origin — a rare and
 *     genuinely tight position that this app earns by its auth design.
 *   - **Every client fetch is same-origin `/api/*`.** All seven of them.
 *
 * WHY `script-src` CARRIES `'unsafe-inline'`, stated plainly rather than buried:
 * Next.js App Router streams the RSC payload through inline `<script>` tags, so
 * a policy without either a nonce or `'unsafe-inline'` blocks hydration and the
 * app renders as dead HTML. This was MEASURED, not assumed — see
 * `docs/eval/csp-verification.md`, which records the strict policy being tried
 * first and the exact violations it produced.
 *
 * The nonce alternative was rejected for a specific reason, not out of
 * convenience. A nonce must be minted per request in middleware, and `/privacy`
 * and `/impressum` are deliberately EXCLUDED from the middleware matcher so they
 * stay static — the two pages a visitor with no account reads. Nonces would
 * either leave those two without one (blocked scripts) or drag them into the
 * matcher and make them dynamic, undoing a deliberate decision and buying an
 * auth round trip on a public page. `'unsafe-inline'` in `script-src` is the
 * honest cost of that trade.
 *
 * What the policy still buys, and it is not nothing — the concrete exposure
 * `ns-2` named was clickjacking on `/settings`, whose dialog fronts an
 * irreversible account deletion:
 *   - `frame-ancestors 'none'` closes that completely;
 *   - `object-src 'none'` and `base-uri 'self'` close plugin and base-tag
 *     injection;
 *   - `form-action 'self'` stops an injected form posting credentials out;
 *   - no external origin is permitted for ANY resource type, so an injected
 *     `<script src>` pointing anywhere off-origin fails regardless of
 *     `'unsafe-inline'`, which only permits inline code.
 *
 * `style-src` carries `'unsafe-inline'` because Radix (the dialog, tabs and
 * select primitives) sets inline style attributes for positioning and animation.
 * Style injection is a markedly weaker vector than script injection.
 */
/**
 * `'unsafe-eval'`, IN DEVELOPMENT ONLY — and never in a deployed build.
 *
 * React's development build calls `eval()` for debugging features (reconstructing
 * call stacks across environments). Under a policy without `'unsafe-eval'` it
 * logs `eval() is not supported in this environment`, and Next's dev overlay then
 * POSTs to `/__nextjs_original-stack-frames` to symbolicate it — which is how
 * this was found: two `auth.spec.ts` cases assert that a client-side validation
 * failure costs NO round trip, and that dev-tools POST made them fail while the
 * validation itself was working perfectly.
 *
 * The production build needs none of it, which is the whole reason this can be
 * conditional rather than a permanent relaxation: `docs/eval/csp-verification.md`
 * records five pages loading clean under the production policy, with hydration
 * proved positively. `next dev` sets NODE_ENV=development and `next build` sets
 * production, so the deployed policy never carries this.
 *
 * A CSP that only exists in production is a CSP nobody tests until it breaks in
 * production — the failure this whole change set out to avoid. Keeping the
 * policy on in development, with exactly the one directive development needs,
 * is what lets the e2e suite run against it every time.
 */
const DEV_ONLY_SCRIPT_SRC = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV_ONLY_SCRIPT_SRC}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Every client fetch is a relative /api/* path; nothing calls out.
  "connect-src 'self'",
  "form-action 'self'",
  // Clickjacking on the account-deletion dialog is the concrete exposure.
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

/**
 * Sent on every response. `X-Frame-Options` duplicates `frame-ancestors` on
 * purpose — the CSP directive is the modern one and the header is what older
 * agents honour, and disagreeing with itself is the one thing this pair must not
 * do, so both say the same thing.
 *
 * HSTS is deliberately ABSENT: Vercel serves it on its own domains, and a
 * `max-age` set here would also apply to any future custom domain before anyone
 * had decided that domain should be HTTPS-only forever. That is a decision to
 * take on purpose, not to inherit from a config file.
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // The app uses none of these. Naming them denies them to anything injected.
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `next dev` otherwise APPENDS a managed block to CLAUDE.md on every start
  // (node_modules/next/dist/server/lib/generate-agent-files.js). CLAUDE.md is
  // this project's rule book and sits above SPEC.md in the hierarchy — a build
  // tool must not be able to write into it, and a future Next release changing
  // that text would silently change the agent's instructions. Off, so the file
  // has exactly one author.
  agentRules: false,
  typescript: {
    // The build must fail on type errors — Block H, DoD #1.
    ignoreBuildErrors: false,
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
