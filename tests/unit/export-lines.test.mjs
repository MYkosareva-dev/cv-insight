import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { RESULT } from '../../src/lib/copy.ts';
import { exportLines, isHeading } from '../../src/lib/utils.ts';

/**
 * The paragraph model of the `.docx` export (SPEC v3.0, Block G G5). It lives in
 * `lib/utils.ts` for the same reason as `exportFilename`: `lib/docx.ts` is
 * `server-only` and would throw on import here.
 *
 * What is pinned: the AI-generated line is the LAST paragraph of every export,
 * exactly once, muted and never bold — appended by the export, so the text the
 * user edited is unchanged and the line cannot be edited out of the file.
 */

describe('exportLines', () => {
  test('the last paragraph is the AI-generated line, muted and not bold', () => {
    const lines = exportLines('JANE DOE\n\nSUMMARY\nBuilt things.');
    assert.deepEqual(lines.at(-1), { text: RESULT.aiGeneratedLine, bold: false, muted: true });
  });

  test('appended exactly once, after the user’s final line', () => {
    const lines = exportLines('SUMMARY\nBuilt things.');
    assert.deepEqual(
      lines.map((line) => line.text),
      ['SUMMARY', 'Built things.', RESULT.aiGeneratedLine],
    );
    assert.equal(lines.filter((line) => line.text === RESULT.aiGeneratedLine).length, 1);
  });

  test('trailing blank lines are kept, and the AI line still comes last', () => {
    const lines = exportLines('Built things.\r\n\r\n');
    assert.deepEqual(
      lines.map((line) => line.text),
      ['Built things.', '', '', RESULT.aiGeneratedLine],
    );
  });

  test('the user’s lines are not muted, and headings are bolded by shape', () => {
    const [heading, body] = exportLines('EXPERIENCE\nShipped a parser.');
    assert.deepEqual(heading, { text: 'EXPERIENCE', bold: true, muted: false });
    assert.deepEqual(body, { text: 'Shipped a parser.', bold: false, muted: false });
  });

  test('the input string is not modified', () => {
    const content = 'SUMMARY\nBuilt things.';
    const before = content.slice();
    exportLines(content);
    assert.equal(content, before);
    assert.ok(!content.includes(RESULT.aiGeneratedLine));
  });

  test('the AI-generated line is never taken for a heading', () => {
    assert.equal(isHeading(RESULT.aiGeneratedLine), false);
  });
});

describe('isHeading', () => {
  test('a short all-caps line is a heading', () => {
    assert.equal(isHeading('SKILLS'), true);
  });

  test('contact-shaped lines are not, whatever their case', () => {
    assert.equal(isHeading('HAMBURG, GERMANY · OPEN TO REMOTE'), false);
    assert.equal(isHeading('JANE@EXAMPLE.COM'), false);
    assert.equal(isHeading('HTTPS://EXAMPLE.COM'), false);
  });

  test('blank, mixed-case and over-long lines are not', () => {
    assert.equal(isHeading(''), false);
    assert.equal(isHeading('Experience'), false);
    assert.equal(isHeading('A'.repeat(41)), false);
    assert.equal(isHeading('2020 — 2024'), false);
  });
});
