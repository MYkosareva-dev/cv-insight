# The `/api/dev/*` routes on a production build — run evidence

**Status: NOT VERIFIED.** This file is a TEMPLATE. Nothing below has been run,
and until the owner runs it and pastes the output, the claim that the
development-only endpoints are unreachable on a deployment rests on reading the
code rather than on watching it refuse.

`<PASTE RUN OUTPUT HERE>`

SPEC Block H item 9 owns this: it is a condition of the first deploy, not a
backlog item (it was `p3-22` until then).

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

## How to verify it (owner, once, before the first deploy)

```
npm run build
npm run start                     # NODE_ENV=production, port 3000

curl -i "http://localhost:3000/api/dev/coverage-probe?applicationId=00000000-0000-0000-0000-000000000000"
curl -i -X POST "http://localhost:3000/api/dev/reindex"
```

Both must answer **404**. Run them signed out AND signed in (paste the session
cookie with `-b`), because the guard is meant to precede the auth check — a 401
would mean the fence is the auth check rather than the environment, which is a
different and weaker property than the one SPEC claims.

Then paste both full responses under "Run output" below, replacing the
placeholder marker above, and note the commit they were run against.

(The shape to copy is the auth audit-retention evidence file in this same
directory — its path is deliberately not backticked here: `scripts/check.mjs`
R12's own test suite builds a sandbox with that file DELETED, so a reference to
it from another docs/ file would make R13 fail inside that sandbox. A gate whose
test breaks because of a cross-reference in prose is a gate nobody can trust.)

## Run output

`<PASTE RUN OUTPUT HERE>`
