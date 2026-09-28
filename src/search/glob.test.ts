import test from 'node:test';
import assert from 'node:assert/strict';
import { expandBraces, matchesGlob, matchesRegex, normalizePath } from './glob.ts';

test('an asterisk does not cross path separators', () => {
  assert.equal(matchesGlob('*.pdf', 'report.pdf'), true);
  assert.equal(matchesGlob('docs/*.pdf', 'docs/report.pdf'), true);
  assert.equal(matchesGlob('docs/*.pdf', 'docs/2024/report.pdf'), false);
});

test('a bare name pattern matches at any depth', () => {
  assert.equal(matchesGlob('*.pdf', 'a/b/c/deep.pdf'), true);
  assert.equal(matchesGlob('report*', 'a/b/report-final.md'), true);
  assert.equal(matchesGlob('report*', 'a/b/other.md'), false);
});

test('a double asterisk crosses directories', () => {
  assert.equal(matchesGlob('docs/**/*.pdf', 'docs/a/b/c.pdf'), true);
  // `**` as a whole segment also matches zero segments.
  assert.equal(matchesGlob('docs/**/*.pdf', 'docs/top.pdf'), true);
  assert.equal(matchesGlob('**/invoice*', 'a/b/invoice-2024.pdf'), true);
  assert.equal(matchesGlob('**/invoice*', 'invoice-2024.pdf'), true);
});

test('a trailing double asterisk matches a whole subtree', () => {
  assert.equal(matchesGlob('docs/**', 'docs/a/b/c.txt'), true);
  assert.equal(matchesGlob('docs/**', 'other/a.txt'), false);
});

test('question marks match a single character but not a separator', () => {
  assert.equal(matchesGlob('v?.pdf', 'v1.pdf'), true);
  assert.equal(matchesGlob('v?.pdf', 'v12.pdf'), false);
  assert.equal(matchesGlob('a/?/c.txt', 'a/b/c.txt'), true);
  assert.equal(matchesGlob('a/?/c.txt', 'a/x/y/c.txt'), false);
});

test('character classes and ranges work', () => {
  assert.equal(matchesGlob('v[12].pdf', 'v1.pdf'), true);
  assert.equal(matchesGlob('v[12].pdf', 'v3.pdf'), false);
  assert.equal(matchesGlob('report-[0-9][0-9].pdf', 'report-42.pdf'), true);
  assert.equal(matchesGlob('report-[0-9][0-9].pdf', 'report-x2.pdf'), false);
  assert.equal(matchesGlob('v[!0-9].pdf', 'va.pdf'), true);
  assert.equal(matchesGlob('v[!0-9].pdf', 'v1.pdf'), false);
});

test('braces expand into alternatives, including nesting', () => {
  assert.deepEqual(expandBraces('a.{b,c}').sort(), ['a.b', 'a.c']);
  assert.deepEqual(expandBraces('{x,{y,z}}.pdf').sort(), ['x.pdf', 'y.pdf', 'z.pdf']);
  assert.equal(matchesGlob('*.{pdf,md}', 'notes/deep/readme.md'), true);
  assert.equal(matchesGlob('*.{pdf,md}', 'notes/deep/image.png'), false);
});

test('matching ignores case by default and honours the flag', () => {
  assert.equal(matchesGlob('*.PDF', 'Report.pdf'), true);
  assert.equal(matchesGlob('*.PDF', 'Report.pdf', false), false);
  assert.equal(matchesGlob('report*', 'REPORT.md', false), false);
});

test('windows separators and leading dot-slash are normalized', () => {
  assert.equal(normalizePath('docs\\a\\b.pdf'), 'docs/a/b.pdf');
  assert.equal(normalizePath('./docs/a.pdf'), 'docs/a.pdf');
  assert.equal(matchesGlob('docs/*.pdf', 'docs\\sub\\x.pdf'), false);
  assert.equal(matchesGlob('docs/**/*.pdf', 'docs\\sub\\x.pdf'), true);
});

test('patterns with special regex characters are literal', () => {
  assert.equal(matchesGlob('a+b(1).pdf', 'a+b(1).pdf'), true);
  assert.equal(matchesGlob('a+b(1).pdf', 'aab1.pdf'), false);
  assert.equal(matchesGlob('file?.txt', 'file?.txt'.replace('?', '?')), true);
  assert.equal(matchesGlob('v1.0*.txt', 'v1.02.txt'), true);
});

test('an unclosed character class is treated literally', () => {
  assert.equal(matchesGlob('a[bc', 'a[bc'), true);
  assert.equal(matchesGlob('a[bc', 'ab'), false);
});

test('regex matching is validated and reported', () => {
  assert.equal(matchesRegex('^docs/.*\\.pdf$', 'docs/a.pdf'), true);
  assert.equal(matchesRegex('^docs/.*\\.pdf$', 'src/a.pdf'), false);
  assert.equal(matchesRegex('^DOCS/', 'docs/a.pdf'), true);
  assert.equal(matchesRegex('^DOCS/', 'docs/a.pdf', false), false);
  assert.equal(matchesRegex('([', 'anything'), false);
});

test('deeply nested and long paths resolve without pathological slowdown', () => {
  const deep = `${'segment/'.repeat(60)}file.pdf`;
  assert.equal(matchesGlob('**/file.pdf', deep), true);
  assert.equal(matchesGlob('**/*.pdf', deep), true);
  assert.equal(matchesGlob('**/*.txt', deep), false);
});
