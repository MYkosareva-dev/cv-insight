import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { exportFilename } from '../../src/lib/utils.ts';

/**
 * `exportFilename` lives in `lib/utils.ts`, not `lib/docx.ts`: docx.ts is
 * `server-only` and would throw on import here. A guard that exists to keep a
 * SECRET out of the browser should not also be what makes a pure function
 * untestable, so the pure part moved and docx.ts re-exports it.
 */

describe('exportFilename', () => {
  test('joins the three parts, spaces to underscores', () => {
    assert.equal(
      exportFilename({
        name: 'Mira Steinberg',
        company: 'DataMinds GmbH',
        role: 'AI Quality Analyst',
      }),
      'CV_Mira_Steinberg_DataMinds_GmbH_AI_Quality_Analyst.docx',
    );
  });

  test('keeps unicode letters — the bug this replaced deleted them', () => {
    assert.equal(
      exportFilename({ name: 'Jürgen Müller', company: null, role: null }),
      'CV_Jürgen_Müller.docx',
    );
    assert.equal(
      exportFilename({ name: 'Мария Косарева', company: null, role: 'Аналитик' }),
      'CV_Мария_Косарева_Аналитик.docx',
    );
    assert.equal(
      exportFilename({ name: '田中 太郎', company: 'ソニー', role: null }),
      'CV_田中_太郎_ソニー.docx',
    );
  });

  test('strips filesystem-unsafe characters but not ordinary punctuation', () => {
    assert.equal(
      exportFilename({ name: 'A/B: "T"<x>', company: 'Foo|Bar?', role: 'C++ Dev*' }),
      'CV_AB_Tx_FooBar_C++_Dev.docx',
    );
  });

  test('drops parts that slug to nothing, rather than emitting empty segments', () => {
    assert.equal(exportFilename({ name: '   ', company: null, role: null }), 'CV.docx');
    assert.equal(
      exportFilename({ name: 'Mira', company: '???', role: null }),
      'CV_Mira.docx',
      'a company of only unsafe characters must not leave a trailing separator',
    );
  });

  test('bounds each part so the filename stays within OS limits', () => {
    const long = exportFilename({ name: 'X'.repeat(200), company: null, role: null });
    assert.equal(long, `CV_${'X'.repeat(40)}.docx`);
  });
});
