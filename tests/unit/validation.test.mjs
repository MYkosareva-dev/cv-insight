import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { AUTH } from '../../src/lib/copy.ts';
import { credentialsSchema, fieldErrorsOf } from '../../src/lib/validation.ts';

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
