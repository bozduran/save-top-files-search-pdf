import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeScan,
  planReindex,
  pruneMissing,
  rankOpenStats,
  recordOpenStat,
  type OpenStat,
  type ReindexPolicy,
} from './recents.ts';

const NOW = Date.UTC(2026, 0, 20);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const stat = (overrides: Partial<OpenStat> & { path: string }): OpenStat => ({
  name: overrides.path.split('/').pop() ?? overrides.path,
  count: 1,
  lastOpened: NOW,
  inProject: true,
  ...overrides,
});

test('frequency ranking ignores recency', () => {
  const stats = [
    stat({ path: 'a', count: 2, lastOpened: NOW }),
    stat({ path: 'b', count: 50, lastOpened: NOW - 300 * DAY }),
  ];
  const ranked = rankOpenStats(stats, { strategy: 'frequency', limit: 10, now: NOW });
  assert.deepEqual(ranked.map((row) => row.path), ['b', 'a']);
});

test('recent ranking ignores frequency', () => {
  const stats = [
    stat({ path: 'a', count: 2, lastOpened: NOW - HOUR }),
    stat({ path: 'b', count: 90, lastOpened: NOW - 40 * DAY }),
  ];
  const ranked = rankOpenStats(stats, { strategy: 'recent', limit: 10, now: NOW });
  assert.deepEqual(ranked.map((row) => row.path), ['a', 'b']);
});

test('hybrid ranking prefers a frequently used, recently touched file', () => {
  const stats = [
    stat({ path: 'daily', count: 30, lastOpened: NOW - 2 * HOUR }),
    stat({ path: 'stale', count: 30, lastOpened: NOW - 400 * DAY }),
    stat({ path: 'fresh-once', count: 1, lastOpened: NOW }),
  ];
  const ranked = rankOpenStats(stats, { strategy: 'hybrid', limit: 10, now: NOW });
  assert.equal(ranked[0].path, 'daily');
  const freshIndex = ranked.findIndex((row) => row.path === 'fresh-once');
  const staleIndex = ranked.findIndex((row) => row.path === 'stale');
  assert.ok(freshIndex > 0, 'a single recent open must not beat a daily driver');
  // 30 old opens still beat one fresh open, but they lose to the daily driver.
  assert.ok(staleIndex > 0, 'the stale file must not beat the daily driver');
  assert.ok(staleIndex < freshIndex, 'long-term frequency must outweigh a single recent open');
});

test('projectOnly filters out files outside the workspace', () => {
  const stats = [
    stat({ path: 'in/a.pdf', inProject: true }),
    stat({ path: '/elsewhere/b.pdf', inProject: false }),
  ];
  assert.equal(rankOpenStats(stats, { strategy: 'hybrid', limit: 10, now: NOW, projectOnly: true }).length, 1);
  assert.equal(rankOpenStats(stats, { strategy: 'hybrid', limit: 10, now: NOW }).length, 2);
});

test('limit is applied and never zero', () => {
  const stats = Array.from({ length: 20 }, (_, i) => stat({ path: `f${i}`, count: i + 1 }));
  assert.equal(rankOpenStats(stats, { strategy: 'frequency', limit: 5, now: NOW }).length, 5);
  assert.equal(rankOpenStats(stats, { strategy: 'frequency', limit: 0, now: NOW }).length, 1);
});

test('ranking is deterministic for equal scores', () => {
  const stats = [
    stat({ path: 'b.txt', count: 1, lastOpened: NOW }),
    stat({ path: 'a.txt', count: 1, lastOpened: NOW }),
  ];
  const ranked = rankOpenStats(stats, { strategy: 'hybrid', limit: 10, now: NOW });
  assert.deepEqual(ranked.map((row) => row.name), ['a.txt', 'b.txt']);
});

test('recordOpenStat increments, timestamps and does not mutate the input', () => {
  const original = [stat({ path: '/p/a.pdf', count: 3, lastOpened: NOW - DAY })];
  const next = recordOpenStat(original, { path: '/p/a.pdf', name: 'a.pdf', inProject: true }, { now: NOW });
  assert.equal(original[0].count, 3, 'input array must not be mutated');
  assert.equal(next[0].count, 4);
  assert.equal(next[0].lastOpened, NOW);
});

test('recordOpenStat adds unknown files and matches paths case-insensitively', () => {
  const next = recordOpenStat(
    [stat({ path: 'C:\\Docs\\A.PDF', count: 1 })],
    { path: 'c:/docs/a.pdf', name: 'a.pdf', inProject: true },
    { now: NOW }
  );
  assert.equal(next.length, 1);
  assert.equal(next[0].count, 2);
});

test('recordOpenStat trims history to the cap, keeping the newest', () => {
  let stats: OpenStat[] = [];
  for (let i = 0; i < 10; i += 1) {
    stats = recordOpenStat(stats, { path: `f${i}`, name: `f${i}`, inProject: true }, { now: NOW + i, cap: 3 });
  }
  assert.equal(stats.length, 3);
  assert.deepEqual(stats.map((row) => row.path), ['f9', 'f8', 'f7']);
});

test('pruneMissing removes vanished files from every collection', () => {
  const value = {
    recents: [stat({ path: '/keep/a.pdf' }), stat({ path: '/gone/b.pdf' })],
    external: [{ path: '/keep/ext.pdf' }, { path: '/gone/ext.pdf' }],
    groups: [{ files: [{ path: '/keep/g.pdf' }, { path: '/gone/g.pdf' }] }],
  };
  const result = pruneMissing(value, (path) => path.startsWith('/keep'));
  assert.equal(result.removed, 3);
  assert.deepEqual(result.value.recents.map((row) => row.path), ['/keep/a.pdf']);
  assert.deepEqual(result.value.external.map((file) => file.path), ['/keep/ext.pdf']);
  assert.deepEqual(result.value.groups[0].files.map((file) => file.path), ['/keep/g.pdf']);
});

test('pruneMissing reports nothing removed when everything exists', () => {
  const value = { recents: [stat({ path: '/a' })], external: [], groups: [] };
  const result = pruneMissing(value, () => true);
  assert.equal(result.removed, 0);
  assert.equal(result.value.recents.length, 1);
});

const policy = (overrides: Partial<ReindexPolicy> = {}): ReindexPolicy => ({
  trigger: 'onViewOpen',
  debounceMs: 1500,
  maxDelayMs: 10_000,
  ...overrides,
});

test('an explicit request always indexes immediately', () => {
  assert.deepEqual(planReindex(policy(), 'explicit', NOW, 0), { runNow: true, delayMs: 0 });
});

test('a change is debounced instead of triggering per keystroke', () => {
  const plan = planReindex(policy(), 'change', NOW, NOW);
  assert.equal(plan.runNow, false);
  assert.equal(plan.delayMs, 1500);
});

test('a change that has waited out the debounce runs immediately', () => {
  const plan = planReindex(policy(), 'change', NOW, NOW - 2000);
  assert.deepEqual(plan, { runNow: true, delayMs: 0 });
});

test('a steady stream of changes cannot postpone indexing past maxDelayMs', () => {
  const plan = planReindex(policy({ debounceMs: 5000, maxDelayMs: 8000 }), 'change', NOW, NOW - 9000);
  assert.deepEqual(plan, { runNow: true, delayMs: 0 });
});

test('viewOpen honours the trigger policy', () => {
  assert.equal(planReindex(policy({ trigger: 'onViewOpen' }), 'viewOpen', NOW, 0).runNow, true);
  assert.equal(planReindex(policy({ trigger: 'onDemand' }), 'viewOpen', NOW, 0).runNow, false);
  assert.equal(planReindex(policy({ trigger: 'onStartup' }), 'viewOpen', NOW, 0).runNow, true);
});

test('startup only indexes when the user opted in', () => {
  assert.equal(planReindex(policy({ trigger: 'onStartup' }), 'startup', NOW, 0).runNow, true);
  assert.equal(planReindex(policy({ trigger: 'onViewOpen' }), 'startup', NOW, 0).runNow, false);
  assert.equal(planReindex(policy({ trigger: 'onDemand' }), 'startup', NOW, 0).runNow, false);
});

test('describeScan explains a no-op scan', () => {
  assert.equal(describeScan(12, 0, 0), 'Nothing to index — 12 PDF(s) already cached');
});

test('describeScan reports changed count and size', () => {
  const message = describeScan(10, 3, 5 * 1024 * 1024);
  assert.ok(message.includes('3 PDF(s) need indexing'));
  assert.ok(message.includes('5.0 MB'));
  assert.ok(message.includes('10 unchanged'));
});
