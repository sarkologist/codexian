import type { App } from 'obsidian';

import {
  attachVaultTurnDiffsToMessages,
  buildVaultTurnDiff,
  captureVaultDiffSnapshot,
  collectVaultTurnDiffsFromMessages,
} from '@/utils/vaultTurnDiff';

class FakeVaultAdapter {
  files = new Map<string, string>();
  stats = new Map<string, { mtime: number; size: number }>();
  unreadable = new Set<string>();

  constructor(initialFiles: Record<string, string>) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
      this.stats.set(path, { mtime: 1, size: content.length });
    }
  }

  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = folder ? `${folder}/` : '';
    const files = new Set<string>();
    const folders = new Set<string>();

    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (!rest) continue;
      const slashIndex = rest.indexOf('/');
      if (slashIndex === -1) {
        files.add(path);
      } else {
        folders.add(prefix + rest.slice(0, slashIndex));
      }
    }

    return {
      files: [...files].sort(),
      folders: [...folders].sort(),
    };
  }

  async read(path: string): Promise<string> {
    if (this.unreadable.has(path)) {
      throw new Error('unreadable');
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error('missing');
    }
    return content;
  }

  async stat(path: string): Promise<{ mtime: number; size: number } | null> {
    return this.stats.get(path) ?? null;
  }

  set(path: string, content: string, mtime = 2): void {
    this.files.set(path, content);
    this.stats.set(path, { mtime, size: content.length });
  }

  setStat(path: string, stat: { mtime: number; size: number }): void {
    this.stats.set(path, stat);
  }

  delete(path: string): void {
    this.files.delete(path);
    this.stats.delete(path);
  }
}

function createApp(adapter: FakeVaultAdapter): App {
  return {
    vault: { adapter },
  } as unknown as App;
}

describe('vaultTurnDiff', () => {
  it('returns null when snapshots are unchanged', async () => {
    const adapter = new FakeVaultAdapter({ 'notes/a.md': 'same' });
    const app = createApp(adapter);

    const before = await captureVaultDiffSnapshot(app);
    const after = await captureVaultDiffSnapshot(app);

    expect(buildVaultTurnDiff(before, after, 'diff-1')).toBeNull();
  });

  it('captures added, modified, deleted, hidden, binary, oversized, and unreadable files', async () => {
    const adapter = new FakeVaultAdapter({
      'notes/a.md': 'one\nold\nthree',
      '.obsidian/app.json': '{}',
      'bin.dat': 'a\u0000b',
      'large.md': 'large before',
      'secret.md': 'secret before',
    });
    adapter.setStat('large.md', { mtime: 1, size: 30 });
    adapter.unreadable.add('secret.md');
    const app = createApp(adapter);

    const before = await captureVaultDiffSnapshot(app, { textSizeLimit: 20 });
    adapter.set('notes/a.md', 'one\nnew\nthree');
    adapter.set('notes/new.md', 'created');
    adapter.delete('.obsidian/app.json');
    adapter.set('bin.dat', 'a\u0000c');
    adapter.set('large.md', 'large after', 2);
    adapter.setStat('large.md', { mtime: 2, size: 31 });
    adapter.set('secret.md', 'secret after', 2);
    adapter.unreadable.add('secret.md');

    const after = await captureVaultDiffSnapshot(app, { textSizeLimit: 20 });
    const diff = buildVaultTurnDiff(before, after, 'assistant-1', 123);

    expect(diff).toEqual(expect.objectContaining({
      id: 'assistant-1',
      createdAt: 123,
      fileCount: 6,
    }));
    expect(diff?.files.map(file => [file.path, file.kind, file.mode])).toEqual([
      ['.obsidian/app.json', 'deleted', 'text'],
      ['bin.dat', 'modified', 'binary'],
      ['large.md', 'modified', 'oversized'],
      ['notes/a.md', 'modified', 'text'],
      ['notes/new.md', 'added', 'text'],
      ['secret.md', 'modified', 'unreadable'],
    ]);
    expect(diff?.stats).toEqual({ added: 2, removed: 2 });
    expect(diff?.files.find(file => file.path === 'notes/a.md')?.diffLines.map(line => line.text))
      .toEqual(['one', 'old', 'new', 'three']);
    expect(diff?.files.find(file => file.path === 'bin.dat')?.note).toBe('Binary file changed');
  });

  it('attaches and collects persisted turn diffs by assistant message id', () => {
    const turnDiff = {
      id: 'assistant-native',
      createdAt: 1,
      fileCount: 1,
      stats: { added: 1, removed: 0 },
      files: [{
        path: 'note.md',
        kind: 'added' as const,
        mode: 'text' as const,
        diffLines: [{ type: 'insert' as const, text: 'hi', newLineNum: 1 }],
        stats: { added: 1, removed: 0 },
      }],
    };
    const messages: Array<{
      id: string;
      role: string;
      assistantMessageId?: string;
      contentBlocks: Array<{ type: string; [key: string]: unknown }>;
      vaultDiffs?: Record<string, typeof turnDiff>;
    }> = [{
      id: 'local-assistant',
      role: 'assistant',
      assistantMessageId: 'assistant-native',
      contentBlocks: [],
    }];

    attachVaultTurnDiffsToMessages(messages, { 'assistant-native': turnDiff });

    expect(messages[0].contentBlocks).toEqual([{ type: 'vault_diff', diffId: 'assistant-native' }]);
    expect(messages[0].vaultDiffs).toEqual({ 'assistant-native': turnDiff });
    expect(collectVaultTurnDiffsFromMessages(messages)).toEqual({ 'assistant-native': turnDiff });
  });
});
