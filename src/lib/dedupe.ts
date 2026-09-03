/**
 * Duplicate detection for career items (SPEC v2.11).
 *
 * Pure and NOT `server-only`, for the same reason `scoring.ts`, `chunking.ts` and
 * `pricing.ts` are not: this is the arithmetic of a decision that SKIPS the user's
 * data, and a wrong answer here is invisible. Over-matching silently drops a real
 * career item the user asked to keep; under-matching lets the flat list of exact
 * duplicates come back. Neither shows up as an error, so both need tests, and a
 * test cannot import the route handler that uses this.
 *
 * The trigger was the owner's first live use: importing the same text twice
 * produced an exact second copy of every item, because nothing compared an
 * incoming item against what was already stored.
 */

/**
 * The comparison key for one item: type + normalized title + normalized content.
 *
 * EXACT-duplicate detection only, after normalization. It deliberately does not
 * try to catch near-duplicates — two resumes describing the same job in different
 * words are a genuinely harder problem (embedding similarity, a threshold, a
 * review step) and guessing at it here would silently discard real content. That
 * work is on the backlog as its own item; this closes the case the owner actually
 * hit, where the two strings are character-identical.
 *
 * `type` is part of the key because the same sentence can legitimately appear as
 * both a `role` and an `achievement`; those are different claims about a career,
 * not one claim stored twice.
 *
 * `period` is NOT part of the key. It is free text — "01/2025 – present" versus
 * "Jan 2025 - now" describe one job — so including it would make two spellings of
 * the same date range read as two different items, which is exactly the duplicate
 * the guard is supposed to catch.
 */
export function itemSignature(item: {
  type: string;
  title: string;
  content: string;
}): string {
  // A unit separator, not a space or a dash: it cannot occur in normalized text,
  // so no combination of title and content can forge another item's key.
  return [item.type, normalizeForCompare(item.title), normalizeForCompare(item.content)].join(
    '␟',
  );
}

/**
 * Lower-case, collapse every whitespace run to one space, trim.
 *
 * This is the smallest normalization that catches what actually differs between
 * two extractions of the same document. The same PDF parsed twice can yield
 * different line wrapping and different runs of spaces — pdf.js emits text per
 * positioned run — so a byte-for-byte comparison would report two identical
 * resumes as entirely distinct. Case folding covers a model that re-capitalises a
 * heading between runs.
 *
 * It stops there on purpose. Stripping punctuation or accents would start merging
 * items that differ in meaning, and this function decides what to THROW AWAY.
 */
export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export type DedupeResult<T> = {
  /** Items to save, in their original order. */
  keep: T[];
  /** How many were dropped as duplicates — of stored items, or of each other. */
  skipped: number;
};

/**
 * Split incoming items into what to save and how much was skipped.
 *
 * Compares against BOTH the signatures already stored for this user AND the items
 * earlier in this same batch. The second half matters: one resume can list the
 * same certification twice, and without the in-batch check the first copy would
 * be inserted and the second would only be caught on a later import — so the
 * guard would appear to work while still admitting duplicates on the very path it
 * was written for.
 *
 * Order is preserved, and the FIRST occurrence wins, so the review list the user
 * approved and the items that get saved stay in the same order.
 */
export function dedupeItems<T extends { type: string; title: string; content: string }>(
  incoming: T[],
  existingSignatures: Iterable<string>,
): DedupeResult<T> {
  const seen = new Set(existingSignatures);
  const keep: T[] = [];
  let skipped = 0;

  for (const item of incoming) {
    const signature = itemSignature(item);
    if (seen.has(signature)) {
      skipped += 1;
      continue;
    }
    seen.add(signature);
    keep.push(item);
  }

  return { keep, skipped };
}
