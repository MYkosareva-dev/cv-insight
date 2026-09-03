/**
 * The rule-B9 capacity ceilings, as plain numbers.
 *
 * Deliberately NOT `server-only`: these two numbers are needed on BOTH sides of
 * the wire. `lib/validation.ts` bounds an array with `MAX_CAREER_ITEMS` and runs
 * in the browser as well as on the server, so it cannot import the `career_items`
 * DAL — pulling a `server-only` module into a client bundle is a build error.
 *
 * It sits in `lib/` and NOT in `lib/db/`, even though the DALs are its main
 * consumers. `lib/db/` is the server-only DAL directory everywhere else in this
 * codebase and in SPEC Block A; a file in there that a client component imports
 * would read as a precedent for "components may import from lib/db", which is
 * the boundary check.mjs R1 exists to hold. Being a plain-constants module is not
 * a good enough reason to blur that.
 *
 * The DALs re-export these, so a caller that already holds a DAL does not need to
 * know this file exists, and there is still exactly one source per number.
 */

/** Rule B9: at most 200 `career_items` per user. */
export const MAX_CAREER_ITEMS = 200;

/**
 * Rule B9: at most 4,000 `documents` rows per user — `MAX_CAREER_ITEMS × the
 * chunker's MAX_CHUNKS_PER_ITEM` (SPEC v2.14). This also stands in for the whole
 * performance section (module M13).
 *
 * It was 500, beside a chunker that produced at most 2 chunks per item
 * (`200 × 2 = 400 ≤ 500`). Semantic-unit chunking (backlog p3-13) makes a
 * 4,000-character item ~14 chunks, so 500 would be reached around the 36th item
 * while B9's only copy still said "Career base limit reached (200 items)" — a
 * reachable state with no true words, which is the exact failure the original
 * reconciliation existed to prevent. Raising this number keeps the ITEM ceiling
 * the binding one, so that sentence stays true.
 *
 * WHY THE RELATION IS PINNED BY A TEST rather than by `MAX_CAREER_ITEMS *
 * MAX_CHUNKS_PER_ITEM` written here: this module and `lib/chunking.ts` must both
 * stay loadable by a bare `node:test` process, which resolves neither the `@/`
 * alias nor a relative `.ts` specifier — so importing one into the other would
 * cost the unit tests that guard both. `tests/unit/chunking.test.mjs` asserts
 * `MAX_CAREER_ITEMS × MAX_CHUNKS_PER_ITEM ≤ MAX_DOCUMENTS` as an executable
 * statement instead, which is the same mechanism that has guarded this pair
 * since v2.10. `ERROR_MESSAGES.DOCUMENT_LIMIT` remains the loud safety net,
 * because "unreachable through the item cap" is a claim about these constants
 * and not a law of nature.
 *
 * The cost is storage, and it is worth stating plainly: 4,000 rows × a
 * 1,536-dimension vector is roughly 25 MB for a user who fills the base to the
 * item cap. That is a real number on a small Postgres instance, and it is the
 * price of retrieval that can tell one bullet from another.
 */
export const MAX_DOCUMENTS = 4_000;
