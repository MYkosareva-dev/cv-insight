import 'server-only';

import { type CallLedger, runChat, runChatJson } from '@/lib/chat';
import { listCareerItemsByIds } from '@/lib/db/careerItems';
import type { JudgeReport, ParsedVacancy } from '@/lib/db/types';
import { AiUnavailableError, DailyLimitError } from '@/lib/errors';
import {
  type GenerationItem,
  MATCH_COUNT_FOR_GENERATE,
  MAX_GENERATION_ITEMS,
  distinctItemIds,
  itemsCorpus,
  itemsPayload,
  vacancyQueryText,
} from '@/lib/generation';
import { type Rubric, needsRevision, revisionFindings, withComputedVerdict } from '@/lib/judge';
import { P2_GENERATE, P3_JUDGE, fillPrompt, revisionFeedbackBlock } from '@/lib/prompts';
import { matchDocuments } from '@/lib/retrieval';
import { MAX_RESUME_CHARS, judgeReportSchema } from '@/lib/validation';

/**
 * The generate-and-judge pipeline (SPEC US-4, Block D #5, prompts P2/P3).
 *
 * Server-only, and every model call leaves through a gate: chat through
 * `lib/chat.ts`, the retrieval embedding through `lib/retrieval.ts`. Nothing
 * here talks to the connection module, and nothing here takes a user id — the
 * gates get theirs from the verified session.
 *
 * THE CALL BUDGET, DECLARED. One `POST …/generate` runs at most FOUR chat steps
 * — generate, judge, and rule B3's single revision pair — each capped at
 * `MAX_CHAT_REQUESTS_PER_STEP = 2` by the chat gate. So:
 *
 *     2 rows   the judge approves the first draft
 *     4 rows   approved after one revision
 *     8 rows   worst case: all four steps spend their single retry
 *
 * plus exactly ONE embeddings request, which rule B7 excludes by its own
 * definition. One `CallLedger` is created by the route and passed to every call,
 * so rule B7's cap is checked against `committed + ledger` rather than against
 * the same stale count four times. `lib/budget.ts` holds the ceiling and the
 * route asserts against it.
 *
 * THE REVISION NEVER MULTIPLIES THE BUDGET. It is a fixed second pass, not a
 * loop: there is no arrangement of verdicts that produces a fifth step, because
 * `generateWithJudge` calls the revision path once and returns whatever it gets.
 */

/** How the corpus was assembled, for a route that wants to log or report it. */
export type RetrievedItems = {
  items: GenerationItem[];
  /** Items retrieval found but the `<items>` character budget could not fit. */
  droppedForSize: number;
};

/**
 * The career items the generator and the judge are allowed to draw facts from.
 *
 * THE CHUNKS SELECT, THE ROWS SUPPLY (SPEC v2.16, architect finding on this
 * phase's plan). `match_documents` ranks bullet-sized chunks, and a chunk is
 * `title + "\n\n" + chunk text` — `career_items.period` is never in one, because
 * `chunksForItem` is given only the title and the content. P2 rule 4 demands
 * "Title — Company (period)", so a generator fed chunk text either drops the
 * dates or invents them, and an invented date is exactly the ungrounded claim
 * rule B2 exists to catch. The retrieval therefore decides WHICH items are
 * relevant and the user's own rows supply the facts.
 *
 * It asks for `MATCH_COUNT_FOR_GENERATE` rows rather than eight, because since
 * v2.14 a chunk is one CLAIM and eight of them can resolve to a single item —
 * which would leave P2 writing a whole resume from one job. Widening the ask
 * costs one larger database read and no extra spend.
 *
 * `could_not_search` FAILS THE RUN. Generating from an empty corpus would
 * produce a resume grounded in nothing while the app reported success, which is
 * the same lie as rendering a gap for a search that never happened.
 */
export async function retrieveItemsFor(
  parsed: ParsedVacancy,
  applicationId: string,
  aiUnavailableMessage: string,
): Promise<RetrievedItems> {
  const outcome = await matchDocuments(
    vacancyQueryText(parsed),
    MATCH_COUNT_FOR_GENERATE,
    'embed',
    applicationId,
  );
  if (outcome.status === 'could_not_search') {
    console.error('[tailoring] retrieval failed before generation', { error: outcome.error });
    throw new AiUnavailableError(aiUnavailableMessage);
  }

  const ids = distinctItemIds(outcome.chunks, MAX_GENERATION_ITEMS);
  const rows = await listCareerItemsByIds(ids);
  // Back into relevance order: `.in()` returns rows in whatever order Postgres
  // chose, and P2 rule 5 asks for the most vacancy-relevant experience first.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: GenerationItem[] = ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      period: row.period,
      content: row.content,
    }));

  const { payload, dropped } = itemsPayload(ordered);
  return { items: payload, droppedForSize: dropped };
}

/**
 * P2/P3's `{{parsedRequirementsJson}}` — what the posting asks for, as data.
 *
 * THE VACANCY'S KEYWORD LIST GOES TO THE REVIEWER AND NOT TO THE WRITER, and
 * that split is a defect found by running the pipeline rather than by reading it
 * (SPEC v2.16). An earlier version gave both prompts `parsed.keywords`, and
 * against the Hiredbuddy case the generator pasted the whole list into a SKILLS
 * line: "ms office, google suite, labelbox, supervisely" — four tools the career
 * base does not contain, claimed as skills. That is rule B4 ("the generator may
 * use a vacancy keyword only if supported by retrieved chunks") broken by the
 * app's own prompt, and it is the exact invention rule B2 exists to catch.
 *
 * The cause was not the model's alone. A tidy list of skill terms beside an
 * instruction to use the vacancy's exact spelling is an invitation to reproduce
 * it, and Block F's own P2 template asks for "Vacancy requirements" — sentences
 * a writer has to check against the career items before answering. So P2 gets
 * the requirements and nothing else, and its rule 3 ("use the vacancy's exact
 * keyword spelling where the career items honestly support the skill") is
 * satisfied from the requirement TEXT, which is a verbatim-derived sentence of
 * the posting.
 *
 * P3 KEEPS THE LIST, because the reviewer cannot do its job without it: criterion
 * 2 is "of vacancy keywords honestly supported by career items, how many appear
 * in the resume", and a judge scoring that against a list it was never given
 * would be inventing the denominator — which is what `missingHonest` then
 * renders to the user and feeds into a paid revision. The asymmetry is the point:
 * a checklist in front of a WRITER is an instruction to fill it in, and the same
 * checklist in front of a REVIEWER is what it is measuring against. Rule B4 is
 * the constraint on the writer, and giving the list only to the party enforcing
 * it is the arrangement that keeps the rule enforceable.
 */
function requirementsJson(parsed: ParsedVacancy, withKeywords: boolean): string {
  return JSON.stringify({
    title: parsed.title,
    company: parsed.company,
    requirements: parsed.requirements.map((r) => ({ text: r.text, kind: r.kind })),
    ...(withKeywords ? { keywords: parsed.keywords } : {}),
  });
}

/** P2/P3's `<items>` payload. Server-built, never echoed to the client. */
function itemsJson(items: GenerationItem[]): string {
  return JSON.stringify(
    items.map((item) => ({
      type: item.type,
      title: item.title,
      period: item.period,
      content: item.content,
    })),
  );
}

/**
 * ONE generate step (P2, Sonnet, plain text).
 *
 * `findings` is empty on the first pass. On a revision it carries the reviewer's
 * SPECIFIC complaints; `revisionFeedbackBlock` returns an empty string for an
 * empty list, so this cannot accidentally send a bare "fix all of them".
 */
export async function generateResume(args: {
  parsed: ParsedVacancy;
  items: GenerationItem[];
  applicationId: string;
  findings: string[];
  ledger: CallLedger;
  /** The profile's display name, or the visible placeholder standing in for one. */
  candidateName: string;
}): Promise<string> {
  const prompt = fillPrompt(P2_GENERATE, {
    // The WRITER gets no keyword list — see `requirementsJson`.
    parsedRequirementsJson: requirementsJson(args.parsed, false),
    retrievedChunksJson: itemsJson(args.items),
    revisionFeedbackBlock: revisionFeedbackBlock(args.findings),
    candidateName: args.candidateName,
  });
  const result = await runChat(
    {
      step: 'generate',
      // P2 returns plain text, not JSON — the one step in the app that does.
      jsonMode: false,
      applicationId: args.applicationId,
      messages: [{ role: 'user', content: prompt }],
    },
    args.ledger,
  );
  /**
   * The column's own bound, as a backstop (edge case L3).
   *
   * `MAX_TOKENS_BY_STEP.generate = 2500` is the mechanism L3 names and it makes
   * an over-long resume very unlikely — but "very unlikely" is not what
   * `resume_versions.content`'s CHECK enforces, and a violated CHECK here would
   * turn a run the user has already paid for into a 500 saying nothing was
   * saved. Cutting the tail costs the last lines of a resume that was already
   * past one page; losing the whole run costs everything.
   */
  return result.data.trim().slice(0, MAX_RESUME_CHARS);
}

/**
 * ONE judge step (P3, Haiku, JSON mode).
 *
 * A DIFFERENT MODEL FROM THE GENERATOR, deliberately: Haiku reviews what Sonnet
 * wrote, which reduces the self-preference a model shows toward its own output
 * (CLAUDE.md, "AI model calls").
 *
 * The verdict the model returns is discarded and recomputed by `lib/judge.ts`
 * from the report's own evidence, so what is stored and acted on is P3's rule
 * applied by this app rather than the model's own summary of it.
 */
export async function judgeResume(args: {
  parsed: ParsedVacancy;
  items: GenerationItem[];
  resumeText: string;
  applicationId: string;
  ledger: CallLedger;
  /**
   * Told to the REVIEWER as well as to the writer, because it is a fact from a
   * source the career items do not contain. Without it the grounding gate fires
   * on the one line the user supplied themselves, and rule B2 makes that
   * uncompensatable — so every generated resume would be revised once for
   * having a name on it.
   */
  candidateName: string;
}): Promise<JudgeReport> {
  const prompt = fillPrompt(P3_JUDGE, {
    resumeText: args.resumeText,
    // The REVIEWER does: P3 criterion 2 scores against exactly this list.
    parsedRequirementsJson: requirementsJson(args.parsed, true),
    retrievedChunksJson: itemsJson(args.items),
    candidateName: args.candidateName,
  });
  const { data } = await runChatJson({
    step: 'judge',
    applicationId: args.applicationId,
    schema: judgeReportSchema,
    messages: [{ role: 'user', content: prompt }],
    ledger: args.ledger,
  });
  return withComputedVerdict(data as Rubric) as JudgeReport;
}

/**
 * One draft and what the reviewer said about it. `judge: null` means the check
 * did not RUN — never that it ran and found nothing.
 */
export type Draft = { content: string; judge: JudgeReport | null };

export type GenerateOutcome = {
  /** The first draft, always. */
  original: Draft;
  /** Rule B3's single rewrite, when one was earned AND could be written. */
  revision: Draft | null;
  /**
   * True when the reviewer refused the first draft and listed nothing to change,
   * so no rewrite was attempted. The card has words for this; a silent skip
   * would show a "revise" verdict with no explanation of why nothing happened.
   */
  revisionWithheld: boolean;
};

/**
 * generate → judge → (at most one) generate → judge (SPEC US-4 step 2, rule B3).
 *
 * FOUR BRANCHES, and each one is a state the user can actually reach:
 *
 *  1. The judge approves. Two calls, one version, done.
 *  2. The judge asks for a rewrite and says what is wrong. One rewrite, judged
 *     again, and BOTH drafts are returned so both become rows — the user can see
 *     that a revision happened and what each verdict was.
 *  3. The judge asks for a rewrite and says nothing specific. No rewrite:
 *     regenerating against no findings is a paid call carrying no information,
 *     which CLAUDE.md's metered rule forbids. Declared as a deviation from Block
 *     D #5's unconditional "regenerate once".
 *  4. The QUALITY CHECK ITSELF fails — rule B7's daily cap refuses the judge
 *     step, or the model is unavailable. The generated resume is still returned
 *     with `judge: null` and saved: the user has already paid for it, and
 *     throwing it away to report "nothing was saved" would take their money and
 *     the work. The card then says the check did not run, which is the third
 *     state, not a pass.
 *  5. The REWRITE is refused, for either of those reasons, after the first draft
 *     has been generated and judged. Same answer as 4 and for the same reason:
 *     the original is returned and saved with its honest card, because there is
 *     a resume by then and it is the one the user paid for.
 *
 * The FIRST generate step's failure is the one case that does propagate, and the
 * difference is not arbitrary: there is no resume yet, so nothing is thrown away,
 * and US-4's error path ("nothing was saved") is a true sentence.
 */
export async function generateWithJudge(args: {
  parsed: ParsedVacancy;
  items: GenerationItem[];
  applicationId: string;
  ledger: CallLedger;
  candidateName: string;
}): Promise<GenerateOutcome> {
  /**
   * The corpus every claim about "what your base supports" is checked against —
   * the items P2 and P3 were actually given. The reviewer's `missingHonest` is
   * gated on it before a single term reaches the rewrite (SPEC v2.17).
   */
  const baseText = itemsCorpus(args.items);

  const content = await generateResume({ ...args, findings: [] });
  const judge = await judgeOrNull(args, content);

  if (!judge || !needsRevision(judge as Rubric, baseText)) {
    return { original: { content, judge }, revision: null, revisionWithheld: false };
  }

  const findings = revisionFindings(judge as Rubric, baseText);
  if (findings.length === 0) {
    // Unreachable while `needsRevision` requires findings; kept as the explicit
    // statement of branch 3 rather than as an implication of another function.
    return { original: { content, judge }, revision: null, revisionWithheld: true };
  }

  /**
   * BRANCH 5, and it is the same argument as branch 4 one step later: the
   * REWRITE can be refused after the first draft has been generated, judged and
   * billed twice. Rule B7's cap is checked per step against committed rows, so a
   * user at 48 calls passes step 1 (48+0), passes step 2 (48+1) and is refused on
   * step 3 (48+2 = 50) — and letting that throw would discard a resume they have
   * already paid for, to report "Generation failed — nothing was saved".
   *
   * A generate failure on the FIRST step still propagates, and the difference is
   * not arbitrary: there is no resume then, so there is nothing to lose. Here
   * there is one, and it is the one the user gets.
   */
  let revised: string;
  try {
    revised = await generateResume({ ...args, findings });
  } catch (err) {
    if (err instanceof DailyLimitError || err instanceof AiUnavailableError) {
      console.error('[tailoring] the revision did not run', {
        name: err instanceof Error ? err.name : typeof err,
      });
      // Not `revisionWithheld`: that names a reviewer who gave no reason. This
      // is a rewrite that was earned, had findings to work from, and could not
      // be bought. The card shows the original's own honest verdict either way.
      return { original: { content, judge }, revision: null, revisionWithheld: false };
    }
    throw err;
  }

  const revisedJudge = await judgeOrNull(args, revised);
  return {
    original: { content, judge },
    revision: { content: revised, judge: revisedJudge },
    revisionWithheld: false,
  };
}

/**
 * Judge a draft, or report that the check did not run.
 *
 * ONLY the two failures that mean "the reviewer never spoke" are swallowed: the
 * daily cap refusing the step, and the service being unavailable. Everything
 * else propagates, because an unexpected throw here is a defect and hiding it
 * behind "not checked" would make every future bug look like a quiet cap.
 *
 * This is the branch that keeps rule B7 from taking a user's money and leaving
 * nothing behind: the cap is checked per STEP against committed rows, so a user
 * at 49 calls passes the generate check, spends a Sonnet call, and is refused on
 * the judge. Returning null saves the resume they paid for.
 */
async function judgeOrNull(
  args: {
    parsed: ParsedVacancy;
    items: GenerationItem[];
    applicationId: string;
    ledger: CallLedger;
    candidateName: string;
  },
  resumeText: string,
): Promise<JudgeReport | null> {
  try {
    return await judgeResume({ ...args, resumeText });
  } catch (err) {
    if (err instanceof DailyLimitError || err instanceof AiUnavailableError) {
      console.error('[tailoring] the quality check did not run', {
        name: err instanceof Error ? err.name : typeof err,
      });
      return null;
    }
    throw err;
  }
}
