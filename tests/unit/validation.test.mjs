import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { AUTH, RESULT, SCAN, VACANCY_LENGTH } from '../../src/lib/copy.ts';
import {
  MAX_SCAN_RESUME_CHARS,
  credentialsSchema,
  fieldErrorsOf,
  parsedVacancySchema,
  patchApplicationSchema,
  isRescanBody,
  rescanSchema,
  scanResumeText,
  scanSchema,
} from '../../src/lib/validation.ts';

/**
 * The credential schema is the real gate: a Server Action is a public endpoint,
 * so whatever the form does client-side, this is what actually runs. The
 * messages are asserted against `lib/copy.ts` rather than string literals, so
 * the test pins the SPEC Block F copy to the field that renders it — changing
 * one without the other fails here.
 */

const errorsFor = (input) => {
  const parsed = credentialsSchema.safeParse(input);
  assert.equal(parsed.success, false, 'expected this input to be rejected');
  return fieldErrorsOf(parsed.error);
};

describe('credentialsSchema — SPEC Block F, sign up / sign in', () => {
  test('accepts a valid pair', () => {
    const parsed = credentialsSchema.safeParse({
      email: 'mira@example.com',
      password: 'a-long-enough-password',
    });
    assert.equal(parsed.success, true);
  });

  test('rejects a malformed email with the exact copy', () => {
    assert.equal(
      errorsFor({ email: 'not-an-email', password: 'longenough' }).email,
      AUTH.invalidEmail,
    );
  });

  test('rejects a password under 8 characters with the exact copy', () => {
    assert.equal(
      errorsFor({ email: 'mira@example.com', password: '1234567' }).password,
      AUTH.shortPassword,
    );
    // Exactly 8 is allowed — the rule is min 8, not more than 8.
    assert.equal(
      credentialsSchema.safeParse({ email: 'mira@example.com', password: '12345678' }).success,
      true,
    );
  });

  test('an empty field is reported, never silently accepted', () => {
    const errors = errorsFor({ email: '', password: '' });
    assert.equal(errors.email, AUTH.invalidEmail);
    assert.equal(errors.password, AUTH.shortPassword);
  });

  test('missing keys are rejected — a hand-rolled POST sends no form fields', () => {
    assert.equal(credentialsSchema.safeParse({}).success, false);
    assert.equal(credentialsSchema.safeParse(null).success, false);
  });

  test('both fields report at once, so the form shows every error in one pass', () => {
    const errors = errorsFor({ email: 'nope', password: 'short' });
    assert.equal(errors.email, AUTH.invalidEmail);
    assert.equal(errors.password, AUTH.shortPassword);
  });

  test('fieldErrorsOf keeps the FIRST message per field', () => {
    const errors = errorsFor({ email: 'nope', password: 'short' });
    assert.equal(Object.keys(errors).length, 2);
    for (const value of Object.values(errors)) assert.equal(typeof value, 'string');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: the scan body, the P1 output shape, and the PATCH
// ---------------------------------------------------------------------------

describe('scanSchema — SPEC Block D #4, Block F bounds', () => {
  const vacancy = 'x'.repeat(150);

  test('accepts a career-base scan with no resume text', () => {
    const parsed = scanSchema.safeParse({
      vacancyText: vacancy,
      resumeSource: 'career_base',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.success, true);
  });

  test('a short vacancy is refused with the Block F copy, before any spend', () => {
    const parsed = scanSchema.safeParse({
      vacancyText: 'too short',
      resumeSource: 'career_base',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error.issues[0].message, SCAN.vacancyRequired);
  });

  test('an over-long vacancy gets the MAX message, not "at least 100" (S7)', () => {
    const parsed = scanSchema.safeParse({
      vacancyText: 'x'.repeat(20_001),
      resumeSource: 'career_base',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error.issues[0].message, VACANCY_LENGTH);
  });

  test('a paste with no text is refused by the refine', () => {
    const parsed = scanSchema.safeParse({
      vacancyText: vacancy,
      resumeSource: 'paste',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error.issues[0].message, SCAN.resumeRequired);
  });

  test('a JSON body claiming "file" with no text is a 400, not a server anomaly', () => {
    const parsed = scanSchema.safeParse({
      vacancyText: vacancy,
      resumeSource: 'file',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.success, false);
  });

  test('the retry branch is the id and nothing else', () => {
    const retry = rescanSchema.safeParse({
      applicationId: '9f2a6c1e-4b7d-4f7a-9e2b-3c8d1a5e7f90',
    });
    assert.equal(retry.success, true);
    assert.deepEqual(retry.data, { applicationId: '9f2a6c1e-4b7d-4f7a-9e2b-3c8d1a5e7f90' });
    assert.equal(rescanSchema.safeParse({ applicationId: 'not-a-uuid' }).success, false);
  });

  test('the two shapes are told apart before either schema runs', () => {
    // The reason this is a predicate and not a z.union: a union reports its
    // failure as one "Invalid input" issue, which would replace every Block F
    // message on the endpoint — and S7 requires the exact copy.
    assert.equal(isRescanBody({ applicationId: 'x' }), true);
    assert.equal(
      isRescanBody({
        vacancyText: vacancy,
        resumeSource: 'career_base',
        sourceResumeText: null,
        resumeVersionId: null,
      }),
      false,
    );
    assert.equal(isRescanBody(null), false);
    assert.equal(isRescanBody('applicationId'), false);

    // And the guarantee that matters: a fresh body's failure still carries the
    // field's own copy, which a union would have thrown away.
    const parsed = scanSchema.safeParse({
      vacancyText: 'x'.repeat(20_001),
      resumeSource: 'career_base',
      sourceResumeText: null,
      resumeVersionId: null,
    });
    assert.equal(parsed.error.issues[0].message, VACANCY_LENGTH);
  });
});

describe('parsedVacancySchema — P1 output', () => {
  test('a full parse survives unchanged', () => {
    const parsed = parsedVacancySchema.safeParse({
      title: 'AI Quality Analyst',
      company: 'DataMinds GmbH',
      requirements: [{ text: 'LLM evaluation', kind: 'must', keyword: 'LLM evaluation' }],
      keywords: ['LLM evaluation', 'Docker'],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.requirements.length, 1);
  });

  test('missing arrays are an empty parse, not a burnt repair retry', () => {
    const parsed = parsedVacancySchema.safeParse({ title: 'Analyst', company: null });
    assert.equal(parsed.success, true);
    assert.deepEqual(parsed.data.requirements, []);
    assert.deepEqual(parsed.data.keywords, []);
  });

  test('a blank company becomes null rather than an empty chip', () => {
    const parsed = parsedVacancySchema.safeParse({ title: 'Analyst', company: '   ' });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.company, null);
  });

  test('keywords are deduplicated case-insensitively, first spelling wins', () => {
    const parsed = parsedVacancySchema.safeParse({
      title: 't',
      company: null,
      keywords: ['Docker', 'docker', ' Docker ', '', 'Python'],
    });
    assert.deepEqual(parsed.data.keywords, ['Docker', 'Python']);
  });

  test('an unknown requirement kind is refused — the enum is load-bearing', () => {
    const parsed = parsedVacancySchema.safeParse({
      title: 't',
      company: null,
      requirements: [{ text: 'x', kind: 'essential', keyword: 'x' }],
    });
    assert.equal(parsed.success, false);
  });
});

describe('scanResumeText — the extracted-PDF bound', () => {
  test('text within the bound is untouched and reports no truncation', () => {
    const result = scanResumeText('short resume');
    assert.deepEqual(result, { text: 'short resume', truncated: false });
  });

  test('an over-long extraction is cut AND says so', () => {
    const result = scanResumeText('x'.repeat(MAX_SCAN_RESUME_CHARS + 500));
    assert.equal(result.text.length, MAX_SCAN_RESUME_CHARS);
    assert.equal(result.truncated, true, 'a silent cut would hide part of the resume');
  });
});

describe('patchApplicationSchema — Block D #8', () => {
  test('status alone, notes alone, and both are all valid edits', () => {
    assert.equal(patchApplicationSchema.safeParse({ status: 'applied' }).success, true);
    assert.equal(patchApplicationSchema.safeParse({ notes: 'called them' }).success, true);
    assert.equal(
      patchApplicationSchema.safeParse({ status: 'offer', notes: 'signed' }).success,
      true,
    );
  });

  test('clearing the notes is a real edit', () => {
    assert.equal(patchApplicationSchema.safeParse({ notes: '' }).success, true);
  });

  test('an empty body is refused — a no-op must not answer 200', () => {
    assert.equal(patchApplicationSchema.safeParse({}).success, false);
  });

  test('notes over 2,000 characters get the Block F copy', () => {
    const parsed = patchApplicationSchema.safeParse({ notes: 'x'.repeat(2001) });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error.issues[0].message, RESULT.notesTooLong);
  });

  test('a status outside the enum is refused', () => {
    assert.equal(patchApplicationSchema.safeParse({ status: 'ghosted' }).success, false);
  });
});
