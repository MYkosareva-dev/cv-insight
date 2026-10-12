/**
 * The shape of `resume_versions.retrieval_log` (SPEC v3.0 §5 item 6, amended),
 * and the two reads every consumer needs.
 *
 * ITS OWN FILE, WITH NO IMPORTS, because three sides read it: the loop that
 * writes it (`lib/agentic.ts`), the dashboard that counts it (`lib/quality.ts`)
 * and the editor that renders it in the BROWSER. The loop module imports the
 * budget, the budget imports the plan table, and the plan module can load a
 * server-only DAL — so a client component may not import the loop module, and
 * the log's shape cannot live there.
 */

export type RefusalReason = 'budget' | 'invalid_arguments' | 'deadline';

/**
 * One search. `failed` is the third retrieval outcome and is never rendered as
 * "0 found"; `reason` says WHY a call was refused, so the screen never claims a
 * budget that was not the cause. Queries, counts, scores and item TITLES —
 * never chunk text, never item content.
 */
export type SearchLogEntry = {
  round: number;
  query: string;
  chunks: number | null;
  bestSimilarity: number | null;
  itemTitles: string[];
  refused: boolean;
  reason: RefusalReason | null;
  failed: boolean;
  /**
   * On a refused entry: how many calls were refused for this reason in the run.
   * One entry per reason, never one per call, so a flood of calls cannot grow
   * the log past its 64 KB CHECK. Absent on an executed search.
   */
  count?: number;
};

/** The terminal entry of a run whose loop ended on an erroring round. */
export type EndedLogEntry = { round: number; ended: 'round_error' };

export type RetrievalLogEntry = SearchLogEntry | EndedLogEntry;

export const isEndedEntry = (entry: RetrievalLogEntry): entry is EndedLogEntry =>
  'ended' in entry;

/** Searches that actually executed — refused calls excluded, failed ones included. */
export function executedSearches(log: readonly RetrievalLogEntry[] | null): number {
  if (!log) return 0;
  return log.filter((entry) => !isEndedEntry(entry) && !entry.refused).length;
}
