import type { FileRef } from '../../types.ts';
import type { SearchHit, SearchProvider, SearchQuery, SearchResult } from '../types.ts';
import type { PdfSearchService } from '../../search/pdfSearch.ts';

/**
 * Searches PDFs two ways:
 *  - "name only" mode filters file names/paths,
 *  - otherwise it searches extracted PDF text (with the file-name hits kept on
 *    top so a query like "invoice" still finds `invoice-2024.pdf`).
 */
export class PdfSearchProvider implements SearchProvider {
  readonly id = 'pdf';
  readonly label = 'PDF';
  readonly order = 10;

  constructor(
    private readonly service: PdfSearchService,
    private readonly getExternal: () => FileRef[]
  ) {}

  async search(query: SearchQuery): Promise<SearchResult> {
    const files = await this.service.searchableFiles(this.getExternal());
    const nameHits: SearchHit[] = this.service.searchNames(query.text, files).map((file) => ({
      path: file.path,
      name: file.name,
      location: file.relativePath ?? 'external',
      source: 'name',
      excerpt:
        file.relativePath && file.relativePath !== file.name
          ? file.relativePath
          : undefined,
    }));

    if (query.nameOnly) {
      return { providerId: this.id, label: this.label, hits: nameHits };
    }

    await this.service.ensureIndex();
    const contentHits = await this.service.searchContent(query.text, files, query.token);
    const hits: SearchHit[] = [...nameHits];

    for (const hit of contentHits) {
      if (query.token.isCancellationRequested) {
        break;
      }
      for (const match of hit.matches.slice(0, 5)) {
        hits.push({
          path: hit.file.path,
          name: hit.file.name,
          location: `Page ${match.page}`,
          excerpt: match.excerpt,
          matchLength: match.length,
          source: 'content',
        });
      }
      if (hit.matches.length > 5) {
        hits.push({
          path: hit.file.path,
          name: hit.file.name,
          location: `${hit.matchCount - 5} more matches`,
          excerpt: `Open to see the remaining matches in ${hit.file.name}`,
          source: 'content',
        });
      }
    }

    const note = this.service.isIndexed() ? undefined : 'Content index still warming up';
    return { providerId: this.id, label: this.label, hits, note };
  }
}
