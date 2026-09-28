/**
 * Pure ranking and pruning logic for the "most opened" section and for
 * remembering files between sessions. No `vscode` import, so it is unit tested.
 */

export interface OpenStat {
  path: string;
  name: string;
  /** How many times the file was opened/activated. */
  count: number;
  /** Epoch ms of the most recent open. */
  lastOpened: number;
  /** Whether the file still resolves inside the current project. */
  inProject: boolean;
  relativePath?: string;
}

export type RankingStrategy = 'frequency' | 'recent' | 'hybrid';

export interface RankingOptions {
  strategy: RankingStrategy;
  limit: number;
  /** Only consider files currently inside the project. */
  projectOnly?: boolean;
  now?: number;
}

/**
 * Ranks remembered files.
 *
 * `hybrid` blends open count with a recency decay (~3 weeks), so a daily driver
 * beats a file opened 200 times two years ago.
 */
export function rankOpenStats(stats: OpenStat[], options: RankingOptions): OpenStat[] {
  const now = options.now ?? Date.now();
  const rows = stats.filter((row) => (options.projectOnly ? row.inProject : true));

  const scored = rows.map((row) => {
    const ageHours = Math.max(0, (now - row.lastOpened) / 3_600_000);
    const recency = 1 / (1 + ageHours / 48);
    const score =
      options.strategy === 'frequency'
        ? row.count
        : options.strategy === 'recent'
          ? row.lastOpened
          : row.count * 1.5 + recency * 10;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, Math.max(1, options.limit)).map((entry) => ({ ...entry.row }));
}

export interface PrunableCollections {
  recents: OpenStat[];
  external: { path: string }[];
  groups: { files: { path: string }[] }[];
}

export interface PruneResult<T extends PrunableCollections> {
  value: T;
  removed: number;
}

/** Drops remembered files that no longer exist on disk. */
export function pruneMissing<T extends PrunableCollections>(
  value: T,
  exists: (path: string) => boolean
): PruneResult<T> {
  const before =
    value.recents.length +
    value.external.length +
    value.groups.reduce((total, group) => total + group.files.length, 0);

  const recents = value.recents.filter((row) => exists(row.path));
  const external = value.external.filter((file) => exists(file.path));
  const groups = value.groups.map((group) => ({
    ...group,
    files: group.files.filter((file) => exists(file.path)),
  }));

  const after =
    recents.length + external.length + groups.reduce((total, group) => total + group.files.length, 0);

  return {
    value: { ...value, recents, external, groups } as T,
    removed: before - after,
  };
}

/**
 * Records an open, updating count and timestamp, and trims the history.
 * Returns a new array; the input is not mutated.
 */
export function recordOpenStat(
  stats: OpenStat[],
  entry: { path: string; name: string; inProject: boolean; relativePath?: string },
  options: { now?: number; cap?: number } = {}
): OpenStat[] {
  const now = options.now ?? Date.now();
  const cap = Math.max(1, options.cap ?? 200);
  const key = entry.path.replace(/\\/g, '/').toLowerCase();

  const existing = stats.find((row) => row.path.replace(/\\/g, '/').toLowerCase() === key);
  const next: OpenStat[] = existing
    ? stats.map((row) =>
        row === existing
          ? {
              ...row,
              count: row.count + 1,
              lastOpened: now,
              name: entry.name,
              inProject: entry.inProject,
              relativePath: entry.relativePath,
            }
          : row
      )
    : [
        ...stats,
        {
          path: entry.path,
          name: entry.name,
          count: 1,
          lastOpened: now,
          inProject: entry.inProject,
          relativePath: entry.relativePath,
        },
      ];

  next.sort((a, b) => b.lastOpened - a.lastOpened);
  return next.slice(0, cap);
}

/**
 * Decides when the background index should (re)run.
 *
 * The point is to avoid recomputing an unchanged corpus: opening a window,
 * switching tabs or saving an unrelated file must not trigger PDF text
 * extraction. Only an explicit request, an opted-in startup policy, or a real
 * PDF change schedules work, and repeated change events are coalesced.
 */
export interface ReindexPolicy {
  /**
   * - `onDemand`: only when search or a command needs the index
   * - `onViewOpen`: when the sidebar is opened (default)
   * - `onStartup`: shortly after activation, in the background
   */
  trigger: 'onDemand' | 'onViewOpen' | 'onStartup';
  /** Delay before a change-triggered pass runs. */
  debounceMs: number;
  /** Upper bound on how long a pass may be postponed by a steady stream of changes. */
  maxDelayMs: number;
}

export interface ReindexSchedule {
  runNow: boolean;
  delayMs: number;
}

/**
 * Coalesces reindex requests.
 *
 * `pendingSince` is the timestamp of the first pending request (0 when none).
 * The returned schedule either runs immediately (explicit request), waits out
 * the debounce, or fires once `maxDelayMs` has elapsed so continuous edits
 * cannot postpone indexing forever.
 */
export function planReindex(
  policy: ReindexPolicy,
  reason: 'explicit' | 'change' | 'viewOpen' | 'startup',
  now: number,
  pendingSince: number
): ReindexSchedule {
  if (reason === 'explicit') {
    return { runNow: true, delayMs: 0 };
  }
  if (reason === 'change') {
    const waited = pendingSince > 0 ? now - pendingSince : 0;
    if (pendingSince > 0 && waited >= policy.maxDelayMs) {
      return { runNow: true, delayMs: 0 };
    }
    const remaining = Math.max(0, policy.debounceMs - waited);
    // The debounce has already elapsed: index now instead of waiting on a timer.
    return remaining === 0 ? { runNow: true, delayMs: 0 } : { runNow: false, delayMs: remaining };
  }
  if (reason === 'viewOpen') {
    return policy.trigger === 'onDemand'
      ? { runNow: false, delayMs: 0 }
      : { runNow: true, delayMs: 0 };
  }
  // startup
  return policy.trigger === 'onStartup' ? { runNow: true, delayMs: 0 } : { runNow: false, delayMs: 0 };
}

/** Cheap summary of what a pass will cost, shown before indexing starts. */
export function describeScan(unchanged: number, changed: number, bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  if (changed === 0) {
    return `Nothing to index — ${unchanged} PDF(s) already cached`;
  }
  return `${changed} PDF(s) need indexing (${size})${unchanged ? `, ${unchanged} unchanged` : ''}`;
}
