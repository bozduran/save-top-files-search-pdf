/**
 * Shared message protocol between the extension host and the sidebar webview.
 *
 * Keeping this in one place means the UI can grow (new sections, new actions)
 * without touching the transport.
 */

export interface UiFile {
  path: string;
  name: string;
  relativePath?: string;
  detail?: string;
  external?: boolean;
}

export interface UiGroup {
  id: string;
  title: string;
  files: UiFile[];
  /** Explanation of the rule, shown under a smart group's title. */
  hint?: string;
  /** True when the group is an auto-collection rather than a manual list. */
  smart?: boolean;
  enabled?: boolean;
}

export interface UiSection {
  id: string;
  title: string;
  icon: string;
  files?: UiFile[];
  groups?: UiGroup[];
  hint?: string;
  /** Groups can be created via the UI in this section. */
  supportsGroups?: boolean;
  /** Smart groups can be created / edited in this section. */
  supportsSmartGroups?: boolean;
}

export interface UiSearchHit {
  path: string;
  name: string;
  location?: string;
  excerpt?: string;
  matchLength?: number;
  source: string;
}

export interface UiState {
  sections: UiSection[];
  groups: { id: string; name: string; count: number }[];
  externalCount: number;
  externalMax: number;
  index: {
    phase: string;
    processed: number;
    total: number;
    currentFile?: string;
    cached: number;
    extracted: number;
    skipped: number;
    failed: number;
    elapsedMs: number;
    summary?: string;
  };
  search: {
    text: string;
    nameOnly: boolean;
    running: boolean;
    hits: UiSearchHit[];
    note?: string;
    contentSearched: boolean;
  } | null;
}

export type HostToWebview =
  | { type: 'state'; state: UiState }
  | { type: 'error'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'search'; text: string; nameOnly: boolean }
  | { type: 'open'; path: string }
  | { type: 'openExternalPicker' }
  | { type: 'createGroup' }
  | { type: 'renameGroup'; groupId: string }
  | { type: 'deleteGroup'; groupId: string }
  | { type: 'removeFavorite'; path: string }
  | { type: 'removeExternal'; path: string }
  | { type: 'moveToGroup'; path: string; groupId: string }
  | { type: 'reindex' }
  | { type: 'refresh' }
  | { type: 'cancelIndex' }
  | { type: 'createSmartGroup' }
  | { type: 'editSmartGroup'; groupId: string }
  | { type: 'toggleSmartGroup'; groupId: string }
  | { type: 'deleteSmartGroup'; groupId: string };
