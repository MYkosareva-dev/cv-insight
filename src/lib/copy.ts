/**
 * Every user-facing string, in one place. Tests import these same constants,
 * so copy drift breaks a test rather than shipping. Strings are verbatim from
 * SPEC Blocks B, E, F and G.
 *
 * No secrets, no resume/vacancy content — this module is safe on the client.
 */

export const APP_NAME = 'CV Insight';

/**
 * Has a `purge-auth-audit-log` run actually SUCCEEDED? (SPEC v2.9.)
 *
 * THE switch. Flipping it is what lets /privacy state a retention period; while
 * it is false the page promises nothing it cannot perform. `scripts/check.mjs`
 * R12 reads this constant: if it is `true`, `docs/eval/audit-retention-evidence.md`
 * must exist, exceed 200 bytes and no longer carry its placeholder marker. So the
 * claim and its proof can only land in the same commit.
 *
 * Earlier versions of R12 tried to SCAN the page for a period instead. That could
 * not work — `{90} days`, `<strong>90</strong> days`, "eighteen months" and
 * "2160 hours" are all the same promise and no regex closes that set. A boolean
 * has no vocabulary to go blind on.
 *
 * Flip it only alongside a real `cron.job_run_details` paste showing `succeeded`.
 * `cron.schedule` returning a job id proves the job is scheduled, not that the
 * `auth` schema (owned by `supabase_auth_admin`) will let it delete anything.
 */
export const AUDIT_RETENTION_VERIFIED = true;

/**
 * The /privacy erasure paragraph, in its two states (SPEC v2.9). The retention
 * period appears in the `verified` branch and NOWHERE else in the app — one
 * ternary, one claim, one switch.
 */
export const PRIVACY_ERASURE = {
  lead: 'Deleting your account removes your account and the data you created in the app.',
  verified:
    'Separately, we keep authentication audit records (event type, your user id, email address and IP address) in our EU database for 90 days for security purposes; these are not removed when you delete your account, and are deleted automatically when they age out.',
  fallback:
    'Separately, we keep authentication audit records (event type, your user id, email address and IP address) in our EU database for security purposes; these are not removed when you delete your account. An automated retention schedule for them is being set up.',
} as const;

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

/**
 * App-level error boundary (src/app/error.tsx). Deliberately says nothing about
 * WHAT failed: a thrown error can carry resume or vacancy text in its message,
 * and that must never be rendered or logged (CLAUDE.md, Privacy). Per-screen
 * error copy lives in the sections below and is more specific.
 */
export const ERROR_PAGE = {
  title: 'Something went wrong',
  body: 'This page could not be loaded. Try again, or head back to your scans.',
  retry: 'Try again',
  home: 'Go to Applications',
  reference: 'Reference',
} as const;

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
  emailLabel: 'Email',
  passwordLabel: 'Password',
  signingIn: 'Signing in…',
  creatingAccount: 'Creating account…',
  toSignUp: 'No account? Create one',
  toSignIn: 'Already have an account? Sign in',
  privacyLink: 'Privacy',
  invalidEmail: 'Enter a valid email address.',
  shortPassword: 'Password must be at least 8 characters.',
  /**
   * Sign-in has THREE outcomes, never two (SPEC Block E) — the same principle
   * as the three retrieval outcomes. Telling someone their password is wrong
   * when the app never got to check it is the app lying about something it
   * did not observe.
   */
  badCredentials: 'Email or password is incorrect.',
  rateLimited: 'Too many attempts — try again in a minute.',
  signInUnavailable: 'Sign-in is temporarily unavailable. Try again.',
  emailTaken: 'An account with this email already exists.',
  /**
   * Defensive — only reachable if the dashboard's Confirm-email toggle is ever
   * re-enabled (SPEC Block F says it is off).
   */
  checkEmail: 'Check your email to confirm your account.',
  /** Fourth sign-in outcome: the credentials were RIGHT. Never bucket as "incorrect". */
  emailNotConfirmed: 'Confirm your email before signing in.',
  signUpFailed: 'Sign-up failed. Try again.',
} as const;

/**
 * The PDF dropzone label (SPEC Block E). One string, two screens: the /scan
 * resume-source panel and the /career import dialog. Promoted out of SCAN so
 * neither screen reads the other's constant and neither copy can drift.
 */
export const PDF_DROPZONE = 'Drag & drop or choose a .pdf file, max 5 MB';

/** PDF upload ceiling, in bytes (Block F / edge case L5). 413 before any parsing. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

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
  dropzone: PDF_DROPZONE,
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
  /**
   * Edge case D3, verbatim: ONE item saved whose re-index failed. Kept exactly as
   * SPEC writes it, and used only where it is literally true — a single-item edit,
   * or a one-item save.
   */
  indexWarning: 'Item saved, search index will update on next edit.',
  /**
   * The bulk shape of the same state (SPEC v2.10). A 14-item import whose
   * indexing failed is not "Item saved", and singular copy on a bulk path
   * describes a state the user is not in.
   */
  indexWarningBulk: (count: number) =>
    `${count} items saved, but the search index will update on your next edit.`,
  /**
   * And the third state, which a boolean could not express: SOME items indexed.
   * Failure granularity is one batch and a batch never splits an item, so each
   * item is either fully searchable or not indexed at all — never half. Naming
   * the count is the only honest option, because the alternative is reporting a
   * partial failure as either a total one or a success.
   */
  indexWarningPartial: (failed: number) =>
    `Saved. ${failed} item${failed === 1 ? '' : 's'} will be added to the search index on your next edit.`,
  titleRequired: 'Title is required, max 200 characters.',
  contentRequired: 'Content is required, max 4000 characters.',
  limitReached: 'Career base limit reached (200 items). Delete unused items first.',

  // --- Import dialog (Block E: Dialog, tabs Upload PDF / Paste text, review list) ---
  dialogTitle: 'Import resume',
  dialogDescription:
    'CV Insight reads the text and splits it into reusable career items. Nothing is saved until you review them.',
  tabUpload: 'Upload PDF',
  tabPaste: 'Paste text',
  dropzone: PDF_DROPZONE,
  choosePdf: 'Choose a .pdf file',
  pastePlaceholder: 'Paste your resume text here.',
  notPdf: 'Only .pdf files are supported.',
  extract: 'Extract items',
  extracting: 'Reading your resume…',
  importFailed: 'Import failed — try again.',
  /** US-1 step 3: "Review 14 extracted items". */
  reviewHeading: (count: number) => `Review ${count} extracted item${count === 1 ? '' : 's'}`,
  reviewHint: 'Edit anything that looks wrong, then uncheck what you do not want to keep.',
  /** Block E: "[Save 14 items to base]". */
  saveToBase: (count: number) => `Save ${count} item${count === 1 ? '' : 's'} to base`,
  saving: 'Saving…',
  nothingSelected: 'Select at least one item to save.',
  saved: (count: number) => `${count} item${count === 1 ? '' : 's'} added to your career base.`,
  saveFailed: 'Could not save — try again.',

  // --- Cards (Block E: title, type Badge, period, 2-line preview, Edit/Delete) ---
  itemCount: (count: number) => `${count} item${count === 1 ? '' : 's'}`,
  edit: 'Edit',
  delete: 'Delete',
  cancel: 'Cancel',
  save: 'Save',
  editTitle: 'Edit career item',
  fieldType: 'Type',
  fieldTitle: 'Title',
  fieldPeriod: 'Period',
  fieldContent: 'Content',
  periodPlaceholder: '01/2025 – present',
  deleteTitle: 'Delete this career item?',
  /**
   * Names the CONSEQUENCE for search, because that is the part a user cannot
   * see: the item's `documents` rows go with it via FK cascade, so anything
   * generated afterwards can no longer draw on this experience.
   */
  deleteBody:
    'The item and its search index entries are removed. Resumes you already generated are not changed.',
  deleteConfirm: 'Delete item',
  deleting: 'Deleting…',
  deleted: 'Career item deleted.',
  deleteFailed: 'Could not delete — try again.',
  updated: 'Career item updated.',
  updateFailed: 'Could not save changes — try again.',
} as const;

/** Human labels for `career_items.type`, used by the Badge and the group headings. */
export const CAREER_ITEM_TYPE_LABEL = {
  role: 'Role',
  project: 'Project',
  achievement: 'Achievement',
  skill_block: 'Skills',
  education: 'Education',
  certification: 'Certification',
} as const;

/** Group order on /career — most load-bearing experience first (Block E grouping). */
export const CAREER_ITEM_TYPE_ORDER = [
  'role',
  'project',
  'achievement',
  'skill_block',
  'education',
  'certification',
] as const;

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
  title: 'Settings',
  emailLabel: 'Email',
  dangerZone: 'Danger zone',
  deleteAccount: 'Delete account and data',
  /**
   * The dialog names what GOES and what STAYS (SPEC v2.6). Split across three
   * constants only so the Privacy reference can be a real link and still keep
   * every word in this file — read them in order, they are one sentence run.
   *
   * It never carries the retention PERIOD, by decision: one retention story told
   * in one place. A number here plus a different (or absent) number one hop away
   * on /privacy is the two-truths defect with the surfaces swapped — and this
   * dialog links straight to that page. Under-promising is also the safe
   * direction for copy a user acts on irreversibly. Mechanically, a period here
   * would trip check.mjs R12 while /privacy carries the fallback wording.
   */
  deleteDialogBody:
    'This permanently deletes your career base, scans and resumes. Some authentication records are kept separately — see',
  deleteDialogPrivacyLink: 'Privacy',
  deleteDialogBodyEnd: '. Type DELETE to confirm.',
  deleteConfirmWord: 'DELETE',
  deleteConfirmPlaceholder: 'DELETE',
  deleteCancel: 'Cancel',
  deleting: 'Deleting…',
  deleteConfirm: 'Delete account',
  deleted: 'Your account and the data you created were deleted.',
  deleteFailed: 'Deletion failed — contact support.',
} as const;

/**
 * Flash notices (SPEC Block E, "Toast mechanism"). A Server Action cannot fire a
 * client toast, so an action that redirects appends `?notice=<key>` and
 * `<FlashToast />` shows the matching string ONCE, then strips the param.
 *
 * Keys are stable identifiers, NOT copy — the copy lives in the constants above
 * so there is still one source per string. An unknown key shows nothing rather
 * than echoing itself: the query string is user-controlled, and rendering it
 * would be a self-XSS-shaped hole and a way to put arbitrary words in the app's
 * own voice.
 */
export const NOTICES = {
  account_deleted: SETTINGS.deleted,
} as const;

export type NoticeKey = keyof typeof NOTICES;

export function noticeFor(key: string | null | undefined): string | null {
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(NOTICES, key)
    ? NOTICES[key as NoticeKey]
    : null;
}

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
  /**
   * 500. Not in the Block D table, which lists only the errors the app raises
   * deliberately. Added because the alternative was labelling a server fault
   * with a code that describes something else — an unset service-role key is
   * not AI_UNAVAILABLE, and a failed delete is not NOT_FOUND. SPEC Block D
   * carries the 500 row since v2.1.
   */
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

export const ERROR_MESSAGES = {
  DAILY_LIMIT: 'Daily AI limit reached (50 calls). Try again tomorrow.',
  VACANCY_LENGTH: 'Vacancy text must be between 100 and 20000 characters.',
  /**
   * The 502 body for any step (SPEC v2.10). Deliberately NOT `SCAN.aiUnavailable`,
   * which is the Block E toast for a scan and promises "Your vacancy was saved" —
   * true there, and a lie on the career-import path where no vacancy exists. The
   * API message says only what is true everywhere; each screen still renders its
   * own copy for its own state.
   */
  AI_UNAVAILABLE: 'AI service is unavailable. Try again.',
  /**
   * Rule B9's OTHER ceiling. "Career base limit reached (200 items)" is false when
   * the 500-document cap is what tripped, and a reachable state with no true words
   * is the defect this constant removes. Chunking is bounded so this is normally
   * unreachable (see lib/chunking.ts), which makes it a real safety net rather
   * than routine copy.
   */
  DOCUMENT_LIMIT: 'Search-index limit reached (500 entries). Delete unused items first.',
} as const;
