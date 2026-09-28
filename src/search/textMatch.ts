/**
 * Pure text-matching helpers.
 *
 * Deliberately free of any `vscode` import so the matching behaviour (ranking,
 * highlights, page attribution) can be unit tested with plain Node.
 */

export interface PageMatch {
  /** One-based page number. */
  page: number;
  /** 1-based index of the occurrence on that page. */
  ordinal: number;
  /** Text around the match. */
  excerpt: string;
  /** Match offset inside the excerpt, for highlighting. */
  offset: number;
  /** Length of the matched text. */
  length: number;
}

export const EXCERPT_PAD = 60;
export const MAX_MATCHES_PER_FILE = 40;

/** Collapses runs of whitespace so excerpts render on one line. */
function condense(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Finds every occurrence of `needle` across pages, case-insensitively.
 *
 * `pages` and `lowerPages` must be parallel arrays: original text and its
 * lower-cased twin, which keeps the search case-insensitive without
 * re-lower-casing large documents on every keystroke.
 */
export function matchPages(
  pages: string[],
  lowerPages: string[],
  needle: string,
  maxMatches = MAX_MATCHES_PER_FILE
): { matches: PageMatch[]; matchCount: number } {
  const query = needle.toLowerCase();
  const matches: PageMatch[] = [];
  let matchCount = 0;
  if (!query) {
    return { matches, matchCount };
  }

  for (let pageIndex = 0; pageIndex < lowerPages.length; pageIndex += 1) {
    const pageLower = lowerPages[pageIndex];
    const pageText = pages[pageIndex] ?? '';
    let from = 0;
    let ordinal = 0;
    for (;;) {
      const at = pageLower.indexOf(query, from);
      if (at === -1) {
        break;
      }
      ordinal += 1;
      matchCount += 1;
      if (matches.length < maxMatches) {
        const start = Math.max(0, at - EXCERPT_PAD);
        const end = Math.min(pageText.length, at + query.length + EXCERPT_PAD);
        const raw = pageText.slice(start, end);
        const condensed = condense(raw);
        // Re-anchor the offset inside the condensed excerpt: everything before
        // the match shrinks by the whitespace that was collapsed away.
        const before = condense(pageText.slice(start, at));
        const offset = before.length;
        matches.push({
          page: pageIndex + 1,
          ordinal,
          excerpt: `${start > 0 ? '…' : ''}${condensed}${end < pageText.length ? '…' : ''}`,
          offset: Math.min(offset + (start > 0 ? 1 : 0), condensed.length),
          length: query.length,
        });
      }
      from = at + query.length;
    }
  }
  return { matches, matchCount };
}

export interface NameMatch<T> {
  file: T;
  score: number;
}

/**
 * Ranks files whose name matches best, then falls back to path matches.
 * A name hit always outranks a path-only hit.
 */
export function rankNameMatches<T extends { name: string; relativePath?: string }>(
  files: T[],
  query: string
): T[] {
  const needle = query.toLowerCase();
  if (!needle) {
    return [];
  }
  const scored: NameMatch<T>[] = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    const rel = (file.relativePath ?? '').toLowerCase();
    const inName = name.indexOf(needle);
    const inPath = rel.indexOf(needle);
    if (inName !== -1) {
      scored.push({ file, score: 1000 - inName * 5 });
    } else if (inPath !== -1) {
      scored.push({ file, score: 500 - inPath * 2 });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name));
  return scored.map((row) => row.file);
}
