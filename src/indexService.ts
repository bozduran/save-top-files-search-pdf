/**
 * Incremental indexing service.
 *
 * Cost model, in order of how often each step runs:
 *  1. `stat` every known PDF (a few hundred microseconds each) to decide whether
 *     anything changed. This is the only cost of opening a window.
 *  2. extract text **only** for files whose mtime or size changed, two at a time.
 *  3. persist the index when work happened, debounced.
 *
 * That means an unchanged project costs one `stat` pass and zero parsing, which
 * is what keeps a mostly-static PDF collection cheap to keep indexed.
 *
 * The file system is injected (`IndexEnvironment`) so the whole scheduling,
 * caching and cancellation behaviour is unit tested.
 */
import type { FileRef } from './types.ts';
import { describeScan } from './search/recents.ts';
import { isEntryValid, type PdfIndexStore } from './search/indexStore.ts';

export interface IndexEnvironment {
  /** Lists candidate PDFs with their on-disk metadata. */
  listFiles(): Promise<FileRef[]>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | undefined>;
  read(path: string): Promise<Uint8Array>;
  extract(
    data: Uint8Array
  ): Promise<{ pages: string[]; truncated: boolean; totalPages: number }>;
}

export interface IndexConfig {
  maxFileSizeBytes: number;
  maxTextCharsPerFile: number;
  concurrency: number;
}

export interface IndexProgress {
  phase: 'idle' | 'scanning' | 'indexing' | 'ready' | 'cancelled' | 'error';
  processed: number;
  total: number;
  currentFile?: string;
  /** Files whose cached text was still valid and were therefore skipped. */
  cached: number;
  /** Files actually re-extracted in this pass. */
  extracted: number;
  fromCache: number;
  skipped: number;
  failed: number;
  bytes: number;
  elapsedMs: number;
  /** Set when the pass finished; a short human summary. */
  summary?: string;
  error?: string;
}

export interface IndexRunOptions {
  /** Report every file, or only phases (useful for background passes). */
  silent?: boolean;
  /** Called when the pass finishes successfully. */
  onComplete?: (progress: IndexProgress) => void;
}

const IDLE: IndexProgress = {
  phase: 'idle',
  processed: 0,
  total: 0,
  cached: 0,
  extracted: 0,
  fromCache: 0,
  skipped: 0,
  failed: 0,
  bytes: 0,
  elapsedMs: 0,
};

export class IndexService {
  private readonly store: PdfIndexStore;
  private readonly environment: IndexEnvironment;
  private readonly config: () => IndexConfig;
  private readonly onProgressCallback: (progress: IndexProgress) => void;
  private readonly now: () => number;

  private current: IndexProgress = { ...IDLE };
  private running: Promise<IndexProgress> | undefined;
  private cancelRequested = false;
  private loaded = false;
  private lastSaveAt = 0;

  constructor(options: {
    store: PdfIndexStore;
    environment: IndexEnvironment;
    config: () => IndexConfig;
    onProgress?: (progress: IndexProgress) => void;
    now?: () => number;
  }) {
    this.store = options.store;
    this.environment = options.environment;
    this.config = options.config;
    this.onProgressCallback = options.onProgress ?? (() => undefined);
    this.now = options.now ?? (() => Date.now());
  }

  get progress(): IndexProgress {
    return { ...this.current };
  }

  get isRunning(): boolean {
    return Boolean(this.running);
  }

  /** Loads the persisted index once. Cheap: one file read. */
  async load(): Promise<{ entries: number }> {
    if (this.loaded) {
      return { entries: this.store.size };
    }
    const result = await this.store.load();
    this.loaded = true;
    return { entries: result.entries };
  }

  /** Requests cancellation of the pass currently running. */
  cancel(): void {
    if (this.running) {
      this.cancelRequested = true;
    }
  }

  /**
   * Indexes what needs indexing. Concurrent calls share one pass, so a burst of
   * triggers (view open, typing, file change) cannot start overlapping work.
   */
  async ensureIndexed(options: IndexRunOptions = {}): Promise<IndexProgress> {
    if (this.running) {
      return this.running;
    }
    this.running = this.run(options).finally(() => {
      this.running = undefined;
      this.cancelRequested = false;
    });
    return this.running;
  }

  /**
   * Decides what a pass would cost without extracting anything.
   * Used to show "12 unchanged, 2 changed" before starting.
   */
  async planPass(): Promise<{
    total: number;
    changed: number;
    unchanged: number;
    bytes: number;
    oversized: number;
    description: string;
  }> {
    await this.load();
    const config = this.config();
    const files = await this.environment.listFiles();
    let changed = 0;
    let unchanged = 0;
    let bytes = 0;
    let oversized = 0;

    for (const file of files) {
      const stats = await this.environment.stat(file.path);
      if (!stats) {
        continue;
      }
      if (stats.size > config.maxFileSizeBytes) {
        oversized += 1;
        continue;
      }
      if (isEntryValid(this.store.peek(file.path), stats)) {
        unchanged += 1;
      } else {
        changed += 1;
        bytes += stats.size;
      }
    }

    return {
      total: files.length,
      changed,
      unchanged,
      bytes,
      oversized,
      description: describeScan(unchanged, changed, bytes),
    };
  }

  private emit(progress: IndexProgress): void {
    this.current = progress;
    this.onProgressCallback({ ...progress });
  }

  private async run(options: IndexRunOptions): Promise<IndexProgress> {
    const started = this.now();
    const silent = options.silent ?? false;
    const config = this.config();
    this.cancelRequested = false;

    const base: IndexProgress = {
      ...IDLE,
      phase: 'scanning',
      elapsedMs: 0,
    };
    if (!silent) {
      this.emit(base);
    }

    await this.load();
    const files = await this.environment.listFiles().catch(() => [] as FileRef[]);

    const queue: { file: FileRef; stats: { mtimeMs: number; size: number } }[] = [];
    let cached = 0;
    let skipped = 0;

    // Phase 1: metadata only.
    for (const file of files) {
      if (this.cancelRequested) {
        break;
      }
      const stats = await this.environment.stat(file.path);
      if (!stats) {
        skipped += 1;
        continue;
      }
      if (stats.size > config.maxFileSizeBytes) {
        skipped += 1;
        continue;
      }
      if (isEntryValid(this.store.peek(file.path), stats)) {
        cached += 1;
        this.store.noteCacheHit(stats.size);
        continue;
      }
      queue.push({ file, stats });
    }

    const total = files.length;
    let progress: IndexProgress = {
      ...base,
      phase: queue.length ? 'indexing' : 'ready',
      processed: cached + skipped,
      total,
      cached,
      fromCache: cached,
      skipped,
      extracted: 0,
      failed: 0,
      bytes: queue.reduce((sum, item) => sum + item.stats.size, 0),
      elapsedMs: this.now() - started,
    };
    if (!silent) {
      this.emit(progress);
    }

    if (this.cancelRequested) {
      const finished: IndexProgress = {
        ...progress,
        phase: 'cancelled',
        summary: `Cancelled after ${cached} cached, ${queue.length} pending`,
        elapsedMs: this.now() - started,
      };
      if (!silent) {
        this.emit(finished);
      }
      return finished;
    }

    if (!queue.length) {
      const finished: IndexProgress = {
        ...progress,
        phase: 'ready',
        summary: describeScan(cached, 0, 0),
        elapsedMs: this.now() - started,
      };
      if (!silent) {
        this.emit(finished);
      }
      options.onComplete?.(finished);
      return finished;
    }

    // Phase 2: extraction, bounded concurrency.
    let cursor = 0;
    let extracted = 0;
    let failed = 0;
    const concurrency = Math.max(1, Math.min(4, config.concurrency));

    const worker = async (): Promise<void> => {
      while (cursor < queue.length && !this.cancelRequested) {
        const item = queue[cursor];
        cursor += 1;
        progress = { ...progress, currentFile: item.file.name };
        if (!silent) {
          this.emit(progress);
        }
        try {
          const bytes = await this.environment.read(item.file.path);
          const result = await this.environment.extract(bytes);
          const maxChars = config.maxTextCharsPerFile;
          let used = 0;
          let truncated = result.truncated;
          const kept: string[] = [];
          for (const page of result.pages) {
            if (used >= maxChars) {
              truncated = true;
              break;
            }
            const slice = page.length > maxChars - used ? page.slice(0, maxChars - used) : page;
            used += slice.length;
            kept.push(slice);
          }
          this.store.set({
            path: item.file.path,
            mtimeMs: item.stats.mtimeMs,
            size: item.stats.size,
            pages: result.totalPages,
            text: kept,
            lower: kept.map((page) => page.toLowerCase()),
            truncated,
          });
          extracted += 1;
          await this.maybeSave();
        } catch {
          failed += 1;
        }
        progress = {
          ...progress,
          processed: cached + skipped + extracted + failed,
          extracted,
          failed,
          elapsedMs: this.now() - started,
        };
        if (!silent) {
          this.emit(progress);
        }
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
      );
    } catch (error) {
      const failedRun: IndexProgress = {
        ...progress,
        phase: 'error',
        error: String(error),
        elapsedMs: this.now() - started,
      };
      this.emit(failedRun);
      return failedRun;
    }

    await this.save(true);

    const finished: IndexProgress = this.cancelRequested
      ? {
          ...progress,
          phase: 'cancelled',
          summary: `Cancelled after ${extracted} file(s)`,
          elapsedMs: this.now() - started,
        }
      : {
          ...progress,
          phase: 'ready',
          currentFile: undefined,
          summary:
            extracted === 0
              ? describeScan(cached, 0, 0)
              : `Indexed ${extracted} file(s)${cached ? `, ${cached} already cached` : ''}${
                  failed ? `, ${failed} failed` : ''
                } in ${Math.max(1, Math.round((this.now() - started) / 100) / 10)}s`,
          elapsedMs: this.now() - started,
        };

    if (!silent) {
      this.emit(finished);
    }
    if (finished.phase === 'ready') {
      options.onComplete?.(finished);
    }
    return finished;
  }

  /** Persists at most every few seconds during a long pass. */
  private async maybeSave(): Promise<void> {
    const now = this.now();
    if (now - this.lastSaveAt < 5000) {
      return;
    }
    this.lastSaveAt = now;
    await this.save(false);
  }

  /** Reads one indexed entry without touching its LRU timestamp. */
  peekEntry(path: string) {
    return this.store.peek(path);
  }

  /** Drops one file from the index (used when a PDF changes or disappears). */
  invalidate(path?: string): void {
    if (path) {
      this.store.delete(path);
    } else {
      this.store.clear();
    }
  }

  /** Removes cached entries for PDFs that are no longer in the workspace. */
  async pruneToKnownFiles(): Promise<number> {
    const files = await this.environment.listFiles().catch(() => [] as FileRef[]);
    const removed = this.store.retainOnly(files.map((file) => file.path));
    if (removed > 0) {
      await this.save(true);
    }
    return removed;
  }

  async save(force = false): Promise<void> {
    try {
      await this.store.save(force);
    } catch {
      // A failed write must never break indexing; the index is rebuilt on demand.
    }
  }

  async reset(): Promise<void> {
    this.store.clear();
    await this.store.drop();
    this.emit({ ...IDLE });
  }

  get indexedFiles(): number {
    return this.store.size;
  }
}
