import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  EMPTY_CONTACTS,
  OPEN_TO_REMOTE,
  contactLines,
  contactValues,
  contactsOf,
  hasAnyContact,
  resumeTextForModel,
  withContactHeader,
} from '../../src/lib/resumeHeader.ts';

/**
 * The contact header block (SPEC v2.20).
 *
 * This is the top of a document the user sends to an employer, and the two
 * failure modes are both silent: a field in the wrong place, and — the one the
 * owner's requirement names explicitly — an absent field leaving a blank line or
 * a dangling separator behind. Neither shows up as an error anywhere; they show
 * up in a .docx on a recruiter's screen. So the collapse rules are pinned here
 * rather than trusted to a template.
 *
 * All values below are the fictional persona's (SPEC Block B) — synthetic data
 * only, in a file that is committed.
 */

const FULL = {
  email: 'mira.steinberg@example.com',
  phone: '+49 40 123456',
  location: 'Hamburg, Germany',
  linkedin: 'https://www.linkedin.com/in/mira-steinberg',
  github: 'https://github.com/mira-steinberg',
  openToRemote: true,
};

describe('contactsOf — a profile row, or the absence of one', () => {
  test('a null profile is no contact details, not a crash', () => {
    assert.deepEqual(contactsOf(null), EMPTY_CONTACTS);
  });

  test('a row from BEFORE migration 005 has the keys absent, and reads as empty', () => {
    // This is the state the branch is reachable in until the owner applies the
    // migration: `select('*')` returns the 004 columns and nothing else.
    assert.deepEqual(
      contactsOf({ user_id: 'u', display_name: 'Mira Steinberg' }),
      EMPTY_CONTACTS,
    );
  });

  test('blank and whitespace-only columns are the same as absent', () => {
    const contacts = contactsOf({
      contact_email: '',
      phone: '   ',
      location: '\t',
      linkedin_url: null,
      github_url: undefined,
      open_to_remote: null,
    });
    assert.deepEqual(contacts, EMPTY_CONTACTS);
  });

  test('values are trimmed, never reformatted', () => {
    const contacts = contactsOf({
      contact_email: '  mira@example.com ',
      phone: ' +49 40 123456 ',
      location: 'Hamburg, Germany',
      linkedin_url: 'https://www.linkedin.com/in/mira-steinberg',
      github_url: 'https://github.com/mira-steinberg',
      open_to_remote: true,
    });
    assert.equal(contacts.email, 'mira@example.com');
    // A phone number is written differently in every country the app is used
    // from: the app must print what the user wrote.
    assert.equal(contacts.phone, '+49 40 123456');
    assert.equal(contacts.openToRemote, true);
  });

  test('open_to_remote null and false both mean "print nothing"', () => {
    assert.equal(contactsOf({ open_to_remote: null }).openToRemote, false);
    assert.equal(contactsOf({ open_to_remote: false }).openToRemote, false);
    assert.equal(contactsOf({ open_to_remote: true }).openToRemote, true);
  });
});

describe('contactLines — the block, in recruiter order', () => {
  test('a full profile is two lines: how to reach you, then where to read more', () => {
    assert.deepEqual(contactLines(FULL), [
      `mira.steinberg@example.com · +49 40 123456 · Hamburg, Germany · ${OPEN_TO_REMOTE}`,
      'https://www.linkedin.com/in/mira-steinberg · https://github.com/mira-steinberg',
    ]);
  });

  test('an empty profile is NO lines — not two blank ones', () => {
    assert.deepEqual(contactLines(EMPTY_CONTACTS), []);
    assert.equal(hasAnyContact(EMPTY_CONTACTS), false);
  });

  test('an absent field takes its separator with it', () => {
    // The dangling-separator defect: "email · · Hamburg" is what a naive
    // template produces, and it is visible on the finished document.
    const lines = contactLines({ ...FULL, phone: null, openToRemote: false });
    assert.equal(lines[0], 'mira.steinberg@example.com · Hamburg, Germany');
    assert.ok(!lines[0].includes('··'));
    assert.ok(!lines[0].includes(' ·  ·'));
  });

  test('a group whose every member is absent takes its whole LINE with it', () => {
    const noLinks = contactLines({ ...FULL, linkedin: null, github: null });
    assert.equal(noLinks.length, 1);

    const onlyGithub = contactLines({
      ...EMPTY_CONTACTS,
      github: 'https://github.com/mira-steinberg',
    });
    assert.deepEqual(onlyGithub, ['https://github.com/mira-steinberg']);
    assert.equal(hasAnyContact(onlyGithub.length ? FULL : EMPTY_CONTACTS), true);
  });

  test('"Open to remote" sits beside the location, because that is what it answers', () => {
    const lines = contactLines({ ...EMPTY_CONTACTS, location: 'Hamburg, Germany', openToRemote: true });
    assert.deepEqual(lines, [`Hamburg, Germany · ${OPEN_TO_REMOTE}`]);
  });

  test('it is the only member of its line when nothing else is filled in', () => {
    assert.deepEqual(contactLines({ ...EMPTY_CONTACTS, openToRemote: true }), [OPEN_TO_REMOTE]);
  });

  test('the URLs go in exactly as stored — never shortened, never linkified', () => {
    const lines = contactLines({
      ...EMPTY_CONTACTS,
      linkedin: 'https://www.linkedin.com/in/mira-steinberg',
    });
    assert.equal(lines[0], 'https://www.linkedin.com/in/mira-steinberg');
    assert.ok(!lines[0].includes('<'));
  });
});

describe('withContactHeader — where the block goes', () => {
  const RESUME = [
    'MIRA STEINBERG',
    'AI Quality Analyst',
    '',
    'SUMMARY',
    'Six years of LLM evaluation and annotation quality work.',
    '',
    'EXPERIENCE',
    'AI Prompt Evaluator — Nordlicht Digital (01/2025 – present)',
  ].join('\n');

  test('it lands under the name and the target title, before the body', () => {
    const out = withContactHeader(RESUME, FULL).split('\n');
    assert.equal(out[0], 'MIRA STEINBERG');
    assert.equal(out[1], 'AI Quality Analyst');
    assert.ok(out[2].startsWith('mira.steinberg@example.com'));
    assert.ok(out[3].startsWith('https://www.linkedin.com'));
    // The blank line that separated the header from SUMMARY is still there, and
    // still separates them.
    assert.equal(out[4], '');
    assert.equal(out[5], 'SUMMARY');
  });

  test('an empty profile returns the text byte for byte', () => {
    assert.equal(withContactHeader(RESUME, EMPTY_CONTACTS), RESUME);
  });

  test('it adds NO blank line of its own into an existing header', () => {
    const out = withContactHeader(RESUME, FULL);
    assert.ok(!out.includes('\n\n\n'), 'no run of blank lines was introduced');
  });

  test('a text with no blank line anywhere still gets a header, and a boundary', () => {
    const oneParagraph = 'MIRA STEINBERG\nAI Quality Analyst — six years of evaluation work.';
    const out = withContactHeader(oneParagraph, FULL).split('\n');
    assert.equal(out[0], 'MIRA STEINBERG');
    assert.ok(out[1].startsWith('mira.steinberg@example.com'));
    assert.equal(out[3], '', 'the block brings the boundary the text did not have');
    assert.equal(out[4], 'AI Quality Analyst — six years of evaluation work.');
  });

  test('it does not insert TWICE', () => {
    // A regenerate, a re-export, or any caller applying it to text that already
    // carries the block. Two headers on one resume is the visible defect.
    const once = withContactHeader(RESUME, FULL);
    assert.equal(withContactHeader(once, FULL), once);
  });

  test('a one-line text is not turned into a nameless document', () => {
    const out = withContactHeader('MIRA STEINBERG', FULL).split('\n');
    assert.equal(out[0], 'MIRA STEINBERG');
    assert.ok(out[1].startsWith('mira.steinberg@example.com'));
  });
});

// ---------------------------------------------------------------------------
// THE MODEL BOUNDARY (owner decision, v2.21)
// ---------------------------------------------------------------------------

/**
 * The contact details must never reach a model. This is the test that fails if
 * one can, and it is deliberately built the way the display-name prompt tests in
 * `validation.test.mjs` are: take the value a user could save, put it through the
 * exact function the app puts it through, and assert on the STRING that would go
 * on the wire.
 *
 * WHY THE RULE EXISTS. Neither writing bullets nor judging grounding depends on a
 * phone number — P2 is told not to write contact details at all, and P3 scores
 * claims against career items — so sending the block widens the set of personal
 * data leaving to a third party for no gain. v2.20 sent it, because the header
 * was inserted before the judge ran; v2.21 inserts it after, and strips it out of
 * any stored version on its way back to a model.
 *
 * WHAT THIS CANNOT PROVE, said here rather than left implied: it cannot prove a
 * city name is absent from a payload when the user's own career items say it.
 * That text was already going to the model as a career item. The claim under test
 * is the one the app can keep — that the app stops ADDING contact details to a
 * model payload — and the call sites are held to it by `ModelResumeText`, which
 * only `resumeTextForModel` produces, so skipping the strip is a build error
 * rather than something a test has to catch.
 */

const CONTACT_FIELDS = [
  ['email', 'mira.steinberg@example.com'],
  ['phone', '+49 40 123456'],
  ['location', 'Hamburg, Germany'],
  ['linkedin', 'https://www.linkedin.com/in/mira-steinberg'],
  ['github', 'https://github.com/mira-steinberg'],
];

/** The model's own output: what P2 returns, before the app touches it. */
const MODEL_OUTPUT = [
  'MIRA STEINBERG',
  'AI Quality Analyst',
  '',
  'SUMMARY',
  'Six years of LLM evaluation and annotation quality work.',
  '',
  'EXPERIENCE',
  'AI Prompt Evaluator - Nordlicht Digital (01/2025 - present)',
  '- Maintained a 98% QA quality score across annotated batches.',
].join('\n');

describe('resumeTextForModel - no contact field reaches a model', () => {
  test('a stored version with a full header goes back to the model without one', () => {
    const stored = withContactHeader(MODEL_OUTPUT, FULL);
    const forModel = resumeTextForModel(stored, FULL);

    for (const value of contactValues(FULL)) {
      assert.ok(!forModel.includes(value), `${value} must not reach a model`);
    }
    /**
     * And what is left is the model's own text, unchanged — not a text with a
     * hole in it. A judge reading a document with a gap where the header stood
     * would be reviewing a shape the writer never produced.
     */
    assert.equal(forModel, MODEL_OUTPUT);
  });

  test('ONE saved field is enough to be stripped', () => {
    // The likeliest real profile is a partial one, and the field-by-field
    // collapse means the header may be a single line.
    for (const [field, value] of CONTACT_FIELDS) {
      const contacts = { ...EMPTY_CONTACTS, [field]: value };
      const stored = withContactHeader(MODEL_OUTPUT, contacts);
      assert.ok(stored.includes(value), `${field} is in the stored version`);
      assert.equal(resumeTextForModel(stored, contacts), MODEL_OUTPUT, field);
    }
  });

  test('"Open to remote" is a value and not a label, so it is stripped too', () => {
    const contacts = { ...EMPTY_CONTACTS, openToRemote: true };
    const stored = withContactHeader(MODEL_OUTPUT, contacts);
    assert.ok(stored.includes(OPEN_TO_REMOTE));
    assert.equal(resumeTextForModel(stored, contacts), MODEL_OUTPUT);
  });

  test('an EDITED header is still stripped', () => {
    /**
     * The header is deliberately editable — it is part of the user's resume — so
     * the strip cannot depend on matching the line the app composed. A user who
     * reorders the fields, splits them across lines or swaps the separator has
     * still not asked for their phone number to be sent to a model.
     */
    for (const edited of [
      'mira.steinberg@example.com | +49 40 123456',
      '+49 40 123456 · mira.steinberg@example.com · Hamburg, Germany',
      'mira.steinberg@example.com\n+49 40 123456\nHamburg, Germany',
      '(mira.steinberg@example.com) - +49 40 123456',
      'https://github.com/mira-steinberg, https://www.linkedin.com/in/mira-steinberg',
    ]) {
      const stored = ['MIRA STEINBERG', edited, '', 'SUMMARY', 'Six years.'].join('\n');
      const forModel = resumeTextForModel(stored, FULL);
      for (const value of contactValues(FULL)) {
        assert.ok(!forModel.includes(value), `${value} survived: ${edited}`);
      }
    }
  });

  test('it does not eat the document around the header', () => {
    // The one failure that would be worse than the leak: a strip that removes a
    // line of the user's actual experience.
    const forModel = resumeTextForModel(withContactHeader(MODEL_OUTPUT, FULL), FULL);
    assert.ok(forModel.includes('AI Prompt Evaluator - Nordlicht Digital (01/2025 - present)'));
    assert.ok(forModel.includes('Maintained a 98% QA quality score'));
    assert.ok(forModel.startsWith('MIRA STEINBERG\nAI Quality Analyst'));
  });

  test('a value inside a SENTENCE is left alone, and the scope says so', () => {
    /**
     * The honest limit of the mechanism, pinned so nobody later reads the rule as
     * wider than it is: a career item that says "Nordlicht Digital, Hamburg,
     * Germany" keeps saying it, because that text is a career item and career
     * items are what the model is for. Redacting mid-sentence would hand the judge
     * a resume the writer never wrote.
     */
    const body = [
      'MIRA STEINBERG',
      '',
      'EXPERIENCE',
      'AI Prompt Evaluator, Nordlicht Digital in Hamburg, Germany since 01/2025',
    ].join('\n');
    assert.equal(resumeTextForModel(body, FULL), body);
  });

  test('an empty profile is a no-op, byte for byte', () => {
    assert.equal(resumeTextForModel(MODEL_OUTPUT, EMPTY_CONTACTS), MODEL_OUTPUT);
  });

  test('the name line is NOT stripped - P2 rule 4 needs it', () => {
    // The display name is the one profile value that still travels, sanitised and
    // inside a tagged block. Stripping it would be the v2.17 defect back.
    const forModel = resumeTextForModel(withContactHeader(MODEL_OUTPUT, FULL), FULL);
    assert.ok(forModel.includes('MIRA STEINBERG'));
  });

  test('stripping is idempotent', () => {
    // A stored version may already have been through it, and a second pass must
    // not start removing body lines.
    const once = resumeTextForModel(withContactHeader(MODEL_OUTPUT, FULL), FULL);
    assert.equal(resumeTextForModel(once, FULL), once);
  });
});
