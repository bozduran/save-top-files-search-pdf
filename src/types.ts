import type { OpenStat } from './search/recents.ts';
import type { SmartRule } from './search/smartRules.ts';

/** A file that can be opened, either inside a workspace folder or outside every folder. */
export interface FileRef {
  /** Absolute, normalized path. */
  path: string;
  /** Basename, cached so the UI does not have to compute it. */
  name: string;
  /** Folder-relative path when inside the workspace, used for display. */
  relativePath?: string;
  /** Workspace folder that owns the file, when it is inside the project. */
  folderName?: string;
  /** True for files outside every workspace folder (external favorites). */
  external?: boolean;
}

/** A user-named, flat collection of files. Groups never nest. */
export interface FavoriteGroup {
  id: string;
  name: string;
  files: FileRef[];
  createdAt: number;
}

export interface PersistedState {
  version: number;
  groups: FavoriteGroup[];
  external: FileRef[];
  recents: OpenStat[];
  /** Auto-collections defined by rules. */
  smartGroups: SmartRule[];
}

export const STATE_VERSION = 2;

export function emptyState(): PersistedState {
  return { version: STATE_VERSION, groups: [], external: [], recents: [], smartGroups: [] };
}

export type { OpenStat, SmartRule };
