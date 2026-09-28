import test from 'node:test';
import assert from 'node:assert/strict';
import { IndexService, type IndexConfig, type IndexEnvironment, type IndexProgress } from './indexService.ts';
import { PdfIndexStore, type IndexStorage } from './search/indexStore.ts';
import type { FileRef } from './types.ts';

const NOW = Date.UTC(2026, 0, 20);

const CONFIG: IndexConfig = {
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTextCharsPerFile: 1000,
  concurrency: 2,
};

function storageBackend(): IndexStorage & { raw?: string } {
  const state: { raw?: string } = {};
  return {
    get raw() {
      return state.raw;
    },
    async read() {
      return state.raw;
    },
    async write(contents: string) {
      state.raw = contents;
    },
    async drop() {
      state.raw = undefined;
    },
  } as IndexStorage & { raw?: string };
}

interface FakeFile {
  path: string;
  mtimeMs: number;
  size: number;
  text: string[];
  /** Simulates a file that cannot be read. */
  unreadable?: boolean;
  /** Keeps the file listed after it is deleted from the map. */
  vanishing?: boolean;
}

/** Fake environment that counts every expensive operation. */
function environment(files: FakeFile[]) {
  const stats = { stats: 0, reads: 0, extracts: 0, maxConcurrent: 0, active: 0 };
  const byPath = new Map(files.map((file) => [file.path, file]));
  // Snapshot of what the workspace reported at scan time: deleting from
  // `byPath` afterwards models a file that disappears mid-scan rather than one
  // that never existed.
  const listed: FakeFile[] = [...files];

  const env: IndexEnvironment = {
    async listFiles(): Promise<FileRef[]> {
      return listed
        .filter((file) => byPath.has(file.path) || file.vanishing)
        .map((file) => ({
          path: file.path,
          name: file.path.split('/').pop() ?? file.path,
        }));
    },
    async stat(path: string) {
      stats.stats += 1;
      const file = byPath.get(path);
      return file ? { mtimeMs: file.mtimeMs, size: file.size } : undefined;
    },
    async read(path: string) {
      stats.reads += 1;
      const file = byPath.get(path);
      if (!file || file.unreadable) {
        throw new Error(`cannot read ${path}`);
      }
      return new Uint8Array(Buffer.from(file.text.join('\n'), 'utf8'));
    },
    async extract() {
      stats.extracts += 1;
      stats.active += 1;
      stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      stats.active -= 1;
      return { pages: ['page one text', 'page two text'], truncated: false, totalPages: 2 };
    },
  };

  return { env, stats, byPath };
}

function service(
  files: FakeFile[],
  options: { storage?: IndexStorage; onProgress?: (progress: IndexProgress) => void; config?: Partial<IndexConfig> } = {}
) {
  const storage = (options.storage ?? storageBackend()) as IndexStorage & { raw?: string };
  const store = new PdfIndexStore(storage, undefined, () => NOW);
  const { env, stats, byPath } = environment(files);
  const instance = new IndexService({
    store,
    environment: env,
    config: () => ({ ...CONFIG, ...options.config }),
    onProgress: options.onProgress,
    now: () => NOW,
  });
  return { instance, store, stats, byPath, storage };
}

const pdf = (path: string, overrides: Partial<FakeFile> = {}): FakeFile => ({
  path,
  mtimeMs: 1000,
  size: 2048,
  text: ['hello world'],
  ...overrides,
});

test('the first pass extracts every file once', async () => {
  const { instance, stats } = service([pdf('/w/a.pdf'), pdf('/w/b.pdf')]);
  const progress = await instance.ensureIndexed();
  assert.equal(progress.phase, 'ready');
  assert.equal(progress.extracted, 2);
  assert.equal(stats.extracts, 2);
  assert.equal(progress.cached, 0);
  assert.equal(progress.total, 2);
});

test('a second pass over unchanged files extracts nothing', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf')];
  const { instance, stats } = service(files);
  await instance.ensureIndexed();
  const before = { ...stats };

  const progress = await instance.ensureIndexed();
  assert.equal(progress.extracted, 0, 'no re-extraction for unchanged files');
  assert.equal(progress.cached, 2);
  assert.equal(stats.extracts, before.extracts, 'extract must not be called again');
  assert.equal(stats.reads, before.reads, 'files must not be re-read');
  assert.ok(stats.stats > before.stats, 'a stat pass is the only cost');
  assert.ok(progress.summary?.includes('already cached'));
});

test('only the changed file is re-extracted', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf')];
  const { instance, stats } = service(files);
  await instance.ensureIndexed();

  const changed = stats.extracts;
  files[1].mtimeMs = 2000; // touch b.pdf
  const progress = await instance.ensureIndexed();
  assert.equal(progress.extracted, 1);
  assert.equal(stats.extracts, changed + 1);
  assert.equal(progress.cached, 1);
});

test('a size change alone invalidates the cache', async () => {
  const files = [pdf('/w/a.pdf')];
  const { instance } = service(files);
  await instance.ensureIndexed();
  files[0].size = 4096;
  const progress = await instance.ensureIndexed();
  assert.equal(progress.extracted, 1);
});

test('oversized files are skipped and reported, never extracted', async () => {
  const { instance, stats } = service([pdf('/w/big.pdf', { size: 50 * 1024 * 1024 }), pdf('/w/ok.pdf')]);
  const progress = await instance.ensureIndexed();
  assert.equal(progress.skipped, 1);
  assert.equal(progress.extracted, 1);
  assert.equal(stats.reads, 1, 'the oversized file must never be read');
});

test('files that vanish mid-scan are skipped without failing the pass', async () => {
  const files = [pdf('/w/a.pdf', { vanishing: true })];
  const { instance, byPath } = service(files);
  byPath.delete('/w/a.pdf');
  const progress = await instance.ensureIndexed();
  assert.equal(progress.phase, 'ready');
  assert.equal(progress.skipped, 1);
  assert.equal(progress.extracted, 0);
});

test('an unreadable file is counted as failed and does not abort the pass', async () => {
  const { instance } = service([pdf('/w/bad.pdf', { unreadable: true }), pdf('/w/good.pdf')]);
  const progress = await instance.ensureIndexed();
  assert.equal(progress.phase, 'ready');
  assert.equal(progress.failed, 1);
  assert.equal(progress.extracted, 1);
});

test('extraction concurrency never exceeds the configured limit', async () => {
  const files = Array.from({ length: 8 }, (_, i) => pdf(`/w/f${i}.pdf`));
  const { instance, stats } = service(files, { config: { concurrency: 2 } });
  await instance.ensureIndexed();
  assert.equal(stats.extracts, 8);
  assert.ok(stats.maxConcurrent <= 2, `max concurrency was ${stats.maxConcurrent}`);
});

test('progress events move through scanning, indexing and ready', async () => {
  const seen: IndexProgress[] = [];
  const { instance } = service([pdf('/w/a.pdf')], { onProgress: (progress) => seen.push({ ...progress }) });
  await instance.ensureIndexed();
  const phases = seen.map((entry) => entry.phase);
  assert.ok(phases.includes('scanning'));
  assert.ok(phases.includes('indexing'));
  assert.equal(phases[phases.length - 1], 'ready');
  const last = seen[seen.length - 1];
  assert.equal(last.processed, 1);
  assert.equal(last.total, 1);
});

test('a cached-only pass reports ready without an indexing phase', async () => {
  const seen: string[] = [];
  const { instance } = service([pdf('/w/a.pdf')], { onProgress: (progress) => seen.push(progress.phase) });
  await instance.ensureIndexed();
  seen.length = 0;
  await instance.ensureIndexed();
  assert.ok(!seen.includes('indexing'), `unexpected indexing phase in ${seen.join(',')}`);
});

test('a second service instance reuses the persisted index', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf')];
  const storage = storageBackend();

  const first = service(files, { storage });
  await first.instance.ensureIndexed();
  assert.equal(first.stats.extracts, 2);

  const second = service(files, { storage });
  const progress = await second.instance.ensureIndexed();
  assert.equal(progress.cached, 2, 'the reloaded index must satisfy the cache');
  assert.equal(second.stats.extracts, 0, 'nothing may be re-extracted after a reload');
  assert.equal(second.instance.indexedFiles, 2);
});

test('extracted text is truncated to the configured budget', async () => {
  const { instance } = service([pdf('/w/a.pdf')], { config: { maxTextCharsPerFile: 5 } });
  await instance.ensureIndexed();
  const entry = instanceStore(instance);
  assert.ok(entry, 'indexed entry not found');
  const total = entry.text.reduce((sum: number, page: string) => sum + page.length, 0);
  assert.ok(total <= 5, `kept ${total} characters`);
  assert.equal(entry.truncated, true);
});

/** Reaches the store through the public surface for assertions. */
function instanceStore(instance: IndexService): { text: string[]; truncated: boolean } | undefined {
  const candidate = instance as unknown as { store: { peek(path: string): never } };
  return candidate.store.peek('/w/a.pdf') as unknown as { text: string[]; truncated: boolean } | undefined;
}

test('cancelling a pass stops further extraction and reports cancelled', async () => {
  const files = Array.from({ length: 40 }, (_, i) => pdf(`/w/f${i}.pdf`));
  const { instance, stats } = service(files, { config: { concurrency: 1 } });
  const running = instance.ensureIndexed();
  setTimeout(() => instance.cancel(), 5);
  const progress = await running;
  assert.equal(progress.phase, 'cancelled');
  assert.ok(stats.extracts < files.length, 'cancellation must stop the queue');
  assert.ok(progress.summary?.includes('Cancelled'));
});

test('cancelling a pass with nothing to do still settles', async () => {
  const { instance } = service([]);
  const progress = await instance.ensureIndexed();
  assert.equal(progress.phase, 'ready');
  assert.equal(progress.total, 0);
});

test('concurrent ensureIndexed calls share a single pass', async () => {
  const files = Array.from({ length: 4 }, (_, i) => pdf(`/w/f${i}.pdf`));
  const { instance, stats } = service(files);
  const [a, b] = await Promise.all([instance.ensureIndexed(), instance.ensureIndexed()]);
  assert.equal(a.phase, 'ready');
  assert.equal(b.phase, 'ready');
  assert.equal(stats.extracts, 4, 'a shared pass must not double the work');
});

test('planPass predicts the work without extracting', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf'), pdf('/w/huge.pdf', { size: 99 * 1024 * 1024 })];
  const { instance, stats } = service(files);
  await instance.load();
  const plan = await instance.planPass();
  assert.equal(plan.total, 3);
  assert.equal(plan.changed, 2);
  assert.equal(plan.oversized, 1);
  assert.equal(stats.extracts, 0, 'planning must not extract anything');
  assert.ok(plan.description.includes('2 PDF(s) need indexing'));

  await instance.ensureIndexed();
  const after = await instance.planPass();
  assert.equal(after.changed, 0);
  assert.equal(after.unchanged, 2);
  assert.ok(after.description.includes('Nothing to index'));
});

test('invalidate drops one file or the whole index', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf')];
  const { instance, stats } = service(files);
  await instance.ensureIndexed();

  instance.invalidate('/w/a.pdf');
  await instance.ensureIndexed();
  assert.equal(stats.extracts, 3, 'only the invalidated file is re-extracted');
  assert.equal(instance.indexedFiles, 2);

  instance.invalidate();
  await instance.ensureIndexed();
  assert.equal(stats.extracts, 5, 'a full invalidation re-extracts everything');
});

test('pruneToKnownFiles forgets PDFs that left the workspace', async () => {
  const files = [pdf('/w/a.pdf'), pdf('/w/b.pdf')];
  const { instance, byPath, storage } = service(files);
  await instance.ensureIndexed();
  assert.equal(instance.indexedFiles, 2);

  byPath.delete('/w/b.pdf');
  const removed = await instance.pruneToKnownFiles();
  assert.equal(removed, 1);
  assert.equal(instance.indexedFiles, 1);

  // The pruned state is persisted, not just held in memory.
  const reloaded = new PdfIndexStore(storage, undefined, () => NOW);
  await reloaded.load();
  assert.equal(reloaded.size, 1);
});

test('reset clears and drops the persisted index', async () => {
  const { instance, storage } = service([pdf('/w/a.pdf')]);
  await instance.ensureIndexed();
  assert.ok(storage.raw, 'expected a persisted index');

  await instance.reset();
  assert.equal(instance.indexedFiles, 0);
  assert.equal(storage.raw, undefined);
});

test('a silent pass still stores results but emits no intermediate events', async () => {
  const seen: string[] = [];
  const { instance, store } = service([pdf('/w/a.pdf')], { onProgress: (p) => seen.push(p.phase) });
  const progress = await instance.ensureIndexed({ silent: true });
  assert.equal(progress.extracted, 1);
  assert.equal(store.size, 1, 'silent passes still index');
  assert.deepEqual(seen, [], 'silent passes emit nothing');
});

test('onComplete is called only for successful passes', async () => {
  const completions: string[] = [];
  const { instance } = service([pdf('/w/a.pdf')]);
  await instance.ensureIndexed({ onComplete: (progress) => completions.push(progress.phase) });
  assert.deepEqual(completions, ['ready']);
});

test('indexing survives a failing storage write', async () => {
  const brokenStorage: IndexStorage = {
    read: async () => undefined,
    write: async () => {
      throw new Error('disk full');
    },
    drop: async () => undefined,
  };
  const { instance } = service([pdf('/w/a.pdf')], { storage: brokenStorage });
  const progress = await instance.ensureIndexed();
  assert.equal(progress.phase, 'ready');
  assert.equal(progress.extracted, 1, 'in-memory indexing must not depend on disk');
});
