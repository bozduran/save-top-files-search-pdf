import test from 'node:test';
import assert from 'node:assert/strict';
import { SmartGroupsProvider } from './smartGroupsProvider.ts';
import { StoreCore, type KeyValueStore } from '../../storeCore.ts';
import type { FileRef } from '../../types.ts';

const NOW = Date.UTC(2026, 0, 20);

function memoryMemento(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

function harness(files: FileRef[], metadata: Record<string, { sizeBytes: number; modifiedMs: number }> = {}) {
  const store = new StoreCore({
    workspaceState: memoryMemento(),
    globalState: memoryMemento(),
    config: <T>(_key: string, fallback: T) => fallback,
    emitter: { fire: () => undefined, dispose: () => undefined },
    now: () => NOW,
  });
  const provider = new SmartGroupsProvider(store, () => files, {
    now: () => NOW,
    statFile: async (path) => metadata[path],
  });
  return { store, provider };
}

const file = (relativePath: string): FileRef => ({
  path: `/w/${relativePath}`,
  name: relativePath.split('/').pop() ?? relativePath,
  relativePath,
});

test('no smart groups means no section at all', async () => {
  const { provider } = harness([file('a.pdf')]);
  assert.deepEqual(await provider.getSections(), []);
});

test('a rule collects only the files it matches', async () => {
  const { store, provider } = harness([file('finance/invoice-1.pdf'), file('finance/notes.pdf')]);
  store.createSmartGroup('Invoices', { includeGlobs: ['**/invoice-*'] });

  const sections = await provider.getSections();
  assert.equal(sections.length, 1);
  const group = sections[0].groups?.[0];
  assert.equal(group?.title, 'Invoices');
  assert.deepEqual(group?.items.map((item) => item.file.name), ['invoice-1.pdf']);
  assert.ok(group?.hint?.includes('invoice'), 'the rule description should be shown');
});

test('an extension rule collects every matching file type', async () => {
  const { store, provider } = harness([file('a.pdf'), file('b.PDF'), file('c.md'), file('Makefile')]);
  store.createSmartGroup('PDFs', { extensions: ['pdf'] });
  const group = (await provider.getSections())[0].groups?.[0];
  assert.deepEqual(group?.items.map((item) => item.file.name).sort(), ['a.pdf', 'b.PDF']);
});

test('exclusions veto matches inside a live collection', async () => {
  const { store, provider } = harness([file('keep/a.pdf'), file('archive/b.pdf')]);
  store.createSmartGroup('Live', { extensions: ['pdf'], excludeGlobs: ['**/archive/**'] });
  const group = (await provider.getSections())[0].groups?.[0];
  assert.deepEqual(group?.items.map((item) => item.file.name), ['a.pdf']);
});

test('size and recency rules use file metadata', async () => {
  const files = [file('big.pdf'), file('small.pdf'), file('old.pdf')];
  const metadata = {
    '/w/big.pdf': { sizeBytes: 500 * 1024, modifiedMs: NOW },
    '/w/small.pdf': { sizeBytes: 1024, modifiedMs: NOW },
    '/w/old.pdf': { sizeBytes: 500 * 1024, modifiedMs: NOW - 90 * 24 * 3600 * 1000 },
  };
  const { store, provider } = harness(files, metadata);

  store.createSmartGroup('Large', { minSizeKb: 100 });
  store.createSmartGroup('Recent', { modifiedWithinDays: 7 });

  const sections = await provider.getSections();
  const byTitle = (title: string) => sections[0].groups?.find((group) => group.title === title);
  assert.deepEqual(byTitle('Large')?.items.map((item) => item.file.name), ['big.pdf', 'old.pdf']);
  assert.deepEqual(byTitle('Recent')?.items.map((item) => item.file.name), ['big.pdf', 'small.pdf']);
});

test('a disabled rule produces no group', async () => {
  const { store, provider } = harness([file('a.pdf')]);
  const rule = store.createSmartGroup('PDFs', { extensions: ['pdf'] });
  store.updateSmartGroup(rule.id, { enabled: false });
  const sections = await provider.getSections();
  assert.deepEqual(sections[0].groups, []);
});

test('an invalid rule explains itself instead of silently matching everything', async () => {
  const { store, provider } = harness([file('a.pdf')]);
  store.createSmartGroup('Broken', { includeRegex: '([' });
  const group = (await provider.getSections())[0].groups?.[0];
  assert.ok(group?.hint?.includes('needs attention'), `hint was "${group?.hint}"`);
});

test('mode "any" collects the union of conditions', async () => {
  const { store, provider } = harness([file('a.pdf'), file('notes/b.md'), file('c.txt')]);
  store.createSmartGroup('Mixed', { includeGlobs: ['**/b.md'], extensions: ['pdf'] }, { matchMode: 'any' });
  const group = (await provider.getSections())[0].groups?.[0];
  assert.deepEqual(group?.items.map((item) => item.file.name).sort(), ['a.pdf', 'b.md']);
});

test('many files are stat-ed once and evaluated quickly', async () => {
  const files = Array.from({ length: 400 }, (_, i) => file(`dir/f${i}.pdf`));
  const metadata = Object.fromEntries(
    files.map((entry) => [entry.path, { sizeBytes: 2048, modifiedMs: NOW }])
  );
  const { store, provider } = harness(files, metadata);
  store.createSmartGroup('PDFs', { extensions: ['pdf'], maxSizeKb: 100 });

  const started = Date.now();
  const group = (await provider.getSections())[0].groups?.[0];
  assert.equal(group?.items.length, 400);
  assert.ok(Date.now() - started < 3000, 'evaluating 400 files should be fast');
});
