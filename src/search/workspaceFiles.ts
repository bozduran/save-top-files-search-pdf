import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

export interface WalkOptions {
  /** Directory names that are always skipped. */
  skipDirectories?: Set<string>;
  /** Maximum number of PDFs returned. */
  limit?: number;
  /** Maximum directory depth below the root. */
  maxDepth?: number;
}

const DEFAULT_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv']);

/**
 * Depth-first search for PDFs below `root`.
 *
 * This exists as a fallback for the workspace search API: it is used when
 * searching the filesystem directly is preferable (very large repos, or a
 * search API failure). It is plain Node, so it is unit testable.
 */
export async function findPdfFilesInDirectory(root: string, options: WalkOptions = {}): Promise<string[]> {
  const skip = options.skipDirectories ?? DEFAULT_SKIP;
  const limit = options.limit ?? 5000;
  const maxDepth = options.maxDepth ?? 24;
  const found: string[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || found.length >= limit) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip silently
    }
    for (const entry of entries) {
      if (found.length >= limit) {
        return;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await visit(absolute, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        found.push(absolute);
      }
    }
  };

  await visit(root, 0);
  return found;
}
