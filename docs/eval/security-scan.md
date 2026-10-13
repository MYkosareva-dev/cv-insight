# Security scan — `/security-scan`

- **Date:** 2026-10-13
- **Commit scanned:** `5ad88e4120c5208ac4eb30462759636e33fe4d22` (`main`, merge of PR #6 `feature/dependency-patch`)
- **Mode:** findings only. Nothing was fixed, upgraded or reconfigured by this run; every finding below is for the owner to decide.
- **Out of scope by rule:** every `.env*` file, including the tracked `.env.example`, was excluded from every read and search.

## 1. Stack detection and tool selection

| Signal | Present | Consequence |
|---|---|---|
| `package.json` / `package-lock.json` | yes (Next.js 16, React 19, Node ≥ 22.18) | JavaScript/TypeScript scans apply |
| `requirements.txt` / `pyproject.toml` | no | Python scanners not applicable |
| `Dockerfile` / `docker-compose.*` | no | container scanning not applicable |
| `*.tf`, Kubernetes manifests | no | IaC scanning not applicable; `vercel.json` holds only `regions: ["fra1"]` |
| `supabase/migrations/*.sql` (001–007) | yes | SQL/RLS review applies |

Scanner availability on this machine:

| Tool | Available | Used instead |
|---|---|---|
| gitleaks, trufflehog | no | regex secret scan over tracked files and full git history (§4) |
| semgrep, snyk, osv-scanner | no | `npm audit` (§2) plus targeted pattern review (§5) |
| trivy, bandit | no | not applicable to this stack |
| `npm audit` (npm 12.0.2, Node 24.15.0) | yes | §2 |
| ESLint (`eslint-config-next` 16.4.0) | yes | §3 |
| `npm run check` (`scripts/check.mjs`, 13 rules) | yes | §3 |

**Coverage gap, stated plainly:** no dedicated secret scanner and no semantic SAST engine ran. §4 and §5 are pattern-based and are only as good as the patterns listed there. No dynamic test was run against the deployment.

## 2. Dependency scan — `npm audit`

`npm audit --json`, exit code 1:

```
"vulnerabilities": { "info": 0, "low": 0, "moderate": 0, "high": 5, "critical": 0, "total": 5 }
"dependencies":    { "prod": 95, "dev": 379, "optional": 89, "peer": 0, "peerOptional": 0, "total": 512 }

@next/eslint-plugin-next high >=14.3.0-canary.0 ["fast-glob"]  fix: {"name":"eslint-config-next","version":"14.2.35","isSemVerMajor":true}
braces                   high *                  ["braces vulnerable to stack-exhaustion denial of service through deeply nested patterns https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"]  fix: same
eslint-config-next       high >=14.3.0-canary.0 ["@next/eslint-plugin-next"]  fix: same
fast-glob                high *                  ["micromatch"]  fix: same
micromatch               high >=0.2.0            ["braces"]  fix: same
```

`npm audit --omit=dev`:

```
found 0 vulnerabilities
```

Dependency path (`npm ls braces micromatch fast-glob`):

```
cv-insight@0.1.0
`-- eslint-config-next@16.4.0
  `-- @next/eslint-plugin-next@16.4.0
    `-- fast-glob@3.3.1
      `-- micromatch@4.0.8
        `-- braces@3.0.3
```

## 3. Project invariant checks and lint

`npm run check` — exit 0:

```
check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer;
  NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection
  import outside the gates; every secret reader imports server-only;
  next.config.* clean of secrets and env injection; no getSession() in src/;
  service-role key pinned to lib/supabase/admin.ts and its client to the account
  and Stripe-webhook routes; Stripe client pinned to the three billing routes;
  createServerClient pinned to server.ts + middleware.ts with shared
  cookieOptions, no createBrowserClient;
  AUDIT_RETENTION_VERIFIED only with real evidence behind it; every
  backticked repo path in the docs/ shelf resolves against the tree.
```

`npx eslint .` — exit 0, no output.

## 4. Secret detection

Patterns: AWS access key (`AKIA…`), GitHub token (`ghp_…`), Stripe live secret (`sk_live_…`), Stripe test secret (`sk_test_…`, ≥ 20 chars), Stripe restricted key (`rk_live_`/`rk_test_`), Stripe webhook secret (`whsec_…`), OpenRouter key (`sk-or-v1-…`), PEM private-key header, Google API key (`AIza…`), JWT (three base64url segments starting `eyJ`). Matched values were set to be suppressed in output; none were matched.

| Scope | Result |
|---|---|
| All 242 tracked files other than `.env.example` and `package-lock.json` | 0 matches |
| Full git history, all refs, excluding `.env*` and `package-lock.json` (`git log --all -G`) | 0 commits for every pattern |

Repository hygiene observed:

- `.gitignore` excludes `/.env` and `/.env.*` with a single re-inclusion, `!/.env.example`.
- The only `.env*` path ever committed is `.env.example` (commits `5b88b61`, `de462ba`, `ffc8bf8`). Its contents were not read by this run; its `NEXT_PUBLIC_` hygiene is covered by `npm run check` (§3).
- `test-results/` and `*.tsbuildinfo` are present locally and ignored, not tracked.

## 5. Code and configuration review

### 5.1 Pattern sweep over `src/` (and `scripts/` for eval)

| Sink | Hits |
|---|---|
| `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML` | 0 in code (1 comment, `src/components/applications/result-tabs.tsx:349`, stating the text is rendered as a React text node) |
| `eval(`, `new Function(` | 0 |
| `Math.random` | 0 |
| `child_process`, `fs`, `readFile` | 0 |
| `.rpc(` | 1 — `src/lib/db/documents.ts:111`, `match_documents` with named parameters, inside the DAL |
| `Access-Control-Allow-Origin`, CORS config | 0 (no cross-origin API surface) |
| `getSession(` | 0 in code (2 comments forbidding it) |
| `redirect(` targets | all literal paths; none built from request input |

### 5.2 Access control on route handlers (15 files under `src/app/api`)

| Route | Session check | Notes |
|---|---|---|
| 13 user routes (account, applications ×5, billing ×2, career ×3, scan) | `requireApiUser()` (→ `getUser()`) | |
| `dev/coverage-probe`, `dev/reindex` | `NODE_ENV === 'production'` → 404 first, then `requireApiUser()` | |
| `stripe/webhook` | none, by design | raw body read with `request.text()`, signature verified by `stripe.webhooks.constructEvent`; error path logs the error class name only |

Middleware excludes `/api` from its matcher deliberately so handlers answer 401 JSON; every handler checks itself. Every model and embeddings call additionally passes the `lib/chat.ts` / `lib/retrieval.ts` gates (§3, R-rules).

### 5.3 Database (migrations 001–007)

- RLS enabled on all nine tables. The policy loop in `001_init.sql:102-125`, plus `003_imports.sql`, `004_profiles.sql` and `006_subscription_events.sql`, produces exactly the matrix CLAUDE.md declares: career_items S/I/U/D · documents S/I/D · vacancies S/I/U · applications S/I/U · resume_versions S/I · llm_calls S/I · imports S/I/U · profiles S/I/U · subscription_events S. Every policy is `auth.uid() = user_id`.
- No `security definer` anywhere under `supabase/` (also enforced by `check.mjs`). No `using (true)`, no `with check (true)`, no grant to `anon`.

### 5.4 Session cookies

`src/lib/supabase/cookie-options.ts`: `httpOnly: true`, `secure` in production, `sameSite: 'lax'`, `maxAge` capped at 30 days via `cappedMaxAge`, which middleware applies on every refresh.

### 5.5 Response headers (`next.config.ts`, all paths)

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests` (production; development adds `'unsafe-eval'`) |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |
| Strict-Transport-Security | not set by the app (see F6) |

### 5.6 Logging of personal data

All 41 `console.*` call sites in `src/` were read. They log error class names, Zod issue paths/codes/schema-authored messages, event ids, counts, similarity scores and career-item titles. The three `console.log` lines in `src/lib/retrieval.ts` (765, 816, 820) are inside `NODE_ENV === 'development'` guards and print query length, chunk counts, scores and titles — no chunk text. `src/lib/pdf.ts:55` and `src/lib/errors.ts:203` deliberately log the error name and not its message. No site logs resume, vacancy or chunk content.

### 5.7 Input bounds

- `/api/career/import`: `Content-Length` checked against `MAX_PDF_BYTES + 64 KiB` before `formData()`, then `file.size > MAX_PDF_BYTES` before `arrayBuffer()`.
- Every other JSON route parses with `request.json()` and validates through Zod before use.

## 6. Findings

Severity is this run's assessment of real exposure for this deployment, not the tool's label; where they differ, both are shown.

| ID | Severity | Category | Location | Status in repo |
|---|---|---|---|---|
| F1 | Low (npm: High ×5) | Vulnerable component, dev-only | `eslint-config-next` → … → `braces@3.0.3` | already tracked as backlog `dp-1`, accepted |
| F2 | Low | Unbounded metered spend (embeddings) | `src/lib/retrieval.ts` indexing path | declared design in SPEC rule B7a |
| F3 | Info | CSP weakening | `next.config.ts` `script-src 'unsafe-inline'` | declared and measured in `docs/eval/csp-verification.md` |
| F4 | Info | CSRF defence-in-depth | state-changing `/api/*` routes | not previously recorded |
| F5 | Info | Host-derived return URLs | `src/app/api/billing/checkout/route.ts:40`, `portal/route.ts:29` | not previously recorded |
| F6 | Info | Missing HSTS from the app | `next.config.ts` | declared decision in the same file |
| F7 | Info | Direct PostgREST writes to own rows | RLS INSERT/UPDATE policies on derived-data tables | follows the declared policy matrix |

Counts: Critical 0 · High 0 · Medium 0 · Low 2 · Info 5.

### F1 — dev-only `braces` denial-of-service advisory (GHSA-vfj7-8cjw-p6xm)

- **What:** five audit entries, one chain: `eslint-config-next@16.4.0` → `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. Stack exhaustion on deeply nested brace patterns.
- **Exposure:** lint time only. Every node is a devDependency; `npm audit --omit=dev` finds 0. A malicious glob would have to be supplied to ESLint on a developer machine or CI.
- **npm's offered fix:** `eslint-config-next@14.2.35`, a semver-major downgrade below Next 16 — not a usable fix.
- **Options for the owner:** keep accepting under `dp-1`; or add an `overrides` entry pinning `braces` to a patched release once one exists for the 3.x line and verify `eslint` still runs; or wait for an `eslint-config-next` release on a patched chain.

### F2 — re-indexing on career-item save has no daily ceiling

- **What:** each save that changes `title` or `content` re-embeds that item through `lib/retrieval.ts`. Rule B7a caps the `rescore` step only; SPEC records "`embed` stays UNCAPPED: indexing must never be able to fail a save, and B9 bounds it instead".
- **Gap in the stated bound:** B9 bounds how many items and documents a user can HOLD (200 items, ≤ 2 chunks each), not how often they are re-embedded. A signed-in user who scripts repeated `PATCH /api/career/items/[id]` with alternating content spends one embeddings request per call with no server-side ceiling.
- **Exposure:** authenticated only; the cost per call is small (SPEC measures a whole 200-item base at roughly a cent), so this is a cost-abuse ceiling question, not a data-exposure one.
- **Options for the owner:** leave as declared; or add a per-user rolling count of `embed` rows that, when exceeded, SKIPS indexing and returns the existing non-blocking warning — which keeps the rule that indexing never fails a save.

### F3 — `script-src 'unsafe-inline'` in the production CSP

- **What:** the CSP permits inline script.
- **Exposure:** an HTML-injection bug would execute inline script. No such sink was found (§5.1), external script origins are still blocked, and `frame-ancestors`, `object-src`, `base-uri` and `form-action` remain tight.
- **Status:** declared trade-off with its reasons and measurement in `next.config.ts` and `docs/eval/csp-verification.md` (nonces would force `/privacy` and `/impressum` dynamic).
- **Options for the owner:** keep; or adopt per-request nonces and accept the dynamic public pages.

### F4 — no explicit `Origin` check on state-changing API routes

- **What:** POST/PATCH/DELETE handlers authenticate by session cookie and do not compare `Origin`/`Sec-Fetch-Site` with the app's own origin. `request.json()` parses any content type, including `text/plain`.
- **Why it is not exploitable today:** the session cookie is `SameSite=Lax`, so browsers do not attach it to cross-site POST/PATCH/DELETE; on `*.vercel.app` every deployment is its own site.
- **When it would matter:** on a future custom domain whose sibling subdomains are controlled by someone else (same-site, not same-origin), Lax no longer separates them.
- **Options for the owner:** accept on SameSite alone; or add one origin check in a shared helper (e.g. beside `requireApiUser`) for non-GET methods, or require `Content-Type: application/json`.

### F5 — Stripe `success_url` / `cancel_url` / `return_url` built from `request.url`

- **What:** `new URL(request.url).origin` supplies the redirect base for Checkout and the billing portal.
- **Exposure:** on Vercel the request reaches this deployment only through its routed host, so the origin is the deployment's own. The caller must be signed in, and the redirect would only send that same caller elsewhere.
- **Options for the owner:** accept; or derive the origin from a configured server-side constant so the value never depends on the incoming request.

### F6 — no `Strict-Transport-Security` from the app

- **What:** the app does not set HSTS.
- **Status:** declared decision in `next.config.ts` — Vercel serves HSTS on its own domains, and a `max-age` set in config would bind any future custom domain before that choice was made on purpose.
- **Options for the owner:** keep; revisit when a custom domain is attached.

### F7 — users can write their own derived-data rows directly through PostgREST

- **What:** the project URL and anon key are public. A user who signs in against Supabase Auth directly obtains their own access token and can, within the declared policies, INSERT `llm_calls`, `resume_versions` and `documents` rows and UPDATE their own `applications` and `vacancies` rows (e.g. stored scores) without this app seeing the request.
- **Exposure:** confined to the user's own rows by `auth.uid() = user_id`. `llm_calls` has no UPDATE or DELETE, so a user can only raise their own usage count, never lower it to escape a daily limit. The plan cannot be forged this way (`subscription_events` is SELECT-only for users). Rows a user forges are visible to that user alone.
- **Options for the owner:** accept as the stated least-privilege matrix; or, if `/quality` figures or stored scores must be trustworthy beyond the user's own view, move those writes behind server-only paths and drop the user INSERT/UPDATE on the affected tables (an owner amendment per CLAUDE.md).

## 7. OWASP Top 10 (2021) category checklist

Used as a checklist taxonomy only.

| Category | Result in this scan |
|---|---|
| A01 Broken access control | every API route authenticates (§5.2); RLS on all tables (§5.3); F4, F7 informational |
| A02 Cryptographic failures | no custom crypto or password handling; cookies `secure` in production; F6 informational |
| A03 Injection | no raw SQL; one parameterised `.rpc`; no HTML/eval sinks (§5.1) |
| A04 Insecure design | metered-spend ceilings in the gates; F2 low |
| A05 Security misconfiguration | headers set (§5.5); F3 informational; dev routes 404 in production |
| A06 Vulnerable components | F1, dev-only; production tree clean |
| A07 Identification and authentication | Supabase Auth only; `getUser()` only; no `getSession()` |
| A08 Software and data integrity | Stripe webhook verifies the signature on the raw body before anything else; ledger is append-only |
| A09 Logging and monitoring | metadata-only logging verified (§5.6) |
| A10 SSRF | no user-controlled outbound URL; the only outbound hosts are OpenRouter (fixed) and Stripe (SDK) |

## 8. Parts of the `/security-scan` template not produced

- **Automated remediation, CI workflow files, middleware templates:** not produced; this run lists findings only.
- **Risk score, cost/investment estimates, compliance percentages (NIST, ISO 27001, PCI DSS, SOC 2):** not produced. This scan has no measurement those numbers could be derived from, and a figure without a basis would be invented.
- **SARIF report:** not produced; no SARIF consumer is configured for this repository.
