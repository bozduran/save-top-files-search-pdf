/**
 * Persistent, incremental PDF text index.
 *
 * Design goals:
 *  - survive window reloads, so opening VS Code does not re-extract anything
 *    that has not changed,
 *  - be cheap to update: one `stat` per file decides whether extraction runs,
 *  - stay bounded: oversized corpora evict least-recently-used entries,
 *  - be testable: storage and hashing are injected, so tests run on the real
 *    implementation with a temporary directory.
 */

export const INDEX_FORMAT_VERSION = 2;

export interface IndexEntry {
  /** Absolute file path, slash-normalized. */
  path: string;
  /** Modification time and size used for cache validation. */
  mtimeMs: number;
  size: number;
  pages: number;
  /** Extracted text, one string per page. */
  text: string[];
  /** Lower-cased twin of `text`, kept for fast case-insensitive matching. */
  lower: string[];
  truncated: boolean;
  /** Epoch ms of the last time this entry was read or written. */
  lastAccess: number;
}

export interface IndexSnapshot {
  version: number;
  savedAt: number;
  entries: IndexEntry[];
  stats: {
    /** Bytes of PDF data covered by the index. */
    bytes: number;
    /** Extractions performed since the index was created. */
    extractions: number;
    /** Extractions avoided because the cache was still valid. */
    cacheHits: number;
  };
}

/** Minimal storage contract; the extension supplies a workspace-fs implementation. */
export interface IndexStorage {
  read(): Promise<string | undefined>;
  write(contents: string): Promise<void>;
  drop(): Promise<void>;
}

export interface IndexLimits {
  /** Maximum size of the serialized index in bytes. */
  maxBytes: number;
  /** Maximum entries kept regardless of size. */
  maxEntries: number;
}

export const DEFAULT_LIMITS: IndexLimits = {
  maxBytes: 24 * 1024 * 1024,
  maxEntries: 4000,
};

type Clock = () => number;

/** Normalizes a path so cache keys are stable across platforms. */
export function indexKey(path: string): string {
  return path.replace(/\\/g, '/');
}

export function emptySnapshot(now = Date.now()): IndexSnapshot {
  return {
    version: INDEX_FORMAT_VERSION,
    savedAt: now,
    entries: [],
    stats: { bytes: 0, extractions: 0, cacheHits: 0 },
  };
}

/** True when the cached entry still describes the file exactly. */
export function isEntryValid(
  entry: IndexEntry | undefined,
  stats: { mtimeMs: number; size: number }
): boolean {
  return Boolean(entry && entry.mtimeMs === stats.mtimeMs && entry.size === stats.size);
}

/**
 * Parses a stored snapshot, discarding anything malformed.
 *
 * A corrupt or older index must degrade to "no cache" rather than throwing,
 * because it is rebuilt automatically.
 */
export function parseSnapshot(raw: string | undefined, now = Date.now()): IndexSnapshot {
  if (!raw) {
    return emptySnapshot(now);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySnapshot(now);
  }
  if (!parsed || typeof parsed !== 'object') {
    return emptySnapshot(now);
  }
  const candidate = parsed as Partial<IndexSnapshot>;
  if (candidate.version !== INDEX_FORMAT_VERSION || !Array.isArray(candidate.entries)) {
    return emptySnapshot(now);
  }

  const entries: IndexEntry[] = [];
  for (const entry of candidate.entries) {
    if (
      entry &&
      typeof entry.path === 'string' &&
      typeof entry.mtimeMs === 'number' &&
      typeof entry.size === 'number' &&
      Array.isArray(entry.text) &&
      entry.text.every((page) => typeof page === 'string')
    ) {
      const text = entry.text as string[];
      entries.push({
        path: entry.path,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        pages: typeof entry.pages === 'number' ? entry.pages : text.length,
        text,
        // Older snapshots may predate the lowercase cache; rebuild on load.
        lower: Array.isArray(entry.lower) && entry.lower.length === text.length
          ? (entry.lower as string[])
          : text.map((page) => page.toLowerCase()),
        truncated: Boolean(entry.truncated),
        lastAccess: typeof entry.lastAccess === 'number' ? entry.lastAccess : candidate.savedAt ?? now,
      });
    }
  }

  return {
    version: INDEX_FORMAT_VERSION,
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : now,
    entries,
    stats: {
      bytes: candidate.stats?.bytes ?? 0,
      extractions: candidate.stats?.extractions ?? 0,
      cacheHits: candidate.stats?.cacheHits ?? 0,
    },
  };
}

/** Serializes a snapshot, optionally dropping entries to respect a byte budget. */
export function serializeSnapshot(
  snapshot: IndexSnapshot,
  limits: IndexLimits = DEFAULT_LIMITS
): { json: string; dropped: number } {
  const byRecency = [...snapshot.entries].sort((a, b) => b.lastAccess - a.lastAccess);
  const kept: IndexEntry[] = [];
  let dropped = 0;

  // Rough per-entry overhead for the JSON scaffolding around the text.
  const perEntryOverhead = 220;
  let bytes = 0;

  for (const entry of byRecency) {
    const entryBytes =
      perEntryOverhead + entry.text.reduce((total, page) => total + page.length * 2, 0);
    const wouldExceed =
      kept.length >= limits.maxEntries || bytes + entryBytes > limits.maxBytes;
    if (wouldExceed) {
      dropped += 1;
      continue;
    }
    bytes += entryBytes;
    kept.push(entry);
  }

  // Keep a stable, readable order in the file itself.
  kept.sort((a, b) => indexKey(a.path).localeCompare(indexKey(b.path)));

  const json = JSON.stringify({
    version: INDEX_FORMAT_VERSION,
    savedAt: snapshot.savedAt,
    stats: snapshot.stats,
    entries: kept,
  });
  return { json, dropped };
}

/**
 * In-memory index with write-through persistence.
 *
 * `save()` is debounced by the caller; this class owns validation, lookup,
 * eviction accounting and the on-disk round trip.
 */
export class PdfIndexStore {
  private entries = new Map<string, IndexEntry>();
  private stats = { bytes: 0, extractions: 0, cacheHits: 0 };
  private dirty = false;

  private readonly storage: IndexStorage;
  private readonly limits: IndexLimits;
  private readonly now: Clock;

  constructor(storage: IndexStorage, limits: IndexLimits = DEFAULT_LIMITS, now: Clock = Date.now) {
    this.storage = storage;
    this.limits = limits;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  getStats(): IndexSnapshot['stats'] {
    return { ...this.stats };
  }

  /** Loads the persisted index, rebuilding the lowercase cache if needed. */
  async load(): Promise<{ entries: number; dropped: boolean }> {
    const raw = await this.storage.read();
    const snapshot = parseSnapshot(raw, this.now());
    this.entries = new Map(snapshot.entries.map((entry) => [indexKey(entry.path), entry]));
    this.stats = snapshot.stats;
    this.dirty = false;
    return { entries: this.entries.size, dropped: Boolean(raw) && snapshot.entries.length === 0 };
  }

  get(path: string): IndexEntry | undefined {
    const entry = this.entries.get(indexKey(path));
    if (entry) {
      entry.lastAccess = this.now();
      this.dirty = true;
    }
    return entry;
  }

  /** Looks up without touching the LRU timestamp. */
  peek(path: string): IndexEntry | undefined {
    return this.entries.get(indexKey(path));
  }

  /** Records a cache hit (a file that did not need re-extraction). */
  noteCacheHit(bytes: number): void {
    this.stats.cacheHits += 1;
    this.stats.bytes += bytes;
    this.dirty = true;
  }

  set(entry: Omit<IndexEntry, 'lastAccess'>): void {
    const key = indexKey(entry.path);
    this.entries.set(key, { ...entry, path: key, lastAccess: this.now() });
    this.stats.extractions += 1;
    this.dirty = true;
  }

  delete(path: string): boolean {
    const removed = this.entries.delete(indexKey(path));
    if (removed) {
      this.dirty = true;
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.stats = { bytes: 0, extractions: 0, cacheHits: 0 };
    this.dirty = true;
  }

  /** Drops entries for paths that are no longer part of the workspace. */
  retainOnly(paths: Iterable<string>): number {
    const keep = new Set([...paths].map(indexKey));
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (!keep.has(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    if (removed) {
      this.dirty = true;
    }
    return removed;
  }

  snapshot(): IndexSnapshot {
    return {
      version: INDEX_FORMAT_VERSION,
      savedAt: this.now(),
      entries: [...this.entries.values()],
      stats: this.getStats(),
    };
  }

  /** Persists the index if it changed. Returns what happened, for logging/tests. */
  async save(force = false): Promise<{ saved: boolean; dropped: number; bytes: number }> {
    if (!this.dirty && !force) {
      return { saved: false, dropped: 0, bytes: 0 };
    }
    const { json, dropped } = serializeSnapshot(this.snapshot(), this.limits);
    await this.storage.write(json);
    this.dirty = false;
    return { saved: true, dropped, bytes: json.length };
  }

  async drop(): Promise<void> {
    this.entries.clear();
    this.stats = { bytes: 0, extractions: 0, cacheHits: 0 };
    this.dirty = false;
    await this.storage.drop();
  }

  dispose(): void {
    this.entries.clear();
  }
}
