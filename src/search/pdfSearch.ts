import * as vscode from 'vscode';
import type { IndexConfig, IndexEnvironment, IndexProgress } from '../indexService.ts';
import { IndexService } from '../indexService.ts';
import type { PdfIndexStore } from './indexStore.ts';
import { matchPages, rankNameMatches, type PageMatch } from './textMatch.ts';
import { findPdfFilesInDirectory } from './workspaceFiles.ts';
import { type FileRef } from '../types.ts';
import { toFileRef } from '../fileRef.ts';

export type PdfPageMatch = PageMatch;

export interface PdfContentHit {
  file: FileRef;
  matchCount: number;
  pages: number;
  matches: PdfPageMatch[];
  /** Set when the file was skipped or only partially indexed. */
  note?: string;
}

/**
 * What the sidebar needs to render indexing status. The service folds the raw
 * `IndexProgress` (which also carries failure and skip counts) into this.
 */
export interface IndexSummary {
  phase: IndexProgress['phase'];
  processed: number;
  total: number;
  currentFile?: string;
  cached: number;
  extracted: number;
  skipped: number;
  failed: number;
  elapsedMs: number;
  summary?: string;
}

export interface PdfSearchDeps {
  /** Persistent, incremental text index. */
  store: PdfIndexStore;
  /** File system access for the indexer. */
  environment: IndexEnvironment;
  /** Indexing limits, read from user settings. */
  config: () => IndexConfig;
}

function config<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('pdfHub').get<T>(key, fallback);
}

/** `findFiles` takes a single GlobPattern, so several excludes become one alternation. */
function toExcludeGlob(patterns: string[]): string | undefined {
  const cleaned = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  if (!cleaned.length) {
    return undefined;
  }
  return cleaned.length === 1 ? cleaned[0] : `{${cleaned.join(',')}}`;
}

/**
 * Turns exclude globs such as `**` + `/node_modules/**` into directory names for
 * the filesystem walk fallback, which only knows how to skip whole folders.
 */
function skipNamesFromGlobs(patterns: string[]): Set<string> {
  const names = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv']);
  for (const pattern of patterns) {
    const match = /\*\*\/([^/*]+)\/\*\*/.exec(pattern.trim());
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

/**
 * PDF discovery plus content search.
 *
 * The text index lives in `IndexService` (persistent and incremental); this
 * class owns discovery and querying, and translates indexing progress into the
 * shape the sidebar shows.
 */
export class PdfSearchService {
  private readonly index: IndexService;
  private readonly emitter = new vscode.EventEmitter<IndexSummary>();
  readonly onProgress = this.emitter.event;
  private lastSummary: IndexSummary = {
    phase: 'idle',
    processed: 0,
    total: 0,
    cached: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 0,
  };
  private fileCache: { files: FileRef[]; at: number } | undefined;

  constructor(deps: PdfSearchDeps) {
    this.index = new IndexService({
      store: deps.store,
      environment: deps.environment,
      config: deps.config,
      onProgress: (progress) => this.publish(progress),
    });
  }

  private publish(progress: IndexProgress): void {
    this.lastSummary = {
      phase: progress.phase,
      processed: progress.processed,
      total: progress.total,
      currentFile: progress.currentFile,
      cached: progress.cached,
      extracted: progress.extracted,
      skipped: progress.skipped,
      failed: progress.failed,
      elapsedMs: progress.elapsedMs,
      summary: progress.summary,
    };
    this.emitter.fire({ ...this.lastSummary });
  }

  get progress(): IndexSummary {
    return { ...this.lastSummary };
  }

  get indexedFileCount(): number {
    return this.index.indexedFiles;
  }

  /** Loads the persisted index. Cheap: one file read, no extraction. */
  async loadIndex(): Promise<number> {
    const result = await this.index.load();
    return result.entries;
  }

  /** Indexes whatever changed. Concurrent calls share one pass. */
  async ensureIndex(): Promise<IndexSummary> {
    await this.index.ensureIndexed();
    return this.progress;
  }

  /** Predicts the cost of a pass without extracting anything. */
  async planIndex() {
    return this.index.planPass();
  }

  cancelIndex(): void {
    this.index.cancel();
  }

  /** Forget one PDF (it changed) or everything. */
  invalidate(fsPath?: string): void {
    this.index.invalidate(fsPath);
    this.fileCache = undefined;
  }

  /** Drops index entries for PDFs that are no longer in the workspace. */
  async pruneIndex(): Promise<number> {
    const removed = await this.index.pruneToKnownFiles();
    if (removed) {
      this.fileCache = undefined;
    }
    return removed;
  }

  /** Rebuilds the index from scratch. */
  async resetIndex(): Promise<void> {
    await this.index.reset();
    this.fileCache = undefined;
  }

  async saveIndex(): Promise<void> {
    await this.index.save(true);
  }

  /** Reads one indexed entry, for search and for tests. */
  peekEntry(filePath: string) {
    return this.index.peekEntry(filePath);
  }

  /**
   * All PDFs in the workspace. Cached briefly so frequent progress pushes and
   * section refreshes do not each trigger a filesystem search.
   */
  async findPdfFiles(force = false): Promise<FileRef[]> {
    const now = Date.now();
    if (!force && this.fileCache && now - this.fileCache.at < 10_000) {
      return this.fileCache.files;
    }

    const exclude = toExcludeGlob(config<string[]>('search.excludeGlobs', []));
    const folders = vscode.workspace.workspaceFolders ?? [];
    const seen = new Set<string>();
    const files: FileRef[] = [];

    const push = (fsPath: string): void => {
      const key = fsPath.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      files.push(toFileRef(fsPath));
    };

    if (folders.length === 0) {
      const found = await vscode.workspace.findFiles('**/*.pdf', exclude, 5000);
      found.forEach((uri) => push(uri.fsPath));
    } else {
      for (const folder of folders) {
        const pattern = new vscode.RelativePattern(folder, '**/*.pdf');
        let found: vscode.Uri[] = [];
        try {
          found = await vscode.workspace.findFiles(pattern, exclude, 5000);
        } catch (error) {
          console.warn('[pdf-hub] workspace search failed, falling back to a filesystem walk:', error);
        }
        if (!found.length) {
          const walked = await findPdfFilesInDirectory(folder.uri.fsPath, {
            skipDirectories: skipNamesFromGlobs(config<string[]>('search.excludeGlobs', [])),
          });
          walked.forEach(push);
          continue;
        }
        found.forEach((uri) => push(uri.fsPath));
      }
    }

    files.sort((a, b) => (a.relativePath ?? a.name).localeCompare(b.relativePath ?? b.name));
    this.fileCache = { files, at: now };
    return files;
  }

  /** Files the content search should consider, honouring the scope setting. */
  async searchableFiles(external: FileRef[]): Promise<FileRef[]> {
    const project = await this.findPdfFiles();
    const scope = config<'project' | 'projectAndExternal'>('search.scope', 'project');
    if (scope !== 'projectAndExternal') {
      return project;
    }
    const key = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
    const known = new Set(project.map((file) => key(file.path)));
    const extra = external.filter(
      (file) => file.path.toLowerCase().endsWith('.pdf') && !known.has(key(file.path))
    );
    return [...project, ...extra];
  }

  /** Searches indexed PDF text. */
  async searchContent(
    query: string,
    files: FileRef[],
    token: vscode.CancellationToken
  ): Promise<PdfContentHit[]> {
    const needle = query.toLowerCase();
    if (!needle) {
      return [];
    }
    await this.index.load();

    const hits: PdfContentHit[] = [];
    for (const file of files) {
      if (token.isCancellationRequested) {
        break;
      }
      const entry = this.index.peekEntry(file.path);
      if (!entry) {
        continue;
      }
      const { matches, matchCount } = matchPages(entry.text, entry.lower, needle);
      if (matchCount > 0) {
        hits.push({
          file,
          matchCount,
          pages: entry.pages,
          matches,
          note: entry.truncated ? 'Indexed partially (size limit)' : undefined,
        });
      }
    }
    hits.sort((a, b) => b.matchCount - a.matchCount || a.file.name.localeCompare(b.file.name));
    return hits;
  }

  /** File-name search, independent of the text index. */
  searchNames(query: string, files: FileRef[]): FileRef[] {
    return rankNameMatches(files, query);
  }

  isIndexed(): boolean {
    return this.index.indexedFiles > 0;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
