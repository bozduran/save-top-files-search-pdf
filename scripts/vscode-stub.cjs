/**
 * A very small `vscode` stub so the real bundled `dist/extension.js` can be
 * exercised outside the extension host (integration smoke test).
 * Only the surface the module touches at load/activate time is implemented.
 */
class Disposable {
  constructor(fn) {
    this._fn = fn;
  }
  dispose() {
    this._fn?.();
  }
}
class EventEmitter {
  constructor() {
    this._listeners = new Set();
    this.event = (listener) => {
      this._listeners.add(listener);
      return new Disposable(() => this._listeners.delete(listener));
    };
  }
  fire(value) {
    for (const listener of [...this._listeners]) {
      listener(value);
    }
  }
  dispose() {
    this._listeners.clear();
  }
}
class CancellationTokenSource {
  constructor() {
    this._emitter = new EventEmitter();
    this.token = {
      isCancellationRequested: false,
      onCancellationRequested: this._emitter.event,
    };
  }
  cancel() {
    this.token.isCancellationRequested = true;
    this._emitter.fire();
  }
  dispose() {
    this._emitter.dispose();
  }
}
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  static isEmpty() {
    return true;
  }
}
const Uri = {
  file: (fsPath) => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` }),
  joinPath: (base, ...parts) => ({
    fsPath: [base.fsPath, ...parts].join('/'),
    toString: () => `file://${[base.fsPath, ...parts].join('/')}`,
    with: () => Uri,
  }),
};

const configuration = (section) => ({
  get: (key, fallback) => (section === 'pdfHub' ? fallback : fallback),
});

const memoryFs = new Map();

const workspace = {
  fs: {
    async readFile(uri) {
      const value = memoryFs.get(uri.fsPath);
      if (value === undefined) {
        throw new Error(`ENOENT: ${uri.fsPath}`);
      }
      return Buffer.from(value, 'utf8');
    },
    async writeFile(uri, contents) {
      memoryFs.set(uri.fsPath, Buffer.from(contents).toString('utf8'));
    },
    async createDirectory() {
      /* directories are implicit in the stub */
    },
    async delete(uri) {
      memoryFs.delete(uri.fsPath);
    },
  },
  createFileSystemWatcher: () => ({
    onDidChange: () => new Disposable(),
    onDidCreate: () => new Disposable(),
    onDidDelete: () => new Disposable(),
    dispose: () => undefined,
  }),
  onDidCreateFiles: () => new Disposable(),
  onDidDeleteFiles: () => new Disposable(),
  onDidRenameFiles: () => new Disposable(),
  getConfiguration: configuration,
  workspaceFolders: [],
  getWorkspaceFolder: () => undefined,
  asRelativePath: (uri) => uri.fsPath ?? String(uri),
  findFiles: async (pattern) => {
    // Patterns are either '**/*.pdf' or a RelativePattern; both mean "pdfs".
    const matcher = typeof pattern === 'string' ? pattern : pattern?.pattern ?? '';
    if (!matcher.includes('.pdf')) {
      return [];
    }
    return (module.exports.__pdfFiles ?? []).map((fsPath) => Uri.file(fsPath));
  },
  openTextDocument: async () => {
    throw new Error('no editor in stub');
  },
  onDidSaveTextDocument: () => new Disposable(),
  onDidChangeWorkspaceFolders: () => new Disposable(),
  onDidChangeConfiguration: () => new Disposable(),
};

const window = {
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => new Disposable(),
  showTextDocument: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
  showErrorMessage: async () => undefined,
  setStatusBarMessage: () => new Disposable(),
  withProgress: async (_options, task) => task({ report: () => {} }, new CancellationTokenSource().token),
  registerWebviewViewProvider: () => new Disposable(),
  tabGroups: {
    activeTabGroup: { activeTab: undefined },
    onDidChangeTabs: () => new Disposable(),
  },
};

const commands = {
  registerCommand: () => new Disposable(),
  executeCommand: async () => undefined,
};

const workspaceState = {
  get: () => undefined,
  update: async () => undefined,
};
const globalState = {
  get: () => undefined,
  update: async () => undefined,
};

const extensionContext = {
  subscriptions: [],
  extensionUri: Uri.file('/tmp/pdf-hub-test'),
  storageUri: Uri.file('/tmp/pdf-hub-test/storage'),
  globalStorageUri: Uri.file('/tmp/pdf-hub-test/global-storage'),
  extension: { packageJSON: { version: '0.1.0' } },
  workspaceState,
  globalState,
};

module.exports = {
  __pdfFiles: [],
  Disposable,
  EventEmitter,
  CancellationTokenSource,
  Position,
  Range,
  Uri,
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  workspace,
  window,
  commands,
  env: { openExternal: async () => true },
  extensions: { getExtension: () => undefined },
  __context: extensionContext,
};
