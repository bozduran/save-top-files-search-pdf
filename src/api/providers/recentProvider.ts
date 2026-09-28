import type { SectionProvider, SectionSnapshot } from '../types.ts';
import type { Store } from '../../store.ts';
import type { FileRef } from '../../types.ts';

/**
 * "Top files" section: the files you open the most in this project.
 * Ranking strategy comes from `pdfHub.recent.ranking`.
 */
export class RecentFilesProvider implements SectionProvider {
  readonly id = 'recent';
  readonly label = 'Top files';
  readonly order = 10;

  constructor(
    private readonly store: Store,
    private readonly workspaceFiles: () => FileRef[]
  ) {}

  async getSections(): Promise<SectionSnapshot[]> {
    const top = this.store.getTopFiles(true);
    const names = new Map(this.workspaceFiles().map((f) => [f.path.replace(/\\/g, '/').toLowerCase(), f]));
    return [
      {
        id: 'recent',
        title: 'Most opened in this project',
        items: top.map((stat) => {
          const key = stat.path.replace(/\\/g, '/').toLowerCase();
          const known = names.get(key);
          return {
            kind: 'file' as const,
            file: known ?? {
              path: stat.path,
              name: stat.name,
              relativePath: stat.relativePath,
            },
            detail: `${stat.count}×`,
          };
        }),
        hint: top.length ? undefined : 'Open some files and they will show up here.',
      },
    ];
  }
}
