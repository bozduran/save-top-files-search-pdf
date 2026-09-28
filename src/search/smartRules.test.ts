import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRule,
  describeRule,
  evaluateRule,
  filterByRule,
  validateRule,
  type RuleCandidate,
  type SmartRule,
} from './smartRules.ts';
import { matchesGlob } from './glob.ts';

const NOW = Date.UTC(2026, 0, 20);
const DAY = 24 * 60 * 60 * 1000;

const candidate = (overrides: Partial<RuleCandidate> & { relativePath: string }): RuleCandidate => {
  const name = overrides.relativePath.split('/').pop() ?? overrides.relativePath;
  return { name, ...overrides };
};

/**
 * Builds a rule for a test. When `overrides.conditions` is supplied it replaces
 * the first argument (mirroring how the builder command edits a rule wholesale).
 */
const rule = (conditions: SmartRule['conditions'], overrides: Partial<SmartRule> = {}): SmartRule =>
  createRule(overrides.name ?? 'Test', overrides.conditions ?? conditions, {
    ...overrides,
    conditions: undefined,
  });

test('a glob rule selects only matching files', () => {
  const r = rule({ includeGlobs: ['*.pdf'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'docs/a.pdf' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'docs/a.md' }), NOW).matched, false);
});

test('multiple globs are alternatives, not all-required', () => {
  const r = rule({ includeGlobs: ['*.pdf', '*.md'] });
  assert.equal(filterByRule(r, [
    candidate({ relativePath: 'a.pdf' }),
    candidate({ relativePath: 'b.md' }),
    candidate({ relativePath: 'c.png' }),
  ], NOW).length, 2);
});

test('exclusions always veto a match', () => {
  const r = rule({ includeGlobs: ['*.pdf'], excludeGlobs: ['**/draft-*'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'in/draft-x.pdf' }), NOW).matched, false);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'in/final-x.pdf' }), NOW).matched, true);
});

test('mode "all" requires every positive condition', () => {
  const r = rule({ includeGlobs: ['*.pdf'], extensions: ['pdf'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.pdf' }), NOW).matched, true);
});

test('mode "any" accepts a single positive condition', () => {
  const r = rule({ includeGlobs: ['*.pdf'], includeRegex: '^docs/' }, { matchMode: 'any' });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'docs/a.txt' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'src/a.pdf' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'src/a.txt' }), NOW).matched, false);
});

test('globOrRegex collapses the two patterns into one either/or condition', () => {
  const all = rule({ includeGlobs: ['*.pdf'], includeRegex: '^notes/' }, { matchMode: 'all' });
  const either = rule(
    { includeGlobs: ['*.pdf'], includeRegex: '^notes/' },
    { matchMode: 'all', conditions: { includeGlobs: ['*.pdf'], includeRegex: '^notes/', globOrRegex: true } }
  );
  const file = candidate({ relativePath: 'notes/a.txt' });
  assert.equal(evaluateRule(all, file, NOW).matched, false);
  assert.equal(evaluateRule(either, file, NOW).matched, true);
});

test('extension filtering accepts entries with or without a leading dot', () => {
  const r = rule({ extensions: ['.PDF', 'md'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.pdf' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.PDF' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.md' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.txt' }), NOW).matched, false);
});

test('a file with no extension never matches an extension filter', () => {
  const r = rule({ extensions: ['pdf'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'Makefile' }), NOW).matched, false);
});

test('size filters use kilobytes and are inclusive', () => {
  const r = rule({ minSizeKb: 10, maxSizeKb: 20 });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.pdf', sizeBytes: 10 * 1024 }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'b.pdf', sizeBytes: 20 * 1024 }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'c.pdf', sizeBytes: 21 * 1024 }), NOW).matched, false);
});

test('recency filters compare against the supplied clock', () => {
  const r = rule({ modifiedWithinDays: 7 });
  const fresh = candidate({ relativePath: 'f.pdf', modifiedMs: NOW - 2 * DAY });
  const stale = candidate({ relativePath: 's.pdf', modifiedMs: NOW - 30 * DAY });
  assert.equal(evaluateRule(r, fresh, NOW).matched, true);
  assert.equal(evaluateRule(r, stale, NOW).matched, false);
  // A file with a future timestamp is not "recent".
  const future = candidate({ relativePath: 'x.pdf', modifiedMs: NOW + DAY });
  assert.equal(evaluateRule(r, future, NOW).matched, false);
});

test('a rule with only exclusions matches everything else', () => {
  const r = rule({ excludeGlobs: ['**/node_modules/**'] });
  assert.equal(evaluateRule(r, candidate({ relativePath: 'src/a.ts' }), NOW).matched, true);
  assert.equal(evaluateRule(r, candidate({ relativePath: 'node_modules/a.ts' }), NOW).matched, false);
});

test('reasons explain a match and misses explain a rejection', () => {
  const r = rule({ includeGlobs: ['*.pdf'], extensions: ['pdf'] });
  const hit = evaluateRule(r, candidate({ relativePath: 'docs/a.pdf' }), NOW);
  assert.equal(hit.matched, true);
  assert.equal(hit.misses.length, 0);
  assert.ok(hit.reasons.some((reason) => reason.includes('*.pdf')));
  assert.ok(hit.reasons.some((reason) => reason.includes('.pdf')));

  const miss = evaluateRule(r, candidate({ relativePath: 'docs/a.txt' }), NOW);
  assert.equal(miss.matched, false);
  assert.equal(miss.reasons.length, 0);
  assert.ok(miss.misses.length >= 1);
});

test('disabled rules are reported by validateRule only when broken, not excluded here', () => {
  const r = rule({ includeGlobs: ['*.pdf'] }, { enabled: false });
  // evaluateRule is policy-free; callers decide whether to skip disabled rules.
  assert.equal(evaluateRule(r, candidate({ relativePath: 'a.pdf' }), NOW).matched, true);
});

test('describeRule produces a readable summary', () => {
  const summary = describeRule(rule({ includeGlobs: ['*.pdf', 'docs/**'], excludeGlobs: ['**/draft*'] }));
  assert.ok(summary.includes('*.pdf'));
  assert.ok(summary.includes('docs/**'));
  assert.ok(summary.includes('except'));
  assert.equal(describeRule(rule({})).startsWith('everything'), true);
});

test('describeRule mentions size and recency windows', () => {
  const summary = describeRule(rule({ minSizeKb: 5, maxSizeKb: 50, modifiedWithinDays: 30 }));
  assert.ok(summary.includes('5–50 KB'));
  assert.ok(summary.includes('30d'));
});

test('validateRule rejects empty names, empty conditions and bad regexes', () => {
  assert.deepEqual(validateRule(rule({ includeGlobs: ['*.pdf'] }, { name: '  ' })), [
    'A name is required.',
  ]);
  const noConditions = validateRule(rule({}));
  assert.equal(noConditions.length, 1);
  assert.ok(noConditions[0].includes('at least one condition'));

  const badRegex = validateRule(rule({ includeRegex: '([' }));
  assert.ok(badRegex.some((problem) => problem.includes('not valid')));

  const badRange = validateRule(rule({ minSizeKb: 100, maxSizeKb: 10 }));
  assert.ok(badRange.some((problem) => problem.includes('larger than the maximum')));

  const badWindow = validateRule(rule({ includeGlobs: ['*.pdf'], modifiedWithinDays: 0 }));
  assert.ok(badWindow.some((problem) => problem.includes('at least one day')));

  const badClass = validateRule(rule({ includeGlobs: ['a[bc'] }));
  assert.ok(badClass.some((problem) => problem.includes('unclosed character class')));
});

test('a realistic "recent invoices" rule behaves as expected', () => {
  const r = rule(
    {
      includeGlobs: ['**/invoice-*', '**/Invoice_*'],
      excludeGlobs: ['**/archive/**'],
      extensions: ['pdf'],
      modifiedWithinDays: 30,
    },
    { name: 'Recent invoices', matchMode: 'all' }
  );

  const files = [
    candidate({ relativePath: 'finance/invoice-2026-01.pdf', modifiedMs: NOW - DAY, sizeBytes: 5000 }),
    candidate({ relativePath: 'finance/2025/invoice-2025-12.pdf', modifiedMs: NOW - 60 * DAY, sizeBytes: 5000 }),
    candidate({ relativePath: 'finance/archive/invoice-2020-01.pdf', modifiedMs: NOW - DAY, sizeBytes: 5000 }),
    candidate({ relativePath: 'finance/notes.pdf', modifiedMs: NOW - DAY, sizeBytes: 5000 }),
  ];
  const matched = filterByRule(r, files, NOW).map((file) => file.relativePath);
  assert.deepEqual(matched, ['finance/invoice-2026-01.pdf']);
});

test('rule evaluation stays fast across a large corpus', () => {
  const r = rule({ includeGlobs: ['**/*.pdf'], extensions: ['pdf'], excludeGlobs: ['**/node_modules/**'] });
  const files: RuleCandidate[] = [];
  for (let i = 0; i < 5000; i += 1) {
    files.push(candidate({ relativePath: `pkg-${i % 50}/dir/file-${i}.pdf` }));
  }
  const started = Date.now();
  const matched = filterByRule(r, files, NOW);
  const elapsed = Date.now() - started;
  assert.equal(matched.length, files.length);
  assert.ok(elapsed < 3000, `evaluating 5000 files took ${elapsed}ms`);
  assert.equal(matchesGlob('**/*.pdf', 'pkg-1/dir/file-1.pdf'), true);
});
