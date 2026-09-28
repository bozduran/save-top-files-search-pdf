import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  INDEX_FORMAT_VERSION,
  PdfIndexStore,
  emptySnapshot,
  indexKey,
  isEntryValid,
  parseSnapshot,
  serializeSnapshot,
  type IndexEntry,
  type IndexStorage,
} from './indexStore.ts';

const NOW = Date.UTC(2026, 0, 20);

/** In-memory storage; optionally records the raw payload for assertions. */
function memoryStorage(initial?: string): IndexStorage & { raw?: string; writes: number; dropped: number } {
  const state = { raw: initial, writes: 0, dropped: 0 };
  return {
    get raw() {
      return state.raw;
    },
    set raw(value) {
      state.raw = value;
    },
    get writes() {
      return state.writes;
    },
    get dropped() {
      return state.dropped;
    },
    async read() {
      return state.raw;
    },
    async write(contents) {
      state.raw = contents;
      state.writes += 1;
    },
    async drop() {
      state.raw = undefined;
      state.dropped += 1;
    },
  } as IndexStorage & { raw?: string; writes: number; dropped: number };
}

function entry(overrides: Partial<IndexEntry> & { path: string }): Omit<IndexEntry, 'lastAccess'> {
  return {
    mtimeMs: 1000,
    size: 2048,
    pages: 2,
    text: ['hello world', 'second page'],
    lower: ['hello world', 'second page'],
    truncated: false,
    ...overrides,
  };
}

test('indexKey normalizes separators so cache keys are stable', () => {
  assert.equal(indexKey('C:\\Docs\\A.PDF'), 'C:/Docs/A.PDF');
  assert.equal(indexKey('/home/a/b.pdf'), '/home/a/b.pdf');
});

test('an entry is valid only when mtime and size both match', () => {
  const stored = { path: 'a', mtimeMs: 10, size: 20 } as IndexEntry;
  assert.equal(isEntryValid(stored, { mtimeMs: 10, size: 20 }), true);
  assert.equal(isEntryValid(stored, { mtimeMs: 11, size: 20 }), false);
  assert.equal(isEntryValid(stored, { mtimeMs: 10, size: 21 }), false);
  assert.equal(isEntryValid(undefined, { mtimeMs: 10, size: 20 }), false);
});

test('a snapshot round-trips through serialize and parse', () => {
  const snapshot = emptySnapshot(NOW);
  snapshot.entries = [{ ...entry({ path: 'a.pdf' }), lastAccess: NOW }];
  const { json, dropped } = serializeSnapshot(snapshot, DEFAULT_LIMITS);
  assert.equal(dropped, 0);

  const parsed = parseSnapshot(json, NOW + 1);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].path, 'a.pdf');
  assert.deepEqual(parsed.entries[0].text, ['hello world', 'second page']);
  assert.equal(parsed.version, INDEX_FORMAT_VERSION);
});

test('corrupt or foreign JSON degrades to an empty index instead of throwing', () => {
  assert.equal(parseSnapshot('not json at all').entries.length, 0);
  assert.equal(parseSnapshot('{"version":99,"entries":[]}').entries.length, 0);
  assert.equal(parseSnapshot('{"version":2,"entries":"nope"}').entries.length, 0);
  assert.equal(parseSnapshot(undefined).entries.length, 0);
});

test('entries with malformed shapes are dropped, valid siblings survive', () => {
  const raw = JSON.stringify({
    version: INDEX_FORMAT_VERSION,
    savedAt: NOW,
    entries: [
      { path: 'good.pdf', mtimeMs: 1, size: 2, text: ['ok'], lower: ['ok'] },
      { path: 'bad.pdf', mtimeMs: 1, size: 2, text: 'not-an-array' },
      { mtimeMs: 1, size: 2, text: [] },
      null,
    ],
  });
  const parsed = parseSnapshot(raw, NOW);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].path, 'good.pdf');
});

test('a snapshot without a lowercase cache rebuilds it on load', () => {
  const raw = JSON.stringify({
    version: INDEX_FORMAT_VERSION,
    savedAt: NOW,
    entries: [{ path: 'a.pdf', mtimeMs: 1, size: 2, text: ['Mixed Case'] }],
  });
  const parsed = parseSnapshot(raw, NOW);
  assert.deepEqual(parsed.entries[0].lower, ['mixed case']);
});

test('serializeSnapshot evicts least-recently-used entries past the byte budget', () => {
  const snapshot = emptySnapshot(NOW);
  const page = 'x'.repeat(5000);
  snapshot.entries = [
    { ...entry({ path: 'new.pdf', text: [page], lower: [page] }), lastAccess: NOW },
    { ...entry({ path: 'mid.pdf', text: [page], lower: [page] }), lastAccess: NOW - 1000 },
    { ...entry({ path: 'old.pdf', text: [page], lower: [page] }), lastAccess: NOW - 5000 },
  ];
  const { json, dropped } = serializeSnapshot(snapshot, { maxBytes: 12_000, maxEntries: 100 });
  assert.ok(dropped >= 1, 'expected at least one eviction');
  const parsed = parseSnapshot(json, NOW);
  assert.ok(parsed.entries.some((item) => item.path === 'new.pdf'), 'newest entry must be kept');
  assert.ok(!parsed.entries.some((item) => item.path === 'old.pdf'), 'oldest entry must be evicted');
});

test('serializeSnapshot respects the entry-count ceiling', () => {
  const snapshot = emptySnapshot(NOW);
  snapshot.entries = Array.from({ length: 10 }, (_, i) => ({
    ...entry({ path: `f${i}.pdf` }),
    lastAccess: NOW - i,
  }));
  const { dropped } = serializeSnapshot(snapshot, { maxBytes: 10 * 1024 * 1024, maxEntries: 4 });
  assert.equal(dropped, 6);
});

test('the store persists to storage and reloads identically', async () => {
  const storage = memoryStorage();
  const store = new PdfIndexStore(storage, DEFAULT_LIMITS, () => NOW);
  store.set(entry({ path: 'a.pdf' }));
  store.set(entry({ path: 'b.pdf', text: ['other'], lower: ['other'] }));
  assert.equal(store.isDirty, true);

  const saved = await store.save();
  assert.equal(saved.saved, true);
  assert.equal(store.isDirty, false);

  const reloaded = new PdfIndexStore(storage, DEFAULT_LIMITS, () => NOW);
  const result = await reloaded.load();
  assert.equal(result.entries, 2);
  assert.deepEqual(reloaded.peek('a.pdf')?.text, ['hello world', 'second page']);
});

test('save is a no-op when nothing changed', async () => {
  const storage = memoryStorage();
  const store = new PdfIndexStore(storage, DEFAULT_LIMITS, () => NOW);
  assert.deepEqual(await store.save(), { saved: false, dropped: 0, bytes: 0 });
  store.set(entry({ path: 'a.pdf' }));
  await store.save();
  const writesAfterFirst = storage.writes;
  await store.save();
  assert.equal(storage.writes, writesAfterFirst, 'second save must not write');
});

test('loading is resilient when storage throws on read', async () => {
  const storage: IndexStorage = {
    read: async () => {
      throw new Error('disk unavailable');
    },
    write: async () => undefined,
    drop: async () => undefined,
  };
  const store = new PdfIndexStore(storage, DEFAULT_LIMITS, () => NOW);
  await assert.rejects(() => store.load());
});

test('get refreshes the LRU timestamp, peek does not', () => {
  let clock = NOW;
  const store = new PdfIndexStore(memoryStorage(), DEFAULT_LIMITS, () => clock);
  store.set(entry({ path: 'a.pdf' }));
  clock += 5000;
  store.peek('a.pdf');
  assert.equal(store.peek('a.pdf')?.lastAccess, NOW, 'peek must not touch lastAccess');
  store.get('a.pdf');
  assert.equal(store.peek('a.pdf')?.lastAccess, NOW + 5000);
});

test('delete and clear update the dirty flag', () => {
  const store = new PdfIndexStore(memoryStorage(), DEFAULT_LIMITS, () => NOW);
  store.set(entry({ path: 'a.pdf' }));
  store.save;
  assert.equal(store.delete('missing.pdf'), false);
  assert.equal(store.delete('a.pdf'), true);
  assert.equal(store.size, 0);
  store.set(entry({ path: 'b.pdf' }));
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.isDirty, true);
});

test('retainOnly drops files that left the workspace', () => {
  const store = new PdfIndexStore(memoryStorage(), DEFAULT_LIMITS, () => NOW);
  store.set(entry({ path: '/w/keep.pdf' }));
  store.set(entry({ path: '/w/gone.pdf' }));
  const removed = store.retainOnly(['/w/keep.pdf']);
  assert.equal(removed, 1);
  assert.equal(store.size, 1);
  assert.ok(store.peek('/w/keep.pdf'));
});

test('statistics distinguish extractions from cache hits', () => {
  const store = new PdfIndexStore(memoryStorage(), DEFAULT_LIMITS, () => NOW);
  store.set(entry({ path: 'a.pdf' }));
  store.noteCacheHit(1024);
  store.noteCacheHit(2048);
  const stats = store.getStats();
  assert.equal(stats.extractions, 1);
  assert.equal(stats.cacheHits, 2);
  assert.equal(stats.bytes, 3072);
});

test('drop wipes both memory and storage', async () => {
  const storage = memoryStorage();
  const store = new PdfIndexStore(storage, DEFAULT_LIMITS, () => NOW);
  store.set(entry({ path: 'a.pdf' }));
  await store.save();
  await store.drop();
  assert.equal(store.size, 0);
  assert.equal(storage.raw, undefined);
});

test('a large index stays within the byte budget on disk', async () => {
  const storage = memoryStorage();
  const limits = { maxBytes: 200_000, maxEntries: 1000 };
  const store = new PdfIndexStore(storage, limits, () => NOW);
  for (let i = 0; i < 200; i += 1) {
    const page = 'lorem ipsum '.repeat(200);
    store.set(entry({ path: `f${i}.pdf`, text: [page], lower: [page] }));
  }
  const result = await store.save();
  assert.ok(result.dropped > 0, 'expected eviction for a large corpus');
  assert.ok(result.bytes <= limits.maxBytes * 1.2, `index was ${result.bytes} bytes`);
});
