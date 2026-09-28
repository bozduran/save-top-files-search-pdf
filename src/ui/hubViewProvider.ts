import * as vscode from 'vscode';
import type { FileRef } from '../types.ts';
import type { Store } from '../store.ts';
import type { PdfSearchService, IndexSummary } from '../search/pdfSearch.ts';
import type { ProviderRegistry } from '../api/registry.ts';
import type { SearchHit, SearchResult } from '../api/types.ts';
import type { HostToWebview, UiFile, UiSection, UiState, WebviewToHost } from './protocol.ts';

const SEARCH_DEBOUNCE_MS = 220;

function asUiFile(file: FileRef, detail?: string): UiFile {
  return {
    path: file.path,
    name: file.name,
    relativePath: file.relativePath,
    external: file.external,
    detail,
  };
}

/**
 * Hosts the sidebar. Owns nothing domain-specific: it renders whatever the
 * registered section/search providers return, which is what makes the UI
 * extendable without editing this file.
 */
export class HubViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'pdfHub.main';

  private view: vscode.WebviewView | undefined;
  private state: UiState | undefined;
  private searchText = '';
  private nameOnly = false;
  private searchTimer: NodeJS.Timeout | undefined;
  private searchRun = 0;
  private indexProgress: IndexSummary = {
    phase: 'idle',
    processed: 0,
    total: 0,
    cached: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 0,
  };
  private readonly viewOpenedEmitter = new vscode.EventEmitter<void>();
  /** Fires when the sidebar becomes visible, so indexing can be deferrable. */
  readonly onViewOpened = this.viewOpenedEmitter.event;
  private viewOpenedOnce = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: Store,
    private readonly service: PdfSearchService,
    private readonly registry: ProviderRegistry,
    private readonly openFile: (file: FileRef) => Promise<void>,
    private readonly externalPicker: () => Promise<void>,
    private readonly groupActions: {
      create: () => Promise<void>;
      rename: (groupId: string) => Promise<void>;
      delete: (groupId: string) => Promise<void>;
    }
  ) {
    this.store.onDidChange(() => void this.push());
    this.registry.onDidChange(() => void this.push());
    this.service.onProgress((progress) => {
      this.indexProgress = progress;
      void this.push();
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    if (!this.viewOpenedOnce) {
      this.viewOpenedOnce = true;
      this.viewOpenedEmitter.fire();
    }
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewToHost) => void this.onMessage(message));
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${HubViewProvider.viewType}.focus`);
  }

  /** Recomputes the whole sidebar payload and sends it to the webview. */
  async push(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.buildState();
    this.state = state;
    void this.view.webview.postMessage({ type: 'state', state } satisfies HostToWebview);
  }

  private async buildState(): Promise<UiState> {
    const sections: UiSection[] = [];
    for (const provider of this.registry.getSectionProviders()) {
      try {
        const snapshots = await provider.getSections();
        for (const snapshot of snapshots) {
          sections.push({
            id: snapshot.id,
            title: snapshot.title,
            icon: iconFor(provider.id),
            files: snapshot.items?.map((item) => asUiFile(item.file, item.detail)),
            groups: snapshot.groups?.map((group) => ({
              id: group.id,
              title: group.title,
              files: group.items.map((item) => asUiFile(item.file, item.detail)),
              hint: group.hint,
              smart: provider.id === 'smart',
              enabled: this.store.getSmartGroup(group.id)?.enabled ?? true,
            })),
            hint: snapshot.hint,
            supportsGroups: provider.id === 'favorites',
            supportsSmartGroups: provider.id === 'smart',
          });
        }
      } catch (error) {
        sections.push({
          id: `${provider.id}-error`,
          title: provider.label,
          icon: 'warning',
          files: [],
          hint: `Provider failed: ${String(error)}`,
        });
      }
    }

    this.state = {
      sections,
      groups: this.store.getGroups().map((g) => ({ id: g.id, name: g.name, count: g.files.length })),
      externalCount: this.store.getExternal().length,
      externalMax: this.store.externalMax,
      index: {
        phase: this.indexProgress.phase,
        processed: this.indexProgress.processed,
        total: this.indexProgress.total,
        currentFile: this.indexProgress.currentFile,
        cached: this.indexProgress.cached,
        extracted: this.indexProgress.extracted,
        skipped: this.indexProgress.skipped,
        failed: this.indexProgress.failed,
        elapsedMs: this.indexProgress.elapsedMs,
        summary: this.indexProgress.summary,
      },
      search: this.state?.search ?? null,
    };
    return this.state;
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.push();
        return;
      case 'search':
        this.searchText = message.text;
        this.nameOnly = message.nameOnly;
        this.scheduleSearch();
        return;
      case 'open': {
        await this.openFile({ path: message.path, name: message.path.split(/[\\/]/).pop() ?? message.path });
        return;
      }
      case 'openExternalPicker':
        await this.externalPicker();
        return;
      case 'createGroup':
        await this.groupActions.create();
        return;
      case 'renameGroup':
        await this.groupActions.rename(message.groupId);
        return;
      case 'deleteGroup':
        await this.groupActions.delete(message.groupId);
        return;
      case 'removeFavorite':
        this.store.removeFavorite(message.path);
        return;
      case 'removeExternal':
        this.store.removeExternal(message.path);
        return;
      case 'moveToGroup': {
        const file = this.findFileRef(message.path);
        if (file) {
          this.store.addFavorite(file, message.groupId);
        }
        return;
      }
      case 'reindex':
        await vscode.commands.executeCommand('pdfHub.reindex');
        return;
      case 'cancelIndex':
        this.service.cancelIndex();
        return;
      case 'createSmartGroup':
        await vscode.commands.executeCommand('pdfHub.createSmartGroup');
        return;
      case 'editSmartGroup':
        await vscode.commands.executeCommand('pdfHub.editSmartGroup', message.groupId);
        return;
      case 'toggleSmartGroup':
        await vscode.commands.executeCommand('pdfHub.toggleSmartGroup', message.groupId);
        return;
      case 'deleteSmartGroup':
        await vscode.commands.executeCommand('pdfHub.deleteSmartGroup', message.groupId);
        return;
      case 'refresh':
        await this.push();
        return;
      default:
        return;
    }
  }

  private findFileRef(path: string): FileRef | undefined {
    const key = path.replace(/\\/g, '/').toLowerCase();
    for (const group of this.store.getGroups()) {
      for (const file of group.files) {
        if (file.path.replace(/\\/g, '/').toLowerCase() === key) {
          return file;
        }
      }
    }
    return { path, name: path.split(/[\\/]/).pop() ?? path };
  }

  private scheduleSearch(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => void this.runSearch(), SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(): Promise<void> {
    const text = this.searchText.trim();
    const minChars = Math.max(1, vscode.workspace.getConfiguration('pdfHub').get<number>('search.minChars', 2));
    const run = ++this.searchRun;

    if (!this.view) {
      return;
    }

    if (text.length < minChars) {
      this.state = {
        ...(this.state ?? (await this.buildState())),
        search: null,
      };
      await this.push();
      return;
    }

    const pending: UiState['search'] = {
      text,
      nameOnly: this.nameOnly,
      running: true,
      hits: [],
      contentSearched: !this.nameOnly,
    };
    this.state = { ...(this.state ?? (await this.buildState())), search: pending };
    await this.push();

    const tokenSource = new vscode.CancellationTokenSource();
    const started = Date.now();
    try {
      if (!this.nameOnly) {
        // Make sure content is indexed before claiming a content search result.
        await this.service.ensureIndex();
        if (run !== this.searchRun) {
          tokenSource.cancel();
          return;
        }
      }
      const providers = this.registry.getSearchProviders();
      const results = (
        await Promise.all(
          providers.map((provider) =>
            provider
              .search({
                text,
                nameOnly: this.nameOnly,
                token: tokenSource.token,
              })
              .catch((error): SearchResult => ({ providerId: provider.id, label: provider.label, hits: [], note: String(error) }))
          )
        )
      )
        .filter(Boolean)
        .flat();

      if (run !== this.searchRun || !this.view) {
        tokenSource.cancel();
        return;
      }

      const hits: SearchHit[] = dedupeHits(results.flatMap((r) => r.hits));
      const notes = results.map((r) => r.note).filter((n): n is string => Boolean(n));
      const note = notes.length
        ? notes[0]
        : `${hits.length} match(es) in ${Date.now() - started} ms`;

      this.state = {
        ...(this.state ?? (await this.buildState())),
        search: {
          text,
          nameOnly: this.nameOnly,
          running: false,
          hits: hits.slice(0, 300).map((hit) => ({
            path: hit.path,
            name: hit.name,
            location: hit.location,
            excerpt: hit.excerpt,
            matchLength: hit.matchLength,
            source: hit.source ?? 'search',
          })),
          note,
          contentSearched: !this.nameOnly,
        },
      };
      await this.push();
    } catch (error) {
      if (this.view) {
        void this.view.webview.postMessage({ type: 'error', message: String(error) } satisfies HostToWebview);
      }
    } finally {
      tokenSource.dispose();
    }
  }

  dispose(): void {
    this.viewOpenedEmitter.dispose();
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'main.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>PDF Hub</title>
  </head>
  <body>
    <div id="app" data-nonce="${nonce}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = `${hit.path.toLowerCase()}|${hit.location ?? ''}|${hit.source ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function iconFor(providerId: string): string {
  switch (providerId) {
    case 'recent':
      return 'history';
    case 'favorites':
      return 'star';
    case 'external':
      return 'link-external';
    default:
      return 'list';
  }
}
