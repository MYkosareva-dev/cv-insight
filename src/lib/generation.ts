/**
 * What goes INTO the generation and judging prompts, as pure functions.
 *
 * NOT `server-only`, same argument as `lib/budget.ts` and `lib/judge.ts`: these
 * decide the query the retrieval runs and the exact corpus the model is allowed
 * to draw facts from, and both are bounded by numbers that a test should be able
 * to hold the code to. The prompts themselves stay in `lib/prompts.ts`, which is
 * server-only because a system prompt must never travel on the wire.
 */

/** One career item as the generator and the judge are allowed to see it. */
export type GenerationItem = {
  id: string;
  type: string;
  title: string;
  period: string | null;
  content: string;
};

/**
 * How many `documents` rows the vacancy query asks for before the distinct
 * career items behind them are counted (SPEC v2.16, architect finding 4).
 *
 * Block D #5's "top-8 chunks" was written when a chunk was a whole career item.
 * Since v2.14 a chunk is one CLAIM of 80–300 characters and an item may produce
 * up to `MAX_CHUNKS_PER_ITEM = 20` of them, so eight chunks can resolve to a
 * single item — and the v2.14 measurement makes that the likely case, not the
 * edge one: concentration was the defect that round fixed, and one item winning
 * several requirements is exactly what a good chunker produces. Sixty rows is
 * three full items at the per-item ceiling and far more in practice, so the
 * distinct-item count below is what actually bounds the corpus.
 *
 * The cost of the wider ask is one `match_documents` call returning more rows.
 * It is a database read, not a spend: the embedding was already paid for.
 */
export const MATCH_COUNT_FOR_GENERATE = 60;

/**
 * How many DISTINCT career items reach P2 and P3.
 *
 * Eight is a one-page resume's worth of material — three or four roles, a skills
 * block, an education entry — which is what P2 is asked to write. More would not
 * fit the page and would dilute rule 5's "most vacancy-relevant experience in the
 * top third"; fewer would leave the generator writing a resume from two items and
 * either padding or inventing.
 */
export const MAX_GENERATION_ITEMS = 8;

/**
 * A character ceiling on the `<items>` block (architect finding 17).
 *
 * `career_items.content` runs to 4,000 characters, so eight items is up to
 * 32,000 characters into P2 AND into P3 — twice each on a revised run.
 * `MAX_TOKENS_BY_STEP` bounds only the OUTPUT, so nothing else in the pipeline
 * bounds this. Items are added in retrieval order and the first one that would
 * cross the line ends the block, so what survives is the most relevant material
 * rather than an arbitrary prefix of the base.
 *
 * The first item is always kept even if it alone exceeds the budget: a corpus of
 * zero items would make every claim in the resume ungrounded by construction.
 */
export const MAX_ITEMS_CHARS = 24_000;

/**
 * The text whose embedding retrieves the career items (SPEC v2.16, architect
 * finding 5).
 *
 * Block D #5 says "the vacancy summary embedding" and `ParsedVacancy` has no
 * summary field, so the query is DEFINED here rather than left to a reader:
 * the parsed title, every requirement's text, and the keyword list. That is the
 * whole of what the app knows the posting asks for, and it is the same material
 * the coverage map was built from — so the items the generator gets are drawn
 * against the same question the score was measured against.
 *
 * The RAW posting is deliberately not used. It carries benefits, legal
 * boilerplate and company prose, which push the query vector away from the
 * skills the retrieval is meant to find.
 */
export function vacancyQueryText(parsed: {
  title: string;
  requirements: { text: string }[];
  keywords: string[];
}): string {
  return [parsed.title, ...parsed.requirements.map((r) => r.text), parsed.keywords.join(', ')]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n');
}

/**
 * The distinct career items behind a ranked list of chunks, best rank first.
 *
 * The CHUNKS decide which items are relevant; the ITEM ROWS are what the model
 * reads. A chunk is `title + "\n\n" + chunk text` and never carries
 * `career_items.period` — `chunksForItem` is given only the title and the
 * content — while P2 rule 4 demands "Title — Company (period)". A generator with
 * no dates either drops the section or invents one, and an invented date is
 * precisely the ungrounded claim rule B2 exists to catch. So retrieval selects,
 * and the user's own rows supply the facts.
 */
export function distinctItemIds(chunks: { careerItemId: string }[], limit: number): string[] {
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (seen.size >= limit) break;
    seen.add(chunk.careerItemId);
  }
  return [...seen];
}

/**
 * The `<items>` block's payload, bounded by `MAX_ITEMS_CHARS`.
 *
 * Serialised as JSON because the model has to be able to tell one item's period
 * from another's title; prose would run them together and invite exactly the
 * date-shuffling the grounding gate then has to catch.
 */
export function itemsPayload(
  items: GenerationItem[],
  maxChars = MAX_ITEMS_CHARS,
): { payload: GenerationItem[]; dropped: number } {
  const payload: GenerationItem[] = [];
  let used = 0;
  for (const item of items) {
    const size = item.title.length + item.content.length + (item.period?.length ?? 0);
    // The first item is kept unconditionally: an empty corpus makes every claim
    // in the resume ungrounded by construction, which is not a smaller failure.
    if (payload.length > 0 && used + size > maxChars) break;
    payload.push(item);
    used += size;
  }
  return { payload, dropped: items.length - payload.length };
}

/**
 * The retrieved career items as ONE body of text — the corpus P2 and P3 were
 * given, and therefore the corpus every claim about "what your base supports"
 * has to be checked against (SPEC v2.17).
 *
 * It is the items and not the chunks, because the items are what the prompts
 * saw: a term present in an item the retrieval selected is a term the generator
 * could honestly reach for, and one that is not is an invention whoever asks for
 * it. Same shape as the scan's own base corpus, so `keywordPresent` reads the
 * two the same way.
 */
export function itemsCorpus(items: readonly { title: string; content: string }[]): string {
  return items.map((item) => `${item.title}\n${item.content}`).join('\n\n');
}

/*
 * `resumeName()` WAS HERE and is deliberately gone (SPEC v2.17).
 *
 * It read the resume's first non-empty line to build the export filename, on the
 * reasoning that P2 rule 4 puts NAME there. Owner testing found what that line
 * actually held: "Data Annotator", the vacancy's job title, because the career
 * base contains no person's name for the generator to use — so downloads arrived
 * as `CV_Data_Annotator_….docx`. The filename now comes from the user's profile,
 * and the function is removed rather than left unused, because the next reader
 * looking for "the name of this resume" would find it and wire it back.
 */
