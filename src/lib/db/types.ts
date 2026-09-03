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
  similarity: number;
};

export type ApplicationStatus = 'draft' | 'applied' | 'interview' | 'offer' | 'rejected';

export type Application = {
  id: string;
  user_id: string;
  vacancy_id: string;
  resume_source: 'career_base' | 'resume_version' | 'paste' | 'file';
  source_resume_text: string | null;
  match_score: number | null;
  coverage: CoverageEntry[] | null;
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
