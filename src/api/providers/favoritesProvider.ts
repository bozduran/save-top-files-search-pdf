import type { SectionProvider, SectionSnapshot } from '../types.ts';
import type { Store } from '../../store.ts';

/**
 * Favorites, grouped by user-named groups (e.g. "Python", "Java").
 * Groups are flat by design: a file belongs to exactly one group.
 */
export class FavoritesProvider implements SectionProvider {
  readonly id = 'favorites';
  readonly label = 'Favorites';
  readonly order = 20;

  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async getSections(): Promise<SectionSnapshot[]> {
    const groups = this.store.getGroups();
    return [
      {
        id: 'favorites',
        title: 'Favorite files',
        groups: groups.map((group) => ({
          id: group.id,
          title: group.name,
          items: group.files.map((file) => ({ kind: 'file' as const, file, groupId: group.id })),
        })),
        hint: groups.length
          ? undefined
          : 'Right-click a file in the Explorer and choose "Add to Favorites".',
      },
    ];
  }
}
