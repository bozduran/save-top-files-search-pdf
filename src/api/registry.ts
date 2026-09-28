import type { SearchProvider, SectionProvider } from './types.ts';

/**
 * Tiny registry that makes the extension extendable without editing the UI.
 *
 * Other extensions can reach it through the exported activation API:
 *
 *   const ext = vscode.extensions.getExtension('local-dev.pdf-hub');
 *   const api = await ext.activate();
 *   api.registerSearchProvider(myProvider);
 *
 * Inside this extension, the same registry is used by the built-in providers.
 */
export class ProviderRegistry {
  private readonly searchProviders = new Map<string, SearchProvider>();
  private readonly sectionProviders = new Map<string, SectionProvider>();
  /** Generic feature hooks: name -> callbacks, for future functionality. */
  private readonly hooks = new Map<string, Set<(...args: unknown[]) => unknown>>();
  /** Called whenever the registry changes, so the sidebar can re-query. */
  private readonly listeners = new Set<() => void>();

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* a broken listener must not break the registry */
      }
    }
  }

  registerSearchProvider(provider: SearchProvider): { dispose(): void } {
    if (this.searchProviders.has(provider.id)) {
      throw new Error(`Search provider "${provider.id}" is already registered.`);
    }
    this.searchProviders.set(provider.id, provider);
    this.notify();
    return { dispose: () => this.unregisterSearchProvider(provider.id) };
  }

  unregisterSearchProvider(id: string): void {
    if (this.searchProviders.delete(id)) {
      this.notify();
    }
  }

  registerSectionProvider(provider: SectionProvider): { dispose(): void } {
    if (this.sectionProviders.has(provider.id)) {
      throw new Error(`Section provider "${provider.id}" is already registered.`);
    }
    this.sectionProviders.set(provider.id, provider);
    this.notify();
    return { dispose: () => this.unregisterSectionProvider(provider.id) };
  }

  unregisterSectionProvider(id: string): void {
    if (this.sectionProviders.delete(id)) {
      this.notify();
    }
  }

  getSearchProviders(): SearchProvider[] {
    return [...this.searchProviders.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  getSectionProviders(): SectionProvider[] {
    return [...this.sectionProviders.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** Extension hook: `api.hook('onFileOpened', fn)` to observe or extend behaviour. */
  hook(name: string, callback: (...args: unknown[]) => unknown): { dispose(): void } {
    let set = this.hooks.get(name);
    if (!set) {
      set = new Set();
      this.hooks.set(name, set);
    }
    set.add(callback);
    return { dispose: () => set?.delete(callback) };
  }

  async fire(name: string, ...args: unknown[]): Promise<void> {
    const set = this.hooks.get(name);
    if (!set) {
      return;
    }
    for (const callback of [...set]) {
      try {
        await callback(...args);
      } catch {
        /* hook failures are isolated */
      }
    }
  }

  dispose(): void {
    this.searchProviders.clear();
    this.sectionProviders.clear();
    this.hooks.clear();
    this.listeners.clear();
  }
}
