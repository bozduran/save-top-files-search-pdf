import type * as vscode from 'vscode';
import type { FileRef } from '../types.ts';

/**
 * A search provider is any extension point that can answer a query with a list
 * of hits. The PDF content search is implemented as one provider; later
 * features (Office documents, code search, notes, ...) can register more
 * without touching the sidebar or the UI protocol.
 */
export interface SearchHit {
  /** Absolute path of the file containing the hit. */
  path: string;
  /** Display name. */
  name: string;
  /** Human readable location, e.g. "Page 12" or "line 40". */
  location?: string;
  /** Short excerpt around the match. */
  excerpt?: string;
  /** Zero-based match offset inside the excerpt, for highlighting. */
  matchLength?: number;
  /** One-based line number, when the provider can jump to a line. */
  line?: number;
  /** One-based column, when known. */
  column?: number;
  /** Where the hit came from, shown as a badge. */
  source?: string;
}

export interface SearchQuery {
  /** Raw text the user typed. */
  text: string;
  /** Match file names only instead of file contents. */
  nameOnly: boolean;
  /** Cancellation for long running providers. */
  token: vscode.CancellationToken;
}

export interface SearchResult {
  providerId: string;
  label: string;
  hits: SearchHit[];
  /** Set when the provider could not finish (e.g. index missing). */
  note?: string;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  /** Lower runs first; used to present the fastest, cheapest provider on top. */
  readonly order?: number;
  search(query: SearchQuery): Promise<SearchResult>;
}

/** A section is a named list of files (recent files, favorites, ...). */
export interface SectionItem {
  kind: 'file';
  file: FileRef;
  /** Optional right-hand annotation. */
  detail?: string;
  /** Group id, for sections that are grouped. */
  groupId?: string;
}

export interface SectionProvider {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  getSections(): Promise<SectionSnapshot[]>;
}

export interface SectionSnapshot {
  id: string;
  title: string;
  /** Grouped sections (favorites, smart groups) use `groups`. */
  groups?: { id: string; title: string; items: SectionItem[]; hint?: string }[];
  items?: SectionItem[];
  hint?: string;
}
