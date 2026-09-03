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
 * Rule B9: at most 500 `documents` rows per user.
 *
 * A separate ceiling from the item count, not a derived one: one career item can
 * chunk into several rows, so 200 items do not imply 200 documents. This is also
 * what stands in for the whole performance section (module M13).
 */
export const MAX_DOCUMENTS = 500;
