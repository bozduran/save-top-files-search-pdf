import * as vscode from 'vscode';
import { ProviderRegistry } from './api/registry.ts';
import { PdfSearchProvider } from './api/providers/pdfSearchProvider.ts';
import { RecentFilesProvider } from './api/providers/recentProvider.ts';
import { FavoritesProvider } from './api/providers/favoritesProvider.ts';
import { ExternalFilesProvider } from './api/providers/externalProvider.ts';
import { SmartGroupsProvider } from './api/providers/smartGroupsProvider.ts';
import type { SearchProvider, SectionProvider } from './api/types.ts';
import { registerCommands, registerSmartGroupCommands } from './commands.ts';
import { PdfIndexStore } from './search/indexStore.ts';
import { PdfSearchService } from './search/pdfSearch.ts';
import { pdfTextExtractor } from './search/pdfText.ts';
import { Store } from './store.ts';
import { type FileRef } from './types.ts';
import { toFileRef } from './fileRef.ts';
import { HubViewProvider } from './ui/hubViewProvider.ts';
import { readIndexConfig, VscodeIndexEnvironment } from './vscodeIndexEnvironment.ts';

/**
 * Public extension API. Any other extension can call
 * `vscode.extensions.getExtension('local-dev.pdf-hub')?.activate()` and then
 * register additional search or section providers, so new functionality does
 * not require editing the sidebar.
 */
export interface PdfHubApi {
  registerSearchProvider(provider: SearchProvider): vscode.Disposable;
  registerSectionProvider(provider: SectionProvider): vscode.Disposable;
  addToFavorites(fsPath: string, groupId?: string): void;
  getGroups(): { id: string; name: string; count: number }[];
  createGroup(name: string): string;
  /** Smart groups (auto-collections) management. */
  listSmartGroups(): { id: string; name: string; enabled: boolean; description: string }[];
  createSmartGroup(name: string, conditions: Record<string, unknown>): string;
  reindex(options?: { force?: boolean }): Promise<{ phase: string; extracted: number; cached: number }>;
  hook(name: string, callback: (...args: unknown[]) => unknown): vscode.Disposable;
  readonly version: string;
  /**
   * Internal test hook so the packaged bundle's PDF pipeline can be verified
   * outside the extension host. Not part of the supported API surface.
   */
  readonly __test: {
    extractPdfText(data: Uint8Array): Promise<string[]>;
    findPdfFiles(): Promise<FileRef[]>;
  };
}

/** Disk-backed storage for the persistent index (workspace-scoped). */
function indexStorage(context: vscode.ExtensionContext) {
  const uri = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'pdf-index.json');
  return {
    async read(): Promise<string | undefined> {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString('utf8');
      } catch {
        return undefined;
      }
    },
    async write(contents: string): Promise<void> {
      const folder = vscode.Uri.joinPath(uri, '..');
      await vscode.workspace.fs.createDirectory(folder);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(contents, 'utf8'));
    },
    async drop(): Promise<void> {
      try {
        await vscode.workspace.fs.delete(uri);
      } catch {
        /* already gone */
      }
    },
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<PdfHubApi> {
  const store = new Store(context);
  const indexStore = new PdfIndexStore(indexStorage(context));
  const registry = new ProviderRegistry();

  // The environment is created first, then given the service's file listing, so
  // neither depends on a half-constructed version of the other.
  const environment = new VscodeIndexEnvironment();
  const service = new PdfSearchService({
    store: indexStore,
    environment,
    config: readIndexConfig,
  });
  environment.useFileList(() => service.findPdfFiles(true));

  // -------------------------------------------------------------- providers
  const externalFiles = (): FileRef[] => store.getExternal();
  registry.registerSearchProvider(new PdfSearchProvider(service, externalFiles));
  registry.registerSectionProvider(new RecentFilesProvider(store, () => serviceFiles));
  registry.registerSectionProvider(new FavoritesProvider(store));
  registry.registerSectionProvider(new SmartGroupsProvider(store, () => serviceFiles));
  registry.registerSectionProvider(new ExternalFilesProvider(store));

  // Cached PDF list, refreshed when the workspace or the PDF index changes.
  let serviceFiles: FileRef[] = [];
  const refreshFileList = async (): Promise<void> => {
    serviceFiles = await service.findPdfFiles(true);
  };

  const openFile = async (file: FileRef): Promise<void> => {
    if (!file.path) {
      return;
    }
    const uri = vscode.Uri.file(file.path);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch {
      // Binary files (including PDFs) open with the default handler instead.
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        void vscode.commands.executeCommand('vscode.open', uri);
      }
    }
  };

  const provider = new HubViewProvider(
    context.extensionUri,
    store,
    service,
    registry,
    openFile,
    async () => {
      await vscode.commands.executeCommand('pdfHub.addExternalFile');
    },
    {
      create: async () => {
        await vscode.commands.executeCommand('pdfHub.createGroup');
      },
      rename: async (groupId: string) => {
        await vscode.commands.executeCommand('pdfHub.renameGroup', groupId);
      },
      delete: async (groupId: string) => {
        await vscode.commands.executeCommand('pdfHub.deleteGroup', groupId);
      },
    }
  );

  // ----------------------------------------------------------------- indexing

  const pendingChanges = new Set<string>();
  let pendingSince = 0;
  let reindexTimer: NodeJS.Timeout | undefined;

  const runIndex = async (reason: 'explicit' | 'change' | 'viewOpen' | 'startup'): Promise<void> => {
    if (service.progress.phase === 'indexing') {
      return;
    }
    if (pendingChanges.size) {
      for (const path of pendingChanges) {
        service.invalidate(path);
      }
      pendingChanges.clear();
    }
    if (reason !== 'explicit') {
      await refreshFileList();
    }
    const summary = await service.ensureIndex();
    await provider.push();
    void summary;
    await registry.fire('onIndexReady', summary.extracted);
  };

  /**
   * Coalesces reindex requests. Opening a window, switching tabs or saving an
   * unrelated file must not trigger PDF extraction: only real PDF changes,
   * an opted-in startup policy, or an explicit request schedule work.
   */
  const scheduleIndex = (reason: 'explicit' | 'change' | 'viewOpen' | 'startup'): void => {
    if (reason === 'change') {
      pendingSince = pendingSince || Date.now();
    }
    const plan = store.planReindex(reason, Date.now(), pendingSince);
    if (reindexTimer) {
      clearTimeout(reindexTimer);
      reindexTimer = undefined;
    }
    if (plan.runNow) {
      pendingSince = 0;
      void runIndex(reason === 'change' ? 'change' : reason);
      return;
    }
    if (plan.delayMs > 0) {
      reindexTimer = setTimeout(() => {
        reindexTimer = undefined;
        pendingSince = 0;
        void runIndex('change');
      }, plan.delayMs);
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HubViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles((event) => {
      if (event.files.some((uri) => uri.fsPath.toLowerCase().endsWith('.pdf'))) {
        scheduleIndex('change');
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      const pdfs = event.files.filter((uri) => uri.fsPath.toLowerCase().endsWith('.pdf'));
      if (pdfs.length) {
        for (const uri of pdfs) {
          service.invalidate(uri.fsPath);
        }
        scheduleIndex('change');
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      if (event.files.some((file) => file.newUri.fsPath.toLowerCase().endsWith('.pdf'))) {
        scheduleIndex('change');
      }
    })
  );

  // A watcher is only created when the user asked for automatic indexing.
  const watched = vscode.workspace.createFileSystemWatcher('**/*.pdf');
  context.subscriptions.push(
    watched,
    watched.onDidChange((uri) => {
      pendingChanges.add(uri.fsPath);
      scheduleIndex('change');
    }),
    watched.onDidCreate(() => scheduleIndex('change')),
    watched.onDidDelete((uri) => {
      service.invalidate(uri.fsPath);
      scheduleIndex('change');
    })
  );

  const serviceHolder = service;
  provider.onViewOpened(() => {
    scheduleIndex('viewOpen');
    void serviceHolder.loadIndex().then(() => provider.push());
  });

  registerCommands(context, store, service, () => provider.focus());
  registerSmartGroupCommands(context, store, {
    refresh: async () => {
      await provider.push();
    },
    reindex: async () => {
      scheduleIndex('explicit');
    },
  });

  // ------------------------------------------------------ open-file tracking
  const track = (uri: vscode.Uri | undefined): void => {
    if (!uri || uri.scheme !== 'file') {
      return;
    }
    const ref = toFileRef(uri.fsPath);
    store.recordOpen(ref.path, ref.name, !ref.external, ref.relativePath);
    void registry.fire('onFileOpened', ref);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => track(editor?.document.uri)),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.opened) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        if (input?.uri && input.uri.scheme === 'file') {
          track(input.uri);
        }
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      store.pruneMissing();
      void refreshFileList().then(() => provider.push());
      void service.pruneIndex();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pdfHub')) {
        void provider.push();
      }
    })
  );

  // Cheap startup work only: load the persisted index and honour the trigger
  // policy. An unchanged corpus costs a single file read plus a stat pass.
  store.pruneMissing();
  await service.loadIndex().catch(() => 0);
  await refreshFileList().catch(() => undefined);
  await provider.push().catch(() => undefined);
  scheduleIndex('startup');
  setTimeout(() => void service.pruneIndex().catch(() => 0), 15_000);

  const api: PdfHubApi = {
    registerSearchProvider: (p) => toDisposable(registry.registerSearchProvider(p)),
    registerSectionProvider: (p) => toDisposable(registry.registerSectionProvider(p)),
    addToFavorites: (fsPath, groupId) => {
      store.addFavorite(toFileRef(fsPath), groupId);
    },
    getGroups: () =>
      store.getGroups().map((group) => ({ id: group.id, name: group.name, count: group.files.length })),
    createGroup: (name) => store.createGroup(name).id,
    listSmartGroups: () =>
      store.getSmartGroups().map((rule) => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        description: rule.description ?? '',
      })),
    createSmartGroup: (name, conditions) =>
      store.createSmartGroup(name, conditions as never).id,
    reindex: async (options) => {
      if (options?.force) {
        await service.resetIndex();
      }
      const summary = await service.ensureIndex();
      return { phase: summary.phase, extracted: summary.extracted, cached: summary.cached };
    },
    hook: (name, callback) => toDisposable(registry.hook(name, callback)),
    version: context.extension.packageJSON.version as string,
    __test: {
      extractPdfText: (data) => pdfTextExtractor.extract(data),
      findPdfFiles: () => service.findPdfFiles(true),
    },
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (reindexTimer) {
        clearTimeout(reindexTimer);
      }
      store.dispose();
      service.dispose();
      registry.dispose();
    })
  );

  return api;
}

function toDisposable(value: { dispose(): void }): vscode.Disposable {
  return new vscode.Disposable(() => value.dispose());
}

export function deactivate(): void {
  /* disposables are handled through context.subscriptions */
}
