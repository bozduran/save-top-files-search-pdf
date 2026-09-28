import type { SectionProvider, SectionSnapshot } from '../types.ts';
import type { Store } from '../../store.ts';

/** Favorites that live outside every workspace folder. Hard capped at 10. */
export class ExternalFilesProvider implements SectionProvider {
  readonly id = 'external';
  readonly label = 'Outside the project';
  readonly order = 30;

  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async getSections(): Promise<SectionSnapshot[]> {
    const files = this.store.getExternal();
    const max = this.store.externalMax;
    const shots: SectionSnapshot[] = [];
    // Only take up sidebar space once the user actually has external favorites.
    if (files.length === 0) {
      return shots;
    }
    shots.push({
      id: 'external',
      title: 'Favorites outside the project',
      items: files.map((file) => ({ kind: 'file' as const, file })),
      hint: `${files.length}/${max} used — ${max - files.length} slot(s) left`,
    });
    return shots;
  }
}
