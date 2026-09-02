import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { describe, after } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * SPEC Block A names "check.mjs rules" as a tests/unit/ target. Until now nothing
 * re-verified them: each rule was demonstrated once by hand, in a hand-over, and
 * the demonstration left no artifact. That is the shape CLAUDE.md rejects — "a
 * configured mechanism is not a working one" — applied to the gate that enforces
 * the rest of them.
 *
 * R12 is the rule this matters most for. Its entire value is that it FIRES: it
 * couples the 90-day audit-retention claim on a user-facing surface to
 * docs/eval/audit-retention-evidence.md, so the app cannot promise an erasure
 * nothing performs. A rule that silently stopped matching would restore that
 * promise with every gate still green — the exact failure mode R11d exists for
 * on the cookie side.
 *
 * Method: copy the repo's checkable surface into a temp dir, mutate ONE thing,
 * run the real scripts/check.mjs against it, assert the exit code. The script is
 * never modified and the working tree is never touched.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIVACY = 'src/app/privacy/page.tsx';
const EVIDENCE = 'docs/eval/audit-retention-evidence.md';

/** The strong sentence, verbatim from SPEC v2.5 — the one R12 gates. */
const STRONG_CLAIM =
  'in our EU database for 90 days for security purposes; these are not removed when ' +
  'you delete your account, and are deleted automatically when they age out.';

const sandboxes = [];

/**
 * A minimal but REAL tree: check.mjs walks from its own parent, so it needs the
 * directories its rules scan. Everything copied is a directory the gate reads.
 */
function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cv-check-'));
  sandboxes.push(dir);
  for (const sub of ['scripts', 'src', 'supabase', 'docs', 'tests']) {
    cpSync(path.join(ROOT, sub), path.join(dir, sub), { recursive: true });
  }
  for (const file of ['.env.example', 'package.json', 'README.md']) {
    cpSync(path.join(ROOT, file), path.join(dir, file));
  }
  // next.config.ts is read by R8; absent is fine, present must be honest.
  try {
    cpSync(path.join(ROOT, 'next.config.ts'), path.join(dir, 'next.config.ts'));
  } catch {
    // Not present in every tree; R8 simply has nothing to scan.
  }
  return dir;
}

const run = (dir) =>
  spawnSync(process.execPath, [path.join(dir, 'scripts', 'check.mjs')], {
    encoding: 'utf8',
    cwd: dir,
  });

const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, text) => {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

/** Swap the shipped fallback sentence for the strong 90-day claim. */
function makeStrongClaim(dir) {
  const before = read(dir, PRIVACY);
  const after = before.replace(
    /in our EU database for security purposes; these are not removed when you\s*\n?\s*delete your account\. An automated retention schedule for them is being set up\./,
    STRONG_CLAIM,
  );
  assert.notEqual(after, before, 'fixture failed to find the fallback sentence in ' + PRIVACY);
  write(dir, PRIVACY, after);
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

describe('scripts/check.mjs — the gate the other gates rest on', () => {
  test('the shipped tree passes', () => {
    const { status, stderr } = run(sandbox());
    assert.equal(status, 0, `check failed on an unmodified tree:\n${stderr}`);
  });

  test('R12 FAILS on the 90-day claim with no evidence file', () => {
    const dir = sandbox();
    makeStrongClaim(dir);
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'the 90-day claim shipped with no evidence and check still passed');
    assert.match(stderr, /R12/, 'the failure must name R12');
    assert.match(stderr, /audit-retention-evidence\.md/, 'it must name the file that unblocks it');
  });

  test('R12 PASSES once the evidence file records a succeeded run', () => {
    const dir = sandbox();
    makeStrongClaim(dir);
    write(dir, EVIDENCE, '# purge run\n\nstatus: succeeded\nend_time: 2026-09-03 03:00:07+00\n');
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `claim + evidence should pass:\n${stderr}`);
  });

  test('R12 is not satisfied by an EMPTY evidence file', () => {
    // `touch` must not unlock the strongest privacy claim in the app.
    const dir = sandbox();
    makeStrongClaim(dir);
    write(dir, EVIDENCE, '');
    const { status } = run(dir);
    assert.equal(status, 1, 'an empty evidence file unlocked the 90-day claim');
  });

  test('R12 is not satisfied by a file that records a FAILED run', () => {
    const dir = sandbox();
    makeStrongClaim(dir);
    write(dir, EVIDENCE, 'status: failed\nreturn_message: permission denied for table\n');
    const { status } = run(dir);
    assert.equal(status, 1, 'a failed purge run unlocked the 90-day claim');
  });

  test('R12 follows the claim into another file — the allow-list would have missed this', () => {
    // The realistic regression: someone lifts the paragraph into a component.
    const dir = sandbox();
    write(
      dir,
      'src/components/privacy-section.tsx',
      'export function PrivacySection() {\n' +
        '  return (\n' +
        '    <p>\n' +
        `      We keep authentication audit records ${STRONG_CLAIM}\n` +
        '    </p>\n' +
        '  );\n' +
        '}\n',
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'the claim moved to a new file and R12 did not follow it');
    assert.match(stderr, /privacy-section/, 'R12 must name the file that carries the claim');
  });

  test('R12 reads what SHIPS, not what a comment archives', () => {
    // src/app/privacy/page.tsx already carries the strong sentence inside a JSX
    // block comment, on purpose, so the swap is a copy-paste when the evidence
    // lands. If R12 matched comments, the shipped tree could never be green.
    assert.match(
      read(ROOT, PRIVACY),
      /90 days/,
      'this test is vacuous unless the comment really does archive the sentence',
    );
    const { status } = run(sandbox());
    assert.equal(status, 0, 'R12 tripped on a comment — it must judge rendered copy only');
  });

  /**
   * The two banned tokens are COMPOSED, never spelled. R9 and R11c scan for the
   * literal, and this file is inside the tree they scan — writing either one out
   * would make the fixture fail the very build it is asserting about. (It did,
   * once: R11c flagged this file the moment it was added.)
   */
  const BANNED_SESSION_CALL = 'get' + 'Session(';
  const BANNED_BROWSER_CLIENT = 'create' + 'BrowserClient';

  test('R9 still FAILS on the unvalidated session getter, load-bearing for auth', () => {
    const dir = sandbox();
    write(
      dir,
      'src/lib/auth/probe.ts',
      `export async function probe(s) {\n  return s.auth.${BANNED_SESSION_CALL});\n}\n`,
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'the unvalidated session getter in src/ must fail the build');
    assert.match(stderr, /R9/);
  });

  test('R11c still FAILS on a browser Supabase client import', () => {
    const dir = sandbox();
    write(
      dir,
      'src/lib/supabase/browser.ts',
      `import { ${BANNED_BROWSER_CLIENT} } from '@supabase/ssr';\n` +
        `export { ${BANNED_BROWSER_CLIENT} };\n`,
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a browser Supabase client must fail the build');
    assert.match(stderr, /R11/);
  });
});
