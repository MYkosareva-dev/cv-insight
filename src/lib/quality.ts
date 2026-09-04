/**
 * The /quality dashboard's arithmetic (SPEC Block E, Block H item 7, v2.20).
 *
 * PURE, and deliberately NOT `server-only`, for the reason that moved
 * `lib/pricing.ts`, `lib/budget.ts` and `lib/judge.ts` out of files a test cannot
 * import: check.mjs R6 keeps `tests/` away from the DALs, and this screen is the
 * product's own evidence that quality is MEASURED rather than asserted. Evidence
 * computed by untested arithmetic is not evidence. Nothing here reads a secret,
 * a request or the database — it is given rows and returns numbers.
 *
 * EVERY FIGURE NAMES ITS ROWS. That is the constraint this whole module is shaped
 * by: no output below is a number whose source a reader cannot point at, and
 * where a share has a denominator, the denominator is returned alongside it
 * rather than divided away. A dashboard whose "auto-revision rate: 33%" cannot be
 * traced to "1 of 3 runs" is asking to be believed instead of read — and on a
 * screen about whether the app's own quality gate works, that is the one thing it
 * must not do.
 *
 * NOTHING HERE INVENTS A ZERO. `null` is returned wherever there is nothing to
 * measure, and the page renders that as its own state. It is the same discipline
 * rule B1b applies to a score with no signal and `judge: null` applies to a check
 * that did not run: a 0% with no observations behind it is a measurement nobody
 * took.
 */

/** The rows this module reads, structurally — never the `server-only` types. */
export type CallRow = {
  step: string;
  model: string;
  fallback_used: boolean;
  ok: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micro: number;
  cost_known: boolean;
  latency_ms: number;
  application_id: string | null;
  created_at: string;
};

export type VersionRow = {
  id: string;
  application_id: string;
  source: 'ai' | 'ai_revision' | 'user';
  judge: {
    grounding: { verdict: 'pass' | 'fail' };
    keywordCoverage: { score: number };
    relevance: { score: number };
    atsFormat: { score: number };
    verdict: 'approve' | 'revise';
  } | null;
  created_at: string;
};

/**
 * Below this many observations, a share is reported as a COUNT and labelled as
 * too thin to read as a rate.
 *
 * Five, and the number is a judgement rather than a derivation — which is worth
 * saying plainly, because a threshold that looks statistical and is not would be
 * exactly the sort of unfounded figure this screen exists not to print. What it
 * encodes: at four runs every share is a multiple of 25%, so the percentage
 * carries less information than the fraction it came from, and printing it
 * implies a precision the observations do not have. The page shows the fraction
 * either way; this decides whether it also shows a percentage.
 */
export const SMALL_SAMPLE = 5;

/** A share with its own denominator attached, so neither can be read alone. */
export type Share = {
  count: number;
  of: number;
  /** null when `of` is 0 — there is nothing to take a share OF. */
  percent: number | null;
  /** True when `of` is below `SMALL_SAMPLE`: read the fraction, not the rate. */
  thin: boolean;
};

export function share(count: number, of: number): Share {
  return {
    count,
    of,
    percent: of > 0 ? Math.round((count / of) * 100) : null,
    // A sample of NOTHING is not a thin sample: "too few runs to read as a rate"
    // is a statement about observations, and there are none to be too few of.
    // `of === 0` has its own rendering ("Nothing measured yet").
    thin: of > 0 && of < SMALL_SAMPLE,
  };
}

// ---------------------------------------------------------------------------
// llm_calls
// ---------------------------------------------------------------------------

export type StepSummary = {
  step: string;
  calls: number;
  costUsdMicro: number;
  /** Rows whose serving model had no price entry — cost NOT included above. */
  unknownPricing: number;
  failed: number;
  /** Mean latency in ms over the step's rows, or null when there are none. */
  meanLatencyMs: number | null;
  /**
   * How often THIS step was served by the fallback model, as a share of its own
   * calls.
   *
   * PER STEP AND NOT ONLY IN TOTAL, because the total hides the condition that
   * matters. A single step at 100% while every other step is at 0% is not a
   * degraded service — it is one configured model that is never served, and the
   * blended figure reads as a mild 20% and invites no question. That is exactly
   * how the generate step went a whole phase being written by the fallback while
   * the app reported nothing.
   */
  fallbackShare: Share;
  /** The models that actually served this step, most-used first. */
  models: string[];
};

export type CallSummary = {
  calls: number;
  /** Sum of `cost_usd_micro` over every row read. */
  totalCostMicro: number;
  /**
   * The same sum restricted to rows carrying an `application_id`, and its
   * complement.
   *
   * SPLIT AND NOT BLENDED, because the two answer different questions and only
   * the first divides by a run. An `import_resume` call and a career-item
   * indexing embed have no application: they are the cost of building the base,
   * not of any one pipeline run, and averaging them into a per-run figure would
   * charge a run for work done before it existed.
   */
  attributableCostMicro: number;
  unattributedCostMicro: number;
  /**
   * Distinct non-null `application_id` values — and the field is named for that
   * rather than for "runs", which is what it was called first.
   *
   * AN APPLICATION IS NOT A RUN, and since [Regenerate] the difference is
   * reachable: one application can hold several AI runs, so a figure divided by
   * applications is not the cost of one generation. `rubricOutcomes.runs` below
   * counts runs, and two quantities under one word on a screen whose one rule is
   * traceability is the defect, not the arithmetic — an `llm_calls` row can be
   * attributed to an application and cannot name a `resume_versions` run, so the
   * name moved to match the arithmetic rather than the other way round.
   */
  applicationsWithCalls: number;
  /** `attributableCostMicro / applicationsWithCalls`, or null when there are none. */
  costPerApplicationMicro: number | null;
  /** Rows where OpenRouter's `models` array fell through to the fallback. */
  fallbackCalls: number;
  fallbackShare: Share;
  /** Rows written with `cost_known = false`: priced at 0 and NOT counted above. */
  unknownPricingCalls: number;
  /** Rows with `ok = false` — a request that was made and did not succeed. */
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  byStep: StepSummary[];
};

/**
 * Every figure the call tiles show, from the rows the page read.
 *
 * IT READS NO CLOCK, deliberately. The rolling-24-hour figures this screen shows
 * are rule B7's and rule B7a's own counters, answered by the DAL queries the caps
 * themselves use — so the tile shows the number the cap compares against rather
 * than a second count of the same window computed a different way. Two
 * implementations of one rolling window is how a dashboard comes to disagree with
 * the rule it is illustrating, and it also keeps this function a function of its
 * arguments alone.
 */
export function summariseCalls(rows: readonly CallRow[]): CallSummary {
  const applications = new Set<string>();
  let totalCostMicro = 0;
  let attributableCostMicro = 0;
  let unattributedCostMicro = 0;
  let fallbackCalls = 0;
  let unknownPricingCalls = 0;
  let failedCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const steps = new Map<
    string,
    {
      calls: number;
      cost: number;
      unknown: number;
      failed: number;
      latency: number;
      fallback: number;
      models: Map<string, number>;
    }
  >();

  for (const row of rows) {
    totalCostMicro += row.cost_usd_micro;
    if (row.application_id) {
      applications.add(row.application_id);
      attributableCostMicro += row.cost_usd_micro;
    } else {
      unattributedCostMicro += row.cost_usd_micro;
    }
    if (row.fallback_used) fallbackCalls += 1;
    if (!row.cost_known) unknownPricingCalls += 1;
    if (!row.ok) failedCalls += 1;
    tokensIn += row.tokens_in;
    tokensOut += row.tokens_out;

    const step =
      steps.get(row.step) ??
      {
        calls: 0,
        cost: 0,
        unknown: 0,
        failed: 0,
        latency: 0,
        fallback: 0,
        models: new Map<string, number>(),
      };
    step.calls += 1;
    step.cost += row.cost_usd_micro;
    step.latency += row.latency_ms;
    if (!row.cost_known) step.unknown += 1;
    if (!row.ok) step.failed += 1;
    if (row.fallback_used) step.fallback += 1;
    step.models.set(row.model, (step.models.get(row.model) ?? 0) + 1);
    steps.set(row.step, step);
  }

  const applicationsWithCalls = applications.size;
  return {
    calls: rows.length,
    totalCostMicro,
    attributableCostMicro,
    unattributedCostMicro,
    applicationsWithCalls,
    // Integer micro-USD throughout: the column is an integer and money in this
    // app is never a float (Block A's own decision).
    costPerApplicationMicro:
      applicationsWithCalls > 0
        ? Math.round(attributableCostMicro / applicationsWithCalls)
        : null,
    fallbackCalls,
    fallbackShare: share(fallbackCalls, rows.length),
    unknownPricingCalls,
    failedCalls,
    tokensIn,
    tokensOut,
    byStep: [...steps.entries()]
      .map(([step, totals]) => ({
        step,
        calls: totals.calls,
        costUsdMicro: totals.cost,
        unknownPricing: totals.unknown,
        failed: totals.failed,
        meanLatencyMs: totals.calls > 0 ? Math.round(totals.latency / totals.calls) : null,
        fallbackShare: share(totals.fallback, totals.calls),
        models: [...totals.models.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([model]) => model),
      }))
      // Most-used step first; the name breaks a tie so the table does not
      // reorder itself between two renders of the same data.
      .sort((a, b) => b.calls - a.calls || a.step.localeCompare(b.step)),
  };
}

// ---------------------------------------------------------------------------
// The rubric outcome of each generate run
// ---------------------------------------------------------------------------

/**
 * WHAT A "RUN" IS, on this screen: one `ai` row, plus the `ai_revision` row that
 * follows it before the next `ai` row of the same application.
 *
 * That rule comes straight from the pipeline. `POST …/generate` writes exactly
 * one `ai` row, and rule B3 permits at most one `ai_revision` after it; a
 * regenerate (v2.20) writes another pair onto the same application, which is why
 * an application is NOT the unit here and grouping by it would merge two runs
 * into one verdict. `user` rows are excluded outright — they are the user's own
 * edits and an on-demand [Check quality], not an AI run.
 */
export type RunOutcome =
  | 'approved_first'
  | 'revised_approved'
  | 'revised_still_revise'
  | 'revise_no_rewrite'
  | 'not_checked';

export type RubricOutcomes = {
  runs: number;
  /** The judge approved the first draft — 2 chat calls, the common case. */
  approvedFirst: Share;
  /** Rule B3's one revision ran and the rewrite was approved. */
  revisedApproved: Share;
  /** The revision ran and the rewrite was STILL refused. */
  revisedStillRevise: Share;
  /**
   * The reviewer refused the draft and no rewrite happened: either it listed
   * nothing specific to act on (SPEC v2.16 note 7) or the cap or the service
   * refused the rewrite step (note 13). Its own bucket, because a run that was
   * never rewritten is not a run whose rewrite failed.
   */
  reviseNoRewrite: Share;
  /**
   * The quality check DID NOT RUN — `judge` is null on the `ai` row (rule B7
   * refusing the judge step, or the model being unavailable for it). Never
   * folded into a pass or a failure: the whole point of the third state is that
   * an unmeasured resume is not a measured one.
   */
  notChecked: Share;
};

/** Within one timestamp, a draft precedes its rewrite. `user` rows never reach here. */
const SOURCE_ORDER: Record<VersionRow['source'], number> = { ai: 0, ai_revision: 1, user: 2 };

/** Group the version rows into runs and classify each one. */
export function classifyRuns(versions: readonly VersionRow[]): RunOutcome[] {
  const byApplication = new Map<string, VersionRow[]>();
  for (const version of versions) {
    if (version.source === 'user') continue;
    const list = byApplication.get(version.application_id) ?? [];
    list.push(version);
    byApplication.set(version.application_id, list);
  }

  const outcomes: RunOutcome[] = [];
  for (const list of byApplication.values()) {
    /**
     * Oldest first, so an `ai` row is followed by its own revision — and a TIE
     * puts the draft ahead of the rewrite.
     *
     * The tie-break is not decoration: the orphan branch below reads the row
     * BEFORE a revision to decide whether it has a draft, and the sort is stable,
     * so a tie would keep whatever order the caller passed. The DAL returns
     * newest-first, so a tied pair arrived rewrite-first and was counted TWICE —
     * once as an orphan run and once as the draft's own refusal-with-no-rewrite.
     * `mergeVersionsNewestFirst` pins the same case on the same argument: the two
     * inserts are separate transactions with distinct `now()` values, so this is
     * defensive rather than expected.
     */
    const ordered = [...list].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source],
    );
    for (let i = 0; i < ordered.length; i += 1) {
      const row = ordered[i]!;
      if (row.source === 'ai') {
        const next = ordered[i + 1];
        const revision = next?.source === 'ai_revision' ? next : null;
        outcomes.push(outcomeOf(row, revision));
        continue;
      }
      /**
       * AN ORPHAN REWRITE IS STILL A RUN. `ai_revision` with no `ai` before it
       * happens at the WINDOW BOUNDARY: the read is newest-first, so truncation
       * cuts the oldest rows and can take a draft while leaving its rewrite. The
       * first version of this loop only ever started a run at an `ai` row, so
       * that run disappeared from all five buckets — while the same row went on
       * being counted in `rubricDistribution`, leaving two denominators
       * disagreeing with nothing on screen to say a row had been dropped.
       *
       * The rewrite is the version that was KEPT, so its own verdict is the
       * run's outcome, which is exactly what `outcomeOf` reads from a revision
       * when the draft is present. Nothing is invented: the draft's verdict is
       * unknown and is not needed.
       */
      if (row.source === 'ai_revision') {
        const previous = ordered[i - 1];
        if (previous?.source !== 'ai') outcomes.push(outcomeOf(row, row));
      }
    }
  }
  return outcomes;
}

function outcomeOf(draft: VersionRow, revision: VersionRow | null): RunOutcome {
  if (revision) {
    /**
     * A revision with no report of its own is `not_checked` for the RUN, not a
     * failure: the rewrite happened and the second judge step was refused (SPEC
     * v2.16 note 9 covers exactly this), so nobody measured the text that was
     * kept.
     */
    if (!revision.judge) return 'not_checked';
    return revision.judge.verdict === 'approve' ? 'revised_approved' : 'revised_still_revise';
  }
  if (!draft.judge) return 'not_checked';
  return draft.judge.verdict === 'approve' ? 'approved_first' : 'revise_no_rewrite';
}

export function rubricOutcomes(versions: readonly VersionRow[]): RubricOutcomes {
  const outcomes = classifyRuns(versions);
  const runs = outcomes.length;
  const count = (kind: RunOutcome) => outcomes.filter((outcome) => outcome === kind).length;
  return {
    runs,
    approvedFirst: share(count('approved_first'), runs),
    revisedApproved: share(count('revised_approved'), runs),
    revisedStillRevise: share(count('revised_still_revise'), runs),
    reviseNoRewrite: share(count('revise_no_rewrite'), runs),
    notChecked: share(count('not_checked'), runs),
  };
}

// ---------------------------------------------------------------------------
// The score distribution, per rubric criterion
// ---------------------------------------------------------------------------

export const CRITERION_KEYS = ['keywordCoverage', 'relevance', 'atsFormat'] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

export type CriterionDistribution = {
  criterion: CriterionKey;
  /** Counts at 1, 2, 3, 4, 5 — index 0 is a score of 1. */
  counts: [number, number, number, number, number];
  /** How many judged versions contributed. The denominator of every count. */
  judged: number;
  /** Mean score, or null when nothing was judged. */
  mean: number | null;
};

export type GroundingTally = { pass: number; fail: number; judged: number };

export type RubricDistribution = {
  /**
   * EVERY judged version, including the user's own [Check quality] rows — this is
   * the distribution of what the REVIEWER said, and it said it about those too.
   * The run shares above are about AI runs and exclude them; the two answer
   * different questions and the screen labels each with its own denominator.
   */
  judged: number;
  criteria: CriterionDistribution[];
  /**
   * Grounding is a GATE, not a score (rule B2), so it is counted and never
   * averaged into the three above. A mean over pass/fail would be a number with
   * no unit sitting beside three that have one.
   */
  grounding: GroundingTally;
};

const clampScore = (score: number): number => Math.min(5, Math.max(1, Math.round(score)));

export function rubricDistribution(versions: readonly VersionRow[]): RubricDistribution {
  const judged = versions.filter((version) => version.judge !== null);
  const grounding: GroundingTally = { pass: 0, fail: 0, judged: judged.length };
  const criteria: CriterionDistribution[] = CRITERION_KEYS.map((criterion) => ({
    criterion,
    counts: [0, 0, 0, 0, 0],
    judged: judged.length,
    mean: null,
  }));

  const totals = new Map<CriterionKey, number>(CRITERION_KEYS.map((key) => [key, 0]));
  for (const version of judged) {
    const report = version.judge!;
    if (report.grounding.verdict === 'pass') grounding.pass += 1;
    else grounding.fail += 1;
    for (const entry of criteria) {
      const score = clampScore(report[entry.criterion].score);
      // `clampScore` guarantees 1-5, so the index is in range; the compiler
      // cannot see that through a tuple index, and a `!` here would assert what
      // the clamp already enforces.
      entry.counts[score - 1] = (entry.counts[score - 1] ?? 0) + 1;
      totals.set(entry.criterion, (totals.get(entry.criterion) ?? 0) + score);
    }
  }

  for (const entry of criteria) {
    entry.mean =
      judged.length > 0
        ? // One decimal: the scores are integers 1-5, and two decimals on a mean
          // of three observations reads as precision nobody measured.
          Math.round((totals.get(entry.criterion)! / judged.length) * 10) / 10
        : null;
  }

  return { judged: judged.length, criteria, grounding };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Micro-USD as dollars, formatted only at display (Block A's decision: money is
 * an integer everywhere else in this app).
 *
 * FOUR DECIMALS, because the sums here are small: a Haiku parse costs a few
 * hundred micro-USD, and `$0.00` for a run that cost 430 of them would report a
 * real spend as nothing — the same failure `cost_known` exists to prevent one
 * layer down. A total large enough not to need them still reads correctly.
 */
export function formatUsdFromMicro(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Which model wrote this resume (v2.22)
// ---------------------------------------------------------------------------

/**
 * What served the `generate` step for ONE application.
 *
 * THE PRODUCT HAS TO BE ABLE TO SAY WHICH MODEL WROTE A RESUME. Owner testing
 * found every generate call being served by the fallback — the configured Sonnet
 * slug is blocked by a guardrail on the provider account, so `models: [primary,
 * fallback]` routing silently used the second entry on every run for a whole
 * phase. The dashboard could show that; the person holding the resume could not,
 * and they are the one it matters to.
 *
 * BUILT FROM `llm_calls` AND NOTHING NEW. `resume_versions` has no model column
 * and adding one would be a migration; the log already records the model that
 * actually served, with the application id threaded through since v2.16. So the
 * claim this can make is about the APPLICATION's generations rather than about
 * one version, and the copy says so in those terms rather than pretending to a
 * precision the data does not carry.
 *
 * `calls` COUNTS REQUESTS, not runs: a step that spent its single repair retry
 * wrote two rows. That is the honest unit here, because the question is which
 * model answered, and each request has its own answer.
 */
export type GenerationProvenance = {
  /** `generate` rows read for this application. Requests, not runs. */
  calls: number;
  /** The model that served most recently, or null when nothing has generated. */
  newestModel: string | null;
  /** Whether that most recent call fell through to the fallback. */
  newestFallback: boolean;
  /** True when EVERY generate call for this application fell back. */
  allFallback: boolean;
  /** Distinct serving models, newest first. */
  models: string[];
};

export const NO_GENERATION: GenerationProvenance = {
  calls: 0,
  newestModel: null,
  newestFallback: false,
  allFallback: false,
  models: [],
};

/** Newest-first `generate` rows for one application. */
export function generationProvenance(rows: readonly CallRow[]): GenerationProvenance {
  const generates = rows.filter((row) => row.step === 'generate');
  if (generates.length === 0) return NO_GENERATION;

  const newest = generates[0]!;
  const models: string[] = [];
  for (const row of generates) if (!models.includes(row.model)) models.push(row.model);

  return {
    calls: generates.length,
    newestModel: newest.model,
    newestFallback: newest.fallback_used,
    // `every` over a non-empty list, so this cannot be vacuously true.
    allFallback: generates.every((row) => row.fallback_used),
    models,
  };
}
