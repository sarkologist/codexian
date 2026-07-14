import type { App, Workspace, WorkspaceLeaf } from 'obsidian';

import { openVaultFileAtLine, openVaultFileAtRange, revealWorkspaceLeaf } from '@/utils/obsidianCompat';

describe('obsidianCompat', () => {
  describe('revealWorkspaceLeaf', () => {
    it('reveals the workspace leaf', async () => {
      const leaf = {} as WorkspaceLeaf;
      const workspace = {
        revealLeaf: jest.fn().mockResolvedValue(undefined),
      } as unknown as Workspace;

      await revealWorkspaceLeaf(workspace, leaf);

      expect((workspace as unknown as { revealLeaf: jest.Mock }).revealLeaf).toHaveBeenCalledWith(leaf);
    });
  });

  describe('openVaultFileAtLine', () => {
    function makeApp(file: unknown): { app: App; openLinkText: jest.Mock } {
      const openLinkText = jest.fn().mockResolvedValue(undefined);
      const app = {
        vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
        workspace: { openLinkText },
      } as unknown as App;
      return { app, openLinkText };
    }

    it('reuses the current tab and scrolls to the 0-based line', async () => {
      const file = { path: 'notes/todo.md', basename: 'todo' };
      const { app, openLinkText } = makeApp(file);

      await openVaultFileAtLine(app, 'notes/todo.md', 12);

      expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', false, { eState: { line: 11 } });
    });

    it('opens in the requested pane when one is given', async () => {
      const file = { path: 'notes/todo.md', basename: 'todo' };
      const { app, openLinkText } = makeApp(file);

      await openVaultFileAtLine(app, 'notes/todo.md', 12, 'tab');

      expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', 'tab', { eState: { line: 11 } });
    });

    it('clamps the line to zero for line 1', async () => {
      const file = { path: 'a.md', basename: 'a' };
      const { app, openLinkText } = makeApp(file);

      await openVaultFileAtLine(app, 'a.md', 1);

      expect(openLinkText).toHaveBeenCalledWith('a.md', '', false, { eState: { line: 0 } });
    });

    it('is a no-op when the file does not exist', async () => {
      const { app, openLinkText } = makeApp(null);

      await openVaultFileAtLine(app, 'missing.md', 3);

      expect(openLinkText).not.toHaveBeenCalled();
    });
  });

  describe('openVaultFileAtRange', () => {
    function makeEditor(lines: string[]) {
      return {
        lineCount: jest.fn().mockReturnValue(lines.length),
        getLine: jest.fn((i: number) => lines[i] ?? ''),
        setSelection: jest.fn(),
        scrollIntoView: jest.fn(),
      };
    }

    function makeApp(file: unknown, view: unknown): {
      app: App;
      openLinkText: jest.Mock;
    } {
      const openLinkText = jest.fn().mockResolvedValue(undefined);
      const app = {
        vault: { getAbstractFileByPath: jest.fn().mockReturnValue(file) },
        metadataCache: { getFirstLinkpathDest: jest.fn().mockReturnValue(null) },
        workspace: { openLinkText, getActiveViewOfType: jest.fn().mockReturnValue(view) },
      } as unknown as App;
      return { app, openLinkText };
    }

    it('opens at the first line and selects through the last line', async () => {
      const file = { path: 'notes/doc.md', basename: 'doc' };
      const editor = makeEditor(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
      const view = { getMode: () => 'source', editor };
      const { app, openLinkText } = makeApp(file, view);

      await openVaultFileAtRange(app, 'notes/doc.md', 2, 5);

      expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', false, { eState: { line: 1 } });
      expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 4, ch: 2 });
    });

    it('opens in the requested pane when one is given', async () => {
      const file = { path: 'notes/doc.md', basename: 'doc' };
      const editor = makeEditor(['l1', 'l2', 'l3']);
      const view = { getMode: () => 'source', editor };
      const { app, openLinkText } = makeApp(file, view);

      await openVaultFileAtRange(app, 'notes/doc.md', 1, 2, 'tab');

      expect(openLinkText).toHaveBeenCalledWith('notes/doc.md', '', 'tab', { eState: { line: 0 } });
      expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 1, ch: 2 });
    });

    it('clamps the last line to the file length', async () => {
      const file = { path: 'a.md', basename: 'a' };
      const editor = makeEditor(['one', 'two']);
      const view = { getMode: () => 'source', editor };
      const { app } = makeApp(file, view);

      await openVaultFileAtRange(app, 'a.md', 1, 99);

      expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 1, ch: 3 });
    });

    it('normalizes a reversed range', async () => {
      const file = { path: 'a.md', basename: 'a' };
      const editor = makeEditor(['one', 'two', 'three', 'four']);
      const view = { getMode: () => 'source', editor };
      const { app, openLinkText } = makeApp(file, view);

      await openVaultFileAtRange(app, 'a.md', 4, 2);

      expect(openLinkText).toHaveBeenCalledWith('a.md', '', false, { eState: { line: 1 } });
      expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 3, ch: 4 });
    });

    it('clamps a range that starts past the end of file', async () => {
      const file = { path: 'short.md', basename: 'short' };
      const editor = makeEditor(['one', 'two']);
      const view = { getMode: () => 'source', editor };
      const { app } = makeApp(file, view);

      await openVaultFileAtRange(app, 'short.md', 200, 250);

      expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 1, ch: 3 });
    });

    it('scrolls but does not select in reading view', async () => {
      const file = { path: 'a.md', basename: 'a' };
      const editor = makeEditor(['one', 'two']);
      const view = { getMode: () => 'preview', editor };
      const { app, openLinkText } = makeApp(file, view);

      await openVaultFileAtRange(app, 'a.md', 1, 2);

      expect(openLinkText).toHaveBeenCalledWith('a.md', '', false, { eState: { line: 0 } });
      expect(editor.setSelection).not.toHaveBeenCalled();
    });

    it('is a no-op when the file does not exist', async () => {
      const { app, openLinkText } = makeApp(null, null);

      await openVaultFileAtRange(app, 'missing.md', 1, 2);

      expect(openLinkText).not.toHaveBeenCalled();
    });
  });
});
