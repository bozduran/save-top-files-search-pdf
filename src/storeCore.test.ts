import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreCore, normalizeKey, type KeyValueStore } from './storeCore.ts';
import { emptyState, STATE_VERSION, type PersistedState } from './types.ts';
import type { FileRef } from './types.ts';

const NOW = Date.UTC(2026, 0, 20);

/** Minimal in-memory Memento double. */
function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const calls: string[] = [];
  const memento: KeyValueStore = {
    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      calls.push(key);
      data.set(key, value);
    },
  };
  return { memento, data, calls };
}

function harness(options: {
  workspace?: Record<string, unknown>;
  global?: Record<string, unknown>;
  config?: Record<string, unknown>;
  files?: string[];
} = {}) {
  const workspace = memoryStore(options.workspace);
  const global = memoryStore(options.global);
  const events: number[] = [];
  const scheduled: (() => void)[] = [];
  const existing = new Set(options.files ?? []);
  const config = options.config ?? {};

  const core = new StoreCore({
    workspaceState: workspace.memento,
    globalState: global.memento,
    config: <T>(key: string, fallback: T): T => (config[key] as T) ?? fallback,
    emitter: { fire: () => events.push(1), dispose: () => undefined },
    now: () => NOW,
    exists: (path) => existing.has(path),
    schedule: (callback) => scheduled.push(callback),
    cancelScheduled: () => scheduled.splice(0, scheduled.length),
    defaultGroupName: 'Favorites',
  });

  return { core, workspace, global, events, scheduled, existing };
}

const file = (path: string, name = path.split('/').pop() ?? path): FileRef => ({ path, name });

// ------------------------------------------------------------------ favorites

test('a favorite added with no groups creates the default group', () => {
  const { core } = harness();
  const group = core.addFavorite(file('/p/a.py'));
  assert.equal(group.name, 'Favorites');
  assert.equal(group.id, 'default');
  assert.deepEqual(core.getGroups()[0].files.map((entry) => entry.name), ['a.py']);
});

test('adding to a named group creates and reuses it', () => {
  const { core } = harness();
  const python = core.createGroup('Python');
  core.addFavorite(file('/p/a.py'), python.id);
  core.addFavorite(file('/p/b.py'), python.id);
  assert.equal(core.getGroup(python.id)?.files.length, 2);
  assert.equal(core.getGroups().length, 1, 'group must not be duplicated');
});

test('group names are unique case-insensitively', () => {
  const { core } = harness();
  const first = core.createGroup('Java');
  const second = core.createGroup('java');
  assert.equal(first.id, second.id);
  assert.equal(core.getGroups().length, 1);
});

test('a file moves between groups instead of being duplicated', () => {
  const { core } = harness();
  const python = core.createGroup('Python');
  const java = core.createGroup('Java');
  core.addFavorite(file('/p/a.py'), python.id);
  core.addFavorite(file('/p/a.py'), java.id);
  assert.equal(core.getGroup(python.id)?.files.length, 0);
  assert.equal(core.getGroup(java.id)?.files.length, 1);
});

test('path matching is case- and separator-insensitive', () => {
  const { core } = harness();
  core.addFavorite(file('C:\\Docs\\A.PDF'));
  assert.equal(core.isFavorite('c:/docs/a.pdf'), true);
  assert.equal(core.removeFavorite('c:/docs/a.pdf'), true);
  assert.equal(core.isFavorite('C:\\Docs\\A.PDF'), false);
  assert.equal(normalizeKey('C:\\Docs\\A.PDF\\'), 'c:/docs/a.pdf');
});

test('renaming and deleting groups behaves sanely', () => {
  const { core } = harness();
  const group = core.createGroup('Python');
  core.renameGroup(group.id, '  '); // blank keeps the old name
  assert.equal(core.getGroup(group.id)?.name, 'Python');
  core.renameGroup(group.id, 'Scripts');
  assert.equal(core.getGroup(group.id)?.name, 'Scripts');
  assert.equal(core.deleteGroup('nope'), undefined);
  core.deleteGroup(group.id);
  assert.equal(core.getGroups().length, 0);
});

test('removeFavorite reports whether anything changed', () => {
  const { core } = harness();
  core.addFavorite(file('/p/a.py'));
  assert.equal(core.removeFavorite('/p/a.py'), true);
  assert.equal(core.removeFavorite('/p/a.py'), false);
});

// ------------------------------------------------------------------- external

test('the external list is hard capped at ten by default', () => {
  const { core } = harness();
  for (let i = 0; i < 10; i += 1) {
    assert.equal(core.addExternal(file(`/out/f${i}.pdf`)), 'added');
  }
  assert.equal(core.addExternal(file('/out/extra.pdf')), 'full');
  assert.equal(core.getExternal().length, 10);
});

test('a configured cap below ten is honoured and clamped', () => {
  const small = harness({ config: { 'external.maxItems': 2 } });
  small.core.addExternal(file('/out/a.pdf'));
  small.core.addExternal(file('/out/b.pdf'));
  assert.equal(small.core.addExternal(file('/out/c.pdf')), 'full');

  const silly = harness({ config: { 'external.maxItems': 99 } });
  assert.equal(silly.core.externalMax, 10, 'the cap can never exceed ten');

  const zero = harness({ config: { 'external.maxItems': 0 } });
  assert.equal(zero.core.externalMax, 1, 'the cap is at least one');
});

test('external duplicates are rejected', () => {
  const { core } = harness();
  core.addExternal(file('/out/a.pdf'));
  assert.equal(core.addExternal(file('/out/a.pdf')), 'duplicate');
  assert.equal(core.addExternal(file('/OUT/A.PDF')), 'duplicate');
});

test('external entries are marked external and removable', () => {
  const { core } = harness();
  core.addExternal(file('/out/a.pdf'));
  assert.equal(core.getExternal()[0].external, true);
  assert.equal(core.removeExternal('/out/a.pdf'), true);
  assert.equal(core.removeExternal('/out/a.pdf'), false);
});

// -------------------------------------------------------------------- recents

test('opening a file repeatedly counts and timestamps', () => {
  const { core } = harness();
  core.recordOpen('/p/a.py', 'a.py', true, 'a.py');
  core.recordOpen('/p/a.py', 'a.py', true, 'a.py');
  const top = core.getTopFiles(true);
  assert.equal(top.length, 1);
  assert.equal(top[0].count, 2);
  assert.equal(top[0].lastOpened, NOW);
});

test('top files honour the configured limit and ranking', () => {
  const { core } = harness({ config: { 'recent.maxItems': 2, 'recent.ranking': 'frequency' } });
  core.recordOpen('/p/a.py', 'a.py', true);
  core.recordOpen('/p/a.py', 'a.py', true);
  core.recordOpen('/p/b.py', 'b.py', true);
  assert.equal(core.getTopFiles(true).length, 2);
  assert.equal(core.getTopFiles(true)[0].name, 'a.py');
});

test('files outside the project are excluded from the project list', () => {
  const { core } = harness();
  core.recordOpen('/p/a.py', 'a.py', true, 'a.py');
  core.recordOpen('/elsewhere/b.pdf', 'b.pdf', false);
  assert.deepEqual(core.getTopFiles(true).map((row) => row.name), ['a.py']);
  assert.equal(core.getTopFiles(false).length, 2);
});

test('clearRecents empties the history', () => {
  const { core } = harness();
  core.recordOpen('/p/a.py', 'a.py', true);
  core.clearRecents();
  assert.deepEqual(core.getTopFiles(false), []);
});

test('pruneMissing drops vanished files from all three collections', () => {
  const { core } = harness({ files: ['/keep/a.py', '/keep/ext.pdf'] });
  core.addFavorite(file('/keep/a.py'));
  core.addFavorite(file('/gone/b.py'), core.createGroup('Gone').id);
  core.addExternal(file('/keep/ext.pdf'));
  core.addExternal(file('/gone/ext.pdf'));
  core.recordOpen('/keep/a.py', 'a.py', true);
  core.recordOpen('/gone/c.py', 'c.py', true);

  const removed = core.pruneMissing();
  assert.equal(removed, 3);
  assert.equal(core.isFavorite('/gone/b.py'), false);
  assert.deepEqual(core.getExternal().map((entry) => entry.name), ['ext.pdf']);
  assert.deepEqual(core.getTopFiles(false).map((row) => row.name), ['a.py']);
});

test('pruneMissing fires no event when nothing was removed', () => {
  const { core, events } = harness({ files: ['/keep/a.py'] });
  core.addFavorite(file('/keep/a.py'));
  const before = events.length;
  assert.equal(core.pruneMissing(), 0);
  assert.equal(events.length, before, 'an event must not be fired for a no-op prune');
});

// --------------------------------------------------------------- smart groups

test('smart groups are created, updated and removed', () => {
  const { core } = harness();
  const rule = core.createSmartGroup('Invoices', { includeGlobs: ['**/invoice-*'], extensions: ['pdf'] });
  assert.equal(core.getSmartGroups().length, 1);
  assert.equal(core.getSmartGroup(rule.id)?.name, 'Invoices');

  const updated = core.updateSmartGroup(rule.id, { name: 'All invoices', matchMode: 'any' });
  assert.equal(updated?.name, 'All invoices');
  assert.equal(updated?.matchMode, 'any');
  assert.equal(core.getSmartGroup(rule.id)?.id, rule.id, 'id must be immutable');

  const withConditions = core.updateSmartGroup(rule.id, { conditions: { includeGlobs: ['*.md'] } });
  assert.deepEqual(withConditions?.conditions, { includeGlobs: ['*.md'] });

  assert.equal(core.removeSmartGroup('missing'), false);
  assert.equal(core.removeSmartGroup(rule.id), true);
  assert.equal(core.getSmartGroups().length, 0);
});

test('updating a missing smart group is a no-op', () => {
  const { core } = harness();
  assert.equal(core.updateSmartGroup('nope', { name: 'x' }), undefined);
});

test('getSmartGroups returns copies, so callers cannot mutate stored rules', () => {
  const { core } = harness();
  const rule = core.createSmartGroup('Invoices', { includeGlobs: ['*.pdf'] });
  const copy = core.getSmartGroups();
  copy[0].name = 'Mutated';
  copy[0].conditions.includeGlobs?.push('*.md');
  assert.equal(core.getSmartGroup(rule.id)?.name, 'Invoices');
  assert.deepEqual(core.getSmartGroup(rule.id)?.conditions.includeGlobs, ['*.pdf']);
});

// ---------------------------------------------------------------- persistence

test('favorites and external files are written to their mementos', async () => {
  const { core, workspace, global } = harness();
  core.addFavorite(file('/p/a.py'));
  core.addExternal(file('/out/a.pdf'));
  await core.flush();
  assert.ok(workspace.calls.includes('pdfHub.state'));
  assert.ok(global.calls.includes('pdfHub.external'));
  const saved = workspace.data.get('pdfHub.state') as PersistedState;
  assert.equal(saved.groups[0].files.length, 1);
  assert.equal(saved.version, STATE_VERSION);
});

test('the external list is restored from global state when the workspace is empty', () => {
  const { core } = harness({ global: { 'pdfHub.external': [file('/out/kept.pdf')] } });
  assert.deepEqual(core.getExternal().map((entry) => entry.name), ['kept.pdf']);
});

test('workspace state wins over global state once it has external files', () => {
  const { core } = harness({
    workspace: { 'pdfHub.state': { ...emptyState(), external: [file('/out/ws.pdf')] } },
    global: { 'pdfHub.external': [file('/out/global.pdf')] },
  });
  assert.deepEqual(core.getExternal().map((entry) => entry.name), ['ws.pdf']);
});

test('corrupt persisted state degrades to defaults instead of throwing', () => {
  const { core } = harness({
    workspace: {
      'pdfHub.state': {
        groups: 'not-an-array',
        external: [null, { path: 5 }],
        recents: [{ nope: true }],
        smartGroups: [null, { id: 'ok', name: 'Ok', conditions: {} }],
      },
    },
  });
  // Spread over emptyState keeps the arrays from emptyState only if the input
  // values are usable; anything malformed is filtered by the shape guards.
  assert.equal(core.getGroups().every((group) => typeof group.name === 'string'), true);
  assert.equal(core.getExternal().every((entry) => typeof entry.path === 'string'), true);
  assert.equal(core.getTopFiles(false).every((row) => typeof row.path === 'string'), true);
  assert.equal(core.getSmartGroups().every((rule) => typeof rule.name === 'string'), true);
});

test('an unknown future state version is still loaded defensively', () => {
  const { core } = harness({
    workspace: { 'pdfHub.state': { version: 999, groups: [{ id: 'g', name: 'G', files: [] }] } },
  });
  assert.equal(core.getGroups().length, 1);
});

// --------------------------------------------------------------------- events

test('mutations fire a change event and schedule a flush', () => {
  const { core, events, scheduled } = harness();
  core.addFavorite(file('/p/a.py'));
  assert.equal(events.length, 1);
  assert.equal(scheduled.length, 1, 'a debounced flush must be scheduled');
});

test('read-only operations do not fire events', () => {
  const { core, events } = harness();
  core.addFavorite(file('/p/a.py'));
  const before = events.length;
  core.getGroups();
  core.getExternal();
  core.getTopFiles(false);
  core.isFavorite('/p/a.py');
  core.snapshot();
  assert.equal(events.length, before);
});

test('reindex policy comes from configuration', () => {
  const { core } = harness({
    config: { 'index.trigger': 'onDemand', 'index.debounceMs': 500, 'index.maxDelayMs': 4000 },
  });
  const policy = core.getReindexPolicy();
  assert.equal(policy.trigger, 'onDemand');
  assert.equal(policy.debounceMs, 500);
  assert.deepEqual(core.planReindex('viewOpen', NOW, 0), { runNow: false, delayMs: 0 });
  assert.deepEqual(core.planReindex('explicit', NOW, 0), { runNow: true, delayMs: 0 });
});
