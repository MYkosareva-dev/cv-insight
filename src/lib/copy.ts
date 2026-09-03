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

/**
 * The other three strings the PDF path needs, promoted for the same reason as
 * the dropzone: /scan gained an Upload PDF tab in Phase 3, so each of these is
 * now one Block E/US-1 sentence rendered on TWO screens. A second copy of the
 * words is a second place for them to drift.
 */
export const UNREADABLE_PDF =
  "We couldn't read text from this PDF. It may be scanned — paste the text instead.";
export const FILE_TOO_LARGE = 'This file is over 5 MB.';
export const NOT_PDF = 'Only .pdf files are supported.';

/** Same argument: the paste box on /scan and the one in the import dialog. */
export const RESUME_PASTE_PLACEHOLDER = 'Paste your resume text here.';

/**
 * The vacancy field's UPPER bound (SPEC Block D's canonical error body).
 *
 * Promoted so the /scan counter's over-limit message and the API's 400 body are
 * the same sentence. `SCAN.vacancyRequired` says "at least 100 characters",
 * which is false as the message for a 25,000-character paste (edge case S7) —
 * a bound needs the message for the side it failed on.
 */
export const VACANCY_LENGTH = 'Vacancy text must be between 100 and 20000 characters.';

/** PDF upload ceiling, in bytes (Block F / edge case L5). 413 before any parsing. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * Grouped digits, the way Block E writes the /scan counter ("4,180 / 20,000").
 *
 * The locale is PINNED, unlike the timestamps in T1 which render in the viewer's
 * zone: this is a character budget against a limit written in the spec and in
 * the Zod schema, so it must read the same for every viewer and in a test.
 */
export const formatCount = (n: number): string => n.toLocaleString('en-US');

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

  // --- Block E: stepper, two panels, resume-source tabs (Phase 3) ---
  title: 'New scan',
  /** "Stepper on top: 1 Resume → 2 Vacancy → 3 Results". */
  steps: ['Resume', 'Vacancy', 'Results'] as const,
  resumeSourceLabel: 'Resume source',
  tabBase: 'Career base',
  tabPaste: 'Paste text',
  tabUpload: 'Upload PDF',
  /** Block E: "shows 'Using all N items of your base'". */
  usingAllItems: (n: number) => `Using all ${n} item${n === 1 ? '' : 's'} of your base`,
  resumePlaceholder: RESUME_PASTE_PLACEHOLDER,
  /**
   * The paste box's own accessible name. Distinct from the TAB label: the tab
   * panel already carries "Paste text" as its accessible name, so reusing it on
   * the field inside would give two different controls one name — ambiguous for
   * a screen reader, and for anything else addressing the field by name.
   */
  resumeTextLabel: 'Resume text',
  choosePdf: 'Choose a .pdf file',
  notPdf: NOT_PDF,
  unreadablePdf: UNREADABLE_PDF,
  fileTooLarge: FILE_TOO_LARGE,
  vacancyLabel: 'Job posting',
  /** Block E: char counter `4,180 / 20,000`. */
  counter: (used: number, max: number) => `${formatCount(used)} / ${formatCount(max)}`,
  vacancyTooLong: VACANCY_LENGTH,
  /**
   * An extracted PDF over the scan's 15,000-character bound is TRUNCATED rather
   * than refused — the user did nothing wrong — and the cut is reported, for the
   * same reason `CAREER.truncated` exists: silently scoring half of someone's
   * resume shows a number with no hint that part of the input was dropped.
   */
  resumeTruncated:
    'This resume is very long — only its first 15,000 characters were used for the match.',
  /**
   * `resumeSource: 'resume_version'` is a valid value of the Block C CHECK
   * constraint whose rows do not exist yet (`resume_versions` lands in Phase 4),
   * so the endpoint refuses it with words instead of a Zod shape error.
   */
  savedVersionUnavailable: 'Saved resume versions arrive with the tailored-resume editor.',
  /**
   * The re-run is for a draft whose analysis never completed. Re-analysing a
   * finished scan would replace the numbers that run measured while its date
   * went on saying otherwise; re-scoring an edited resume is a different
   * feature (Block D #6).
   */
  alreadyAnalysed: 'This scan has already been analysed.',
  /**
   * Edge case D7 as COPY rather than as a silent all-gaps result. A base with
   * items but zero index entries (every embedding call failed) matches nothing,
   * and "Using all N items of your base" would then be the app promising a
   * search it cannot perform.
   */
  baseNotIndexed:
    'Your career base is not searchable yet — open an item and save it to rebuild the search index.',
} as const;

export const CAREER = {
  importResume: 'Import resume',
  emptyTitle: 'Your career base is empty',
  emptyBody:
    'Your career base is empty. Import your resume — CV Insight will split it into reusable career items.',
  unreadablePdf: UNREADABLE_PDF,
  fileTooLarge: FILE_TOO_LARGE,
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
  pastePlaceholder: RESUME_PASTE_PLACEHOLDER,
  notPdf: NOT_PDF,
  extract: 'Extract items',
  extracting: 'Reading your resume…',
  importFailed: 'Import failed — try again.',
  /**
   * The extraction was bounded before the model saw it (S7). Said out loud
   * rather than left as "fewer items than my CV has, and no reason given" —
   * silently dropping part of someone's career history is the same defect the
   * chunker refuses when it merges overflow instead of discarding it.
   */
  truncated: 'This resume is very long — only its first part was read. Check for missing items.',
  /** US-1 step 3: "Review 14 extracted items". */
  reviewHeading: (count: number) => `Review ${count} extracted item${count === 1 ? '' : 's'}`,
  reviewHint: 'Edit anything that looks wrong, then uncheck what you do not want to keep.',
  /** Block E: "[Save 14 items to base]". */
  saveToBase: (count: number) => `Save ${count} item${count === 1 ? '' : 's'} to base`,
  saving: 'Saving…',
  nothingSelected: 'Select at least one item to save.',
  saved: (count: number) => `${count} item${count === 1 ? '' : 's'} added to your career base.`,
  saveFailed: 'Could not save — try again.',

  // --- Import identity and the saved step (SPEC v2.11) ---
  /**
   * The step indicator, verbatim as specified: "1 Paste -> 2 Review -> 3 Saved".
   * "Paste" names the primary path (paste is now the default tab) rather than
   * branching per tab, so the indicator does not change shape mid-flow.
   */
  steps: ['Paste', 'Review', 'Saved'] as const,
  fieldName: 'Name this resume',
  /** Default label for a run: "Resume 1", "Resume 2", … Editable before saving. */
  defaultName: (n: number) => `Resume ${n}`,
  nameRequired: 'Name is required, max 120 characters.',
  fieldTargetRole: 'Target role (optional)',
  targetRolePlaceholder: 'AI Automation Engineer',
  targetRoleTooLong: 'Target role is limited to 120 characters.',
  nameHint: 'Career items remember which resume they came from.',
  /**
   * The saved step. The "· M skipped as duplicates" half renders only when
   * something was actually skipped — "Saved 14 items · 0 skipped as duplicates"
   * would report a state the user is not in, and this app writes the copy for
   * the state it is describing.
   */
  savedSummary: (saved: number, skipped: number) => {
    const head = `Saved ${saved} item${saved === 1 ? '' : 's'}`;
    return skipped === 0 ? head : `${head} · ${skipped} skipped as duplicates`;
  },
  /**
   * The whole batch was already in the base. Not an error and not a silent
   * no-op: the user asked for something, the app did nothing, and it says why.
   */
  allDuplicates: (skipped: number) =>
    `Nothing new to save — all ${skipped} item${skipped === 1 ? '' : 's'} are already in your career base.`,
  done: 'Done',
  importAnother: 'Import another',
  /** Provenance chip on a card: "from: Resume 2 · AI Automation Engineer". */
  fromImport: (name: string, targetRole: string | null) =>
    targetRole ? `from: ${name} · ${targetRole}` : `from: ${name}`,

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
  // --- Block E left rail: the ring and the category bars (Phase 3) ---
  title: 'Scan result',
  matchRate: 'Match Rate',
  /**
   * One sentence naming WHAT the ring measured, because rule B1 measures two
   * different things against two different texts: S over the career base, K over
   * the resume source the user picked. Without it a paste-scan reads the number
   * as "how well the text I pasted matched", which is not what was computed.
   */
  scoreExplainer:
    'Must-have requirements are matched against your career base (60%); vacancy keywords are counted in the resume source you picked (40%).',
  categoryKeywords: 'Keywords',
  categoryCoverage: 'Requirements coverage',
  categoryAts: 'ATS format',
  categoryQuality: 'Quality',
  /** Block E: category bars with "N issues". */
  issues: (n: number) => `${n} issue${n === 1 ? '' : 's'}`,
  noIssues: 'No issues',
  /**
   * ATS format and Quality are the judge's two criteria, and the judge is
   * Phase 4. An "0 issues" bar would be a measurement the app never took —
   * the same defect as B1b rendering a hard 0 for a score with no signal.
   */
  notChecked: 'Not checked yet',
  /**
   * A check that RAN and had nothing to look at — no keywords were extracted,
   * or the posting stated no requirements. Distinct from `notChecked`, which
   * means the check has not happened: reporting a measured emptiness as
   * "Not checked yet" denies work the app actually did, and the Analysis tab on
   * the same screen says the opposite.
   */
  nothingToCheck: 'Nothing to check',

  // --- Tabs (Block E) ---
  tabAnalysis: 'Analysis',
  tabBaseMatches: 'Base matches',
  tabVacancy: 'Vacancy',
  colRequirement: 'Requirement',
  colKind: 'Type',
  colStatus: 'Status',
  colBestMatch: 'Best match',
  colKeyword: 'Keyword',
  colInResume: 'In resume',
  colInVacancy: 'In vacancy',
  kindMust: 'Must',
  kindNice: 'Nice',
  statusCovered: 'Covered',
  statusBaseOnly: 'In base only',
  statusGap: 'Gap',
  /** US-3 step 2: "BPMN — found in career item 'Business Analyst, BotWorks Labs'". */
  foundInItem: (title: string) => `found in career item “${title}”`,
  /**
   * The career base was the scan's own source, so "covered by the base but
   * missing from your resume" is not a state that can exist for this run. Said
   * out loud instead of rendering an empty tab that reads as "nothing found".
   */
  baseIsSource: 'Your career base is the source — every base match is already in scope.',
  /**
   * NOT `addToResume`. That string is US-3 step 4's promise to insert a bullet
   * into the tailored-resume editor, and the editor is Phase 4 — a button
   * labelled for an action the app does not perform is copy describing a state
   * the user is not in. This label says what the button does today.
   */
  copyBullet: 'Copy to clipboard',
  copied: 'Copied to your clipboard.',
  copyFailed: 'Could not copy — select the text instead.',
  vacancyRawHeading: 'Job posting',
  vacancyParsedHeading: 'Parsed requirements',
  /**
   * The THIRD state of a result screen, and the one that must never be confused
   * with N4's "we found no requirements": this scan's analysis never ran (the AI
   * was unavailable, or the daily cap refused the step), so there is nothing
   * measured to show — and a coverage table with zero rows would read as "no
   * gaps found".
   */
  notAnalysed: 'This scan has not been analysed yet — the AI step did not complete.',
  runAnalysis: 'Run analysis',
  analysisFailed: 'Analysis failed — try again.',
  notesLabel: 'Notes',
  notesFailed: 'Could not save your notes — try again.',

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
  title: 'Applications',
  emptyTitle: 'No scans yet. Run your first scan.',
  newScan: 'New scan',
  loadFailed: "Couldn't load applications. Refresh the page.",

  // --- Block E table (Phase 3) ---
  colPosition: 'Position',
  colCompany: 'Company',
  colScore: 'Score',
  colStatus: 'Status',
  colCreated: 'Created',
  /**
   * A draft whose parse never ran has no title and no company — the parser is
   * what fills those columns. Two blank cells would look like a rendering bug;
   * this names the actual state, and the row's own score cell shows NO_SCORE.
   */
  notAnalysedTitle: 'Not analysed yet',
  /**
   * The posting was analysed and the parser found no title. Not
   * `notAnalysedTitle`, which would deny a run that happened, and not a blank
   * cell, which reads as a rendering fault.
   */
  untitledPosting: 'Untitled posting',
  /**
   * Its own em dash, not an alias of `NO_SCORE`. Same glyph, different meaning:
   * aliasing them means changing the score placeholder silently changes the
   * Company column.
   */
  noCompany: '—',
  statusUpdated: 'Status updated.',
  statusUpdateFailed: 'Could not update the status — try again.',
} as const;

/** `applications.status` as the Select renders it (Block E). */
export const APPLICATION_STATUS_LABEL = {
  draft: 'Draft',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
} as const;

/** Select order: the pipeline as it actually runs, not alphabetical. */
export const APPLICATION_STATUS_ORDER = [
  'draft',
  'applied',
  'interview',
  'offer',
  'rejected',
] as const;

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
  VACANCY_LENGTH,
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
  /**
   * 413 for a multipart body that is over the ceiling as a WHOLE, checked off
   * `Content-Length` before the body is buffered. Distinct from
   * `FILE_TOO_LARGE`: a scan upload carries the PDF and the job posting in one
   * request, so "This file is over 5 MB." can be false while the request is
   * still too large, and a message that names the wrong cause is worse than a
   * general one.
   */
  REQUEST_TOO_LARGE:
    'That request is too large — keep the PDF under 5 MB and the posting under 20,000 characters.',
} as const;
