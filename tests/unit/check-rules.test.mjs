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
 * couples the audit-retention claim on /privacy to
 * docs/eval/audit-retention-evidence.md, so the app cannot promise an erasure
 * nothing performs. A rule that silently stopped firing would restore that
 * promise with every gate still green — the exact failure mode R11d exists for
 * on the cookie side, and the one two scanner-shaped versions of R12 actually
 * suffered before it became a switch (SPEC v2.9).
 *
 * Method: copy the repo's checkable surface into a temp dir, mutate ONE thing,
 * run the real scripts/check.mjs against it, assert the exit code. The script is
 * never modified and the working tree is never touched.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SWITCH = 'src/lib/copy.ts';
const EVIDENCE = 'docs/eval/audit-retention-evidence.md';
const PLACEHOLDER = '<PASTE RUN OUTPUT HERE>';

/**
 * A realistic psql paste — deliberately a format the gate does NOT parse. An
 * earlier R12 demanded an anchored `status: succeeded` line, which no client
 * actually emits; the only way to satisfy it was to hand-type the line, which is
 * the paper mechanism the rule opposes. This fixture is the shape of real
 * evidence, and it passes because the gate asks "is the placeholder gone and is
 * there substance here", not "does this match my format".
 */
const REAL_PASTE = [
  '# Auth audit-log purge run evidence',
  '',
  '  status   |  return_message  |          end_time',
  '-----------+------------------+----------------------------',
  ' succeeded | DELETE 0         | 2026-09-03 03:00:07.114+00',
  ' succeeded | DELETE 0         | 2026-09-02 03:00:06.882+00',
  ' succeeded | DELETE 12        | 2026-09-01 03:00:07.401+00',
  '(3 rows)',
  '',
].join('\n');

/**
 * The template as it ships before any run exists: prose plus the marker. Built
 * from PLACEHOLDER and written INTO the sandbox rather than read out of docs/,
 * so the placeholder case keeps testing the placeholder now that the real
 * evidence file has been filled in with a real run.
 */
const TEMPLATE_PASTE = [
  '# Auth audit-log purge run evidence',
  '',
  'Status: TEMPLATE. No purge run has succeeded yet. Replace the block below',
  'with the verbatim output of a cron.job_run_details query, in the same commit',
  'that sets the switch, and never before a run has actually succeeded.',
  '',
  PLACEHOLDER,
  '',
].join('\n');

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
  /**
   * Root files, and the list is longer than it looks like it needs to be.
   *
   * R13 resolves a backticked path against the tree, and its DOC_ROOT_FILES
   * pattern deliberately covers `SPEC.`, `CLAUDE.`, `README.`, `package.`,
   * `next.config.`, `eslint.config.` and `tsconfig.`. So a docs/ page that cites
   * `SPEC.md` — which the shelf does constantly, since SPEC is the source of
   * truth — resolves in the real tree and FAILED here, because the sandbox did
   * not copy it. Every case that expects a green sandbox broke at once, and the
   * defect was in this fixture rather than in the tree it was judging.
   *
   * The lesson generalises: this sandbox is only useful while it is a REAL tree
   * for every path any rule can reach. Copy each root file R13 knows how to
   * resolve, and tolerate absence so the fixture never fails on a file a future
   * tree happens not to have.
   */
  for (const file of [
    '.env.example',
    'package.json',
    'README.md',
    'SPEC.md',
    'CLAUDE.md',
    'tsconfig.json',
    'eslint.config.mjs',
    // Read by R8; absent is fine, present must be honest.
    'next.config.ts',
  ]) {
    try {
      cpSync(path.join(ROOT, file), path.join(dir, file));
    } catch {
      // Not present in every tree; the rules that read it have nothing to scan.
    }
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

/**
 * Pin the one switch that lets /privacy state a retention period to an EXPLICIT
 * state. It sets rather than flips, and that is the point: an earlier fixture
 * rewrote `false` -> `true` and so stopped finding its target on the day the
 * shipped constant legitimately became `true`, taking four of the cases below
 * down with it. A fixture that inherits the tree's current state cannot test a
 * rule about that state. Each case now names the state it needs.
 */
const SWITCH_DECL = /export const AUDIT_RETENTION_VERIFIED = (?:true|false);/;

function setSwitch(dir, value) {
  const before = read(dir, SWITCH);
  assert.match(before, SWITCH_DECL, `fixture failed to find the switch in ${SWITCH}`);
  write(
    dir,
    SWITCH,
    before.replace(SWITCH_DECL, `export const AUDIT_RETENTION_VERIFIED = ${value};`),
  );
}

after(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

describe('scripts/check.mjs — the gate the other gates rest on', () => {
  test('the shipped tree passes', () => {
    const { status, stderr } = run(sandbox());
    assert.equal(status, 0, `check failed on an unmodified tree:\n${stderr}`);
  });

  /**
   * R12 is a SWITCH, not a scanner (SPEC v2.9). Four states, and that is the
   * whole rule. Two earlier versions read the page and tried to decide whether
   * it stated a retention period; both shipped real promises past the gate,
   * because `{90} days`, `<strong>90</strong> days`, "eighteen months" and
   * "2160 hours" are the same claim and no regex closes that set. A boolean has
   * no vocabulary to go blind on.
   */
  test('R12 state 1/4 — switch ON, no evidence file at all: FAIL', () => {
    const dir = sandbox();
    setSwitch(dir, true);
    rmSync(path.join(dir, EVIDENCE), { force: true });
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'the claim shipped with no evidence whatsoever');
    assert.match(stderr, /R12/);
    assert.match(stderr, /audit-retention-evidence\.md/, 'name the file that unblocks it');
  });

  test('R12 state 2/4 — switch ON, template placeholder intact: FAIL', () => {
    // The realistic mistake: flip the constant, forget the paste.
    const dir = sandbox();
    setSwitch(dir, true);
    write(dir, EVIDENCE, TEMPLATE_PASTE);
    assert.ok(read(dir, EVIDENCE).includes(PLACEHOLDER), 'fixture must carry the placeholder');
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'an untouched template unlocked the retention claim');
    assert.match(stderr, /placeholder/i);
  });

  test('R12 state 3/4 — switch ON, a real run pasted in: PASS', () => {
    const dir = sandbox();
    setSwitch(dir, true);
    write(dir, EVIDENCE, REAL_PASTE);
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `a genuine psql paste must satisfy the gate:\n${stderr}`);
  });

  test('R12 state 4/4 — switch OFF: nothing further is checked', () => {
    // Where the tree sits before any run has succeeded. The evidence file may
    // be an untouched template, or absent entirely.
    const dir = sandbox();
    setSwitch(dir, false);
    rmSync(path.join(dir, EVIDENCE), { force: true });
    const { status, stderr } = run(dir);
    assert.equal(status, 0, `with the switch off the evidence file is irrelevant:\n${stderr}`);
  });

  test('R12 rejects a stub that is technically placeholder-free', () => {
    // Deleting the marker must not be the whole trick; a real paste has bulk.
    const dir = sandbox();
    setSwitch(dir, true);
    write(dir, EVIDENCE, 'succeeded\n');
    const { status, stderr } = run(dir);
    assert.equal(status, 1, 'a one-word file unlocked the retention claim');
    assert.match(stderr, /too small/i);
  });

  test('/privacy states a period only in the verified branch', () => {
    // The switch is only meaningful if exactly one branch carries the period.
    // Read the real files, not a sandbox.
    //
    // What is asserted is that the switch stays a plain boolean LITERAL, not
    // which of the two values it currently holds. R12 recognises the switch by
    // matching `= true;`, so an env read or a computed expression would leave
    // the rule's own test false while /privacy could still render the strong
    // wording -- the one way this gate can go blind. Whether a `true` is backed
    // by real evidence is R12's own job, exercised against the real tree by
    // "the shipped tree passes" above; and the constant is designed to return
    // to `false` if a run ever stops succeeding, which a hard-coded value here
    // would report as a test failure instead of the correct outcome it is.
    const copy = read(ROOT, SWITCH);
    assert.match(
      copy,
      /^export const AUDIT_RETENTION_VERIFIED = (?:true|false);$/m,
      'the switch must stay a plain boolean literal, or R12 stops seeing it',
    );
    assert.match(copy, /verified:[\s\S]*?90 days/, 'the verified branch states the period');
    const fallbackOnly = copy.slice(copy.indexOf('fallback:'));
    assert.doesNotMatch(fallbackOnly, /90 days/, 'the fallback branch must state no period');
    assert.match(
      read(ROOT, 'src/app/privacy/page.tsx'),
      /AUDIT_RETENTION_VERIFIED \? PRIVACY_ERASURE\.verified : PRIVACY_ERASURE\.fallback/,
      'the page must choose by the switch, not by hand-edited prose',
    );
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
