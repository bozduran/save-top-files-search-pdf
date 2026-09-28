import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPages, rankNameMatches, MAX_MATCHES_PER_FILE } from './textMatch.ts';

const pages = [
  'Invoice for ACME Robotics. Total 42 units.',
  'Appendix without the keyword. but INVOICE appears uppercase here.',
];
const lower = pages.map((page) => page.toLowerCase());

test('finds every occurrence across pages with page numbers', () => {
  const { matchCount, matches } = matchPages(pages, lower, 'invoice');
  assert.equal(matchCount, 2);
  assert.deepEqual(matches.map((match) => match.page), [1, 2]);
});

test('ordinals count occurrences within a single page', () => {
  const multi = ['invoice invoice', 'x'];
  const { matches } = matchPages(multi, multi.map((page) => page.toLowerCase()), 'invoice');
  assert.deepEqual(matches.map((match) => match.ordinal), [1, 2]);
});

test('matching is case-insensitive in both directions', () => {
  assert.equal(matchPages(pages, lower, 'InVoIcE').matchCount, 2);
  assert.equal(matchPages(pages, lower, 'robotics').matchCount, 1);
});

test('the excerpt offset points at the matched text', () => {
  const { matches } = matchPages(pages, lower, 'robotics');
  const first = matches[0];
  const sliced = first.excerpt.slice(first.offset, first.offset + first.length).toLowerCase();
  assert.equal(sliced, 'robotics');
});

test('the offset survives whitespace collapsing', () => {
  const messy = ['total    42\n\n units   invoice   now'];
  const { matches } = matchPages(messy, messy.map((page) => page.toLowerCase()), 'invoice');
  const match = matches[0];
  assert.equal(match.excerpt.slice(match.offset, match.offset + match.length).toLowerCase(), 'invoice');
});

test('long excerpts are trimmed with ellipses on both sides', () => {
  const long = [`${'a'.repeat(200)}needle${'b'.repeat(200)}`];
  const { matches } = matchPages(long, long.map((page) => page.toLowerCase()), 'needle');
  assert.ok(matches[0].excerpt.startsWith('…'));
  assert.ok(matches[0].excerpt.endsWith('…'));
  assert.equal(matches[0].excerpt.slice(matches[0].offset, matches[0].offset + 6), 'needle');
});

test('stored matches are capped while the true count is preserved', () => {
  const many = ['x '.repeat(300)];
  const { matches, matchCount } = matchPages(many, many.map((page) => page.toLowerCase()), 'x', 5);
  assert.equal(matches.length, 5);
  assert.equal(matchCount, 300);
});

test('the default cap is applied when none is supplied', () => {
  const many = ['x '.repeat(500)];
  const { matches } = matchPages(many, many.map((page) => page.toLowerCase()), 'x');
  assert.equal(matches.length, MAX_MATCHES_PER_FILE);
});

test('an empty query matches nothing', () => {
  assert.equal(matchPages(pages, lower, '').matchCount, 0);
  assert.deepEqual(matchPages(pages, lower, '').matches, []);
});

test('name hits outrank path-only hits', () => {
  const files = [
    { name: 'notes.txt', relativePath: 'reports/invoice/notes.txt' },
    { name: 'invoice-2024.pdf', relativePath: 'a/invoice-2024.pdf' },
    { name: 'other.pdf', relativePath: 'z/other.pdf' },
  ];
  assert.deepEqual(
    rankNameMatches(files, 'invoice').map((file) => file.name),
    ['invoice-2024.pdf', 'notes.txt']
  );
});

test('an earlier position in the name ranks higher', () => {
  const files = [{ name: 'xxinvoice.pdf' }, { name: 'invoice-xx.pdf' }];
  assert.equal(rankNameMatches(files, 'invoice')[0].name, 'invoice-xx.pdf');
});

test('non-matching files are dropped and the input is untouched', () => {
  const files = [{ name: 'a.pdf' }];
  assert.deepEqual(rankNameMatches(files, 'zzz'), []);
  assert.deepEqual(rankNameMatches(files, ''), []);
  assert.equal(files.length, 1);
});

test('ranking is stable for identical scores', () => {
  const files = [{ name: 'b-invoice.pdf' }, { name: 'a-invoice.pdf' }];
  assert.deepEqual(
    rankNameMatches(files, 'invoice').map((file) => file.name),
    ['a-invoice.pdf', 'b-invoice.pdf']
  );
});
