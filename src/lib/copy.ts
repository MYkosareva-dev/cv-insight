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
 * The NAME line of a generated resume when the user has not saved a display name
 * (SPEC v2.17).
 *
 * A VISIBLE PLACEHOLDER, never a substituted value. The career base holds no
 * person's name — P4 splits an imported resume into items and the heading
 * becomes part of none of them — so the generator has nothing to write there,
 * and owner testing found it writing the vacancy's job title instead: a .docx
 * that reaches an employer with "Data Annotator" where the candidate's name
 * belongs, which is what an ATS parser reads as the name.
 *
 * Square brackets and capitals because the one thing this must not do is look
 * finished. An exported file carrying it is obviously incomplete at a glance, in
 * the document itself and not only in a toast the user has already dismissed —
 * which is the difference between a reminder and a document that quietly goes
 * out wrong.
 */
export const NAME_PLACEHOLDER = '[YOUR NAME]';

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

/**
 * Edge case D7's remedy, said once. A base with items but zero index entries
 * matches nothing, and both the scan screen (before a scan) and the generate
 * button (before a tailored resume) have to name the same fix — a second copy of
 * the words is a second place for them to drift.
 */
const baseNotIndexedCopy =
  'Your career base is not searchable yet — open an item and save it to rebuild the search index.';

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
   * constraint that this app does not offer as a scan source. The endpoint
   * refuses it with words instead of a Zod shape error.
   *
   * REWORDED IN v2.16, because the sentence it replaced ("Saved resume versions
   * arrive with the tailored-resume editor") named a milestone that has now
   * arrived: `resume_versions` has rows from Phase 4 onward, and copy promising
   * a thing that has shipped while the source is still refused is copy saying
   * the opposite of the truth. The tab is still not built — deferred, and
   * declared as deferred — so what the string says now is what the app does.
   */
  savedVersionUnavailable:
    'Scanning a saved tailored resume is not available — paste its text instead.',
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
  baseNotIndexed: baseNotIndexedCopy,
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
  /**
   * The BEST MATCH cell for a row that rule B1's lexical gate turned into a gap
   * (SPEC v2.15): the base was topically close enough to clear the similarity
   * threshold, and it never names the thing the requirement asks for.
   *
   * One short phrase, in the cell that would otherwise hold a career-item title,
   * because that cell is exactly where the user asks "matched against what?".
   * Naming the TERM is the whole point — an unexplained "Gap" beside a keywords
   * table that says "Labelbox: 0 in resume" would trade one contradiction for a
   * different confusion.
   */
  missingTerm: (term: string) => `no mention of “${term}”`,
  /** US-3 step 2: "BPMN — found in career item 'Business Analyst, BotWorks Labs'". */
  foundInItem: (title: string) => `found in career item “${title}”`,
  /**
   * The career base was the scan's own source, so "covered by the base but
   * missing from your resume" is not a state that can exist for this run. Said
   * out loud instead of rendering an empty tab that reads as "nothing found".
   */
  baseIsSource: 'Your career base is the source — every base match is already in scope.',
  /**
   * v2.12 shipped `copyBullet` because the editor `addToResume` names did not
   * exist yet. It does now, so the button performs US-3 step 4 and wears the
   * label for it — the two constants are kept apart rather than merged, since
   * they name two different actions and only one of them is still wired.
   */
  copyBullet: 'Copy to clipboard',
  /**
   * KEPT AND UNWIRED, for the same reason and on the same terms as `copyBullet`
   * above — declared here rather than left to be rediscovered, which is the
   * distinction Phase 3 drew when it DELETED unreachable constants a branch had
   * just added and KEPT `APPLICATIONS.loadFailed` because its state was real.
   *
   * These two are one pair: `copyBullet` is the button and `copied` / `copyFailed`
   * are its two outcomes. Deleting only the middle of a three-part mechanism would
   * leave a label and a failure message for a success nobody could report, so if
   * the clipboard path is ever wired again it is wired with all three, and if it is
   * ever abandoned all three go together.
   */
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

  // --- Phase 4: the tailored-resume tab, the judge card, re-score, export ---
  tabResume: 'Tailored resume',
  editorLabel: 'Tailored resume',
  /**
   * US-3 step 4 inserts into the editor, and there is no editor until a version
   * exists. The button is DISABLED with this hint rather than quietly appending
   * to a panel the same screen says is empty, and rather than wearing a second
   * label for a second action — one button, one promise, and an honest reason
   * when it cannot be kept yet.
   */
  addToResumeDisabled: 'Generate a tailored resume first, then add this to it.',
  addedToResume: 'Added to your tailored resume.',
  /**
   * The bullet [Add to resume] actually inserts. US-3 step 3's "ready-to-insert
   * bullet phrased for this vacancy" is NOT what this is: phrasing one needs
   * either a second metered call or the retrieved chunk's text, and chunks never
   * reach the client (CLAUDE.md, Retrieval). So the inserted line states the
   * requirement and names the career item that covers it — both of which the
   * screen already holds — and the user edits it into their own words. Declared
   * rather than dressed up as the feature.
   */
  insertedBullet: (requirement: string, item: string | null) =>
    item ? `- ${requirement} (from: ${item})` : `- ${requirement}`,

  /**
   * A resume can only be tailored to a posting the app has PARSED: with no
   * requirements there is nothing to write against, and the generator would be
   * asked to tailor to nothing. Distinct from `notAnalysed`, which describes the
   * scan; this names what the BUTTON cannot do and points at the remedy on the
   * same screen.
   */
  generateNeedsAnalysis: 'Run the analysis first — there is nothing to tailor to yet.',
  /**
   * Edge case D7 on the generation path. The retrieval found no career chunks,
   * so every claim in a generated resume would be ungrounded by construction and
   * the reviewer would reject all of them — a Sonnet call spent to produce
   * something the app is about to refuse. Refused before the spend instead, with
   * the same remedy `SCAN.baseNotIndexed` names.
   */
  generateNeedsBase: baseNotIndexedCopy,

  /**
   * NO ELLIPSIS, unlike its three siblings below, and the difference is the
   * point: `<BusyDots />` renders three PULSING dots after this label, and a
   * static "…" beside them would read as six dots, three of them dead.
   *
   * Only the generate button gets the motion. It is the one that runs for the
   * better part of a minute — a re-score, a quality check and an export are all
   * seconds — and owner testing found a dimmed button with a changed label
   * indistinguishable from a hung one over that span.
   */
  generating: 'Generating',
  /** US-4 step 1: the progress text cycles while the pipeline runs. */
  generateSteps: ['Retrieving your experience…', 'Writing…', 'Quality check…'] as const,
  rescoring: 'Re-scoring…',
  checkingQuality: 'Checking quality…',
  exporting: 'Preparing…',

  // --- the judge card (US-4 step 3, prompt P3's four criteria) ---
  judgeHeading: 'Quality check',
  criterionGrounding: 'Grounding',
  criterionKeywords: 'Keyword coverage',
  criterionRelevance: 'Relevance',
  criterionAts: 'ATS format',
  groundingPassed: 'Passed',
  groundingFailed: 'Failed',
  criterionScore: (score: number) => `${score}/5`,
  /**
   * The judge's own words for a criterion, shown under it. Kept as a labelled
   * list rather than free prose so a reader can tell the app's copy from the
   * model's output — the model wrote the text after the colon, and nothing after
   * it is ever treated as an instruction.
   */
  violationsHeading: 'Unsupported claims',
  /**
   * The terms the reviewer says the base supports AND the base literally
   * contains — every one of them checked with `keywordPresent`, the same
   * function rule B1's lexical gate uses (SPEC v2.17).
   *
   * The check is not belt-and-braces. Owner testing found this section listing
   * Labelbox, Supervisely, MS Office and Google Suite on a screen that said
   * `no mention of "Labelbox"` two blocks above: the page asserting both that
   * the base lacks a term and that the base supports it, with the second
   * assertion telling the user to write it into their resume. That is the
   * keyword stuffing this phase removed from P2, arriving through the reviewer
   * instead of the writer.
   */
  missingHonestHeading: 'Supported by your base, missing from the resume',
  /**
   * The other half of that split, and it needs its own words. These terms are
   * asked for by the posting and are NOT in the career base, so the honest thing
   * to say is that they are gaps — not suggestions. The hint exists because the
   * heading alone, in a card full of "add these" material, would still read as
   * an invitation.
   */
  notInBaseHeading: 'Asked for by the posting, and not in your career base',
  notInBaseHint:
    'These are gaps, not suggestions. Add one to your career base only if you have really done it — never straight into this resume.',
  atsIssuesHeading: 'Formatting issues',
  /**
   * The version was generated and the quality check did NOT run — the daily cap
   * refused it, or the model was unavailable. Distinct from a judge that ran and
   * approved: one is a measurement, the other is its absence, and the card must
   * not show four green rows for a review nobody performed.
   */
  judgeNotRun:
    'Your resume was saved, but the quality check did not run. Use [Check quality] to review it.',
  /**
   * Rule B3's revision was EARNED and could not be written: the reviewer refused
   * the draft and listed nothing to fix. Regenerating against that would be a
   * paid call carrying no information — a generic "try again" — so it does not
   * happen, and the card says so rather than showing a bare "revise".
   */
  reviseWithoutFindings:
    'The reviewer flagged this draft without saying what to change, so it was not rewritten.',
  /**
   * The revision ran and did NOT beat the original, so the editor opens with the
   * first draft (Block D #5: "return the best version anyway"). Without this the
   * "Auto-revised once" badge would sit above the pre-revision text with nothing
   * explaining which of the two the reader is looking at.
   */
  revisionNotBetter: 'The rewrite did not improve on the first draft, so this is the first draft.',
  versionsHeading: 'Versions',
  versionLabel: { ai: 'AI draft', ai_revision: 'AI revision', user: 'Your edit' },
  /**
   * A version the reviewer approved, and one it did not. Not "Failed": rule B2's
   * grounding failure and a criterion scoring 2 both land on `revise`, and only
   * one of them is a factual problem — the row says the verdict, and the card
   * above says which of the four criteria produced it.
   */
  versionApproved: 'Approved',
  versionNeedsWork: 'Needs work',

  // --- re-score (US-5 step 2) ---
  /**
   * A re-score measures the text in the EDITOR, which is not saved anywhere. The
   * ring is showing a live reading of an unsaved draft, and saying so is what
   * keeps it from reading as the stored scan result — the number the scan
   * measured is still the one on the row, and it comes back on reload.
   */
  rescoredLabel: 'Live score for the text in the editor — not saved.',
  rescoredRevert: 'Show the original scan',
  rescoreFailed: 'Could not re-score — try again.',

  /**
   * A RUN THAT CHANGED NOTHING STILL HAS TO REPORT ITSELF (SPEC v2.20, owner
   * feedback). Re-scoring text nobody edited returns the score it returned
   * before, the ring does not move, and the screen was indistinguishable from a
   * button that did nothing — which is the same defect the busy indicator fixes
   * at the other end of the request. An unchanged measurement is a RESULT, and
   * the number is named so the user can see which one it is.
   */
  rescoredUnchanged: (score: string) =>
    `Re-scored — the score is unchanged at ${score}. Nothing in your edit moved it.`,
  rescoredChanged: (from: string, to: string) => `Re-scored — ${from} → ${to} for the text in the editor.`,
  /**
   * The quality check finished. Said out loud for the same reason: the card
   * below may come back with the same four scores it had, and a screen that
   * looks identical after a paid call reads as a click that missed.
   */
  qualityChecked: 'Quality check complete — the card below is the new verdict.',

  /**
   * REGENERATE (SPEC v2.20, from the owner's live use).
   *
   * Block E hides [Generate tailored resume] once a version exists, which left a
   * user who changes their name, fills in their profile, or simply wants a second
   * attempt locked to the first text forever. This is the way back — and it is
   * METERED, so it says what it costs BEFORE it runs and asks once, rather than
   * being a button a stray click can spend money on.
   *
   * IT APPENDS. `resume_versions` is append-only by design, so a regenerate adds
   * to the history and replaces nothing; the dialog says so, because a user who
   * thinks they are about to lose their current text will not press it.
   */
  regenerate: 'Regenerate',
  regenerating: 'Regenerating',
  regenerateDialogTitle: 'Write another resume?',
  regenerateDialogBody:
    'This writes a new resume from your career base and has the reviewer check it. Your current version is kept — every version stays in the history below.',
  regenerateDialogCost:
    'It costs two AI calls, or four if the reviewer asks for a rewrite.',
  regenerateConfirm: 'Write another',
  regenerateCancel: 'Cancel',

  /**
   * ONE LINE PER ACTION, saying what it does and that it costs a model call
   * (SPEC v2.20, from the owner's live use: the three buttons gave no clue what
   * they would do or what they would spend).
   *
   * THE COSTS ARE STATED IN THE UNITS THE APP ACTUALLY SPENDS, which is why
   * [Re-score] does not say "one AI call" and stop there. It makes no chat call
   * at all — rule B7 excludes embeddings by definition and rule B7a exists
   * precisely because that made it the one metered path with no ceiling — so
   * copy that priced it like a generate would be wrong in the user's favour on
   * the daily limit and wrong in the app's favour on what it does.
   *
   * [Download .docx] gets a line too even though it spends nothing, because the
   * absence of one in a row of three annotated buttons reads as an omission
   * rather than as "this one is free". Its line says what it saves, which is the
   * part of it a user does not expect.
   */
  generateHelp:
    'Writes a resume from your career base and has the reviewer check it. Costs two AI calls, or four with a rewrite.',
  /**
   * ITS OWN LINE, not `generateHelp` reused. The two actions cost the same and do
   * the same thing to the same corpus, but only one of them is happening to a
   * screen that already HAS a resume on it — and the fact a reader needs there is
   * what happens to the text in front of them, which "Writes a resume…" does not
   * answer.
   */
  regenerateHelp:
    'Writes another resume from your career base and has it checked. Your current version is kept. Costs two AI calls, or four with a rewrite.',
  /**
   * IT IS NOT "ONE AI CALL", and the first version of this line said so — which
   * is the exact sentence the paragraph above forbids, shipped by the copy it
   * was written to constrain. A re-score makes NO chat call: it re-embeds the
   * requirements and the editor's text, which is two paid embedding requests on
   * a measured run, and it is counted against rule B7a's separate ceiling rather
   * than against rule B7's 50. A user told "one AI call" would read forty
   * re-scores as forty of their fifty daily calls, and be wrong in both
   * directions at once.
   */
  rescoreHelp:
    'Re-measures the match against the text in the editor. Costs a paid AI call — no writing, just re-reading your text — with its own daily limit, and saves nothing.',
  checkQualityHelp:
    'Asks the reviewer for a fresh verdict on the text in the editor. Costs one AI call and saves the text as a version.',
  downloadHelp:
    'Builds the .docx from the text in the editor and saves it as a version. No AI call.',
  /**
   * A re-score matches the requirements against the resume in the EDITOR, not
   * against the career base, so the "Best match" column names the user's own
   * line. The scan's explainer describes a different measurement and would be
   * wrong here.
   */
  rescoredExplainer:
    'Must-have requirements are matched against the resume in the editor (60%); vacancy keywords are counted in the same text (40%).',
  /**
   * The 100-character FLOOR, which used to borrow `emptyEditor` and therefore
   * told a user with a 50-character paste that their text was empty. It was not:
   * it was short. This app tells four sign-in outcomes and three retrieval
   * outcomes apart on exactly that principle, and a bound the schema enforces
   * deserves a sentence of its own as much as the ceiling below does.
   */
  resumeTooShort: 'A resume needs at least 100 characters.',
  resumeTooLong: 'A resume is limited to 15000 characters.',
  savedUserVersion: 'Your edited version was saved.',
  /**
   * The export went out with the name placeholder still in it. Said as a WARNING
   * on a completed download rather than as a refusal: the file is the user's and
   * blocking it would be the app deciding what they may send, but leaving it
   * silent would let a resume reach an employer with "[YOUR NAME]" at the top
   * because nobody mentioned it.
   */
  /**
   * THE EXPORTED FILE HAS NO CONTACT HEADER (v2.20), which is reachable and was
   * silent. `withContactHeader` runs during GENERATION, so a resume written
   * before the contact details were saved has no header block — and the export
   * writes the editor's text verbatim. The one thing migration 005 exists to fix
   * would then stay broken for every application the user already had, with the
   * download looking finished.
   *
   * A WARNING AND NOT A REFUSAL, exactly like the name placeholder beside it: the
   * file is the user's and the app does not decide what they may send. It names
   * the way out, because [Regenerate] is not an obvious answer to "my phone
   * number is missing".
   */
  exportedWithoutContacts:
    'Downloaded — but this resume was written before your contact details were saved, so it has no contact header. Regenerate it, or paste the details into the editor.',
  exportedWithPlaceholderName:
    'Downloaded — but the name line still reads [YOUR NAME]. Replace it, or save your name in Settings.',
  /** In the editor, where the placeholder is still on screen and still editable. */
  namePlaceholderNotice:
    'Replace [YOUR NAME] with your own, or save it once in Settings and the next resume uses it.',
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
  /**
   * The observability dashboard (SPEC Block E, Block H item 7; built in v2.20).
   *
   * EVERY LABEL NAMES ITS ROWS, and that is a copy rule on this screen rather
   * than a style preference. It is the product's own evidence that quality is
   * MEASURED rather than asserted, so a figure a reader cannot trace back to a
   * row is worse than no figure: it asks to be believed. Each caption therefore
   * says which table the number was counted in and what its denominator was.
   *
   * A SHARE ALWAYS SHOWS ITS FRACTION. "33%" and "1 of 3 runs" are the same fact
   * and only one of them is honest about how much is known, so the fraction is
   * always rendered and the percentage is dropped below `SMALL_SAMPLE`
   * observations, where it would imply precision nobody measured.
   */
  title: 'Quality',
  lead: 'Every number here is counted from rows this app already stores: the AI-call log and the reviewer verdicts saved with each resume version. Nothing on this screen is estimated.',
  empty: 'No AI calls yet.',
  emptyHint: 'Run a scan and generate a resume — this screen fills in from the rows that run writes.',
  loadFailed: "Couldn't load metrics.",

  /** The window the totals are computed over, said out loud. */
  windowNote: (rows: number) => `Counted over the ${formatCount(rows)} most recent AI calls.`,
  windowFull: (rows: number) =>
    `Counted over the ${formatCount(rows)} most recent AI calls — the ceiling this screen reads, so calls older than those are not included in the totals above.`,
  versionWindowNote: (rows: number) =>
    `Counted over the ${formatCount(rows)} most recent resume versions.`,
  /**
   * The version window has to say it is full for the same reason the call window
   * does. It was missing, and the asymmetry mattered more here: this read is
   * newest-first, so truncation cuts the OLDEST rows, and a run whose draft fell
   * outside the window while its rewrite stayed inside would have gone missing
   * from every bucket with nothing on screen to say a row had been dropped.
   */
  versionWindowFull: (rows: number) =>
    `Counted over the ${formatCount(rows)} most recent resume versions — the ceiling this screen reads, so older runs are not included.`,

  /** Said wherever a share rests on too few observations to be read as a rate. */
  thinSample: 'Too few runs to read as a rate — the fraction is the whole of it.',
  nothingMeasured: 'Nothing measured yet',

  tileTotalCost: 'Total AI cost',
  tileTotalCostSource: (calls: number) =>
    `Sum of cost_usd_micro over ${formatCount(calls)} logged call${calls === 1 ? '' : 's'}.`,
  /**
   * "COST PER APPLICATION", and not "per run" — which is what this tile said
   * first, over a denominator that could not mean that.
   *
   * The figure divides by DISTINCT APPLICATION IDS, and since [Regenerate] one
   * application can hold several AI runs: the tile would have read "1 run" with
   * three generations' cost in it, eight inches above a section correctly saying
   * "3 AI runs". Two quantities under one word, on the screen whose one rule is
   * traceability. The denominator is what it is — an application is what an
   * `llm_calls` row can be attributed to, and a `resume_versions` run is not
   * something a call row names — so the LABEL moved to match the arithmetic
   * rather than the arithmetic being bent to match the label.
   */
  tileCostPerApplication: 'Cost per application',
  tileCostPerApplicationSource: (cost: string, applications: number) =>
    `${cost} of call cost carries an application id, divided by the ${formatCount(applications)} application${applications === 1 ? '' : 's'} that made calls. An application may hold several AI runs, so this is not the cost of one generation.`,
  tileApplications: 'Applications with AI calls',
  tileApplicationsSource:
    'Distinct application ids in the AI-call log — one per posting you scanned, whatever it cost. Not the same as the AI runs counted below.',
  tileUnattributed: 'Not attributable to a run',
  tileUnattributedSource:
    'Calls with no application id: resume imports and career-base indexing. Real spend, and not part of any one run — so it is stated rather than averaged into the figure above.',
  /**
   * THE TWO DAILY CAPS, SHOWN AS THE COUNTERS THEMSELVES.
   *
   * Both figures come from the queries rules B7 and B7a actually use, not from a
   * second count of the same rolling window — so the tile shows the number the
   * cap compares against. Two implementations of one window is how a dashboard
   * comes to disagree with the rule it illustrates.
   */
  tileChatCalls: 'Chat calls in the last 24 hours',
  tileChatCallsSource: (limit: number) =>
    `Rule B7's own counter: import, parse, generate and quality-check rows in the rolling 24 hours, against its cap of ${limit}.`,
  tileRescoreCalls: 'Re-score calls in the last 24 hours',
  tileRescoreCallsSource: (limit: number) =>
    `Rule B7a's own counter: rescore embedding requests in the rolling 24 hours, against its cap of ${limit}. Embeddings are excluded from rule B7 by definition, which is why they have a ceiling of their own.`,
  tileFallback: 'Served by the fallback model',
  tileFallbackSource: 'Rows with fallback_used = true.',
  tileFailed: 'Calls that failed',
  /**
   * NOT "billed like any other request", which the first version said. A request
   * that never reached the service is logged with `cost_usd_micro = 0` and
   * `cost_known = true`, because nothing was spent and that is known — so
   * claiming every failure was billed would be this screen making the inverse of
   * the mistake `cost_known` exists to prevent.
   */
  tileFailedSource:
    'Rows with ok = false. Each one is logged; whether it cost anything depends on how far it got, and its own cost column says which.',
  tileUnknownPricing: 'Calls with unknown pricing',
  tileUnknownPricingSource:
    'Rows with cost_known = false: the serving model had no price entry, so their cost is 0 in the total above and is genuinely unknown rather than free.',
  tileTokens: 'Tokens in / out',
  tileTokensSource: 'Sums of tokens_in and tokens_out over the same rows.',

  /** The rubric outcome of each AI run. */
  rubricHeading: 'What the reviewer said about each AI run',
  rubricLead:
    'One run is one generated draft plus the single rewrite rule B3 allows. Counted from the resume versions themselves: an ai row, and the ai_revision row that follows it.',
  rubricRuns: (runs: number) => `${formatCount(runs)} AI run${runs === 1 ? '' : 's'}`,
  outcomeApprovedFirst: 'Passed the rubric on the first attempt',
  outcomeRevisedApproved: 'Needed the one rewrite, and passed after it',
  outcomeRevisedStillRevise: 'Needed the rewrite and still failed after it',
  outcomeReviseNoRewrite: 'Refused, with no rewrite attempted',
  outcomeReviseNoRewriteHint:
    'The reviewer refused the draft and either listed nothing specific to act on, or the daily cap or the service refused the rewrite step.',
  outcomeNotChecked: 'The quality check did not run',
  outcomeNotCheckedHint:
    'No reviewer verdict is stored for the version that was kept. Never counted as a pass or a failure — an unmeasured resume is not a measured one.',

  /** The score distribution, per criterion. */
  distributionHeading: 'Score distribution, per rubric criterion',
  distributionLead:
    'Every stored reviewer verdict, including the ones you asked for with [Check quality]. Each row counts how many versions scored 1 to 5 on that criterion.',
  distributionJudged: (judged: number) =>
    `${formatCount(judged)} judged version${judged === 1 ? '' : 's'}`,
  colCriterion: 'Criterion',
  colMean: 'Mean',
  colScore: (score: number) => `${score}`,
  groundingRow: 'Grounding (a gate, not a score)',
  groundingTally: (passed: number, failed: number) =>
    `${formatCount(passed)} passed · ${formatCount(failed)} failed`,
  groundingHint:
    'Rule B2 makes a grounding failure uncompensatable, so it is counted and never averaged in with the three scored criteria.',

  /** Cost by step. */
  stepsHeading: 'Cost by pipeline step',
  stepsLead: 'The same rows, grouped by their step column.',
  colStep: 'Step',
  colCalls: 'Calls',
  colCost: 'Cost',
  colMeanLatency: 'Mean latency',
  colFailedShort: 'Failed',
  colUnknownPricing: 'Unpriced',

  /** Block E's table of the last 50 calls. */
  callsHeading: 'Last 50 AI calls',
  /**
   * IT IS NOT "the rows every figure above is counted from", which is what this
   * line said first. Three independent reads back this screen: the AI-call
   * window for the tiles and the step table, a `resume_versions` window for the
   * rubric sections, and this table's own newest-50 — and the DAL deliberately
   * lets the first and the third differ. On the one screen whose stated rule is
   * that every number is traceable to a row, a caption claiming the wrong rows
   * was the untraceable claim.
   */
  callsLead:
    'The newest 50 of the AI calls the figures at the top are counted from. The rubric sections above come from your saved resume versions instead. Metadata only — no resume or vacancy text is ever logged.',
  colTime: 'Time',
  colModel: 'Model',
  colTokens: 'Tokens in / out',
  colLatency: 'Latency',
  colOk: 'Result',
  okYes: 'ok',
  okNo: 'failed',
  fallbackBadge: 'fallback',
  unpricedBadge: 'unpriced',
} as const;

/** The `llm_calls.step` values, in pipeline order, with the words a user reads. */
export const LLM_STEP_LABEL = {
  import_resume: 'Import resume',
  parse_vacancy: 'Parse vacancy',
  embed: 'Embed',
  generate: 'Generate',
  judge: 'Quality check',
  rescore: 'Re-score',
} as const;

export const SETTINGS = {
  title: 'Settings',
  emailLabel: 'Email',

  /**
   * The display name (SPEC v2.17, Block E). One optional field, and the copy has
   * to earn the asking: it says what the name is FOR, which is the only reason a
   * resume tool has to hold one.
   *
   * OPTIONAL IN WORDS as well as in the schema. The app works without it — the
   * resume gets a placeholder the user replaces — and a field that looks
   * required collects personal data from people who would rather not give it.
   */
  displayNameLabel: 'Your name',
  displayNameHint:
    'Optional. Used as the name line on resumes you generate, and in the file name when you download one. Leave it empty and the resume asks you to fill the name in yourself.',
  displayNamePlaceholder: 'e.g. Mira Steinberg',
  displayNameSave: 'Save name',
  displayNameSaving: 'Saving…',
  displayNameSaved: 'Name saved.',
  displayNameCleared: 'Name removed.',
  displayNameFailed: 'Could not save your name — try again.',
  /**
   * The READ failed, which is not the same as having no name saved — and the
   * difference matters, because an empty field with no explanation reads as "the
   * app forgot my name". Said inline, on a page that still renders: a Settings
   * screen that 500s because one optional field could not load is out of all
   * proportion to the field, and it takes the route's prefetch down with it,
   * which was observed breaking navigation across the whole app.
   */
  displayNameLoadFailed:
    'Could not load your saved name, so the field below is blank — it may not be empty. Saving a name will still work.',
  displayNameTooLong: 'A name is limited to 120 characters.',
  /**
   * The action ran without a verified session. Its OWN outcome, not
   * `displayNameFailed`: "try again" is advice that can never work here, and
   * this app tells three retrieval outcomes and four sign-in outcomes apart for
   * the same reason. Unreachable through the UI — the layout has already
   * verified the session — but a Server Action is a public endpoint.
   */
  displayNameSignedOut: 'Your session has expired — sign in again to save your name.',

  /**
   * CONTACT DETAILS (SPEC v2.20, migration 005).
   *
   * The words earn the asking the same way the name field's do: they say what the
   * fields are FOR — a document a recruiter has to be able to reply to — and they
   * say optional in prose as well as in the schema, because the app genuinely
   * works with every one of them empty.
   *
   * ONE FIELD PER LINE OF THE HEADER, and no field the app cannot use. There is
   * no second email, no address, no date of birth: a resume tool collecting
   * personal data it does not print is collecting it for nothing.
   */
  contactsHeading: 'Contact details',
  contactsHint:
    'Optional. These become the header block of every resume you generate, so an employer can reply to it. Leave any of them empty and that line is left out.',
  contactEmailLabel: 'Contact email',
  contactEmailHint:
    'The address you want to be contacted on. It does not have to be the one you sign in with.',
  contactEmailPlaceholder: 'e.g. mira.steinberg@example.com',
  phoneLabel: 'Phone',
  phonePlaceholder: 'e.g. +49 40 123456',
  locationLabel: 'Location',
  locationPlaceholder: 'e.g. Hamburg, Germany',
  linkedinLabel: 'LinkedIn URL',
  githubLabel: 'GitHub URL',
  linkPlaceholder: 'https://…',
  /** Said once, above both link fields, because it is one rule for both. */
  linkHint: 'Links must start with https://.',
  openToRemoteLabel: 'Open to remote work',
  openToRemoteHint: 'Adds “Open to remote” beside your location on the resume.',
  contactsSave: 'Save contact details',
  contactsSaving: 'Saving…',
  contactsSaved: 'Contact details saved.',
  contactsCleared: 'Contact details removed.',
  contactsFailed: 'Could not save your contact details — try again.',
  /**
   * The MIGRATION is not applied. Its own outcome, because "try again" is advice
   * that cannot work: the columns do not exist yet, so every save fails
   * identically until the owner runs `005_profile_contacts.sql`. Telling a user
   * to retry a thing guaranteed to refuse is the same defect rule B7a's refusal
   * copy was fixed for.
   */
  contactsNotMigrated:
    'Contact details cannot be saved yet — this part of the app is still being set up. Your name and everything else still work.',
  /**
   * "Saving will still work" was too strong: this line fires because a database
   * READ failed, and if the cause is the database being unreachable the write
   * will fail too. What is true is that the write is a separate round trip, so
   * saving is worth trying — and the form will say what happened either way.
   */
  contactsLoadFailed:
    'Could not load your saved contact details, so the fields below are blank — they may not be empty. Saving is a separate step and is still worth trying.',
  contactsSignedOut: 'Your session has expired — sign in again to save your contact details.',
  contactEmailInvalid: 'Enter a valid email address, or leave it empty.',
  contactEmailTooLong: 'An email address is limited to 254 characters.',
  phoneTooLong: 'A phone number is limited to 40 characters.',
  locationTooLong: 'A location is limited to 120 characters.',
  linkNotHttps: 'A link must start with https:// — or leave it empty.',
  linkTooLong: 'A link is limited to 200 characters.',

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
  /**
   * Rule B7a, the re-score ceiling. 429 DAILY_LIMIT like rule B7, because a quota
   * is what was reached — a second error CODE would say the same thing to a client
   * that already handles this one, and Block D would grow a row for it.
   *
   * IT DOES NOT NAME THE NUMBER, and B7's message does. B7 caps chat calls one for
   * one with the actions the user took, so "(50 calls)" is a number they can count.
   * B7a caps embedding REQUESTS, and one re-score is 2 to 7 of them depending on
   * how long the posting and the resume are — so naming 100 would invite a user
   * who clicked thirty times to conclude the app had miscounted.
   *
   * It names what still works instead, because nothing about this cap costs the
   * user their edit: [Download .docx] makes no embeddings call, and it is the path
   * that turns the draft in the editor into a saved version.
   */
  RESCORE_LIMIT: 'Daily re-score limit reached. Try again tomorrow — [Download .docx] still works.',
  /**
   * 409 for a second generate while the first is still running (Block D #5).
   *
   * It names WAITING as the remedy, because that is the true one: the first run
   * is still going and will save its version. Offering "try again" would invite
   * the duplicate spend the lock exists to refuse.
   */
  ALREADY_RUNNING:
    'A tailored resume is already being generated for this application — wait for it to finish.',
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
   * the document cap is what tripped, and a reachable state with no true words
   * is the defect this constant removes. Chunking is bounded so this is normally
   * unreachable (see lib/chunking.ts), which makes it a real safety net rather
   * than routine copy.
   */
  DOCUMENT_LIMIT: 'Search-index limit reached (4000 entries). Delete unused items first.',
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
