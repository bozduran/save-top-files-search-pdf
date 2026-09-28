import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import type { IndexConfig, IndexEnvironment } from './indexService.ts';
import { pdfTextExtractor } from './search/pdfText.ts';
import type { FileRef } from './types.ts';

/**
 * VS Code/pdf.js adapter for the (tested) `IndexService`.
 *
 * This module is intentionally thin: it reads bytes and hands back extracted
 * pages. All scheduling, caching, cancellation and progress accounting live in
 * `indexService.ts`, where they are covered by unit tests.
 */
export class VscodeIndexEnvironment implements IndexEnvironment {
  private lister: (() => Promise<FileRef[]>) | undefined;

  /**
   * The file listing comes from `PdfSearchService`, which in turn needs this
   * environment. Supplying it after construction keeps the two free of a
   * circular reference.
   */
  useFileList(lister: () => Promise<FileRef[]>): void {
    this.lister = lister;
  }

  async listFiles() {
    if (!this.lister) {
      throw new Error('VscodeIndexEnvironment.useFileList() was never called');
    }
    return this.lister();
  }

  async stat(path: string): Promise<{ mtimeMs: number; size: number } | undefined> {
    const stats = await fs.stat(path).catch(() => undefined);
    if (!stats || !stats.isFile()) {
      return undefined;
    }
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  }

  async read(path: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(path);
    return new Uint8Array(buffer);
  }

  async extract(data: Uint8Array) {
    const pages = await pdfTextExtractor.extract(data);
    return { pages, truncated: false, totalPages: pages.length };
  }
}

/** Reads the indexing configuration from user settings. */
export function readIndexConfig(): IndexConfig {
  const config = vscode.workspace.getConfiguration('pdfHub');
  return {
    maxFileSizeBytes: Math.max(1, config.get<number>('search.maxFileSizeMb', 40)) * 1024 * 1024,
    maxTextCharsPerFile: Math.max(64, config.get<number>('search.maxTextKbPerFile', 2048)) * 1024,
    concurrency: 2,
  };
}
