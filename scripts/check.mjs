#!/usr/bin/env node
/**
 * Repo invariants that a type-checker cannot see (SPEC v1.9 Block A, CLAUDE.md).
 * Runs as `npm run check`, and as `prebuild` so a build cannot skip it.
 *
 * Thirteen rules:
 *   R1  `.from(` outside lib/db — one DAL per table, and DALs are the only
 *       files allowed to reach the database. Non-database receivers such as
 *       `Array.from(` and `Buffer.from(` are excluded.
 *   R2  `.rpc(` outside lib/db — match_documents is reachable only through
 *       lib/db/documents.ts, which the retrieval gate orchestrates.
 *   R3  `security definer` anywhere in supabase/ — match_documents must stay
 *       `security invoker` so RLS is the fence, not the function.
 *   R4  NEXT_PUBLIC_ on a secret name, in code AND in .env.example. Prose under
 *       docs/ is exempt: a review report has to be able to quote the forbidden
 *       literal in order to warn about it.
 *   R5  an openrouter.ai URL outside the connection module — no hand-rolled
 *       model call can skip the gates.
 *   R6  importing the connection module from outside the two gates.
 *   R7  reading a secret from process.env without `import 'server-only'`.
 *   R8  a secret anywhere in next.config.* — that file is the one place a
 *       server secret can reach the client bundle with no NEXT_PUBLIC_ prefix
 *       (via `env:` or `publicRuntimeConfig`), so R4 and R7 both miss it. It
 *       also cannot satisfy `import 'server-only'`, which is why this is its
 *       own rule rather than a widening of R7.
 *   R9  `getSession(` anywhere in src/ — it does not validate the token, so
 *       using it for any access decision is prohibited (CLAUDE.md auth rule 2).
 *       No exemptions: the only valid server-side check is getUser().
 *   R10 SUPABASE_SERVICE_ROLE_KEY read anywhere but lib/supabase/admin.ts. The
 *       service role bypasses RLS entirely, so "exactly one module" was a
 *       documented rule with nothing enforcing it — R7 only proves SOME reader
 *       imported `server-only`, which a second consumer would also do.
 *   R11 createServerClient outside lib/supabase/server.ts + middleware.ts, or
 *       ANY createBrowserClient import. Passing cookieOptions is what makes the
 *       session httpOnly, it must be repeated at each call site, and a third
 *       site that forgets it downgrades the cookie SILENTLY — no error, no test
 *       failure. Pinning the call sites is what makes that impossible.
 *   R12 an audit-retention period in user-facing copy while
 *       docs/eval/audit-retention-evidence.md is absent or records no succeeded
 *       run. The claim and its proof ship together or not at all: a pg_cron job
 *       scheduled against the `auth` schema (owned by supabase_auth_admin) can
 *       fail with permission denied every night and leave no user-visible trace,
 *       so a page saying "deleted automatically" would be the app promising an
 *       erasure nothing performs. A source comment saying "do not deploy this"
 *       is itself a configured mechanism, not a working one — this is the
 *       working one.
 *   R13 a backticked repo path in a docs/ shelf reference that does not resolve
 *       against the tree. Three consecutive keyword sweeps declared docs/ clean
 *       while an annotation described a boot-time guard in `lib/supabase/env.ts`,
 *       a module that has never existed — because a keyword sweep can only look
 *       for strings already known to be wrong. What makes such an annotation
 *       wrong is a PROPERTY (it asserts something about this repo that is not the
 *       case), and a property belongs in the build. A stale note is an
 *       instruction to the next agent to do the wrong thing (CLAUDE.md, docs/ is
 *       THIS project's reference shelf).
 *
 * This script opens exactly one dotfile — `.env.example`, the committed
 * template of NAMES — and for that file it prints only the matched variable
 * name, never the line. `.env`, `.env.local` and every other `.env.*` are
 * skipped during the walk and never read. No value is ever printed.
 *
 * KNOWN LIMITS — deliberately out of scope. This is a grep gate: it defends
 * against DRIFT, not against malice. Every one of these needs intent, none is
 * something a phase reaches for by accident, and chasing them with more regex
 * would buy false positives instead of safety. The real fences are RLS, the
 * `server-only` import, and code review.
 *   - Bracket access: `supabase['from']('career_items')` evades R1/R2.
 *   - Identifier shadowing: `const Array = supabase` makes the safe-receiver
 *     set in R1 match by NAME, not by binding.
 *   - Host construction: `'//openrouter.ai/…'` is stripped as a line comment
 *     before R5 sees it, and a concatenated host defeats R5 outright. R6 still
 *     catches the module import, which is the path a real change takes.
 *   - Runtime indirection generally: `eval`, dynamic property names, a helper
 *     that forwards `process.env`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Adding a table means adding a DAL and a line here. */
const DAL_FILES = [
  'src/lib/db/careerItems.ts',
  'src/lib/db/documents.ts',
  'src/lib/db/vacancies.ts',
  'src/lib/db/applications.ts',
  'src/lib/db/resumeVersions.ts',
  'src/lib/db/llmCalls.ts',
];

/** The connection module — the only file allowed to name the OpenRouter host. */
const CONNECTION_FILE = 'src/lib/openrouter/server.ts';

/** The one module allowed to read the service-role key (SPEC v2.0 Block A). */
const SERVICE_ROLE_FILE = 'src/lib/supabase/admin.ts';
const SERVICE_ROLE_KEY_NAME = 'SUPABASE_SERVICE_ROLE_KEY';

/** The only files allowed to construct a Supabase server client (SPEC v2.1). */
const SERVER_CLIENT_FILES = ['src/lib/supabase/server.ts', 'src/middleware.ts'];

/** The committed template of variable NAMES. The only dotfile this script reads. */
const ENV_TEMPLATE = '.env.example';

/** Server-only secrets. None of these may ever appear behind NEXT_PUBLIC_. */
const SECRET_NAMES = ['OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** The only two variables allowed to be NEXT_PUBLIC_. */
const ALLOWED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', '.vercel', 'test-results']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.md']);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    // .env.example is the committed NAMES template and is scanned by R4.
    // Every other .env* holds values and is never opened (CLAUDE.md, Secrets).
    if (entry.startsWith('.env')) {
      if (path.relative(ROOT, abs) === ENV_TEMPLATE) out.push(abs);
      continue;
    }
    if (statSync(abs).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(abs, out);
    } else if (SOURCE_EXT.has(path.extname(entry))) {
      out.push(abs);
    }
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const files = walk(ROOT);
const failures = [];

/**
 * Strip block and line comments, so prose about a rule never trips it.
 *
 * `//` is NOT a comment in markdown. Applying the line-comment pass to a .md file
 * blanked everything after any bare `//` in prose, which hid the rest of the line
 * from R13 — a stale path could sit behind one and never be seen. Block comments
 * stay stripped for .md, because SPEC and CLAUDE quote code samples that contain
 * them and other rules read those files.
 */
function stripComments(text, isMarkdown = false) {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (isMarkdown) return noBlocks;
  return noBlocks.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const isMarkdown = (abs) => rel(abs).endsWith('.md');

/**
 * Per-line rule. The matcher sees the comment-stripped line, the file, and the
 * whole comment-stripped file as lines plus this line's index — a method-chain
 * rule has to look at the PREVIOUS line to find its receiver. It returns either
 * a boolean or a string. A string REPLACES the echoed source line in the
 * report — that is how R4 names a variable in .env.example without printing
 * the line it sits on.
 */
function scanLines(label, predicate, matcher) {
  const hits = [];
  for (const abs of files.filter(predicate)) {
    const text = readFileSync(abs, 'utf8');
    const raw = text.split(/\r?\n/);
    const stripped = stripComments(text, isMarkdown(abs)).split(/\r?\n/);
    raw.forEach((line, i) => {
      const verdict = matcher(stripped[i] ?? '', abs, stripped, i);
      if (!verdict) return;
      const shown = typeof verdict === 'string' ? verdict : line.trim().slice(0, 120);
      hits.push(`${rel(abs)}:${i + 1}: ${shown}`);
    });
  }
  if (hits.length) failures.push({ label, hits });
}

/** Whole-file rule, for anything a per-line scan would miss across newlines. */
function scanFiles(label, predicate, matcher) {
  const hits = [];
  for (const abs of files.filter(predicate)) {
    const raw = readFileSync(abs, 'utf8');
    const reason = matcher(raw, stripComments(raw, isMarkdown(abs)), abs);
    if (reason) hits.push(`${rel(abs)}: ${reason}`);
  }
  if (hits.length) failures.push({ label, hits });
}

const isCode = (abs) => {
  const r = rel(abs);
  return (r.startsWith('src/') || r.startsWith('tests/')) && CODE_EXT.test(r);
};
const isDal = (abs) => DAL_FILES.includes(rel(abs));

/**
 * Receivers that are never the database. Only `.from` has any.
 * `Buffer.from(await file.arrayBuffer())` is the Phase-2 PDF-upload idiom and
 * `Uint8Array.from` shows up in docx export, so they are listed before they
 * arrive rather than after someone hits a false FAIL mid-phase.
 */
const NON_DB_RECEIVERS = new Set([
  'Array',
  'Buffer',
  'Date',
  'Map',
  'Object',
  'Set',
  'String',
  'Uint8Array',
]);

/**
 * `.from(` / `.rpc(`, matched with the receiver OPTIONAL and the known-safe
 * receivers SUBTRACTED — never the other way round.
 *
 * Requiring a receiver on the same line failed open on exactly the formatting
 * this repo uses: Prettier wraps a Supabase chain so `.from(` starts its own
 * line, and five of the six DALs are already written that way. Copying such a
 * block into a route handler would then have passed the one rule CLAUDE.md
 * names as the enforcement of the DAL boundary.
 *
 * When the receiver is not on this line, it is read off the end of the
 * previous non-blank line, so `Array\n  .from(…)` is still recognised as safe.
 * With no receiver findable anywhere, the call FAILS: the boundary fails
 * closed, and a false positive is a one-line rename, not a data leak.
 */
function callsDbMethod(line, method, lines, index) {
  const re = new RegExp(`(?:([A-Za-z0-9_$\\]\\)]+)\\s*)?\\.\\s*${method}\\s*\\(`, 'g');
  for (const m of line.matchAll(re)) {
    let receiver = m[1];
    if (!receiver) {
      for (let i = index - 1; i >= 0; i--) {
        const prev = (lines[i] ?? '').trimEnd();
        if (prev.trim() === '') continue;
        receiver = prev.match(/([A-Za-z0-9_$\]\)]+)\s*$/)?.[1];
        break;
      }
    }
    if (method === 'from' && receiver && NON_DB_RECEIVERS.has(receiver)) continue;
    return true;
  }
  return false;
}

// R1. .from( outside the listed DALs.
scanLines(
  'R1 .from( outside lib/db — only a DAL may call the database',
  (abs) => isCode(abs) && !isDal(abs),
  (line, _abs, lines, i) => callsDbMethod(line, 'from', lines, i),
);

// R2. .rpc( outside the listed DALs. lib/db/documents.ts owns match_documents;
//     lib/retrieval.ts orchestrates by calling that DAL (SPEC v1.9 Block A).
scanLines(
  'R2 .rpc( outside lib/db — match_documents lives in lib/db/documents.ts',
  (abs) => isCode(abs) && !isDal(abs),
  (line, _abs, lines, i) => callsDbMethod(line, 'rpc', lines, i),
);

// R3. security definer anywhere in supabase/. Scanned whole-file: the two words
//     can be split across a newline, which a per-line scan would miss.
scanFiles(
  'R3 security definer in supabase/ — match_documents must stay security invoker',
  (abs) => rel(abs).startsWith('supabase/'),
  (raw) => {
    const sql = raw.replace(/--.*$/gm, '');
    return /security\s+definer/i.test(sql) ? 'contains "security definer"' : null;
  },
);

// R4a. NEXT_PUBLIC_ on a secret name — in source and in the .env.example template.
scanLines(
  'R4 NEXT_PUBLIC_ prefix on a secret — that ships the value to the browser',
  // Prose under docs/ is exempt: a review report must be able to quote the
  // forbidden literal in order to warn about it, and `check` runs as prebuild —
  // so without this exemption writing the warning down breaks the deploy.
  (abs) => !rel(abs).startsWith('scripts/') && !rel(abs).startsWith('docs/'),
  (line, abs) => {
    const hit = SECRET_NAMES.find((name) => line.includes(`NEXT_PUBLIC_${name}`));
    if (!hit) return false;
    // In the env template, report the NAME only — never echo the line.
    return rel(abs) === ENV_TEMPLATE ? `NEXT_PUBLIC_${hit}` : true;
  },
);

// R4b. Any NEXT_PUBLIC_ variable that is not one of the two allowed ones.
scanLines(
  'R4 unknown NEXT_PUBLIC_ variable — only the Supabase URL and anon key may reach the browser',
  (abs) => {
    const r = rel(abs);
    return (r.startsWith('src/') || r === ENV_TEMPLATE) && !r.startsWith('scripts/');
  },
  (line, abs) => {
    const names = (line.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []).filter(
      (n) => !ALLOWED_PUBLIC.includes(n),
    );
    if (names.length === 0) return false;
    return rel(abs) === ENV_TEMPLATE ? names.join(', ') : true;
  },
);

// R5. A literal openrouter.ai URL outside the connection module. R6 guards the
//     MODULE; this guards the ENDPOINT, so a route handler cannot hand-roll its
//     own fetch and skip both gates.
scanLines(
  'R5 openrouter.ai URL outside the connection module — no hand-rolled model calls',
  (abs) => isCode(abs) && rel(abs) !== CONNECTION_FILE,
  (line) => line.includes('openrouter.ai'),
);

// R6. The connection module is reachable only through the two gates. Covers
//     `from '…'`, bare side-effect imports and `await import('…')`.
scanLines(
  'R6 direct import of lib/openrouter/server — every model call goes through a gate',
  (abs) => {
    const r = rel(abs);
    return (
      isCode(abs) &&
      r !== 'src/lib/chat.ts' &&
      r !== 'src/lib/retrieval.ts' &&
      !r.startsWith('src/lib/openrouter/')
    );
  },
  (line) =>
    /(?:from|import|require)\s*\(?\s*['"](?:@\/lib\/openrouter[^'"]*|[^'"]*\/openrouter\/server)['"]/.test(
      line,
    ),
);

/**
 * Names actually READ off process.env, captured rather than scanned loosely: a
 * file-wide token scan fails any client component that happens to hold a
 * `const ROW_KEY` next to a `process.env.NODE_ENV`, and the only way to silence
 * that is adding `server-only` to a client file — which breaks the build. A
 * rule whose false positive has no correct remedy gets deleted.
 *
 * Three access forms are captured: `process.env.NAME`, `process.env['NAME']`,
 * and destructuring — `const { NAME } = process.env`, which the first two
 * patterns miss entirely. That last one is the same fail-open shape that was
 * found in R1/R2, so it is closed here rather than left as a known limit.
 */
function envSecretsRead(text) {
  const destructured = [...text.matchAll(/\{([^{}]*)\}\s*=\s*process\s*\.\s*env\b/g)].flatMap((m) =>
    // `const { A, B: local, C = 'x' } = process.env` — take the SOURCE key,
    // which is the identifier before any `:` or `=`.
    (m[1] ?? '')
      .split(',')
      .map((part) => part.split(/[:=]/)[0]?.trim() ?? '')
      .filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)),
  );
  const names = [
    ...[...text.matchAll(/process\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
    ...[...text.matchAll(/process\s*\.\s*env\s*\[\s*['"]([A-Z][A-Z0-9_]*)['"]/g)].map((m) => m[1]),
    ...destructured,
  ];
  // The explicit list first, so a secret that does not end in one of the
  // suffixes below is still covered; the shape heuristic then catches the ones
  // nobody has added to SECRET_NAMES yet.
  const isSecret = (n) =>
    !n.startsWith('NEXT_PUBLIC_') &&
    (SECRET_NAMES.includes(n) ||
      /(?:_KEY|_SECRET|_TOKEN)$/.test(n) ||
      n.includes('SERVICE_ROLE'));
  return [...new Set(names.filter(isSecret))];
}

// R7. Reading a secret without `import 'server-only'`. That import is the actual
//     mechanism keeping a secret out of a client bundle, and nothing else
//     verified it was present.
scanFiles(
  "R7 reads a secret from process.env without importing 'server-only'",
  isCode,
  (raw, stripped) => {
    const found = envSecretsRead(stripped);
    if (found.length === 0) return null;
    if (/^\s*import\s+['"]server-only['"];?\s*$/m.test(stripped)) return null;
    return `reads ${found.join(', ')} without import 'server-only'`;
  },
);

// R8. A secret in next.config.*. R7 does not cover it — that file is outside
//     src/, and it could not satisfy `import 'server-only'` even if it were
//     inside. It is also the ONE file that can copy a server secret into the
//     client bundle with no NEXT_PUBLIC_ prefix, through `env: {…}` or the
//     legacy `publicRuntimeConfig`, which makes it invisible to R4 as well.
//     So: any secret name, any process.env read, and either config key is a
//     FAIL here, unconditionally.
scanFiles(
  'R8 secret or env-injection key in next.config.* — that reaches the client bundle',
  (abs) => /^next\.config\.(ts|js|mjs|cjs)$/.test(rel(abs)),
  (raw, stripped) => {
    const reasons = [];
    const named = SECRET_NAMES.filter((n) => stripped.includes(n));
    if (named.length) reasons.push(`names ${named.join(', ')}`);
    const read = envSecretsRead(stripped);
    if (read.length) reasons.push(`reads ${read.join(', ')} from process.env`);
    // The injection keys themselves: even with a non-secret value today, they
    // are the mechanism, and the next edit to them is the leak.
    if (/(^|[^A-Za-z0-9_$])env\s*:/m.test(stripped)) reasons.push('has an `env:` block');
    if (/publicRuntimeConfig/.test(stripped)) reasons.push('has publicRuntimeConfig');
    return reasons.length ? reasons.join('; ') : null;
  },
);

// R9. getSession() anywhere in src/. It does not validate the token, so using
//     it for an access decision is prohibited (CLAUDE.md auth rule 2); the only
//     valid server-side check is getUser(). No exemption list: the two places
//     the tree mentions it are comments, which stripComments() already removes,
//     so the rule costs nothing today and is in place before Phase 1 auth and
//     the Phase 2 handlers — where a copy-paste from generic Supabase docs,
//     which use getSession() freely, would otherwise land unnoticed.
scanLines(
  'R9 getSession( in src/ — it does not validate the token; use getUser()',
  (abs) => rel(abs).startsWith('src/') && CODE_EXT.test(rel(abs)),
  (line) => /\bgetSession\s*\(/.test(line),
);

// R10. The service-role key is pinned to one module. R7 only proves that SOME
//      reader imported 'server-only' — a second service-role consumer in a
//      later phase would import it too and sail through. This rule is what
//      makes CLAUDE.md's "exactly one module" enforceable rather than written.
scanLines(
  `R10 ${SERVICE_ROLE_KEY_NAME} outside ${SERVICE_ROLE_FILE} — the service role bypasses RLS`,
  (abs) => isCode(abs) && rel(abs) !== SERVICE_ROLE_FILE,
  (line) => line.includes(SERVICE_ROLE_KEY_NAME),
);

// R11a. createServerClient is pinned to the two files that pass cookieOptions.
scanLines(
  `R11 createServerClient outside ${SERVER_CLIENT_FILES.join(' + ')} — it would miss cookieOptions`,
  (abs) => isCode(abs) && !SERVER_CLIENT_FILES.includes(rel(abs)),
  // Bare token, not `createServerClient(`: matching only the call site let
  // `import { createServerClient as makeClient }` build an unguarded client and
  // pass all rules. Verified. R11c already matched bare and was strictly stronger.
  (line) => /createServerClient/.test(line),
);

// R11b. Both pinned files must actually pass the shared options. Pinning the
//       call sites is worthless if one of them stops using them.
scanFiles(
  'R11 a pinned createServerClient file does not pass AUTH_COOKIE_OPTIONS',
  (abs) => SERVER_CLIENT_FILES.includes(rel(abs)),
  (raw, stripped) =>
    stripped.includes('cookieOptions: AUTH_COOKIE_OPTIONS')
      ? null
      : 'constructs a Supabase server client without the shared cookieOptions',
);

// R11d. Both pinned files must route every cookie write through cappedMaxAge().
//       R11b checks `cookieOptions: AUTH_COOKIE_OPTIONS`, whose maxAge the library
//       DISCARDS (cookies.js:325-329) — so on its own R11b enforces the inert half
//       of the contract. Deleting cappedMaxAge( from one adapter would silently
//       restore 400-day sessions with every rule and test still green.
scanFiles(
  'R11 a pinned createServerClient file does not call cappedMaxAge() in setAll',
  (abs) => SERVER_CLIENT_FILES.includes(rel(abs)),
  (raw, stripped) =>
    stripped.includes('cappedMaxAge(')
      ? null
      : 'writes session cookies without clamping maxAge - the library default is 400 days',
);

// R11c. createBrowserClient is banned outright: it writes the session through
//       document.cookie, which can never be httpOnly (CLAUDE.md, SPEC v2.1).
scanLines(
  'R11 createBrowserClient is banned — it writes the session via document.cookie',
  isCode,
  (line) => /createBrowserClient/.test(line),
);

// R12. The 90-day audit-retention claim may not ship ahead of its evidence.
//      Scans ALL of src/ plus README.md rather than an allow-list of the two files
//      that carry the claim today: an allow-list fails OPEN the moment the sentence
//      is inlined in a component or lifted into a <PrivacySection>, which is exactly
//      the edit a later phase makes without thinking about this rule. Every other
//      rule here scans broadly and exempts narrowly; this one now matches.
//      tests/ is OUT of scope, unlike the other code rules: a fixture asserting that
//      the claim is gated has to contain the claim, and nothing under tests/ can
//      render to a user. The surfaces this rule protects are the ones that ship.
//      Matched on comment-STRIPPED text, so the block comment archiving the strong
//      sentence (and this rule's own prose) never trips it — what a reader sees is
//      what is judged.
//      FAIL-CLOSED AND DELIBERATELY OVER-INCLUSIVE (SPEC v2.8). The first version
//      keyed the noun on the word "audit" and the period on the literal "90 days".
//      Both were too narrow, and the gap was not hypothetical: the app's own shipped
//      dialog says "Some AUTHENTICATION records", which a rule looking for "audit"
//      cannot see, and "90-day" is not "90 days". A rule that only recognises one
//      blessed sentence protects that sentence, not the claim.
//      So: ANY period expression near ANY of this app's retention vocabulary. If it
//      over-matches somewhere benign, rephrase the copy or add the evidence — do NOT
//      narrow the rule. A false positive costs one edit; a false negative ships a
//      promise nothing performs.
//      The evidence file must contain a line matching `status: succeeded`, ANCHORED.
//      A substring test for "succeeded" was satisfied by a file reading "has NOT
//      succeeded", which is the same species of paper mechanism this rule exists to
//      prevent.
const RETENTION_EVIDENCE = 'docs/eval/audit-retention-evidence.md';
/** The vocabulary this app actually uses for the thing being retained. */
const RETENTION_NOUN = '(?:audit|authentication\\s+record|retention|log\\s+entr)';
/** number + unit: digits or words, hyphenated or spaced, singular or plural. */
const PERIOD_WORD =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|fifteen|twenty|' +
  'thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)';
const PERIOD = `(?:\\d+|${PERIOD_WORD})[-\\s]*(?:day|week|month|year)s?\\b`;
const RETENTION_EVIDENCE_LINE = /^\s*status\s*:\s*succeeded\b/im;
scanFiles(
  `R12 an audit-retention period ships without ${RETENTION_EVIDENCE}`,
  (abs) => (rel(abs).startsWith('src/') && CODE_EXT.test(rel(abs))) || rel(abs) === 'README.md',
  (raw, stripped) => {
    // The noun and the period within one sentence-ish window, either order.
    const claim =
      new RegExp(`${RETENTION_NOUN}[\\s\\S]{0,300}?${PERIOD}`, 'i').test(stripped) ||
      new RegExp(`${PERIOD}[\\s\\S]{0,300}?${RETENTION_NOUN}`, 'i').test(stripped);
    if (!claim) return null;
    const evidence = path.join(ROOT, RETENTION_EVIDENCE);
    if (existsSync(evidence) && RETENTION_EVIDENCE_LINE.test(readFileSync(evidence, 'utf8'))) {
      return null;
    }
    return (
      'states an audit-retention period that nothing has been shown to perform - ' +
      `either use the SPEC fallback wording or add ${RETENTION_EVIDENCE} ` +
      "with a 'status: succeeded' line from cron.job_run_details, in this same commit"
    );
  },
);

/**
 * R13. Every backticked repo path in a docs/ reference must resolve against the
 *      tree.
 *
 *      Scope is the vendored reference shelf — `docs/*.md` — and NOT `docs/reviews/`
 *      or `docs/eval/`. A review report is a DATED record of the tree as it stood
 *      when it was written; `docs/reviews/phase-0.md` correctly names
 *      `src/lib/supabase/client.ts`, which existed at Phase 0 and was deleted in
 *      Phase 1. Failing on that would push the next agent to falsify a historical
 *      record. The shelf is different: it is read as current instruction.
 *
 *      A path is EXEMPT when the annotation itself says it is gone — "was deleted",
 *      "is deleted", "deleted in Phase N". That is the one case where naming a
 *      non-existent file is the point of the sentence. The marker must sit within
 *      80 characters of the backtick, not merely somewhere on the line: retention
 *      prose in this repo says "rows ARE DELETED when they age out", which would
 *      otherwise exempt every stale path sharing a line with it.
 *
 *      DIRECTORIES count too (`src/lib/supabase/`). The annotation that closed the
 *      round-5 blocker asserts that directory "holds exactly server.ts,
 *      cookie-options.ts and admin.ts" — a claim about a path, and one a
 *      file-extension-only rule would never revisit.
 *
 *      Known limit, in the spirit of the others: this checks that a path RESOLVES,
 *      not that the claim around it is true. An annotation can still describe a real
 *      file inaccurately. It closes the specific failure that recurred three times —
 *      a confident description of a module that is not there.
 */
const DOC_PATH_PREFIXES = /^(?:src|lib|scripts|tests|supabase|docs|app|components)\//;
const DOC_ROOT_FILES = /^(?:README|SPEC|CLAUDE|package|next\.config|eslint\.config|tsconfig)\./;
const DELETED_MARKER = /\b(?:was|is|were|are)\s+deleted\b|\bdeleted\s+in\s+Phase\b/i;

/**
 * Does this repo-relative path exist, matching CASE exactly?
 *
 * `existsSync` alone is case-insensitive on NTFS and APFS, so a doc naming
 * `src/lib/Supabase/Server.ts` passed on the author's machine and would fail the
 * same check on Vercel's Linux builder — and `check` is `prebuild`, so that is a
 * green local tree and a red deploy. Walking the segments and comparing against
 * the real directory entries makes the rule mean the same thing everywhere.
 */
function existsCaseSensitive(relPath) {
  const segments = relPath.split('/').filter((s) => s.length > 0 && s !== '.');
  let dir = ROOT;
  for (let i = 0; i < segments.length; i += 1) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    if (!entries.includes(segments[i])) return false;
    dir = path.join(dir, segments[i]);
  }
  return segments.length > 0;
}

/** Resolve a path that may carry a `*` segment (e.g. `src/app/api/*\/route.ts`). */
function resolvesInTree(p) {
  if (!p.includes('*')) return existsCaseSensitive(p);
  const parent = p.slice(0, p.indexOf('*')).replace(/\/[^/]*$/, '');
  return parent.length > 0 && existsCaseSensitive(parent);
}

scanLines(
  'R13 a docs/ annotation names a repo path that does not exist',
  (abs) => {
    const r = rel(abs);
    return r.startsWith('docs/') && r.endsWith('.md') && r.split('/').length === 2;
  },
  (line) => {
    // Either a file (trailing extension) or a directory (trailing slash).
    const token =
      /`([A-Za-z0-9_@.()[\]/*-]+(?:\.(?:ts|tsx|mjs|cjs|js|jsx|sql|json|md)|\/))`/g;
    for (const m of line.matchAll(token)) {
      let p = m[1];
      if (p.startsWith('@/')) p = `src/${p.slice(2)}`;
      if (!DOC_PATH_PREFIXES.test(p) && !DOC_ROOT_FILES.test(p)) continue;
      if (resolvesInTree(p) || resolvesInTree(`src/${p}`)) continue;
      // The "it is gone" marker must be NEAR this path, not anywhere on the line.
      const near = line.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      if (DELETED_MARKER.test(near)) continue;
      return `names \`${m[1]}\`, which does not exist — describe what the repo actually does`;
    }
    return false;
  },
);

if (failures.length) {
  for (const { label, hits } of failures) {
    console.error(`\nFAIL: ${label}`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
  console.error(`\ncheck failed: ${failures.length} rule(s) violated.\n`);
  process.exit(1);
}

const NL = String.fromCharCode(10);
console.log(
  'check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer;' +
    NL + '  NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection' +
    NL + '  import outside the gates; every secret reader imports server-only;' +
    NL + '  next.config.* clean of secrets and env injection; no getSession() in src/;' +
    NL + '  service-role key pinned to lib/supabase/admin.ts; createServerClient pinned to' +
    NL + '  server.ts + middleware.ts with shared cookieOptions, no createBrowserClient;' +
    NL + '  no audit-retention period without its evidence file; every backticked' +
    NL + '  repo path in the docs/ shelf resolves against the tree.',
);
