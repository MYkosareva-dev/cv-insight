# Phase 6 gate — nextjs-security
(date 2026-09-04, commit 949ded8, branch phase-6-deploy)

## Verdict

**PASS WITH FINDINGS — 1 BLOCKER, 2 MAJOR, 2 MINOR, 2 NIT.** The server/client boundary, the session-verification story and the secret-handling story are the strongest I have audited in this codebase class, and none of the findings below is a secret exposure, a missing authorization check or a cross-user data leak. Every one of the twelve route handlers calls `requireApiUser()` as its first statement; `getSession()` appears nowhere in `src/` outside two comments explaining why it is banned; both metered gates call `getUser()` before any spend and neither accepts a user id as an argument; not one of the twenty `'use client'` files imports a `server-only` module as a value (all six `@/lib/db/types` imports are `import type`, fully erased); and the previously-built client bundle in `.next/static/` contains no occurrence of `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `openrouter.ai` or an `sk-or-v1` prefix. `npm run check` passes all 13 rules and `npm test` is 379/379 green. The single BLOCKER is not a defect in running code — it is SPEC Block H DoD item 9's own deploy condition being unmet: the `/api/dev/*` production fence has never been witnessed, and the project's own rule book says the claim may not ship ahead of its proof. The two MAJORs are the absence of any security response headers, and function-duration budgets that exceed the Hobby plan's default ceiling in a way the code's own docblock warns about.

## Findings

### [BLOCKER] ns-1 — The `/api/dev/*` production fence is a claim with no evidence, and SPEC makes that a deploy condition

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\dev-routes-production-evidence.md:3`, against `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md:1270`

**What:** The evidence file that Block H item 9 requires is still the template:

```
**Status: NOT VERIFIED.** This file is a TEMPLATE. Nothing below has been run,
and until the owner runs it and pastes the output, the claim that the
development-only endpoints are unreachable on a deployment rests on reading the
code rather than on watching it refuse.

`<PASTE RUN OUTPUT HERE>`
```

SPEC Block H item 9 is unambiguous that this is not a backlog item:

> Owner-run, once, before the first deploy: `npm run build && npm run start`, then `curl -i localhost:3000/api/dev/coverage-probe?applicationId=<uuid>` and `curl -i -X POST localhost:3000/api/dev/reindex` — both must answer **404**, signed in or not. […] the claim and its proof ship together, or the claim does not ship.

**Why it matters:** Two routes ship inside the production bundle and both spend money. `POST /api/dev/reindex` re-embeds the caller's entire career base — up to 63 embedding requests on a base at the rule-B9 cap — and it is the one metered endpoint in the app with **no daily ceiling of any kind**: rule B7 counts chat steps only, and `lib/retrieval.ts:206` applies rule B7a to `step === 'rescore'` alone, so the `embed` step this route uses is uncapped by deliberate design (`src/lib/retrieval.ts:180-182`). The only thing standing between a signed-in user and that spend on a deployment is one runtime line, and the evidence file itself enumerates why nothing in the repo witnesses it: the handlers import `server-only` so `node:test` cannot load them, Playwright only ever runs against a dev server, and `scripts/check.mjs` has no rule for it (the 13 are frozen). This is CLAUDE.md's "a configured mechanism is not a working one" case verbatim.

I read the fence itself and it is correct on every axis: it is the **first** statement in both handlers, before `requireApiUser()` and before any argument is parsed — `src/app/api/dev/coverage-probe/route.ts:84` and `src/app/api/dev/reindex/route.ts:76`. So the finding is a missing witness, not a broken fence.

**Fix:** Run the two curls against `npm run build && npm run start` exactly as Block H item 9 specifies, both signed in and signed out, and paste both raw responses into `docs/eval/dev-routes-production-evidence.md`, replacing the `NOT VERIFIED` status line. Five minutes of owner time; do not deploy ahead of it.

---

### [MAJOR] ns-2 — The app ships no security response headers at all, and there is no `vercel.json`

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\next.config.ts:3-16` (whole config), and the absence of `vercel.json` at the repo root

**What:** The entire Next config is:

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  typescript: {
    ignoreBuildErrors: false,
  },
};
```

There is no `async headers()` block, and `src/middleware.ts` sets no response headers either (I read it in full — it sets session cookies and returns; lines 63-84). So the deployment serves no `Content-Security-Policy`, no `frame-ancestors`, no `X-Frame-Options`, no `Referrer-Policy`, no `X-Content-Type-Options` and no `Permissions-Policy`.

**Why it matters:** The concrete exposure is framing. `/settings` renders `DeleteAccountDialog` (`src/app/(app)/settings/page.tsx:106`), which fronts `DELETE /api/account` — a hard, cascading, irreversible GDPR erasure across eight tables (`src/app/api/account/route.ts:22-33`). Nothing prevents that page being embedded in a third-party frame. Vercel Deployment Protection raises the bar (the framing attacker's victim must already hold the password, and the frame itself would need to satisfy protection) but it does not close it — a named user who has authenticated the perimeter in that browser is exactly the population that can be framed. `X-Content-Type-Options: nosniff` is also worth having on the `.docx` download path at `src/app/api/applications/[id]/export/route.ts:167-195`, which sets `Content-Type` and `Cache-Control` but no `nosniff`.

Note that SPEC's Security (M2/M3) paragraph at `SPEC.md:1033` covers CORS, sanitisation, ID forgery, secrets and prompt injection — and says nothing about response headers. So this is a gap in the specification as much as in the code, which is why it is the owner's call rather than an automatic blocker.

**Fix:** Add an `async headers()` to `next.config.ts` returning, for `source: '/:path*'`, at minimum `X-Frame-Options: DENY` (or `Content-Security-Policy: frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` and a restrictive `Permissions-Policy`. A full CSP with script/style directives is a larger job (Tailwind v4 and Next's inline bootstrap need nonce handling) and can be a follow-up; the four headers above are free. Record the decision in SPEC's Security paragraph so the next reviewer does not have to re-derive it.

---

### [MAJOR] ns-3 — Declared `maxDuration` budgets exceed the Hobby plan's default function ceiling, and the code says what breaks when they do

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\applications\[id]\generate\route.ts:56` (`export const maxDuration = 300`), `src\app\api\scan\route.ts:83` (120), `src\app\api\applications\[id]\judge\route.ts:59` (120), `src\app\api\dev\reindex\route.ts:72` (120), `src\app\api\dev\coverage-probe\route.ts:74` (120)

**What:** The generate pipeline declares 300 s, justified at line 55 as "Two 60 s attempts plus a 2 s retry wait, four times over, is ~248 s." On Vercel's Hobby plan the default maximum function duration is 60 s; durations above that require Fluid compute to be enabled on the project. I have not verified the project's Vercel settings (out of my scope — see "Scope not covered"), so this is a *verify before deploy*, not an assertion that it is currently broken.

**Why it matters:** The scan route's own docblock states the consequence precisely, and it is the reason this is MAJOR rather than a note:

```
 * Worst case on this route: one 60 s chat attempt, the 2 s network-retry wait, a
 * second 60 s attempt, then the embedding requests and one RPC per requirement.
 * A platform timeout below that budget kills the request before `after()` runs,
 * which drops the `llm_calls` row for a call that WAS billed — rule B8 would
 * stop holding with /quality as the only witness. Stated here so the deployment
 * cap is checked against a number rather than guessed at.
```
(`src/app/api/scan/route.ts:75-82`)

`logLlmCall` is scheduled through `after()` (`src/lib/db/llmCalls.ts:151-164`). A platform kill at 60 s on a run that has already spent two Haiku calls and a gpt-5.4 call therefore bills the user and writes no audit row — which silently falsifies `/quality`, the screen that exists to be the app's own evidence of what it spent. On `/generate` it is worse: the in-flight lock at `generate/route.ts:68` has a 300 s TTL chosen to be `>= maxDuration`, so a process killed at 60 s leaves that application locked for four more minutes with no run in progress, and the user's retry answers `409 ALREADY_RUNNING`.

**Fix:** Before deploying, confirm the Vercel project's maximum function duration actually equals or exceeds 300 s (enable Fluid compute if that is what it takes) — the number the code declared is the number to check against. If it cannot be raised, the honest change is to lower `maxDuration` to what the platform permits and reduce `REQUEST_TIMEOUT_MS` (`src/lib/openrouter/server.ts:50`, currently 60 000) so the pipeline's worst case fits inside it, rather than leaving a declared budget the platform will not honour. Either way, `LOCK_TTL_MS` must move with `maxDuration`, since its correctness argument is `TTL >= maxDuration`.

---

### [MINOR] ns-4 — `/api/career/items/[id]` is the one `[id]` route that does not validate the segment shape (backlog M-3, still open)

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\career\items\[id]\route.ts:29-30` and `:88-90`

**What:** Both verbs go straight from the auth check to the DAL:

```ts
await requireApiUser();
const { id } = await params;
```

Every other `[id]` handler parses the segment first — `applications/[id]/route.ts:38`, `generate/route.ts:94`, `judge/route.ts:66`, `rescore/route.ts:71`, `export/route.ts:69`, and the detail page at `app/(app)/applications/[id]/page.tsx:63` — all with `if (!z.uuid().safeParse(id).success) throw new NotFoundError();`. Here, a non-UUID reaches `getCareerItem(id)`, which does `.eq('id', id)` and rethrows the raw PostgREST error (`src/lib/db/careerItems.ts:44-46`); `apiErrorResponse` then maps that unrecognised throw to a generic `500 SERVER_ERROR`.

`docs/backlog.md:20` records this as an open **MAJOR M-3** with the exact fix. The comment at `applications/[id]/route.ts:26-28` reads "raised against the career endpoints and closed here rather than repeated", which is easy to misread as meaning the career endpoints were also fixed. They were not.

**Why it matters:** Block D's status table mandates 404 for an id that does not resolve, and 404-not-403 is the app's declared non-enumeration rule. Answering 500 instead is a deviation from the table and a small oracle: a malformed id and a well-formed id belonging to another user now produce different status codes (500 vs 404). No content leaks — `apiErrorResponse` returns the generic "Something went wrong." and logs only `err.name` — so the impact is small, but this is the last unvalidated route segment in the app.

**Fix:** Add `if (!z.uuid().safeParse(id).success) throw new NotFoundError();` after `requireApiUser()` in both `PATCH` and `DELETE`, import `z` from `zod`, and close M-3 in `docs/backlog.md`.

---

### [MINOR] ns-5 — The advertised 5 MB upload ceiling exceeds the platform body limit, and `/api/career/import` still buffers before checking

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\career\import\route.ts:87-98`; compare `src\app\api\scan\route.ts:271-274`

**What:** `/api/scan` pre-checks the declared body size off the header before buffering:

```ts
const declared = Number(request.headers.get('content-length'));
if (Number.isFinite(declared) && declared > MAX_SCAN_BODY_BYTES) {
  throw new FileTooLargeError(ERROR_MESSAGES.REQUEST_TOO_LARGE);
}
```

`/api/career/import` does not — it calls `await request.formData()` at line 88 and only then reads `file.size` at line 98. And both routes advertise `MAX_PDF_BYTES` = 5 MB, which exceeds the ~4.5 MB serverless request-body limit. `docs/backlog.md:24` (m-3) and `:147` (p3-1) both record this and both say to reconcile it **before deploy**.

**Why it matters:** A 4.6 MB PDF is legal by the app's own copy and illegal by the platform's, so the user gets the platform's generic error page instead of edge case L5's exact string — the app promising a ceiling it cannot honour. The missing `Content-Length` pre-check is the smaller half: an oversized multipart import is read fully into the function's memory before being refused, which is the cost the pre-check on the scan route exists to avoid, and the two endpoints should not disagree about it.

**Fix:** Lower `MAX_PDF_BYTES` to a number under the platform limit (and update the copy that quotes "5 MB"), or state the real ceiling; and copy the `Content-Length` pre-check from `scan/route.ts:271-274` into `career/import/route.ts` ahead of `request.formData()`.

---

### [NIT] ns-6 — No `Cache-Control` on JSON API responses

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\errors.ts:152` (`return Response.json(apiError.body, { status: apiError.status });`) and every `NextResponse.json(...)` return in the route handlers

**What:** Only the export route sets a cache header — `'Cache-Control': 'no-store'` at `export/route.ts:180`, with the correct reasoning beside it ("A resume is personal data and there is nothing to gain from caching it"). No other handler sets one.

**Why it matters:** Today this is genuinely harmless and I verified why: every other handler is `POST`, `PATCH` or `DELETE`, which are not cacheable by default, and the app's only `GET` route handler is the dev-only coverage probe. The member pages are all dynamic because they read cookies through `createClient()`, so Next marks them private. The nit is durability, not exposure — a future authenticated `GET` route handler will inherit no header at all, and the one place that would naturally teach it otherwise (the shared `apiErrorResponse`) is silent.

**Fix:** Optional. If taken, set `'Cache-Control': 'no-store'` in `apiErrorResponse` and in the success responses of the handlers that return user data, so the default is safe rather than incidental.

---

### [NIT] ns-7 — The unhandled-error log line carries no usable signal for a PostgREST throw

**Where:** `d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\errors.ts:147-151`

**What:**

```ts
console.error('[api] unhandled error mapped to 500 SERVER_ERROR', {
  name: err instanceof Error ? err.name : typeof err,
});
```

A PostgREST error object is not an `Error` instance, so this logs `{ name: 'object' }`.

**Why it matters:** The privacy reasoning is right and should not change — the message can carry resume or vacancy text. But the resulting log line cannot distinguish a UUID syntax error (ns-4's 500) from an RLS refusal from a connection failure. `saveContactsAction` already solved this leak-free at `src/lib/profile/actions.ts:159-164`, where it reads `(err as { code?: string })?.code` and logs the code alongside the name, explicitly because "the code is the contract".

**Fix:** Optional. Add the same `code` field to the `apiErrorResponse` log. Postgres/PostgREST codes are fixed identifiers and carry no user content.

## Checked and clean

**Server/client boundary**
- All 20 `'use client'` files enumerated and their import lists read individually. None imports a `server-only` module as a value. Confirmed by grep that `src/components/` contains no non-type import of `@/lib/db/*`, `@/lib/chat`, `@/lib/retrieval`, `@/lib/prompts`, `@/lib/tailoring`, `@/lib/coverage`, `@/lib/docx`, `@/lib/pdf`, `@/lib/supabase/*`, `@/lib/openrouter/*` or `@/lib/auth/requireApiUser`.
- `src/lib/db/types.ts` does import `'server-only'` and *is* referenced by six client components — every one of those six is `import type` (`judge-card.tsx:5`, `result-tabs.tsx:9`, `resume-editor.tsx:20`, `status-select.tsx:8`, `career-item-card.tsx:21`, `import-resume-dialog.tsx:24`), which TypeScript erases entirely. This was the highest-risk-looking thing in the tree and it is correct.
- The modules client code *does* import as values — `@/lib/copy`, `@/lib/utils`, `@/lib/validation`, `@/lib/limits`, `@/lib/judge`, `@/lib/quality`, `@/lib/budget` — are all confirmed free of `'server-only'` and of `process.env` reads, and each carries a docblock explaining why it is deliberately not server-only.
- Props crossing into client components audited at `app/(app)/applications/[id]/page.tsx:141-153` and `app/(app)/settings/page.tsx:78-90`: application id, coverage entries, keywords, score, parsed vacancy, raw vacancy text, versions, judge terms, notes, provenance, contacts. All of it is the signed-in user's own data read through DALs under their own session. No secret, no service-role client, no other user's data, no admin surface.
- Scanned the existing production client bundle in `.next/static/` for `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `openrouter.ai` and `sk-or-v1`. Zero hits.

**Session verification**
- `grep -rn "getSession(" src/` returns exactly two hits, both comments explaining the ban (`app/(app)/layout.tsx:14`, `lib/supabase/server.ts:13`). No access decision anywhere reads it.
- All twelve route handlers verified line by line: `requireApiUser()` (or, for the two dev routes, the NODE_ENV fence then `requireApiUser()`) is the first statement, **before** the body is read. This matters most on `/api/career/import:46` and `/api/scan:95`, where reading a 5 MB body for an anonymous caller would be work done for someone with no right to ask.
- `DELETE /api/account` takes **no `Request` parameter at all** (`account/route.ts:39`), so there is no body and no id for a caller to forge; the id comes only from `requireApiUser()`. The service-role client is constructed *after* that check and is a function, not a module constant, so the key is never read at import or build time.
- Both metered gates call `getUser()` first and neither exposes a `userId` parameter — `lib/chat.ts:261,317` and `lib/retrieval.ts:204,313,369,485,616,667`. `reindexAllCareerItems` takes no id by explicit design (`retrieval.ts:479-483`). The two indexing exports refuse rather than throw when unverified, which reconciles the gate rule with "indexing may never fail a save".
- Middleware matcher is anchored per SPEC: `/apifoo`, `/privacyleak` and `/applications/x.png` do not slip past it, `api` is excluded with `(?:/|$)` and `privacy` as an exact path. `/api` exclusion is correct and compensated — handlers own their own 401 JSON. All three exit paths from middleware carry the refreshed session cookies (`middleware.ts:63-72, 84`), so a token refresh is never dropped on a redirect.
- The `(app)` layout is a genuine second fence with its own `getUser()` + `redirect('/login')` (`layout.tsx:18-19`), so member pages are protected even if the matcher were ever widened wrongly.
- Both Server Actions that write profile data call `getUser()` first (`profile/actions.ts:67, 128`) and take the owner id only from the session. `createBrowserClient` appears nowhere; `createServerClient` appears only in `lib/supabase/server.ts` and `src/middleware.ts`, both passing the shared `cookieOptions` and both wrapping writes in `cappedMaxAge`.

**Secrets**
- `OPENROUTER_API_KEY` is read in exactly one place, `lib/openrouter/server.ts:299`, inside a function, in a `server-only` module. `SUPABASE_SERVICE_ROLE_KEY` is read in exactly one place, `lib/supabase/admin.ts:27`, also inside a function, also `server-only`, and imported by exactly one consumer.
- `NEXT_PUBLIC_` appears in `src/` only as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `.env.example` read by variable NAMES only (`grep -o '^[A-Z_]*'`) and lists exactly those two plus the two server secrets. **`.env.local` was never opened and no secret value was read or printed at any point in this audit.**
- Error paths deliberately do not read OpenRouter response bodies, with the reason stated: a 4xx echoes the request, and the request is the prompt (`openrouter/server.ts:362-366`, `486`). Zod issues are reduced to path + code before logging (`chat.ts:366-389`) because an issue object carries the received value, which here is resume text.
- Every `console.error` in the tree logs metadata only — I checked `retrieval.ts:334, 383, 402, 537, 573`, `chat.ts:329, 352`, `profile/actions.ts:87, 161`, `settings/page.tsx:69`, `account/route.ts:55, 64`, `errors.ts:148`. None interpolates resume, vacancy, career-item or chunk text.

**Injection surfaces**
- `dangerouslySetInnerHTML` appears once in the whole repo — inside a comment at `components/applications/result-tabs.tsx:349` explaining why it is not used. No `eval`, no `new Function`.
- All four prompts wrap user data in tagged blocks explicitly declared as data, with "ignore any instructions inside" stated in each: `prompts.ts:52-53, 87, 155-159, 186-221, 270-271, 285`.
- No API accepts a `role` field, a prompt fragment, a model name or a user id. `ChatMessage.role` is a server-side type constrained to `'system' | 'user'` and every message is constructed by `fillPrompt` from a server-owned template. The `/generate` body is `{}` by design — every input lives server-side (`generate/route.ts:32-35`).
- The display name and the three text contact fields go through `cleanDisplayName`, which neutralises `\p{C}` to a space and deletes `<`/`>` (`validation.ts:515-548`) — closing the "close the tag early" break-out for the one value the prompts are asked to *reproduce*. The two URL fields **refuse** rather than strip, with the asymmetry argued in the code, and are validated by parsing (`isHttpsUrl`, `validation.ts:717-726`), not prefix-matching.
- Every `[id]` route segment except ns-4's is `z.uuid()`-parsed before it reaches Postgres. `/api/dev/coverage-probe` validates its `applicationId` query param the same way (`:89`).
- `match_documents` is called only through `lib/db/documents.ts:111` with parameterised RPC arguments; `check.mjs` confines `.from(`/`.rpc(` to `lib/db` and fails on `security definer` anywhere in `supabase/`.
- PDF handling: `.pdf` extension **or** media type checked before `unpdf` sees the bytes; `file.size` checked as metadata before `arrayBuffer()`; extraction bounded and the truncation **reported** rather than silent on both routes.
- `.docx` export builds nothing by hand — every line becomes a `TextRun` and the `docx` package escapes the XML (`lib/docx.ts:106-116`). Bold is decided by the line's own shape, never by anything embedded in it.
- `Content-Disposition` header injection is closed: `asciiFallback` replaces everything outside `[\x20-\x7E]` (which includes CR and LF) and strips `"` (`export/route.ts:207-209`), and the `filename*` half is `encodeURIComponent`'d. `exportFilename` additionally strips `\p{C}` and filesystem-unsafe characters (`utils.ts:38-46`). This matters because `company` and `role` originate in an LLM parse of user-supplied vacancy text.
- Open redirects: every `href`, `router.push` and `router.replace` in the tree is a relative path built from either a literal or a server-generated UUID. `FlashToast` never renders the query value — `noticeFor` maps a known key to a copy constant and returns null otherwise (`flash-toast.tsx:30-44`), so a crafted `?notice=` cannot put words in the app's voice.
- All ten client `fetch` calls target relative same-origin `/api/*` paths; the one templated path segment (`result-workspace.tsx:243`) is fed only literals.

**Route handler hygiene**
- Zod at every boundary, with the parse *after* auth and *before* any spend on all twelve handlers. Malformed JSON is caught and turned into the endpoint's own `ValidationError` rather than allowed to throw.
- Canonical error shape in one place (`errors.ts:15`), one class hierarchy shared by gates and handlers so `instanceof` cannot miss, and `apiErrorResponse` defaults an unrecognised throw to a generic 500 rather than echoing a message that could carry personal data.
- 404-not-403 held consistently for absent-or-foreign rows, on both the API side and the page side (`not-found.tsx`).
- `app/error.tsx` renders only Next's `digest`, never `error.message` (`error.tsx:40-44`).
- No CORS headers are added anywhere, so same-origin is the default — matching SPEC.md:1033. No `GET` handler returns member data (the only one is dev-only).

**Rate limiting / abuse**
- Rule B7 (50 chat calls / rolling 24 h) is checked once per step inside the chat gate, before the first request, with the `CallLedger` correctly threaded through all four steps of `/generate` so the multi-call overshoot is closed (`chat.ts:136-144, 262, 318`; `generate/route.ts:120`).
- Rule B7a (100 `rescore` rows / 24 h) is enforced in the **gate**, not the handler (`retrieval.ts:184-190, 206`), which is the right place — a fence a caller must remember is a fence the next caller does not have.
- The retry rules hold: exactly two owner-approved exceptions drawing from one shared budget of 2, with no nesting; `MAX_CHAT_REQUESTS_PER_GENERATE = 8` asserted at `generate/route.ts:172` as a defect trap. Embeddings have no retry and no `models` fallback array, with the vector-space reason given.
- The `/generate` in-flight lock honestly declares itself per-instance rather than pretending to be distributed (`generate/route.ts:70-77`).

**Config and toolchain**
- `next.config.ts` contains no secrets, no `env: {…}` injection, no `serverExternalPackages`, no image `remotePatterns`, and `typescript.ignoreBuildErrors: false`. `agentRules: false` is a defensive choice I agree with — it stops `next dev` writing into CLAUDE.md.
- `npm run check` passes all 13 rules; `npm test` passes 379/379 across 69 suites.
- `package.json` wires `check` + `test` as `prebuild`, so the boundary rules cannot be bypassed by a build. No agent framework in dependencies (direct `fetch` only), consistent with the Prohibited list.

## Scope not covered

- **`npm run build` / `npx vercel build` was not executed.** My instructions were a strictly read-only audit with Bash limited to grep/find/ls, and a build writes to `.next/`. I ran the two things `prebuild` runs (`npm run check`, `npm test`) since neither writes, and I scanned the **existing** `.next/static/` bundle from the 2026-09-04 15:09 build for secret markers — that bundle is clean. Block H item 1's "zero TypeScript errors" claim is therefore inherited from that prior build, not re-verified by me. Note that ns-1's fix requires a production build anyway, so this closes with the same action.
- **Vercel project settings** — function duration limits, Fluid compute, environment-variable scoping, Deployment Protection configuration, region. ns-3 depends on the first of these and I could only read what the code declares. This is `vercel-security`'s scope.
- **Supabase side** — migrations, RLS policy matrix, `match_documents`' `security invoker` status as actually deployed, and whether migration 005 is applied to the live project. `supabase-security`'s scope; I read only the app-side callers.
- **`/privacy` content, the Impressum, and the GDPR disclosure text.** `eu-compliance-reviewer`'s scope. I confirmed the page is public and correctly excluded from the middleware matcher as an exact path, and that it is linked from both layouts; I did not assess what it says.
- **Playwright e2e suite not run** (it needs a live server and credentials). I read the run transcripts in `docs/eval/` only to confirm ns-1's claim that the suite never exercises the production fence.
- **`.env.local` was not opened, at all.** Per CLAUDE.md and my instructions, only `.env.example` variable names were read.
- **`308.md`** at the repo root was not audited — CLAUDE.md marks it an owner-approved temporary working reference and explicitly not a finding.
