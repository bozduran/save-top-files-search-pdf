import * as vscode from 'vscode';
import type { FileRef } from './types.ts';

/**
 * Builds a `FileRef` for a filesystem path, resolving its workspace folder.
 *
 * Lives outside `types.ts` so the type module stays free of the `vscode`
 * import and can be loaded by the unit tests.
 */
export function toFileRef(fsPath: string): FileRef {
  const normalized = vscode.Uri.file(fsPath).fsPath;
  const name = normalized.replace(/\\/g, '/').split('/').pop() ?? normalized;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalized));
  if (!folder) {
    return { path: normalized, name, external: true };
  }
  return {
    path: normalized,
    name,
    relativePath: vscode.workspace.asRelativePath(vscode.Uri.file(normalized), false),
    folderName: folder.name,
    external: false,
  };
}
