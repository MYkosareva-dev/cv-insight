# The `/api/dev/*` routes on a production build — run evidence

**Status: VERIFIED.** Both development-only endpoints answer 404 on a production
build, signed out and with a session cookie present, and the run is recorded
verbatim under "Run output" below.

Run on 2026-09-04 against commit `519aa4c` (branch `phase-6-deploy`), Node
v24.15.0, Next.js v16.3.4. SPEC Block H item 9 owns this: it is a condition of
the first deploy, not a backlog item (it was `p3-22` until then).

The run answers the question Block H item 9 actually asks — is the fence the
ENVIRONMENT, or is it the auth check wearing the environment's clothes? — and
the answer is the environment. Signed out, a live handler in this app answers
**401**; both dev routes answer **404** without ever reaching that check.

## What this file is for

Two endpoints exist for development only:

- `GET /api/dev/coverage-probe` (v2.13) — re-runs the match for one application
  and returns the ranked career-item titles and raw similarities.
- `POST /api/dev/reindex` (v2.14) — re-embeds the caller's whole career base.

Both spend metered embedding calls, the second one writes to `documents`, and
both **ship in the production bundle**. What keeps them off a deployment is one
line in each handler:

```ts
if (process.env.NODE_ENV === 'production') throw new NotFoundError();
```

It is the first statement in both, before `requireApiUser()` and before any
argument is parsed, and every deployed build runs with `NODE_ENV=production`
(Vercel production and preview; `next build` + `next start` self-hosted). The
reasoning is sound. The problem is that nothing in this repository WITNESSES it:

- it cannot be unit-tested — both handlers import `server-only`, so `node:test`
  cannot load them;
- the Playwright suite only ever runs against a development server, where the
  guard is supposed to be inactive, so a green suite says nothing about it;
- `scripts/check.mjs` has no rule for it, and the thirteen rules are frozen;
- so a THIRD dev route that omitted the guard would pass `npm run check`, every
  unit test, the whole e2e suite and the build, while SPEC states the property
  for "both" routes as settled fact.

That is the "a configured mechanism is not a working one" case exactly
(CLAUDE.md, Process): a user-facing promise — here, a promise to the owner that
these instruments cannot be reached or billed on the deployment — may not ship
ahead of evidence that it holds at least once.

**The scope was verified before the run, not assumed.** `find src/app/api/dev
-name 'route.ts'` returns exactly two files, and both carry the fence. "Both
routes" is a complete description of the directory as it stands, not a count
inherited from an older SPEC revision.

## How to re-verify it

```
npm run build
npm run start                     # NODE_ENV=production

curl -i "http://localhost:<port>/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
curl -i -X POST "http://localhost:<port>/api/dev/reindex"
```

Both must answer **404**, and the body must be the app's own
`{"error":{"code":"NOT_FOUND"...}}` rather than Next.js's HTML 404 page — those
two are not the same result, and only the first proves the handler ran. Run the
requests signed out AND with a cookie, because the guard is meant to precede the
auth check: a **401** would mean the fence is the auth check rather than the
environment, which is a different and weaker property than the one SPEC claims.

The shape to copy is the auth audit-retention evidence file in this same
directory — its path is deliberately not backticked here: `scripts/check.mjs`
R12's own test suite builds a sandbox with that file DELETED, so a reference to
it from another docs/ file would make R13 fail inside that sandbox. A gate whose
test breaks because of a cross-reference in prose is a gate nobody can trust.

### A note on the port

The run below used port **3210**, not 3000. Port 3000 was already held by an
unrelated process on the machine at the time, and this project's rules forbid
stopping a process this session did not start. The port number changes nothing
about what is being tested — `NODE_ENV` is what the fence reads — and using a
free port was the correct response rather than a workaround.

## Run output

Verbatim. Comment lines beginning `###` are labels added to the transcript; every
`$` line is the command and everything under it is the unedited response.

```
### 1. SIGNED OUT — GET /api/dev/coverage-probe
$ curl -i "http://localhost:3210/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
HTTP/1.1 404 Not Found
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:37:58 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"NOT_FOUND","message":"Not found."}}


### 2. SIGNED OUT — POST /api/dev/reindex
$ curl -i -X POST "http://localhost:3210/api/dev/reindex"
HTTP/1.1 404 Not Found
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:37:58 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"NOT_FOUND","message":"Not found."}}


### 3. CONTROL A — a real METERED route, signed out, answers 401 and not 404.
###    So the 404s above are NOT the auth check refusing; a signed-out caller
###    who reaches a live handler gets 401, and the dev routes never got that far.
$ curl -i -X POST -H "Content-Type: application/json" -d "{}" "http://localhost:3210/api/scan"
HTTP/1.1 401 Unauthorized
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:38:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"UNAUTHORIZED","message":"You must be signed in."}}

$ curl -i -X POST -H "Content-Type: application/json" -d "{}" "http://localhost:3210/api/career/items"
HTTP/1.1 401 Unauthorized
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:38:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"UNAUTHORIZED","message":"You must be signed in."}}


### 4. CONTROL B — a route that does not exist answers Next.js HTML, not the app JSON.
###    So the JSON 404s above came from the app handler RUNNING and throwing
###    NotFoundError - the route is present in the bundle and the fence fired.
$ curl -i -X POST "http://localhost:3210/api/dev/does-not-exist"
HTTP/1.1 404 Not Found
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
X-Powered-By: Next.js
ETag: "1exeir7uyr5a1"
Content-Type: text/html; charset=utf-8
Content-Length: 6841
Date: Fri, 04 Sep 2026 14:38:17 GMT


### 5. WITH A SESSION COOKIE PRESENT — the answer does not change.
###    The fence precedes requireApiUser(), so cookie state is irrelevant to it.
$ curl -i -b "sb-access-token=x; sb-refresh-token=y" "http://localhost:3210/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
HTTP/1.1 404 Not Found
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:38:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"NOT_FOUND","message":"Not found."}}

$ curl -i -X POST -b "sb-access-token=x; sb-refresh-token=y" "http://localhost:3210/api/dev/reindex"
HTTP/1.1 404 Not Found
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
content-type: application/json
Date: Fri, 04 Sep 2026 14:38:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

{"error":{"code":"NOT_FOUND","message":"Not found."}}


### 6. The two public legal pages render with no session on the production build.
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/privacy  -> 200
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/impressum  -> 200

### 7. A member route, signed out, redirects rather than rendering.
$ curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}" http://localhost:3210/scan  -> 307 -> http://localhost:3210/login
```

## What this proves, and what it does not

**Proves.** On a production build, both `/api/dev/*` endpoints refuse with 404
before authentication, before argument parsing, and before any metered call. The
refusal comes from the application's own `NotFoundError` — the JSON error body is
the app's canonical shape, and a genuinely absent route answers with Next.js's
HTML 404 instead (control B), so the handler demonstrably executed and the fence
is what stopped it. Presenting cookies does not change the answer (§5), and a
signed-out request to a live metered handler answers 401 (control A), so the 404
cannot be the auth check.

**Does not prove.** That a THIRD dev route added later would carry the guard.
Nothing in the repository enforces that — `scripts/check.mjs`'s thirteen rules
are frozen and none of them covers it, so the control remains code review. This
is recorded as `vs-10` in `docs/reviews/phase-6-vercel-security.md`, which
proposes an R14 for it; adding a fourteenth rule needs an owner decision and is
not taken here.

**Not run: a genuinely signed-in session.** §5 sends cookie headers, which
demonstrates that the fence does not consult them, but it is not a real
authenticated session — this run had no test account credentials. That gap is
narrow: because the fence is the first statement in each handler and returns
before `requireApiUser()` is called, a valid session cannot reach a code path
that a bogus one does not. Control A is what closes it from the other side, by
showing what a signed-out caller gets when the fence is NOT in the way.
