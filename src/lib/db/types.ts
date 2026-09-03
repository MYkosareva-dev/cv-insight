import 'server-only';

/** Row shapes for the seven owned tables: `001_init.sql` plus `imports` from `003_imports.sql`. */

export type CareerItemType =
  | 'role'
  | 'project'
  | 'achievement'
  | 'skill_block'
  | 'education'
  | 'certification';

export type CareerItem = {
  id: string;
  user_id: string;
  type: CareerItemType;
  title: string;
  content: string;
  period: string | null;
  source: 'manual' | 'import';
  /**
   * The import RUN this item came from, or null (SPEC v2.11).
   *
   * Nullable and `ON DELETE SET NULL`: a hand-created item has no import, every
   * item predating 003 has none, and if an import row ever goes the item must
   * survive it — the item is the user's real experience, the import only records
   * how it arrived.
   */
  import_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One import RUN (SPEC v2.11) — not one file. The same PDF imported twice is two
 * rows, because the user needs to tell those runs apart.
 */
export type Import = {
  id: string;
  user_id: string;
  /** The user's own label, defaulted to "Resume N" and editable before saving. */
  name: string;
  target_role: string | null;
  source_kind: 'pdf' | 'paste';
  created_at: string;
};

export type DocumentRow = {
  id: string;
  user_id: string;
  career_item_id: string;
  content: string;
  created_at: string;
};

/**
 * What kind of evidence a requirement demands (SPEC v2.15, rule B1's lexical
 * gate). `general` is the default and the conservative answer — see P1.
 */
export type EvidenceKind = 'tool' | 'credential' | 'general';

export type ParsedVacancy = {
  title: string;
  company: string | null;
  requirements: {
    text: string;
    kind: 'must' | 'nice';
    keyword: string;
    /** v2.15. Absent on vacancies parsed before it — read it as `general`. */
    evidence?: EvidenceKind;
    /** v2.15. The verbatim names that satisfy a tool/credential requirement. */
    terms?: string[];
  }[];
  keywords: string[];
};

export type Vacancy = {
  id: string;
  user_id: string;
  title: string | null;
  company: string | null;
  raw_text: string;
  parsed: ParsedVacancy | null;
  created_at: string;
};

export type CoverageStatus = 'covered' | 'gap_in_resume_covered_by_base' | 'gap';

export type CoverageEntry = {
  requirement: string;
  kind: 'must' | 'nice';
  status: CoverageStatus;
  /** Denormalized on write: the detail page never joins live (edge case D4). */
  careerItemId: string | null;
  careerItemTitle: string | null;
  /**
   * The best similarity the search actually returned. `0` with a null item is a
   * requirement that WAS searched and matched nothing (edge case D7) — a
   * measured zero. A search that could not run produces no entry at all: the
   * whole scan fails with AI_UNAVAILABLE and `coverage` stays null, because
   * "we could not look" must never render as "we looked and found nothing"
   * (CLAUDE.md, Retrieval).
   */
  similarity: number;
  /**
   * The term whose ABSENCE made this a gap (SPEC v2.15, rule B1's lexical gate):
   * a `tool` or `credential` requirement whose best chunk cleared the similarity
   * threshold, but none of whose verbatim terms appears anywhere in the career
   * base. Null on every other row, and absent entirely on rows written before
   * v2.15 — which is not the same as null, but reads the same on screen.
   *
   * Stored because the screen has to be able to say WHY: "Covered" beside
   * "Labelbox: 0 in resume" was the contradiction this field exists to end, and
   * replacing it with an unexplained "Gap" would trade one confusion for
   * another.
   */
  missingTerm?: string | null;
  /**
   * The line of the SCORED TEXT that matched, for a coverage map whose corpus is
   * not the career base (SPEC v2.16).
   *
   * `/api/applications/[id]/rescore` measures the requirements against the
   * resume in the editor, so there is no career item to name and
   * `careerItemTitle` is null — but the "Best match" cell still has to answer
   * "matched against what?", and leaving it blank would render as a gap beside a
   * status that says Covered. This carries the answer for that path: the user's
   * own edited line, echoed back to the browser it came from in the same
   * request.
   *
   * NEVER A CAREER-BASE CHUNK: retrieved chunks are data for a model call and
   * are never echoed to the client (CLAUDE.md, Retrieval), so on the scan path
   * this is always `null`.
   *
   * It IS written to the database — the scan builds every entry through the same
   * function and `updateApplication` stores the map — with a null on every row.
   * That is worth stating precisely rather than as "it never reaches the
   * database", which was the earlier and wrong version of this note: what makes
   * the field safe is that the only path that ever fills it is the re-score, and
   * the re-score stores nothing.
   */
  matchedText?: string | null;
};

/**
 * One row of the Block E keywords table: how often a vacancy keyword appears in
 * the vacancy, and in the resume SOURCE the scan actually scored (rule B1a
 * boundaries, `keywordCount` in lib/scoring.ts).
 */
export type KeywordRow = {
  keyword: string;
  inResume: number;
  inVacancy: number;
};

/**
 * What `applications.coverage` stores (SPEC v2.12).
 *
 * Block D's 200 response has `coverage` and `keywords` as siblings and the
 * column comment in Block C says "CoverageMap JSON", so both halves of the map
 * live in the one jsonb column — no migration, since the column is already
 * jsonb.
 *
 * The keyword COUNTS are stored rather than recomputed at render. For a pasted
 * or uploaded resume they could be recomputed from `source_resume_text`, but a
 * career-base scan has no such column (it is null by design) and would have to
 * count against the LIVE base — putting a freshly measured number beside a
 * stored score that came from a different moment of the same base. The screen
 * would then carry two measurements from two times, with the recomputed one not
 * being the number that produced the ring. Same argument as edge case D4, which
 * denormalizes the career-item title for exactly this reason.
 */
export type CoverageMap = {
  entries: CoverageEntry[];
  keywords: KeywordRow[];
  /**
   * How many keywords rule B1a's literal-span guard threw away on this run
   * (SPEC v2.13) — keywords P1 returned that the vacancy text does not contain.
   *
   * OPTIONAL because it is optional in the DATA: rows written before v2.13 have
   * no such field, and a jsonb column cannot be back-filled with a number
   * nobody measured. `undefined` therefore means "this run did not record it",
   * which is not the same as `0` ("nothing was dropped") — the distinction the
   * three-state discipline asks for everywhere else in this file.
   *
   * Not rendered. It exists so that a parser drifting back to canonical forms is
   * visible in the stored data, and so /quality can count it in a later phase.
   */
  keywordsDropped?: number;
  /**
   * How many requirement `terms` the same literal-span guard threw away on this
   * run (SPEC v2.15) — terms P1 returned that the vacancy text does not contain.
   *
   * Optional for the same reason as `keywordsDropped`: absent on rows written
   * before it existed, which is not the same as zero. Not rendered. It exists so
   * that a parser generalizing the terms that decide a coverage status is
   * visible in the data rather than only in a screen someone happens to read.
   */
  termsDropped?: number;
};

export type ApplicationStatus = 'draft' | 'applied' | 'interview' | 'offer' | 'rejected';

export type Application = {
  id: string;
  user_id: string;
  vacancy_id: string;
  resume_source: 'career_base' | 'resume_version' | 'paste' | 'file';
  source_resume_text: string | null;
  /**
   * null means the analysis NEVER RAN (the AI step failed, or the daily cap
   * refused it) — the row is a draft. It is not "scored zero" and not "no
   * requirements found": those are a number and an empty `coverage.entries`
   * respectively. The result screen has to tell all three apart.
   */
  match_score: number | null;
  coverage: CoverageMap | null;
  status: ApplicationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type JudgeReport = {
  grounding: { verdict: 'pass' | 'fail'; violations: { claim: string; issue: string }[] };
  keywordCoverage: { score: number; missingHonest: string[] };
  relevance: { score: number; evidence: string };
  atsFormat: { score: number; issues: string[] };
  verdict: 'approve' | 'revise';
  feedbackForGenerator: string[];
};

export type ResumeVersion = {
  id: string;
  user_id: string;
  application_id: string;
  content: string;
  source: 'ai' | 'ai_revision' | 'user';
  judge: JudgeReport | null;
  created_at: string;
};

export type LlmCall = {
  id: string;
  user_id: string;
  application_id: string | null;
  step: 'import_resume' | 'parse_vacancy' | 'generate' | 'judge' | 'embed' | 'rescore';
  model: string;
  fallback_used: boolean;
  ok: boolean;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micro: number;
  /**
   * false when the serving model had no entry in the price table: the row is
   * still written with cost_usd_micro = 0, and /quality surfaces it as unknown
   * pricing rather than as a free call.
   */
  cost_known: boolean;
  latency_ms: number;
  created_at: string;
};
