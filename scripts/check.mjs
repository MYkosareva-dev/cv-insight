#!/usr/bin/env node
/**
 * Repo invariants that a type-checker cannot see (SPEC Block A, CLAUDE.md).
 * Exits non-zero on the first category that fails.
 *
 *   1. `.from(` outside the listed DALs — one DAL per table, and DALs are the
 *      only files allowed to reach the database.
 *   2. `security definer` anywhere in supabase/ — match_documents must stay
 *      `security invoker` so RLS is the fence, not the function.
 *   3. NEXT_PUBLIC_ on a secret name — a secret behind that prefix is shipped
 *      to the browser.
 *
 * This script never reads .env* files. It reads variable NAMES out of source
 * and never prints a value.
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

/** Server-only secrets. None of these may ever appear behind NEXT_PUBLIC_. */
const SECRET_NAMES = ['OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** The only two variables allowed to be NEXT_PUBLIC_. */
const ALLOWED_PUBLIC = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', '.vercel', 'test-results']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.md']);

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

function scan(label, predicate, matcher) {
  const hits = [];
  for (const abs of files.filter(predicate)) {
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (matcher(line, abs)) hits.push(`${rel(abs)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  if (hits.length) failures.push({ label, hits });
}

// 1. .from( outside the listed DALs. Comments and this script's own list don't count.
scan(
  '.from( outside lib/db — only a DAL may call the database',
  (abs) => {
    const r = rel(abs);
    return (
      (r.startsWith('src/') || r.startsWith('tests/')) &&
      !DAL_FILES.includes(r) &&
      /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(r)
    );
  },
  (line) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    return /\.from\s*\(/.test(code);
  },
);

// 2. security definer anywhere in supabase/.
scan(
  'security definer in supabase/ — match_documents must stay security invoker',
  (abs) => rel(abs).startsWith('supabase/'),
  (line) => /security\s+definer/i.test(line.replace(/--.*$/, '')),
);

// 3. NEXT_PUBLIC_ on a secret name, in source or in .env.example (names only).
scan(
  'NEXT_PUBLIC_ prefix on a secret — that ships the value to the browser',
  (abs) => !rel(abs).startsWith('scripts/'),
  (line) => SECRET_NAMES.some((name) => line.includes(`NEXT_PUBLIC_${name}`)),
);

// 3b. Any NEXT_PUBLIC_ variable that is not one of the two allowed ones.
scan(
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

// 4. The connection module is reachable only through the two gates.
scan(
  'direct import of lib/openrouter/server — every model call goes through a gate',
  (abs) => {
    const r = rel(abs);
    return (
      r.startsWith('src/') &&
      r !== 'src/lib/chat.ts' &&
      r !== 'src/lib/retrieval.ts' &&
      !r.startsWith('src/lib/openrouter/')
    );
  },
  (line) => /from\s+['"](@\/lib\/openrouter|.*\/openrouter\/server)/.test(line),
);

if (failures.length) {
  for (const { label, hits } of failures) {
    console.error(`\nFAIL: ${label}`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
  console.error(`\ncheck failed: ${failures.length} rule(s) violated.\n`);
  process.exit(1);
}

console.log('check passed: DAL boundary, security invoker, NEXT_PUBLIC_ hygiene, gate chokepoint.');
