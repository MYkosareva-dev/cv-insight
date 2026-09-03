/**
 * Career-item text → the chunks that become `documents` rows.
 *
 * Pure functions, no I/O and deliberately NOT `server-only`: the same reason
 * `lib/scoring.ts` is not. The indexing path runs inside the `lib/retrieval.ts`
 * gate, which a `node:test` process cannot import (`server-only` resolves to a
 * module that throws outside a React-server build), so any part of indexing that
 * deserves a unit test has to live in a module the test can actually load.
 *
 * ONE `documents` row per career-item chunk, and every stored chunk's `content`
 * is `title + "\n\n" + chunk text` (CLAUDE.md, Embeddings). The title is STORED,
 * not merely embedded, so an item stays findable by its own name from any chunk —
 * and so `lib/retrieval.ts` can log which item matched without ever printing
 * chunk text.
 */

/**
 * Target chunk size in characters.
 *
 * A career item's `content` is capped at 4,000 characters by the CHECK constraint
 * in 001_init.sql, so most items are a single chunk and this bound only bites on
 * the long ones. It is chosen for RETRIEVAL, not for the token limit: a whole
 * multi-paragraph role averaged into one 1,536-dim vector retrieves worse than the
 * same role as two vectors, because one strongly-matching paragraph gets diluted
 * by the rest. Splitting costs nothing — embeddings are priced per token, and the
 * token count is the same either way.
 *
 * The VALUE is then pinned by rule B9 rather than by taste — see
 * MAX_CHUNKS_PER_ITEM.
 */
export const CHUNK_TARGET_CHARS = 2_000;

/**
 * Hard ceiling per chunk. A single paragraph longer than this is split on
 * whitespace rather than stored whole: `text-embedding-3-small` truncates at its
 * own context limit silently, and a silently truncated vector is worse than a
 * split one because nothing reports it.
 */
export const CHUNK_MAX_CHARS = 2_600;

/**
 * At most this many `documents` rows per career item — and this is the number
 * that makes rule B9 self-consistent.
 *
 * B9 caps 200 `career_items` AND 500 `documents` per user, as two independent
 * ceilings. Nothing reconciles them: at 4,000 characters per item, a small chunk
 * size lets 200 legal items produce well over 500 documents, so a user who is
 * legal under one cap is illegal under the other — and the only copy B9 provides
 * says "Career base limit reached (200 items)", which is false when the document
 * cap is what tripped.
 *
 * 200 items × 2 chunks = 400 ≤ 500, so the document ceiling cannot be reached
 * through the item ceiling and the item-count message is always the true one.
 * (`ERROR_MESSAGES.DOCUMENT_LIMIT` still exists as a real safety net, because a
 * future change to these constants must fail loudly rather than silently.)
 *
 * Packing alone cannot provide this guarantee: chunks flush when the NEXT
 * paragraph would exceed the target, so a run of paragraphs just over half the
 * target yields one chunk each, and the count follows the input's paragraph
 * structure rather than any constant here. Hence an explicit cap, with the
 * overflow merged into the final chunk instead of dropped.
 */
export const MAX_CHUNKS_PER_ITEM = 2;

/** `title + "\n\n" + chunk` — the stored `documents.content` shape. */
export function withTitle(title: string, chunk: string): string {
  return `${title}\n\n${chunk}`;
}

/**
 * The inverse, for logging only: the career-item title a stored chunk carries.
 *
 * `lib/retrieval.ts` prints one line per considered chunk in development — item
 * title and similarity — and it gets the title from here. Chunk TEXT is never
 * printed in either mode, which is exactly what storing the title buys.
 */
export function titleOf(storedContent: string): string {
  return storedContent.split('\n\n', 1)[0] ?? '';
}

/** Split on blank lines, dropping empties and normalising interior whitespace runs. */
function paragraphsOf(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Break one over-long paragraph on word boundaries, never mid-word. */
function splitLongParagraph(paragraph: string): string[] {
  const words = paragraph.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > CHUNK_MAX_CHARS && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Career-item content → chunk texts, WITHOUT the title prefix. Callers wrap each
 * with `withTitle`.
 *
 * Paragraphs are the unit: a resume bullet block is already the author's own
 * semantic split, and cutting mid-sentence at a fixed character count is what
 * makes naive chunkers retrieve badly. Adjacent paragraphs are packed together
 * while they fit under CHUNK_TARGET_CHARS, so a three-line item stays one chunk
 * instead of becoming three thin vectors.
 *
 * Returns `[]` for blank content — never `['']`. An empty string would embed to a
 * meaningless vector and put a row in `documents` that can match a query while
 * carrying no information; the DB CHECK on `career_items.content` means the caller
 * should never see this, and returning nothing is the honest answer if it does.
 */
export function chunkContent(content: string): string[] {
  const paragraphs = paragraphsOf(content);
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > CHUNK_MAX_CHARS) {
      flush();
      chunks.push(...splitLongParagraph(paragraph));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > CHUNK_TARGET_CHARS && current) {
      flush();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  flush();

  return capChunks(chunks);
}

/**
 * Enforce MAX_CHUNKS_PER_ITEM by MERGING the overflow into the last kept chunk,
 * never by dropping it.
 *
 * Dropping would silently delete part of the user's own career history from the
 * index — the item would still look indexed, and the missing paragraph would just
 * never match anything. Merging makes the last chunk longer than CHUNK_MAX_CHARS,
 * which is safe here for a reason worth stating: `career_items.content` is capped
 * at 4,000 characters, and `text-embedding-3-small` accepts 8,191 tokens (roughly
 * 32,000 characters), so even a maximal item merged whole is an order of magnitude
 * inside the model's limit. The ceiling exists to avoid SILENT truncation, and
 * this cannot reach it.
 */
function capChunks(chunks: string[]): string[] {
  if (chunks.length <= MAX_CHUNKS_PER_ITEM) return chunks;
  const kept = chunks.slice(0, MAX_CHUNKS_PER_ITEM - 1);
  const merged = chunks.slice(MAX_CHUNKS_PER_ITEM - 1).join('\n\n');
  return [...kept, merged];
}

/** Every stored `documents.content` for one item: chunked, each title-prefixed. */
export function chunksForItem(title: string, content: string): string[] {
  return chunkContent(content).map((chunk) => withTitle(title, chunk));
}
