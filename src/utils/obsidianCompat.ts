import type { App, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

export function getVaultFileByPath(app: App, filePath: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (isVaultFile(file)) {
    return file;
  }
  return null;
}

export async function revealWorkspaceLeaf(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
  await workspace.revealLeaf(leaf);
}

/**
 * Opens a vault file in a tab and scrolls to a 1-based line.
 * `eState.line` is 0-based; MarkdownView honors it to scroll to the line.
 * No-op when the file is missing (e.g. it was deleted).
 */
export async function openVaultFileAtLine(app: App, filePath: string, line: number): Promise<void> {
  const file = getVaultFileByPath(app, filePath);
  if (!file) return;
  await app.workspace.openLinkText(file.path, '', 'tab', { eState: { line: Math.max(0, line - 1) } });
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFile>;
  return typeof candidate.path === 'string'
    && typeof candidate.basename === 'string';
}
