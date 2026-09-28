import * as vscode from 'vscode';
import { describeRule, validateRule, type RuleConditions, type SmartRule } from './search/smartRules.ts';
import { type FileRef } from './types.ts';
import { toFileRef } from './fileRef.ts';
import type { Store } from './store.ts';
import type { PdfSearchService } from './search/pdfSearch.ts';

const NEW_GROUP_SENTINEL = '__pdfhub_new_group__';
const EXTERNAL_SENTINEL = '__pdfhub_external__';

/** Resolves the files a context-menu command should act on. */
export function resolveTargetFiles(uri?: vscode.Uri): FileRef[] {
  if (uri && uri.scheme === 'file') {
    return [toFileRef(uri.fsPath)];
  }

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file') {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      // Favourites store whole files, so a selection maps to its document.
      return [toFileRef(editor.document.uri.fsPath)];
    }
    return [toFileRef(editor.document.uri.fsPath)];
  }

  // Fall back to whatever is selected in the Explorer.
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = active?.input as { uri?: vscode.Uri } | undefined;
  if (input?.uri && input.uri.scheme === 'file') {
    return [toFileRef(input.uri.fsPath)];
  }
  return [];
}

/**
 * "Add to Favorites": shows the group picker (creating groups on the fly) and
 * routes external files to the capped external list instead.
 */
export async function addToFavorites(store: Store, uris?: vscode.Uri[]): Promise<void> {
  const targets: FileRef[] = [];
  for (const uri of uris ?? []) {
    if (uri.scheme === 'file') {
      targets.push(toFileRef(uri.fsPath));
    }
  }
  if (!targets.length) {
    targets.push(...resolveTargetFiles(undefined));
  }
  if (!targets.length) {
    void vscode.window.showWarningMessage('PDF Hub: no file selected.');
    return;
  }

  const inProject = targets.filter((f) => !f.external);
  const external = targets.filter((f) => f.external);

  if (inProject.length) {
    const groupId = await pickGroup(store, inProject.length > 1 ? `Add ${inProject.length} files to favorites` : 'Add to favorites');
    if (groupId !== undefined) {
      for (const file of inProject) {
        store.addFavorite(file, groupId === NEW_GROUP_SENTINEL ? undefined : groupId);
      }
      showAddedConfirmation(inProject.length, store.getGroup(groupId)?.name);
    }
  }

  if (external.length) {
    await addExternalFiles(store, external);
  }
}

async function pickGroup(store: Store, title: string): Promise<string | undefined> {
  const groups = store.getGroups().map((group) => ({
    label: group.name,
    description: `${group.files.length} file(s)`,
    id: group.id,
  }));

  if (!groups.length) {
    const name = await vscode.window.showInputBox({
      title: 'New favorites group',
      prompt: 'Name the group, for example "Python" or "Java"',
      value: vscode.workspace.getConfiguration('pdfHub').get<string>('favorites.defaultGroupName', 'Favorites'),
      validateInput: (value) => (value.trim().length ? undefined : 'A group name is required'),
    });
    if (name === undefined) {
      return undefined;
    }
    return store.createGroup(name).id;
  }

  const picked = await vscode.window.showQuickPick(
    [
      ...groups,
      { label: '$(add) New group...', description: 'Create another named group', id: NEW_GROUP_SENTINEL },
    ],
    { title, placeHolder: 'Pick a group' }
  );
  if (!picked) {
    return undefined;
  }
  if (picked.id !== NEW_GROUP_SENTINEL) {
    return picked.id;
  }
  const name = await vscode.window.showInputBox({
    title: 'New favorites group',
    prompt: 'Name the group, for example "Python" or "Java"',
    validateInput: (value) => (value.trim().length ? undefined : 'A group name is required'),
  });
  if (name === undefined) {
    return undefined;
  }
  return store.createGroup(name).id;
}

function showAddedConfirmation(count: number, groupName?: string): void {
  const where = groupName ? ` to "${groupName}"` : '';
  void vscode.window.setStatusBarMessage(`PDF Hub: added ${count} file(s)${where}`, 4000);
}

/** Adds external files, respecting the hard cap. */
export async function addExternalFiles(store: Store, files: FileRef[]): Promise<void> {
  let added = 0;
  const skipped: string[] = [];
  for (const file of files) {
    const result = store.addExternal({ ...file, external: true });
    if (result === 'added') {
      added += 1;
    } else {
      skipped.push(`${file.name} (${result === 'full' ? 'list is full' : 'already added'})`);
    }
  }
  if (added) {
    void vscode.window.setStatusBarMessage(`PDF Hub: added ${added} external favorite(s)`, 4000);
  }
  if (skipped.length) {
    const max = store.externalMax;
    const choice = await vscode.window.showWarningMessage(
      `PDF Hub: ${skipped.join(', ')}. The external list holds at most ${max} files.`,
      'Manage external files'
    );
    if (choice) {
      await vscode.commands.executeCommand('pdfHub.focus');
    }
  }
}

/** Multi-select picker for files that live outside the project. */
export async function pickExternalFiles(store: Store): Promise<void> {
  const remaining = store.externalMax - store.getExternal().length;
  if (remaining <= 0) {
    void vscode.window.showWarningMessage(
      `PDF Hub: the external favorites list is full (${store.externalMax}/${store.externalMax}). Remove one first.`
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: `Add (max ${remaining} more)`,
    title: `Add files outside the project — ${remaining} slot(s) left`,
  });
  if (!picked?.length) {
    return;
  }

  const inside = picked.filter((uri) => vscode.workspace.getWorkspaceFolder(uri));
  const outside = picked.filter((uri) => !vscode.workspace.getWorkspaceFolder(uri));
  if (inside.length) {
    void vscode.window.showWarningMessage(
      `PDF Hub: ${inside.length} selected file(s) are inside the project. Use "Add to Favorites" for those.`
    );
  }
  await addExternalFiles(
    store,
    outside.map((uri) => toFileRef(uri.fsPath))
  );
}

export async function createGroup(store: Store): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: 'New favorites group',
    prompt: 'Name the group, for example "Python" or "Java"',
    validateInput: (value) => (value.trim().length ? undefined : 'A group name is required'),
  });
  if (name !== undefined) {
    store.createGroup(name);
  }
}

export async function renameGroup(store: Store, groupId?: string): Promise<void> {
  const group = groupId ? store.getGroup(groupId) : await pickGroupOnly(store);
  if (!group) {
    return;
  }
  const name = await vscode.window.showInputBox({
    title: `Rename "${group.name}"`,
    value: group.name,
    validateInput: (value) => (value.trim().length ? undefined : 'A group name is required'),
  });
  if (name !== undefined) {
    store.renameGroup(group.id, name);
  }
}

export async function deleteGroup(store: Store, groupId?: string): Promise<void> {
  const group = groupId ? store.getGroup(groupId) : await pickGroupOnly(store);
  if (!group) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Delete the group "${group.name}" and its ${group.files.length} favorite(s)?`,
    { modal: true },
    'Delete'
  );
  if (confirmed === 'Delete') {
    store.deleteGroup(group.id);
  }
}

async function pickGroupOnly(store: Store): Promise<ReturnType<Store['getGroup']>> {
  const groups = store.getGroups();
  if (!groups.length) {
    void vscode.window.showInformationMessage('PDF Hub: there are no favorites groups yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    groups.map((group) => ({ label: group.name, description: `${group.files.length} file(s)`, id: group.id })),
    { title: 'Pick a favorites group' }
  );
  return picked ? store.getGroup(picked.id) : undefined;
}

export async function removeFromFavorites(store: Store, uri?: vscode.Uri): Promise<void> {
  const targets = uri ? [toFileRef(uri.fsPath)] : resolveTargetFiles(undefined);
  let removed = 0;
  for (const file of targets) {
    if (store.removeFavorite(file.path)) {
      removed += 1;
    }
    if (store.removeExternal(file.path)) {
      removed += 1;
    }
  }
  if (removed === 0) {
    void vscode.window.showInformationMessage('PDF Hub: that file is not a favorite.');
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  store: Store,
  service: PdfSearchService,
  focus: () => Promise<void>
): void {
  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));
  };

  register('pdfHub.focus', () => focus());
  register('pdfHub.addToFavorites', (uri?: vscode.Uri) => addToFavorites(store, uri ? [uri] : undefined));
  register('pdfHub.addSelectionToFavorites', (uri?: vscode.Uri) => addToFavorites(store, uri ? [uri] : undefined));
  register('pdfHub.removeFromFavorites', (uri?: vscode.Uri) => removeFromFavorites(store, uri));
  register('pdfHub.createGroup', () => createGroup(store));
  register('pdfHub.renameGroup', (groupId?: string) => renameGroup(store, groupId));
  register('pdfHub.deleteGroup', (groupId?: string) => deleteGroup(store, groupId));
  register('pdfHub.addExternalFile', () => pickExternalFiles(store));
  register('pdfHub.clearRecents', () => {
    store.clearRecents();
    void vscode.window.setStatusBarMessage('PDF Hub: recent files cleared', 3000);
  });
  register('pdfHub.reindex', async () => {
    // A rebuild drops the persisted cache and re-extracts everything, which is
    // the escape hatch when an index looks stale.
    await service.resetIndex();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'PDF Hub: rebuilding PDF index' },
      async () => {
        await service.ensureIndex();
      }
    );
    void vscode.window.showInformationMessage('PDF Hub: PDF index rebuilt.');
  });
}

export { EXTERNAL_SENTINEL };

// ------------------------------------------------------------- smart groups

const SMART_PRESETS: {
  label: string;
  detail: string;
  name: string;
  conditions: RuleConditions;
}[] = [
  {
    label: '$(file-pdf) All PDFs',
    detail: '**/*.pdf',
    name: 'All PDFs',
    conditions: { extensions: ['pdf'] },
  },
  {
    label: '$(file-media) Recent PDFs',
    detail: 'changed in the last 30 days',
    name: 'Recent PDFs',
    conditions: { extensions: ['pdf'], modifiedWithinDays: 30 },
  },
  {
    label: '$(markdown) Markdown notes',
    detail: '**/*.md',
    name: 'Markdown notes',
    conditions: { extensions: ['md'] },
  },
  {
    label: '$(calendar) Changed this week',
    detail: 'any file modified in the last 7 days',
    name: 'Changed this week',
    conditions: { modifiedWithinDays: 7 },
  },
  {
    label: '$(edit) Custom pattern...',
    detail: 'Enter your own glob, extension or date rule',
    name: '',
    conditions: {},
  },
];

/** Guided builder for a smart group, with validation feedback. */
export async function createSmartGroup(store: Store): Promise<SmartRule | undefined> {
  const preset = await vscode.window.showQuickPick(
    SMART_PRESETS.map((entry) => ({ label: entry.label, detail: entry.detail, preset: entry })),
    { title: 'New smart group', placeHolder: 'What should it collect?' }
  );
  if (!preset) {
    return undefined;
  }

  let name = preset.preset.name;
  let conditions: RuleConditions = { ...preset.preset.conditions };

  if (!name) {
    const pattern = await vscode.window.showInputBox({
      title: 'New smart group',
      prompt: 'Glob pattern, for example *.pdf, docs/** or invoice-*',
      placeHolder: '**/*.pdf',
      validateInput: (value) => (value.trim() ? undefined : 'A pattern is required'),
    });
    if (pattern === undefined) {
      return undefined;
    }
    conditions = { includeGlobs: [pattern.trim()] };
    name = pattern.trim();
  }

  const finalName = await vscode.window.showInputBox({
    title: 'Name this smart group',
    value: name,
    prompt: 'Shown as a section in the sidebar',
    validateInput: (value) => (value.trim() ? undefined : 'A name is required'),
  });
  if (finalName === undefined) {
    return undefined;
  }

  const rule = store.createSmartGroup(finalName, conditions);
  const problems = validateRule(rule);
  if (problems.length) {
    void vscode.window.showWarningMessage(`PDF Hub: ${problems[0]}`);
    return rule;
  }
  void vscode.window.setStatusBarMessage(`PDF Hub: smart group "${rule.name}" added`, 4000);
  return rule;
}

/** Edits an existing smart group's pattern, or toggles it on/off. */
export async function editSmartGroup(store: Store, groupId?: string): Promise<void> {
  const rules = store.getSmartGroups();
  if (!rules.length) {
    void vscode.window.showInformationMessage('PDF Hub: there are no smart groups yet.');
    return;
  }
  const rule = groupId ? store.getSmartGroup(groupId) : undefined;
  const chosen =
    rule ??
    (await vscode.window
      .showQuickPick(
        rules.map((entry) => ({ label: entry.name, description: describeRule(entry), id: entry.id })),
        { title: 'Edit smart group' }
      )
      .then((picked) => (picked ? store.getSmartGroup(picked.id) : undefined)));
  if (!chosen) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(edit) Change pattern', id: 'pattern' },
      { label: '$(check) Require all conditions', id: 'mode-all' },
      { label: '$(list-ordered) Match any condition', id: 'mode-any' },
      chosen.enabled ? { label: '$(circle-slash) Disable', id: 'disable' } : { label: '$(play) Enable', id: 'enable' },
      { label: '$(trash) Delete', id: 'delete' },
    ],
    { title: chosen.name }
  );
  if (!action) {
    return;
  }

  switch (action.id) {
    case 'pattern': {
      const value = await vscode.window.showInputBox({
        title: `Pattern for "${chosen.name}"`,
        value: (chosen.conditions.includeGlobs ?? []).join(', '),
        prompt: 'Comma-separated globs, for example *.pdf, docs/**',
      });
      if (value === undefined) {
        return;
      }
      const globs = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      store.updateSmartGroup(chosen.id, { conditions: { ...chosen.conditions, includeGlobs: globs } });
      break;
    }
    case 'mode-all':
      store.updateSmartGroup(chosen.id, { matchMode: 'all' });
      break;
    case 'mode-any':
      store.updateSmartGroup(chosen.id, { matchMode: 'any' });
      break;
    case 'disable':
      store.updateSmartGroup(chosen.id, { enabled: false });
      break;
    case 'enable':
      store.updateSmartGroup(chosen.id, { enabled: true });
      break;
    case 'delete':
      await deleteSmartGroup(store, chosen.id);
      return;
    default:
      return;
  }
  void vscode.window.setStatusBarMessage(`PDF Hub: updated "${chosen.name}"`, 3000);
}

export async function deleteSmartGroup(store: Store, groupId?: string): Promise<void> {
  const rule = groupId ? store.getSmartGroup(groupId) : undefined;
  if (!rule) {
    return;
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Delete the smart group "${rule.name}"?`,
    { modal: true },
    'Delete'
  );
  if (confirmed === 'Delete') {
    store.removeSmartGroup(rule.id);
  }
}

export interface SmartGroupHooks {
  refresh: () => Promise<void>;
  reindex: () => Promise<void>;
}

/** Registers the smart-group commands. */
export function registerSmartGroupCommands(
  context: vscode.ExtensionContext,
  store: Store,
  hooks: SmartGroupHooks
): void {
  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown)
    );
  };

  register('pdfHub.createSmartGroup', async () => {
    await createSmartGroup(store);
    await hooks.refresh();
  });
  register('pdfHub.editSmartGroup', async (groupId?: string) => {
    await editSmartGroup(store, groupId);
    await hooks.refresh();
  });
  register('pdfHub.deleteSmartGroup', async (groupId?: string) => {
    await deleteSmartGroup(store, groupId);
    await hooks.refresh();
  });
  register('pdfHub.refreshSmartGroups', async () => {
    await hooks.refresh();
  });
  register('pdfHub.toggleSmartGroup', async (groupId: string) => {
    const rule = store.getSmartGroup(groupId);
    if (rule) {
      store.updateSmartGroup(groupId, { enabled: !rule.enabled });
      await hooks.refresh();
    }
  });
}
