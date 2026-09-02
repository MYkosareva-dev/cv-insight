import 'server-only';

/** Row shapes for the six tables in supabase/migrations/001_init.sql. */

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
  created_at: string;
  updated_at: string;
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
  latency_ms: number;
  created_at: string;
};
