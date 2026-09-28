import * as vscode from 'vscode';
import { StoreCore, type KeyValueStore } from './storeCore.ts';
import type { FileRef, PersistedState, SmartRule } from './types.ts';

export type { FileRef, PersistedState, SmartRule };

/**
 * VS Code adapter around `StoreCore`.
 *
 * Everything domain-specific lives in `storeCore.ts` (which is unit tested);
 * this file only supplies the environment: mementos, configuration, the change
 * event and the debounce timer.
 */
export class Store {
  private readonly core: StoreCore;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.core = new StoreCore({
      workspaceState: asKeyValueStore(context.workspaceState),
      globalState: asKeyValueStore(context.globalState),
      config: <T>(key: string, fallback: T): T =>
        vscode.workspace.getConfiguration('pdfHub').get<T>(key, fallback),
      emitter: { fire: () => this.emitter.fire(), dispose: () => undefined },
      defaultGroupName: vscode.workspace
        .getConfiguration('pdfHub')
        .get<string>('favorites.defaultGroupName', 'Favorites'),
      exists: (path) => {
        try {
          return require('node:fs').existsSync(path) as boolean;
        } catch {
          return false;
        }
      },
      schedule: (callback) => {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(callback, 250);
      },
      cancelScheduled: () => {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = undefined;
        }
      },
    });
  }

  // The core owns the behaviour; the adapter forwards so call sites stay simple.
  get externalMax(): number {
    return this.core.externalMax;
  }

  get defaultGroupId(): string {
    return this.core.defaultGroupId;
  }

  async flush(): Promise<void> {
    await this.core.flush();
  }

  getGroups() {
    return this.core.getGroups();
  }

  getGroup(id: string) {
    return this.core.getGroup(id);
  }

  createGroup(name: string) {
    return this.core.createGroup(name);
  }

  renameGroup(id: string, name: string): void {
    this.core.renameGroup(id, name);
  }

  deleteGroup(id: string): void {
    this.core.deleteGroup(id);
  }

  addFavorite(file: FileRef, groupId?: string) {
    return this.core.addFavorite(file, groupId);
  }

  removeFavorite(path: string): boolean {
    return this.core.removeFavorite(path);
  }

  isFavorite(path: string): boolean {
    return this.core.isFavorite(path);
  }

  findFavoriteGroup(path: string) {
    return this.core.findFavoriteGroup(path);
  }

  getExternal(): FileRef[] {
    return this.core.getExternal();
  }

  addExternal(file: FileRef) {
    return this.core.addExternal(file);
  }

  removeExternal(path: string): boolean {
    return this.core.removeExternal(path);
  }

  recordOpen(fsPath: string, name: string, inProject: boolean, relativePath?: string): void {
    this.core.recordOpen(fsPath, name, inProject, relativePath);
  }

  clearRecents(): void {
    this.core.clearRecents();
  }

  getTopFiles(projectOnly: boolean) {
    return this.core.getTopFiles(projectOnly);
  }

  pruneMissing(): number {
    return this.core.pruneMissing();
  }

  getSmartGroups(): SmartRule[] {
    return this.core.getSmartGroups();
  }

  getSmartGroup(id: string): SmartRule | undefined {
    return this.core.getSmartGroup(id);
  }

  addSmartGroup(rule: SmartRule): SmartRule {
    return this.core.addSmartGroup(rule);
  }

  createSmartGroup(
    name: string,
    conditions: SmartRule['conditions'],
    overrides: Partial<SmartRule> = {}
  ): SmartRule {
    return this.core.createSmartGroup(name, conditions, overrides);
  }

  updateSmartGroup(id: string, patch: Partial<SmartRule>): SmartRule | undefined {
    return this.core.updateSmartGroup(id, patch);
  }

  removeSmartGroup(id: string): boolean {
    return this.core.removeSmartGroup(id);
  }

  getReindexPolicy() {
    return this.core.getReindexPolicy();
  }

  planReindex(reason: 'explicit' | 'change' | 'viewOpen' | 'startup', now: number, pendingSince: number) {
    return this.core.planReindex(reason, now, pendingSince);
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.core.dispose();
    this.emitter.dispose();
  }
}

/** Structural adapter: `vscode.Memento` already satisfies this shape. */
function asKeyValueStore(memento: vscode.Memento): KeyValueStore {
  return {
    get: <T>(key: string) => memento.get<T>(key),
    update: (key: string, value: unknown) => Promise.resolve(memento.update(key, value)),
  };
}
