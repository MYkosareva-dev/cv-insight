/**
 * Every user-facing string, in one place. Tests import these same constants,
 * so copy drift breaks a test rather than shipping. Strings are verbatim from
 * SPEC Blocks B, E, F and G.
 *
 * No secrets, no resume/vacancy content — this module is safe on the client.
 */

export const APP_NAME = 'CV Insight';

/**
 * The score placeholder. Rendered wherever a match score exists as a slot but
 * not as a number:
 *   - the parse produced 0 requirements (edge case N4, matchScore returns null);
 *   - rule B1b: 0 MUST requirements AND 0 keywords, so matchScore returns a 0
 *     that means "nothing was measured" rather than "measured, scored zero".
 *     Use `insufficientSignal()` from lib/scoring.ts to detect that case.
 * An em dash, not a hyphen — the same glyph SPEC Block F writes.
 */
export const NO_SCORE = '—';

export const NAV = {
  scan: 'New scan',
  career: 'Career base',
  applications: 'Applications',
  quality: 'Quality',
  settings: 'Settings',
} as const;

export const AUTH = {
  signIn: 'Sign in',
  signUp: 'Create account',
  signOut: 'Sign out',
  invalidEmail: 'Enter a valid email address.',
  shortPassword: 'Password must be at least 8 characters.',
  badCredentials: 'Email or password is incorrect.',
  emailTaken: 'An account with this email already exists.',
} as const;

export const SCAN = {
  analyze: 'Analyze',
  analyzing: 'Analyzing…',
  vacancyPlaceholder: 'Paste the job posting here. Tip: skip benefits and legal boilerplate.',
  vacancyRequired: 'Paste the job posting text (at least 100 characters).',
  resumeRequired: 'Paste your resume text (at least 100 characters).',
  emptyBase: 'Your career base is empty — import a resume first.',
  goToCareerBase: 'Go to Career base',
  aiUnavailable: 'AI service is unavailable. Your vacancy was saved — retry from Applications.',
  noRequirements: "We couldn't find concrete requirements in this posting.",
  dropzone: 'Drag & drop or choose a .pdf file, max 5 MB',
} as const;

export const CAREER = {
  importResume: 'Import resume',
  emptyTitle: 'Your career base is empty',
  emptyBody:
    'Your career base is empty. Import your resume — CV Insight will split it into reusable career items.',
  unreadablePdf:
    "We couldn't read text from this PDF. It may be scanned — paste the text instead.",
  fileTooLarge: 'This file is over 5 MB.',
  noItemsFound: 'No career items found — is this a resume?',
  indexWarning: 'Item saved, search index will update on next edit.',
  titleRequired: 'Title is required, max 200 characters.',
  contentRequired: 'Content is required, max 4000 characters.',
  limitReached: 'Career base limit reached (200 items). Delete unused items first.',
} as const;

export const RESULT = {
  generate: 'Generate tailored resume',
  rescore: 'Re-score',
  checkQuality: 'Check quality',
  download: 'Download .docx',
  saveNotes: 'Save notes',
  notesSaved: 'Notes saved.',
  notesPlaceholder: 'Your notes on this application — contacts, dates, follow-ups…',
  notesTooLong: 'Notes are limited to 2000 characters.',
  noVersionYet: 'No tailored resume yet.',
  emptyEditor: 'Resume text is empty',
  generationFailed: 'Generation failed — nothing was saved. Try again.',
  autoRevised: 'Auto-revised once',
  noHiddenMatches:
    'No extra matches — your resume already uses everything relevant from your base.',
  addToResume: 'Add to resume',
  qualityCheckFailed: 'Quality check failed — try again.',
  exportFailed: 'Export failed — try again.',
} as const;

export const APPLICATIONS = {
  emptyTitle: 'No scans yet. Run your first scan.',
  newScan: 'New scan',
  loadFailed: "Couldn't load applications. Refresh the page.",
} as const;

export const QUALITY = {
  empty: 'No AI calls yet.',
  loadFailed: "Couldn't load metrics.",
} as const;

export const SETTINGS = {
  deleteAccount: 'Delete account and all data',
  deleteDialogBody:
    'This permanently deletes your career base, scans and resumes. Type DELETE to confirm.',
  deleteConfirmWord: 'DELETE',
  deleted: 'Your account and all data were deleted.',
  deleteFailed: 'Deletion failed — contact support.',
} as const;

/** Canonical API error codes (SPEC Block D). */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNREADABLE_PDF: 'UNREADABLE_PDF',
  DAILY_LIMIT: 'DAILY_LIMIT',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
} as const;

export const ERROR_MESSAGES = {
  DAILY_LIMIT: 'Daily AI limit reached (50 calls). Try again tomorrow.',
  VACANCY_LENGTH: 'Vacancy text must be between 100 and 20000 characters.',
} as const;
