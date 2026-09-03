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

export type ParsedVacancy = {
  title: string;
  company: string | null;
  requirements: { text: string; kind: 'must' | 'nice'; keyword: string }[];
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
