import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { IMPRESSUM, IMPRESSUM_FILLED } from '../../src/lib/copy.ts';

/**
 * THE SWITCH AND ITS VALUES SHIP TOGETHER (SPEC Block E, /impressum).
 *
 * `IMPRESSUM_FILLED` exists so the page never renders an unfilled `[[...]]`
 * token at a reader as though it were an identity. With the switch true, every
 * value the filled branch renders must be real — a placeholder email would be
 * a `mailto:` link to nobody on the page whose only job is to say who is
 * accountable.
 *
 * `[[` and not a bare `[`: the postal-address slot is a MARKED placeholder in
 * single brackets on purpose, and is the honest state the page states.
 */

describe('Impressum', () => {
  test('no unfilled [[...]] token renders while IMPRESSUM_FILLED is true', () => {
    if (!IMPRESSUM_FILLED) return;
    for (const [key, value] of Object.entries(IMPRESSUM)) {
      if (key === 'unfilled') continue; // rendered only while the switch is false
      assert.ok(!value.includes('[['), `IMPRESSUM.${key} still carries a placeholder`);
    }
  });

  test('the address slot is a marked placeholder, never an invented street', () => {
    assert.match(IMPRESSUM.addressPlaceholder, /^\[ placeholder/);
  });
});
