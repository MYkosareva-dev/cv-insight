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

  test('R12 is not satisfied by PROSE that merely contains the word succeeded', () => {
    // This is the case the test above was NAMED for and did not cover: it passed
    // only because its fixture happened not to contain the substring. A substring
    // test for "succeeded" is satisfied by a file saying the opposite.
    const dir = sandbox();
    makeStrongClaim(dir);
    write(
      dir,
      EVIDENCE,
      'The job has NOT succeeded yet: permission denied for table audit_log_entries.\n',
    );
    const { status } = run(dir);
    assert.equal(status, 1, '"has NOT succeeded" unlocked the claim — the predicate is a substring');
  });

  test('R12 accepts an anchored status line among other output', () => {
    const dir = sandbox();
    makeStrongClaim(dir);
    write(
      dir,
      EVIDENCE,
      '# purge run\n\n```\n jobid | status    | end_time\n```\n' +
        'status: succeeded\nend_time: 2026-09-03 03:00:07+00\n',
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `an anchored succeeded line must unlock the claim:\n${stderr}`);
  });

  /**
   * M1/M2 from the phase-1 code review, as fixtures. R12's first version keyed the
   * noun on "audit" and the period on the literal "90 days"; all three of these
   * shipped a fully-formed retention promise past it, exit 0.
   */
  for (const [label, sentence] of [
    [
      'the phrase the app itself ships ("authentication records", no "audit")',
      'in our EU database for 90 days; these are not removed when you',
    ],
    ['a hyphenated singular period ("90-day")', 'in our EU database on a 90-day retention schedule; these are not removed when you'],
    ['a spelled-out period ("ninety days")', 'in our EU database for ninety days; these are not removed when you'],
    ['a different unit ("three months")', 'in our EU database for three months; these are not removed when you'],
  ]) {
    test(`R12 FAILS on ${label}`, () => {
      const dir = sandbox();
      const before = read(dir, PRIVACY);
      const after = before
        .replace(
          /in our EU database for security purposes; these are not removed when you/,
          sentence,
        )
        .replace(/authentication audit records/g, 'authentication records');
      assert.notEqual(after, before, 'fixture failed to rewrite the paragraph');
      write(dir, PRIVACY, after);
      const { status, stderr } = run(dir);
      assert.equal(status, 1, `a retention promise shipped unguarded: ${label}`);
      assert.match(stderr, /R12/);
    });
  }

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
   * R13 is the rule that exists because THREE keyword sweeps in a row declared
   * docs/ clean while an annotation described `lib/supabase/env.ts`, a module
   * that has never existed here. A keyword sweep can only look for strings
   * already known to be wrong; what made that annotation wrong was a property.
   * These cases pin the property.
   */
  const docNote = (body) => `# note\n\n> **ANNOTATION:** ${body}\n`;

  test('R13 FAILS on a docs/ annotation naming a module that does not exist', () => {
    const dir = sandbox();
    write(dir, 'docs/invented.md', docNote('the boot-time guard in `lib/supabase/env.ts` does X.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a docs/ path that does not resolve must fail the build');
    assert.match(stderr, /R13/);
    assert.match(stderr, /env\.ts/, 'R13 must name the path it could not resolve');
  });

  test('R13 PASSES on paths that do resolve, including @/ and a glob segment', () => {
    const dir = sandbox();
    write(
      dir,
      'docs/real.md',
      docNote(
        'the gate `lib/chat.ts` imports `@/lib/supabase/server.ts`; the routes are ' +
          '`src/app/api/*/route.ts`.',
      ),
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `real paths must not trip R13:\n${stderr}`);
  });

  test('R13 checks DIRECTORY paths too, not only files with an extension', () => {
    // The annotation that closed the round-5 blocker asserts what
    // `src/lib/supabase/` holds. An extension-only rule would never revisit it.
    const dir = sandbox();
    write(dir, 'docs/dir-ok.md', docNote('`src/lib/supabase/` holds the server client.'));
    assert.equal(run(dir).status, 0, 'a real directory must pass');

    const dir2 = sandbox();
    write(dir2, 'docs/dir-bad.md', docNote('`src/lib/guards/` holds the boot-time check.'));
    const { status, stderr } = run(dir2);
    assert.equal(status, 1, 'a directory that does not exist must fail');
    assert.match(stderr, /R13/);
  });

  test('R13 exempts a path the annotation itself marks as deleted', () => {
    // The one case where naming a missing file is the point of the sentence.
    const dir = sandbox();
    write(dir, 'docs/gone.md', docNote('`lib/supabase/client.ts` was deleted in Phase 1.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `an explicitly-deleted path must be allowed:\n${stderr}`);
  });

  test('R13 does not let unrelated "are deleted" prose exempt a stale path', () => {
    // Retention prose in this repo says "rows are deleted when they age out".
    // Line-scoped matching would have exempted every stale path sharing that line.
    const dir = sandbox();
    write(
      dir,
      'docs/faroff.md',
      docNote(
        'audit rows are deleted when they age out, which is a completely separate ' +
          'matter from the retention job and the disclosure wording on the privacy ' +
          'page, and has nothing at all to do with `lib/supabase/env.ts` here.',
      ),
    );
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a far-off "are deleted" must not exempt an unrelated stale path');
    assert.match(stderr, /env\.ts/);
  });

  test('R13 resolves paths CASE-SENSITIVELY, so a green tree here is green on Linux', () => {
    // existsSync is case-insensitive on NTFS/APFS. Without an explicit walk this
    // passes on the author's machine and fails on the Vercel builder — and check
    // is prebuild, so that is a green local tree and a red deploy.
    const dir = sandbox();
    write(dir, 'docs/case.md', docNote('the client lives in `src/lib/Supabase/Server.ts`.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a mis-cased path must fail here, as it would on Linux');
    assert.match(stderr, /R13/);
  });

  test('R13 sees a path sitting after a bare // in markdown prose', () => {
    // `//` is not a comment in markdown. The shared stripComments blanked the rest
    // of the line, hiding any stale path behind one.
    const dir = sandbox();
    write(dir, 'docs/slashes.md', docNote('ratio 1//2 — see `lib/supabase/env.ts` for the guard.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a stale path hid behind a bare // in markdown');
    assert.match(stderr, /env\.ts/);
  });

  test('R13 does not police docs/reviews — a dated record must stay accurate to its date', () => {
    // phase-0.md names src/lib/supabase/client.ts, which existed at Phase 0.
    // Failing on it would push the next agent to falsify a historical record.
    const dir = sandbox();
    write(dir, 'docs/reviews/phase-9.md', docNote('`src/lib/supabase/client.ts:14-15` reads two.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `review reports are out of R13 scope:\n${stderr}`);
  });

  test('R13 ignores package and upstream references, not just repo paths', () => {
    const dir = sandbox();
    write(dir, 'docs/upstream.md', docNote('see `@supabase/ssr` and `self-hosted-auth-keys.mdx`.'));
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `non-repo references must not trip R13:\n${stderr}`);
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
