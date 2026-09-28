/**
 * All persisted, user-owned state in one place: favorite groups, the external
 * file list, open statistics, and smart-group rules.
 *
 * There is no `vscode` import here. Timers, events, configuration and storage
 * are injected, which means the real logic (not a copy of it) runs under test
 * in `storeCore.test.ts`.
 */
import { planReindex, pruneMissing, rankOpenStats, recordOpenStat, type OpenStat, type RankingStrategy, type ReindexPolicy } from './search/recents.ts';
import { createRule, type RuleConditions, type SmartRule } from './search/smartRules.ts';
import { STATE_VERSION, type FavoriteGroup, type FileRef, type PersistedState } from './types.ts';

const DEFAULT_GROUP_ID = 'default';

/** Minimal key/value store: structurally compatible with `vscode.Memento`. */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface StoreEventEmitter {
  fire(): void;
  dispose(): void;
}

export interface StoreDeps {
  workspaceState: KeyValueStore;
  globalState: KeyValueStore;
  config<T>(key: string, fallback: T): T;
  emitter: StoreEventEmitter;
  /** Injectable clock, for deterministic ranking tests. */
  now?: () => number;
  /** Injectable file existence check, for pruning tests. */
  exists?: (path: string) => boolean;
  /** Schedules a debounced flush; the VS Code adapter supplies a real timer. */
  schedule?: (callback: () => void) => void;
  cancelScheduled?: () => void;
  /** Default group name used when the first favorite is added. */
  defaultGroupName?: string;
}

export function makeId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class StoreCore {
  private state: PersistedState;
  private readonly deps: StoreDeps;
  private readonly now: () => number;
  private readonly exists: (path: string) => boolean;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.exists = deps.exists ?? (() => true);

    const workspace = deps.workspaceState.get<Partial<PersistedState>>('pdfHub.state');
    const globalExternal = deps.globalState.get<FileRef[]>('pdfHub.external');
    // Stored values are untrusted: anything malformed is discarded rather than
    // allowed to poison a collection (a string where an array belongs would
    // otherwise crash the first `.filter` call).
    const asArray = <T>(value: unknown, guard: (entry: unknown) => entry is T): T[] =>
      Array.isArray(value) ? value.filter(guard) : [];

    this.state = {
      version: STATE_VERSION,
      groups: asArray(workspace?.groups, isGroupLike),
      external: asArray(workspace?.external, isFileRefLike),
      recents: asArray(workspace?.recents, isOpenStatLike),
      smartGroups: asArray(workspace?.smartGroups, isSmartRuleLike),
    };
    if (!this.state.external.length) {
      this.state.external = asArray(globalExternal, isFileRefLike);
    }
  }

  private touch(): void {
    this.deps.emitter.fire();
    this.deps.schedule?.(() => void this.flush());
  }

  /** Writes both mementos immediately. */
  async flush(): Promise<void> {
    this.deps.cancelScheduled?.();
    await this.deps.workspaceState.update('pdfHub.state', this.state);
    await this.deps.globalState.update('pdfHub.external', this.state.external);
  }

  // ---------------------------------------------------------------- favorites

  getGroups(): FavoriteGroup[] {
    return this.state.groups.map((group) => ({ ...group, files: [...group.files] }));
  }

  getGroup(id: string): FavoriteGroup | undefined {
    return this.state.groups.find((group) => group.id === id);
  }

  get defaultGroupId(): string {
    return this.state.groups[0]?.id ?? DEFAULT_GROUP_ID;
  }

  createGroup(name: string): FavoriteGroup {
    const trimmed = name.trim() || 'Group';
    const existing = this.state.groups.find((group) => group.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      return existing;
    }
    const group: FavoriteGroup = { id: makeId(this.now()), name: trimmed, files: [], createdAt: this.now() };
    this.state.groups.push(group);
    this.touch();
    return group;
  }

  renameGroup(id: string, name: string): void {
    const group = this.state.groups.find((entry) => entry.id === id);
    if (!group) {
      return;
    }
    group.name = name.trim() || group.name;
    this.touch();
  }

  deleteGroup(id: string): void {
    const index = this.state.groups.findIndex((group) => group.id === id);
    if (index === -1) {
      return;
    }
    this.state.groups.splice(index, 1);
    this.touch();
  }

  /** Adds a file to a group, moving it out of any other group first. */
  addFavorite(file: FileRef, groupId?: string): FavoriteGroup {
    let group = groupId ? this.state.groups.find((entry) => entry.id === groupId) : undefined;
    if (!group) {
      group = this.state.groups.find((entry) => entry.id === this.defaultGroupId);
    }
    if (!group) {
      const created: FavoriteGroup = {
        id: this.state.groups.length ? makeId(this.now()) : DEFAULT_GROUP_ID,
        name: this.deps.defaultGroupName ?? 'Favorites',
        files: [],
        createdAt: this.now(),
      };
      this.state.groups.push(created);
      group = created;
    }

    // A file lives in exactly one group: remove it from the others first.
    const key = normalizeKey(file.path);
    for (const entry of this.state.groups) {
      entry.files = entry.files.filter((candidate) => normalizeKey(candidate.path) !== key);
    }
    group.files.push(file);
    this.touch();
    return group;
  }

  removeFavorite(path: string): boolean {
    const key = normalizeKey(path);
    let changed = false;
    for (const group of this.state.groups) {
      const before = group.files.length;
      group.files = group.files.filter((file) => normalizeKey(file.path) !== key);
      changed = changed || group.files.length !== before;
    }
    if (changed) {
      this.touch();
    }
    return changed;
  }

  isFavorite(path: string): boolean {
    const key = normalizeKey(path);
    return this.state.groups.some((group) => group.files.some((file) => normalizeKey(file.path) === key));
  }

  findFavoriteGroup(path: string): FavoriteGroup | undefined {
    const key = normalizeKey(path);
    return this.state.groups.find((group) => group.files.some((file) => normalizeKey(file.path) === key));
  }

  // ----------------------------------------------------------------- external

  get externalMax(): number {
    const raw = this.deps.config('external.maxItems', 10);
    return Math.max(1, Math.min(10, Math.floor(raw)));
  }

  getExternal(): FileRef[] {
    return [...this.state.external];
  }

  addExternal(file: FileRef): 'added' | 'duplicate' | 'full' {
    const key = normalizeKey(file.path);
    if (this.state.external.some((entry) => normalizeKey(entry.path) === key)) {
      return 'duplicate';
    }
    if (this.state.external.length >= this.externalMax) {
      return 'full';
    }
    this.state.external.push({ ...file, external: true });
    this.touch();
    return 'added';
  }

  removeExternal(path: string): boolean {
    const key = normalizeKey(path);
    const before = this.state.external.length;
    this.state.external = this.state.external.filter((file) => normalizeKey(file.path) !== key);
    if (this.state.external.length !== before) {
      this.touch();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ recents

  recordOpen(fsPath: string, name: string, inProject: boolean, relativePath?: string): void {
    const cap = Math.max(50, this.deps.config('recent.maxItems', 15) * 4);
    this.state.recents = recordOpenStat(
      this.state.recents,
      { path: fsPath, name, inProject, relativePath },
      { now: this.now(), cap }
    );
    this.touch();
  }

  clearRecents(): void {
    this.state.recents = [];
    this.touch();
  }

  getTopFiles(projectOnly: boolean): OpenStat[] {
    return rankOpenStats(this.state.recents, {
      strategy: this.deps.config<RankingStrategy>('recent.ranking', 'hybrid'),
      limit: this.deps.config('recent.maxItems', 15),
      projectOnly,
      now: this.now(),
    });
  }

  /** Drops remembered files that no longer exist on disk. */
  pruneMissing(): number {
    const result = pruneMissing(this.state, (path) => this.exists(path));
    if (result.removed > 0) {
      this.state = { ...this.state, ...result.value, version: STATE_VERSION };
      this.touch();
    }
    return result.removed;
  }

  // -------------------------------------------------------------- smart groups

  /** Returns deep copies so callers cannot mutate stored rules by accident. */
  getSmartGroups(): SmartRule[] {
    return this.state.smartGroups.map(cloneRule);
  }

  getSmartGroup(id: string): SmartRule | undefined {
    const rule = this.state.smartGroups.find((entry) => entry.id === id);
    return rule ? cloneRule(rule) : undefined;
  }

  addSmartGroup(rule: SmartRule): SmartRule {
    this.state.smartGroups.push(rule);
    this.touch();
    return rule;
  }

  /** Creates and stores a rule in one step. */
  createSmartGroup(name: string, conditions: RuleConditions, overrides: Partial<SmartRule> = {}): SmartRule {
    return this.addSmartGroup(createRule(name, conditions, overrides));
  }

  updateSmartGroup(id: string, patch: Partial<SmartRule>): SmartRule | undefined {
    const rule = this.state.smartGroups.find((entry) => entry.id === id);
    if (!rule) {
      return undefined;
    }
    Object.assign(rule, patch, { id: rule.id });
    if (patch.conditions) {
      rule.conditions = { ...patch.conditions };
    }
    this.touch();
    return rule;
  }

  removeSmartGroup(id: string): boolean {
    const index = this.state.smartGroups.findIndex((rule) => rule.id === id);
    if (index === -1) {
      return false;
    }
    this.state.smartGroups.splice(index, 1);
    this.touch();
    return true;
  }

  // -------------------------------------------------------------------- misc

  /** Reads the current index policy from configuration. */
  getReindexPolicy(): ReindexPolicy {
    return {
      trigger: this.deps.config<'onDemand' | 'onViewOpen' | 'onStartup'>('index.trigger', 'onViewOpen'),
      debounceMs: this.deps.config('index.debounceMs', 1500),
      maxDelayMs: this.deps.config('index.maxDelayMs', 10000),
    };
  }

  /** Exposed for tests: asks the pure policy whether a reindex should run. */
  planReindex(reason: 'explicit' | 'change' | 'viewOpen' | 'startup', now: number, pendingSince: number) {
    return planReindex(this.getReindexPolicy(), reason, now, pendingSince);
  }

  snapshot(): PersistedState {
    return JSON.parse(JSON.stringify(this.state)) as PersistedState;
  }

  dispose(): void {
    this.deps.cancelScheduled?.();
    this.deps.emitter.dispose();
  }
}

// ------------------------------------------------------------- shape guards

function isFileRefLike(value: unknown): value is FileRef {
  const candidate = value as FileRef | undefined;
  return Boolean(candidate && typeof candidate.path === 'string' && typeof candidate.name === 'string');
}

function isGroupLike(value: unknown): value is FavoriteGroup {
  const candidate = value as FavoriteGroup | undefined;
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      Array.isArray(candidate.files)
  );
}

function isOpenStatLike(value: unknown): value is OpenStat {
  const candidate = value as OpenStat | undefined;
  return Boolean(
    candidate &&
      typeof candidate.path === 'string' &&
      typeof candidate.count === 'number' &&
      typeof candidate.lastOpened === 'number'
  );
}

function cloneConditions(conditions: SmartRule['conditions']): SmartRule['conditions'] {
  return {
    ...conditions,
    includeGlobs: conditions.includeGlobs ? [...conditions.includeGlobs] : undefined,
    excludeGlobs: conditions.excludeGlobs ? [...conditions.excludeGlobs] : undefined,
    extensions: conditions.extensions ? [...conditions.extensions] : undefined,
  };
}

function cloneRule(rule: SmartRule): SmartRule {
  return { ...rule, conditions: cloneConditions(rule.conditions) };
}

function isSmartRuleLike(value: unknown): value is SmartRule {
  const candidate = value as SmartRule | undefined;
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      candidate.conditions &&
      typeof candidate.conditions === 'object'
  );
}
