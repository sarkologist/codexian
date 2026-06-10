import type { App, Workspace, WorkspaceLeaf } from 'obsidian';

import { openVaultFileAtLine, revealWorkspaceLeaf } from '@/utils/obsidianCompat';

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

    it('opens the file in a tab scrolled to the 0-based line', async () => {
      const file = { path: 'notes/todo.md', basename: 'todo' };
      const { app, openLinkText } = makeApp(file);

      await openVaultFileAtLine(app, 'notes/todo.md', 12);

      expect(openLinkText).toHaveBeenCalledWith('notes/todo.md', '', 'tab', { eState: { line: 11 } });
    });

    it('clamps the line to zero for line 1', async () => {
      const file = { path: 'a.md', basename: 'a' };
      const { app, openLinkText } = makeApp(file);

      await openVaultFileAtLine(app, 'a.md', 1);

      expect(openLinkText).toHaveBeenCalledWith('a.md', '', 'tab', { eState: { line: 0 } });
    });

    it('is a no-op when the file does not exist', async () => {
      const { app, openLinkText } = makeApp(null);

      await openVaultFileAtLine(app, 'missing.md', 3);

      expect(openLinkText).not.toHaveBeenCalled();
    });
  });
});
