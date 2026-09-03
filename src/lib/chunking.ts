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
 *
 * SEMANTIC UNITS, NOT PACKED PARAGRAPHS (SPEC v2.14, backlog p3-13). Until this
 * revision the chunker packed paragraphs up to 2,000 characters, which for a
 * typical career item meant ONE chunk holding the whole role. Owner testing on
 * the recalibrated build showed why that cannot stand: a chunk that says eight
 * things resembles every requirement a little and therefore WINS almost every
 * comparison, so "Proficient with MS Office or Google Suite" and "Experience
 * with annotation tools such as Labelbox or Supervisely" both came back Covered
 * against a base that mentions none of MS Office, Google Suite, Labelbox or
 * Supervisely — attributed to a generic skills blob. That is not a threshold
 * problem and no threshold can fix it: lowering the bar bought false positives
 * where the old bar bought false negatives, because the ORDERING was wrong.
 * Comparing a one-sentence requirement against a one-sentence claim is what
 * makes the ordering mean something.
 */

/**
 * Floor. A unit shorter than this is merged with its neighbour rather than
 * stored alone.
 *
 * Not a style preference: a 20-character fragment ("SKILLS", "Python, SQL")
 * embeds to a vector dominated by whatever the fragment happens to share with
 * the query, and it carries no context to distinguish a real match from a
 * coincidence. Below roughly this length a chunk is a keyword, and keywords are
 * rule B1a's job, not retrieval's.
 */
export const CHUNK_MIN_CHARS = 80;

/**
 * Target ceiling. A unit longer than this is split at sentence boundaries.
 *
 * One resume bullet is typically 80–250 characters, which is the size of one
 * claim: "Built Python pipelines that de-duplicated incoming datasets". A
 * requirement is the same size. Keeping both sides of the comparison at one
 * claim each is the whole intervention.
 */
export const CHUNK_TARGET_CHARS = 300;

/**
 * Hard ceiling, and the only place a chunk is cut mid-sentence.
 *
 * A single sentence between the target and this bound is stored WHOLE, because
 * splitting one sentence into two vectors gives two halves that each mean less
 * than the sentence did — there is no boundary inside it to cut on. Beyond this
 * bound the dilution argument wins again and the text is split on word
 * boundaries, never mid-word. `text-embedding-3-small` accepts about 32,000
 * characters, so this ceiling is about retrieval quality and never about the
 * model's limit.
 */
export const CHUNK_HARD_MAX_CHARS = 600;

/**
 * A unit whose comma-separated segments average no more than this many
 * characters is treated as an enumeration and split on its commas.
 *
 * 45 characters is comfortably longer than a skill name ("BPMN process
 * modeling", "annotation quality assurance") and comfortably shorter than a
 * clause of prose, which is the distinction being drawn. It is a shape test, not
 * a meaning test — see `looksEnumerated`.
 */
export const ENUMERATION_MEAN_SEGMENT_CHARS = 45;

/**
 * At most this many `documents` rows per career item — and the number rule B9's
 * document ceiling is DERIVED from (`lib/limits.ts`).
 *
 * B9 caps 200 `career_items` and, separately, the `documents` rows per user.
 * Nothing reconciled those two numbers when they were written: at 4,000
 * characters per item, a small chunk size lets 200 legal items produce far more
 * documents than the stated ceiling, so a user legal under one cap is illegal
 * under the other — and the only copy B9 provides says "Career base limit
 * reached (200 items)", which is false when the document cap is what tripped.
 *
 * The reconciliation used to be `2 chunks × 200 items = 400 ≤ 500`. With
 * semantic units it is the other way round: this constant is chosen from the
 * content bound (a 4,000-character item at the 300-character target is ~14
 * chunks, and 20 leaves headroom for bullet-dense items), and `MAX_DOCUMENTS` is
 * derived from it, so the two can no longer disagree. Overflow beyond the cap is
 * MERGED, never dropped — see `capChunks`.
 */
export const MAX_CHUNKS_PER_ITEM = 20;

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

/** A line that begins a list item: -, *, •, –, —, or "1." / "1)" numbering. */
const BULLET_LINE = /^\s*(?:[-*•–—]|\d{1,2}[.)])\s+/;

/**
 * Content → semantic units, before any merging or splitting.
 *
 * A bullet line is its own unit even when its neighbours are bullets too: the
 * author already decided those are separate claims, and that decision is better
 * than any heuristic this file could apply. Consecutive NON-bullet lines are
 * joined into one paragraph unit, because a hard-wrapped paragraph is one claim
 * broken by a line width, not several claims.
 */
function unitsOf(content: string): string[] {
  const units: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    units.push(paragraph.join(' ').replace(/\s+/g, ' ').trim());
    paragraph = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushParagraph();
      continue;
    }
    if (BULLET_LINE.test(rawLine)) {
      flushParagraph();
      units.push(line.replace(BULLET_LINE, '').replace(/\s+/g, ' ').trim());
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  return units.filter((unit) => unit.length > 0);
}

/**
 * Does this unit read as a LIST rather than as prose?
 *
 * The case that forced this question (SPEC v2.14, measured): P4 writes a
 * resume's skills section as one 215-character enumeration —
 * "LLM evaluation, annotation quality assurance, …, English C1, Russian native"
 * — which is under the target and contains neither a bullet nor a sentence
 * boundary, so bullet-and-sentence splitting leaves it whole. It is twelve
 * claims in one chunk, and it behaved exactly like the 2,000-character blobs
 * this revision removed: in the first measured run after semantic chunking it
 * was still the best match for FIVE of eight requirements, including two the
 * base does not support.
 *
 * A comma is therefore a semantic boundary too, but only where the commas are
 * separating ITEMS rather than clauses — otherwise every prose sentence with an
 * aside would be shredded. Two conditions, both measured against the shape of
 * the text rather than its meaning: at least four segments, and segments that
 * are short on average. A clause is a phrase; a list item is a term.
 */
function looksEnumerated(unit: string): boolean {
  const segments = unit.split(/\s*[;,]\s+/).filter((segment) => segment.length > 0);
  if (segments.length < 4) return false;
  const mean = segments.reduce((sum, segment) => sum + segment.length, 0) / segments.length;
  return mean <= ENUMERATION_MEAN_SEGMENT_CHARS;
}

/** Split a list into its items. Merging afterwards puts short ones back together. */
function enumerationItems(unit: string): string[] {
  return unit
    .split(/\s*[;,]\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * One unit → sentences, when the unit is over the target.
 *
 * The split is on terminal punctuation followed by whitespace. It is imperfect
 * on abbreviations ("e.g. this") and deliberately not defended against them: an
 * over-eager split produces a short fragment, and the merge pass immediately
 * afterwards puts short fragments back together with their neighbour. The
 * failure mode is self-healing, which is worth more here than a longer regex.
 */
function sentencesOf(unit: string): string[] {
  if (unit.length <= CHUNK_TARGET_CHARS) return [unit];
  const parts = unit
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 1 ? parts : [unit];
}

/** Break one over-long sentence on word boundaries, never mid-word. */
function splitOnWords(text: string): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > CHUNK_HARD_MAX_CHARS && current) {
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
 * Merge units that are below the floor into their neighbour.
 *
 * A chunk grows ONLY while it is under `CHUNK_MIN_CHARS`. That is the difference
 * between this and a packing chunker: two 150-character bullets stay two chunks
 * rather than being glued into one 300-character chunk, because they are two
 * claims and a query that matches one of them should not have to out-score the
 * other. A trailing chunk left under the floor is merged BACKWARDS into the
 * previous one — the alternative is storing the fragment alone, which is the
 * thing the floor exists to prevent.
 */
function mergeSmall(units: string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    if (current.length < CHUNK_MIN_CHARS) {
      current = `${current} ${unit}`;
      continue;
    }
    chunks.push(current);
    current = unit;
  }
  if (current) chunks.push(current);

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1]!;
    if (last.length < CHUNK_MIN_CHARS) {
      chunks.splice(chunks.length - 2, 2, `${chunks[chunks.length - 2]!} ${last}`);
    }
  }
  return chunks;
}

/**
 * Enforce MAX_CHUNKS_PER_ITEM by merging the SMALLEST adjacent pair, repeatedly,
 * never by dropping anything.
 *
 * The previous implementation merged all overflow into the final chunk, which
 * under a 2-chunk cap was harmless and under a 20-chunk cap would rebuild the
 * exact defect this revision exists to remove: a bullet-dense item would end
 * with nineteen small chunks and one blob holding everything else. Merging the
 * smallest neighbours keeps the sizes even, so an item that hits the cap
 * degrades toward slightly-coarser chunks rather than toward one blob.
 *
 * Dropping is never an option: it would silently delete part of the user's own
 * career history from the index while the item still looked fully indexed.
 */
function capChunks(chunks: string[]): string[] {
  const out = [...chunks];
  while (out.length > MAX_CHUNKS_PER_ITEM) {
    let at = 0;
    let smallest = Infinity;
    for (let i = 0; i < out.length - 1; i += 1) {
      const size = out[i]!.length + out[i + 1]!.length;
      if (size < smallest) {
        smallest = size;
        at = i;
      }
    }
    out.splice(at, 2, `${out[at]!} ${out[at + 1]!}`);
  }
  return out;
}

/**
 * Career-item content → chunk texts, WITHOUT the title prefix. Callers wrap each
 * with `withTitle`.
 *
 * Five passes, in this order: units (bullets and paragraphs), sentences (for
 * units over the target), word-splitting (for sentences over the hard ceiling),
 * enumeration-splitting (for sentences that are lists rather than prose), then
 * merging (for anything under the floor) and the cap. Splitting before merging
 * is what lets an over-long bullet become two chunks whose halves are each still
 * a claim, instead of one chunk and one fragment — and it is why the merge pass
 * can be as simple as "grow while under the floor".
 *
 * Returns `[]` for blank content — never `['']`. An empty string would embed to a
 * meaningless vector and put a row in `documents` that can match a query while
 * carrying no information; the DB CHECK on `career_items.content` means the caller
 * should never see this, and returning nothing is the honest answer if it does.
 */
export function chunkContent(content: string): string[] {
  const units = unitsOf(content);
  if (units.length === 0) return [];

  const pieces: string[] = [];
  for (const unit of units) {
    for (const sentence of sentencesOf(unit)) {
      if (sentence.length > CHUNK_HARD_MAX_CHARS) pieces.push(...splitOnWords(sentence));
      else if (looksEnumerated(sentence)) pieces.push(...enumerationItems(sentence));
      else pieces.push(sentence);
    }
  }

  return capChunks(mergeSmall(pieces));
}

/** Every stored `documents.content` for one item: chunked, each title-prefixed. */
export function chunksForItem(title: string, content: string): string[] {
  return chunkContent(content).map((chunk) => withTitle(title, chunk));
}
