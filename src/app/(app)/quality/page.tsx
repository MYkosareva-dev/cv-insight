import { LLM_STEP_LABEL, QUALITY, formatCount } from '@/lib/copy';
import { DAILY_CALL_LIMIT, DAILY_RESCORE_LIMIT } from '@/lib/budget';
import {
  QUALITY_CALL_WINDOW,
  countCallsInLast24h,
  countRescoreCallsInLast24h,
  listLlmCallsForQuality,
  listRecentLlmCalls,
} from '@/lib/db/llmCalls';
import {
  QUALITY_VERSION_WINDOW,
  listResumeVersionsForQuality,
} from '@/lib/db/resumeVersions';
import type { LlmCall } from '@/lib/db/types';
import {
  type Share,
  SMALL_SAMPLE,
  formatUsdFromMicro,
  rubricDistribution,
  rubricOutcomes,
  summariseCalls,
} from '@/lib/quality';

export const metadata = { title: 'Quality — CV Insight' };

/**
 * `/quality` — the observability dashboard (SPEC Block E, Block H item 7).
 *
 * WHAT THIS SCREEN IS FOR. CLAUDE.md's product claim is that every generated
 * resume is evaluated by a rubric-based judge before it is shown, or that the app
 * says plainly the check did not run. This page is the evidence for that claim,
 * which sets its one hard rule: **every number is traceable to a row**. There is
 * no estimate, no smoothed rate and no figure whose source a reader cannot name —
 * each caption says which table it was counted in and what the denominator was,
 * and a share always renders its fraction beside its percentage.
 *
 * AND IT SAYS WHEN IT KNOWS TOO LITTLE. Below `SMALL_SAMPLE` observations a
 * percentage carries less information than the fraction it came from, so the
 * percentage is dropped and the screen says why. A dashboard that prints "100%
 * first-attempt pass rate" off one run is not reporting a rate, it is reporting a
 * coincidence with a percent sign on it.
 *
 * A SERVER COMPONENT reading three DALs under the user's own session, so RLS
 * scopes every row to the caller and no id is passed anywhere. Nothing is
 * computed in the browser and no endpoint is added: `GET /api/quality` would be a
 * second auth fence in front of data this page can already read.
 *
 * THE ERROR STATE IS THE APP'S ERROR BOUNDARY, not Block E's toast — the same as
 * `/applications`. A DAL throw in a Server Component reaches `app/error.tsx`;
 * there is no client render in which `QUALITY.loadFailed` could fire, so that
 * constant stays declared and unused until this screen gains a client refetch.
 * The LOADING state is `loading.tsx`, because an awaited Server Component renders
 * nothing until it resolves.
 *
 * THE TOTALS ARE BOUNDED AND THE BOUND IS STATED. `llm_calls` has no aggregate
 * function and adding one would be a SQL function in a migration this phase does
 * not make, so the sums are computed in process over the rows read. That means
 * "total" is only true of a window — so the window is named, and when the ceiling
 * is actually reached the page says the older calls are not counted. A total that
 * quietly stops at a limit is precisely the untraceable figure this screen exists
 * not to print.
 */
export default async function QualityPage() {
  const [calls, versions, recent, chatCalls24h, rescoreCalls24h] = await Promise.all([
    listLlmCallsForQuality(),
    listResumeVersionsForQuality(),
    // Block E's own table. A second read rather than a slice of the first,
    // because "the last 50 calls" and "the window the totals cover" are two
    // numbers that must be free to differ.
    listRecentLlmCalls(50),
    /**
     * THE CAPS' OWN COUNTERS, and not a second count of the same window. These
     * are the exact queries `lib/chat.ts` and `lib/retrieval.ts` compare against
     * rules B7 and B7a, so the tiles show the number the cap sees. Counting the
     * rolling window a second time here would give this screen its own opinion
     * about a rule it is meant to be illustrating.
     */
    countCallsInLast24h(),
    countRescoreCallsInLast24h(),
  ]);

  const summary = summariseCalls(calls);
  const outcomes = rubricOutcomes(versions);
  const distribution = rubricDistribution(versions);
  const windowFull = calls.length >= QUALITY_CALL_WINDOW;
  /**
   * Steps whose every call was served by the fallback — the condition the app has
   * to announce rather than leave in a column (v2.22).
   *
   * `fallbackShare.count === calls` and not `percent === 100`: the percentage is
   * rounded, so 199 of 200 also prints 100% and this must mean what it says.
   */
  const alwaysFallback = summary.byStep.filter(
    (step) => step.calls > 0 && step.fallbackShare.count === step.calls,
  );

  if (calls.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{QUALITY.title}</h1>
        <p role="status" className="text-sm">
          {QUALITY.empty}
        </p>
        <p className="text-muted-foreground max-w-prose text-sm">{QUALITY.emptyHint}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{QUALITY.title}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{QUALITY.lead}</p>
      </header>

      {/* --- the cost and traffic tiles ------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label={QUALITY.tileTotalCost}
          value={formatUsdFromMicro(summary.totalCostMicro)}
          source={QUALITY.tileTotalCostSource(summary.calls)}
        />
        {/*
          "PER APPLICATION", not "per run". The denominator is distinct
          `application_id` values, and since [Regenerate] one application can
          hold several AI runs — so this tile and the "AI runs" section below
          count different things and now say so. Two quantities under one word is
          the defect on a screen whose one rule is traceability.
        */}
        <Tile
          label={QUALITY.tileCostPerApplication}
          value={
            summary.costPerApplicationMicro === null
              ? QUALITY.nothingMeasured
              : formatUsdFromMicro(summary.costPerApplicationMicro)
          }
          source={QUALITY.tileCostPerApplicationSource(
            formatUsdFromMicro(summary.attributableCostMicro),
            summary.applicationsWithCalls,
          )}
        />
        <Tile
          label={QUALITY.tileApplications}
          value={formatCount(summary.applicationsWithCalls)}
          source={QUALITY.tileApplicationsSource}
        />
        <Tile
          label={QUALITY.tileUnattributed}
          value={formatUsdFromMicro(summary.unattributedCostMicro)}
          source={QUALITY.tileUnattributedSource}
        />
        <Tile
          label={QUALITY.tileChatCalls}
          value={`${formatCount(chatCalls24h)} / ${formatCount(DAILY_CALL_LIMIT)}`}
          source={QUALITY.tileChatCallsSource(DAILY_CALL_LIMIT)}
        />
        <Tile
          label={QUALITY.tileRescoreCalls}
          value={`${formatCount(rescoreCalls24h)} / ${formatCount(DAILY_RESCORE_LIMIT)}`}
          source={QUALITY.tileRescoreCallsSource(DAILY_RESCORE_LIMIT)}
        />
        <Tile
          label={QUALITY.tileFallback}
          value={<ShareValue share={summary.fallbackShare} />}
          source={QUALITY.tileFallbackSource}
        />
        <Tile
          label={QUALITY.tileFailed}
          value={formatCount(summary.failedCalls)}
          source={QUALITY.tileFailedSource}
        />
        {/*
          NEVER A SILENT ZERO. Block C's own comment on `cost_known` requires this
          tile: a call whose serving model has no price entry is written with
          cost_usd_micro = 0, and without saying so the total above would report
          an unknown spend as a free one.
        */}
        <Tile
          label={QUALITY.tileUnknownPricing}
          value={formatCount(summary.unknownPricingCalls)}
          source={QUALITY.tileUnknownPricingSource}
        />
        <Tile
          label={QUALITY.tileTokens}
          value={`${formatCount(summary.tokensIn)} / ${formatCount(summary.tokensOut)}`}
          source={QUALITY.tileTokensSource}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {windowFull ? QUALITY.windowFull(QUALITY_CALL_WINDOW) : QUALITY.windowNote(summary.calls)}
      </p>

      {/* --- the rubric outcome of each AI run ----------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{QUALITY.rubricHeading}</h2>
          <p className="text-muted-foreground max-w-prose text-sm">{QUALITY.rubricLead}</p>
          <p className="text-muted-foreground text-xs">{QUALITY.rubricRuns(outcomes.runs)}</p>
        </div>
        <ul className="flex flex-col gap-3">
          <OutcomeRow label={QUALITY.outcomeApprovedFirst} share={outcomes.approvedFirst} />
          <OutcomeRow label={QUALITY.outcomeRevisedApproved} share={outcomes.revisedApproved} />
          <OutcomeRow
            label={QUALITY.outcomeRevisedStillRevise}
            share={outcomes.revisedStillRevise}
          />
          {/*
            THE TWO STATES THE OWNER'S THREE SHARES DO NOT COVER, and folding
            either into one of the three would be the app reporting something it
            did not observe. A run whose rewrite never happened is not a run whose
            rewrite failed, and a run nobody reviewed is neither a pass nor a
            failure — that is the whole reason `judge: null` is a third state.
          */}
          <OutcomeRow
            label={QUALITY.outcomeReviseNoRewrite}
            hint={QUALITY.outcomeReviseNoRewriteHint}
            share={outcomes.reviseNoRewrite}
          />
          <OutcomeRow
            label={QUALITY.outcomeNotChecked}
            hint={QUALITY.outcomeNotCheckedHint}
            share={outcomes.notChecked}
          />
        </ul>
        {outcomes.runs > 0 && outcomes.runs < SMALL_SAMPLE ? (
          <p className="text-accent text-xs">{QUALITY.thinSample}</p>
        ) : null}
      </div>

      {/* --- the score distribution per criterion -------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{QUALITY.distributionHeading}</h2>
          <p className="text-muted-foreground max-w-prose text-sm">{QUALITY.distributionLead}</p>
          <p className="text-muted-foreground text-xs">
            {QUALITY.distributionJudged(distribution.judged)} ·{' '}
            {/*
              The window says when it is FULL, like the call window above. The
              read is newest-first, so a full window means the OLDEST versions
              were cut — and a figure that quietly stops at a limit is the one
              thing this screen must not print. `versions.length` is already
              bounded by the query, so the comparison is the whole test.
            */}
            {versions.length >= QUALITY_VERSION_WINDOW
              ? QUALITY.versionWindowFull(QUALITY_VERSION_WINDOW)
              : QUALITY.versionWindowNote(versions.length)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-lg text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {QUALITY.colCriterion}
                </th>
                {[1, 2, 3, 4, 5].map((score) => (
                  <th key={score} scope="col" className="py-2 pr-3 text-right font-medium">
                    {QUALITY.colScore(score)}
                  </th>
                ))}
                <th scope="col" className="py-2 text-right font-medium">
                  {QUALITY.colMean}
                </th>
              </tr>
            </thead>
            <tbody>
              {distribution.criteria.map((entry) => (
                <tr key={entry.criterion} className="border-border border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {CRITERION_LABEL[entry.criterion]}
                  </th>
                  {entry.counts.map((count, index) => (
                    <td key={index} className="py-2 pr-3 text-right tabular-nums">
                      {count}
                    </td>
                  ))}
                  <td className="py-2 text-right tabular-nums">
                    {/* No mean without an observation — never a 0.0. */}
                    {entry.mean === null ? '—' : entry.mean.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            {QUALITY.groundingRow}:{' '}
            <span className="tabular-nums">
              {QUALITY.groundingTally(distribution.grounding.pass, distribution.grounding.fail)}
            </span>
          </p>
          <p className="text-muted-foreground max-w-prose text-xs">{QUALITY.groundingHint}</p>
        </div>
        {distribution.judged > 0 && distribution.judged < SMALL_SAMPLE ? (
          <p className="text-accent text-xs">{QUALITY.thinSample}</p>
        ) : null}
      </div>

      {/* --- cost by step -------------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{QUALITY.stepsHeading}</h2>
          <p className="text-muted-foreground text-sm">{QUALITY.stepsLead}</p>
        </div>
        {/*
          THE APP SAYS IT, rather than leaving it to be read off a column. A step
          every one of whose calls was served by the fallback is a configuration
          that will keep happening, and the owner found this one by reading a
          table — which is the thing a dashboard should make unnecessary.
        */}
        {alwaysFallback.length > 0 ? (
          <div className="border-destructive/40 flex flex-col gap-1 rounded-lg border p-3">
            {alwaysFallback.map((step) => (
              <p key={step.step} role="alert" className="text-destructive text-sm">
                {QUALITY.stepAlwaysFallback(stepLabel(step.step), step.calls)}
              </p>
            ))}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-xl text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {QUALITY.colStep}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colCalls}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colCost}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colMeanLatency}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colFallback}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colFailedShort}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colUnknownPricing}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {QUALITY.colModels}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.byStep.map((step) => (
                <tr key={step.step} className="border-border border-b last:border-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {stepLabel(step.step)}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{step.calls}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatUsdFromMicro(step.costUsdMicro)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {step.meanLatencyMs === null ? '—' : `${formatCount(step.meanLatencyMs)} ms`}
                  </td>
                  {/*
                    PER STEP, because the blended total hides the condition that
                    matters: one step at 100% while the others are at 0% is not a
                    degraded service, it is a configured model that is never
                    served — and that is how the generate step spent a whole phase
                    being written by the fallback.
                  */}
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <ShareValue share={step.fallbackShare} />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{step.failed}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{step.unknownPricing}</td>
                  <td className="text-muted-foreground py-2 text-xs">
                    {step.models.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Block E's last-50 table --------------------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{QUALITY.callsHeading}</h2>
          <p className="text-muted-foreground max-w-prose text-sm">{QUALITY.callsLead}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-176 text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {QUALITY.colTime}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {QUALITY.colStep}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {QUALITY.colModel}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colTokens}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colCost}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {QUALITY.colLatency}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {QUALITY.colOk}
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((call) => (
                <CallRowView key={call.id} call={call} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** P3's own criterion names, as Block E renders them on the judge card. */
const CRITERION_LABEL = {
  keywordCoverage: 'Keyword coverage',
  relevance: 'Relevance',
  atsFormat: 'ATS format',
} as const;

/**
 * A step's own words, falling back to the stored value.
 *
 * The fallback is not defensive padding: `llm_calls.step` is a CHECK-constrained
 * column, so a value with no label here means the constraint grew and this map
 * did not — and printing the raw value is how a reader finds that out, where a
 * blank cell would hide it.
 */
function stepLabel(step: string): string {
  return LLM_STEP_LABEL[step as keyof typeof LLM_STEP_LABEL] ?? step;
}

function Tile({
  label,
  value,
  source,
}: {
  label: string;
  value: React.ReactNode;
  source: string;
}) {
  return (
    <div className="border-border flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {/*
        THE SOURCE IS PART OF THE TILE, not a tooltip and not a footnote. A number
        on this screen without the rows behind it is the one thing the screen must
        not show, and a caption a reader has to hover to find is a caption most
        readers never see.
      */}
      <span className="text-muted-foreground text-xs">{source}</span>
    </div>
  );
}

/**
 * A share, always as a fraction, and as a percentage only when there is enough
 * behind it to be one.
 */
function ShareValue({ share }: { share: Share }) {
  if (share.of === 0) return <>{QUALITY.nothingMeasured}</>;
  return (
    <>
      {share.count} / {share.of}
      {share.thin ? null : <span className="text-muted-foreground"> · {share.percent}%</span>}
    </>
  );
}

function OutcomeRow({
  label,
  hint,
  share,
}: {
  label: string;
  hint?: string;
  share: Share;
}) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-sm tabular-nums">
          <ShareValue share={share} />
        </span>
      </div>
      {/*
        The bar is drawn from the SHARE, and only when there is a denominator: a
        full-width empty track under "0 of 0" would read as a measured zero.
      */}
      {share.of > 0 ? (
        <div className="bg-muted h-2 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${share.percent ?? 0}%` }}
          />
        </div>
      ) : null}
      {hint ? <p className="text-muted-foreground max-w-prose text-xs">{hint}</p> : null}
    </li>
  );
}

/** One logged call. Metadata only — no resume or vacancy text is ever stored here. */
function CallRowView({ call }: { call: LlmCall }) {
  return (
    <tr className="border-border border-b last:border-0">
      <td className="text-muted-foreground py-2 pr-3 whitespace-nowrap">
        {/* T1: stored UTC, rendered in the viewer's own timezone. */}
        {new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'medium',
        }).format(new Date(call.created_at))}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{stepLabel(call.step)}</td>
      <td className="py-2 pr-3">
        <span className="break-all">{call.model}</span>
        {call.fallback_used ? (
          <span className="text-accent ml-1.5 text-xs">{QUALITY.fallbackBadge}</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {formatCount(call.tokens_in)} / {formatCount(call.tokens_out)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {formatUsdFromMicro(call.cost_usd_micro)}
        {/* An unpriced row is 0 because nobody knows, not because it was free. */}
        {call.cost_known ? null : (
          <span className="text-accent ml-1.5 text-xs">{QUALITY.unpricedBadge}</span>
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {formatCount(call.latency_ms)} ms
      </td>
      <td className={`py-2 ${call.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
        {call.ok ? QUALITY.okYes : QUALITY.okNo}
      </td>
    </tr>
  );
}
