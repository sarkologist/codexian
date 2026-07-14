import type { App, PaneType, TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { MarkdownView } from 'obsidian';

/**
 * Where a link should open, following Obsidian's own semantics: `false` reuses
 * the current tab, a `PaneType` opens a new tab/split/window. `Keymap.isModEvent`
 * maps a click to one of these.
 */
export type LinkPaneType = PaneType | boolean;

export function getVaultFileByPath(app: App, filePath: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (isVaultFile(file)) {
    return file;
  }
  return null;
}

/**
 * Resolves a wikilink-style path to a vault file, mirroring how file links are
 * matched at render time: exact path, then linkpath cache, then a `.md` fallback.
 */
function resolveVaultFile(app: App, filePath: string): TFile | null {
  const direct = getVaultFileByPath(app, filePath);
  if (direct) return direct;

  const viaCache = app.metadataCache?.getFirstLinkpathDest(filePath, '');
  if (isVaultFile(viaCache)) return viaCache;

  if (!filePath.endsWith('.md')) {
    const withExt = getVaultFileByPath(app, filePath + '.md');
    if (withExt) return withExt;
  }

  return null;
}

export async function revealWorkspaceLeaf(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
  await workspace.revealLeaf(leaf);
}

/**
 * Opens a vault file and scrolls to a 1-based line.
 * `eState.line` is 0-based; MarkdownView honors it to scroll to the line.
 * No-op when the file is missing (e.g. it was deleted).
 */
export async function openVaultFileAtLine(
  app: App,
  filePath: string,
  line: number,
  newLeaf: LinkPaneType = false,
): Promise<void> {
  const file = resolveVaultFile(app, filePath);
  if (!file) return;
  await app.workspace.openLinkText(file.path, '', newLeaf, { eState: { line: Math.max(0, line - 1) } });
}

/**
 * Opens a vault file and selects an inclusive 1-based line range.
 * Scrolls to the first line via `eState`, then selects through the last line
 * once an editor is available. Falls back to scroll-only in reading view.
 */
export async function openVaultFileAtRange(
  app: App,
  filePath: string,
  startLine: number,
  endLine: number,
  newLeaf: LinkPaneType = false,
): Promise<void> {
  const file = resolveVaultFile(app, filePath);
  if (!file) return;

  const firstLine = Math.min(startLine, endLine);
  const lastLine = Math.max(startLine, endLine);
  await app.workspace.openLinkText(file.path, '', newLeaf, { eState: { line: Math.max(0, firstLine - 1) } });

  const view = app.workspace.getActiveViewOfType?.(MarkdownView);
  if (!view || view.getMode?.() === 'preview' || !view.editor) return;

  const editor = view.editor;
  const maxIndex = Math.max(0, editor.lineCount() - 1);
  const fromIndex = Math.min(Math.max(0, firstLine - 1), maxIndex);
  const toIndex = Math.min(Math.max(0, lastLine - 1), maxIndex);
  const from = { line: fromIndex, ch: 0 };
  const to = { line: toIndex, ch: editor.getLine(toIndex).length };
  editor.setSelection(from, to);
  editor.scrollIntoView({ from, to }, true);
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFile>;
  return typeof candidate.path === 'string'
    && typeof candidate.basename === 'string';
}
