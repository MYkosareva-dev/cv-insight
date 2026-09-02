#!/usr/bin/env node
/**
 * Repo invariants that a type-checker cannot see (SPEC v1.9 Block A, CLAUDE.md).
 * Runs as `npm run check`, and as `prebuild` so a build cannot skip it.
 *
 * Seven rules:
 *   R1  `.from(` outside lib/db — one DAL per table, and DALs are the only
 *       files allowed to reach the database. `Array.from(` is excluded: Block E
 *       builds its skeleton states with `Array.from({ length: 6 })`.
 *   R2  `.rpc(` outside lib/db — match_documents is reachable only through
 *       lib/db/documents.ts, which the retrieval gate orchestrates.
 *   R3  `security definer` anywhere in supabase/ — match_documents must stay
 *       `security invoker` so RLS is the fence, not the function.
 *   R4  NEXT_PUBLIC_ on a secret name, in source AND in .env.example.
 *   R5  an openrouter.ai URL outside the connection module — no hand-rolled
 *       model call can skip the gates.
 *   R6  importing the connection module from outside the two gates.
 *   R7  reading a secret from process.env without `import 'server-only'`.
 *
 * This script opens exactly one dotfile — `.env.example`, the committed
 * template of NAMES — and for that file it prints only the matched variable
 * name, never the line. `.env`, `.env.local` and every other `.env.*` are
 * skipped during the walk and never read. No value is ever printed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/** Strip block and line comments, so prose about a rule never trips it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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
    const stripped = stripComments(text).split(/\r?\n/);
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
    const reason = matcher(raw, stripComments(raw), abs);
    if (reason) hits.push(`${rel(abs)}: ${reason}`);
  }
  if (hits.length) failures.push({ label, hits });
}

const isCode = (abs) => {
  const r = rel(abs);
  return (r.startsWith('src/') || r.startsWith('tests/')) && CODE_EXT.test(r);
};
const isDal = (abs) => DAL_FILES.includes(rel(abs));

/** Receivers that are never the database. Only `.from` has any. */
const NON_DB_RECEIVERS = new Set(['Array', 'String']);

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
  (abs) => !rel(abs).startsWith('scripts/'),
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
 */
function envSecretsRead(text) {
  const names = [
    ...[...text.matchAll(/process\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
    ...[...text.matchAll(/process\s*\.\s*env\s*\[\s*['"]([A-Z][A-Z0-9_]*)['"]/g)].map((m) => m[1]),
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

if (failures.length) {
  for (const { label, hits } of failures) {
    console.error(`\nFAIL: ${label}`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
  console.error(`\ncheck failed: ${failures.length} rule(s) violated.\n`);
  process.exit(1);
}

console.log(
  'check passed (7 rules): .from( and .rpc( confined to lib/db; no security definer;\n' +
    '  NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import\n' +
    "  outside the gates; every secret reader imports 'server-only'.",
);
