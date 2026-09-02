#!/usr/bin/env node
/**
 * Repo invariants that a type-checker cannot see (SPEC Block A, CLAUDE.md).
 * Runs as `npm run check`, and as `prebuild` so a build cannot skip it.
 *
 * The three SPEC-mandated FAIL rules:
 *   1. `.from(` outside the listed DALs — one DAL per table, and DALs are the
 *      only files allowed to reach the database.
 *   2. `security definer` anywhere in supabase/ — match_documents must stay
 *      `security invoker` so RLS is the fence, not the function.
 *   3. NEXT_PUBLIC_ on a secret name — a secret behind that prefix is shipped
 *      to the browser.
 *
 * Plus four that close the ways a later phase could walk around them:
 *   4. importing the OpenRouter connection from outside the two gates,
 *   5. `.rpc(` outside the DALs and the retrieval gate,
 *   6. a literal openrouter.ai URL outside the connection module,
 *   7. reading a secret from process.env without importing 'server-only'.
 *
 * This script never opens .env* — it skips those names during the walk — and
 * never prints a value.
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

/**
 * `match_documents` is reachable only through the retrieval gate, which SPEC
 * Block A names as its home ("retrieval.ts — GATE: embeddings + match_documents").
 * So the RPC allowlist is the DALs plus that one gate, not lib/db alone.
 */
const RPC_ALLOWED = [...DAL_FILES, 'src/lib/retrieval.ts'];

/** The connection module — the only file allowed to name the OpenRouter host. */
const CONNECTION_FILE = 'src/lib/openrouter/server.ts';

/** Server-only secrets. None of these may ever appear behind NEXT_PUBLIC_. */
const SECRET_NAMES = ['OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** The only two variables allowed to be NEXT_PUBLIC_. */
const ALLOWED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', '.vercel', 'test-results']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.md']);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    // Never touch .env* — not even to stat it (CLAUDE.md, Secrets).
    if (entry.startsWith('.env')) continue;
    const abs = path.join(dir, entry);
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

/** Per-line rule. The matcher sees the comment-stripped line. */
function scanLines(label, predicate, matcher) {
  const hits = [];
  for (const abs of files.filter(predicate)) {
    const raw = readFileSync(abs, 'utf8').split(/\r?\n/);
    const stripped = stripComments(readFileSync(abs, 'utf8')).split(/\r?\n/);
    raw.forEach((line, i) => {
      if (matcher(stripped[i] ?? '', abs)) {
        hits.push(`${rel(abs)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
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

// 1. .from( outside the listed DALs.
scanLines(
  '.from( outside lib/db — only a DAL may call the database',
  (abs) => isCode(abs) && !DAL_FILES.includes(rel(abs)),
  (line) => /\.from\s*\(/.test(line),
);

// 2. security definer anywhere in supabase/. Scanned whole-file: the two words
//    can be split across a newline, which a per-line scan would miss.
scanFiles(
  'security definer in supabase/ — match_documents must stay security invoker',
  (abs) => rel(abs).startsWith('supabase/'),
  (raw) => {
    const sql = raw.replace(/--.*$/gm, '');
    return /security\s+definer/i.test(sql) ? 'contains "security definer"' : null;
  },
);

// 3. NEXT_PUBLIC_ on a secret name, in source or in .env.example (names only).
scanLines(
  'NEXT_PUBLIC_ prefix on a secret — that ships the value to the browser',
  (abs) => !rel(abs).startsWith('scripts/'),
  (line) => SECRET_NAMES.some((name) => line.includes(`NEXT_PUBLIC_${name}`)),
);

// 3b. Any NEXT_PUBLIC_ variable that is not one of the two allowed ones.
scanLines(
  'unknown NEXT_PUBLIC_ variable — only the Supabase URL and anon key may reach the browser',
  (abs) => {
    const r = rel(abs);
    return (r.startsWith('src/') || r === '.env.example') && !r.startsWith('scripts/');
  },
  (line) => {
    const names = line.match(/NEXT_PUBLIC_[A-Z0-9_]+/g);
    return !!names && names.some((n) => !ALLOWED_PUBLIC.includes(n));
  },
);

// 4. The connection module is reachable only through the two gates. Covers
//    `from '…'`, bare side-effect imports and `await import('…')`.
scanLines(
  'direct import of lib/openrouter/server — every model call goes through a gate',
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

// 5. .rpc( outside the DALs and the retrieval gate. Without this rule any file
//    could call supabase.rpc('match_documents', …) and bypass the gate.
scanLines(
  '.rpc( outside lib/db and the retrieval gate — match_documents goes through the gate',
  (abs) => isCode(abs) && !RPC_ALLOWED.includes(rel(abs)),
  (line) => /\.rpc\s*\(/.test(line),
);

// 6. A literal openrouter.ai URL outside the connection module. Rule 4 guards
//    the MODULE; this guards the ENDPOINT, so a route handler cannot hand-roll
//    its own fetch and skip both gates.
scanLines(
  'openrouter.ai URL outside the connection module — no hand-rolled model calls',
  (abs) => isCode(abs) && rel(abs) !== CONNECTION_FILE,
  (line) => line.includes('openrouter.ai'),
);

/** Env names that are secrets by shape. NEXT_PUBLIC_* is public by definition. */
function secretNamesIn(text) {
  const names = text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
  const isSecret = (n) =>
    !n.startsWith('NEXT_PUBLIC_') &&
    (/(?:_KEY|_SECRET|_TOKEN)$/.test(n) || n.includes('SERVICE_ROLE'));
  return [...new Set(names.filter(isSecret))];
}

// 7. Reading a secret without `import 'server-only'`. That import is the actual
//    mechanism keeping a secret out of a client bundle, and nothing verified it
//    was present.
scanFiles(
  "reads a secret from process.env without importing 'server-only'",
  isCode,
  (raw, stripped) => {
    if (!/process\s*\.\s*env/.test(stripped)) return null;
    const found = secretNamesIn(stripped);
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
  'check passed: DAL boundary, RPC boundary, security invoker, NEXT_PUBLIC_ hygiene,\n' +
    '              gate chokepoint, endpoint chokepoint, server-only on secrets.',
);
