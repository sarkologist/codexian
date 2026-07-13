import type { App } from 'obsidian';

import {
  attachVaultTurnDiffsToMessages,
  buildVaultTurnDiff,
  buildVaultTurnDiffFromToolCalls,
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

  it('captures added, modified, deleted, binary, oversized, and unreadable files while excluding hidden files', async () => {
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
      fileCount: 5,
    }));
    // .obsidian/app.json is hidden, so its deletion is not tracked.
    expect(diff?.files.map(file => [file.path, file.kind, file.mode])).toEqual([
      ['bin.dat', 'modified', 'binary'],
      ['large.md', 'modified', 'oversized'],
      ['notes/a.md', 'modified', 'text'],
      ['notes/new.md', 'added', 'text'],
      ['secret.md', 'modified', 'unreadable'],
    ]);
    expect(diff?.stats).toEqual({ added: 2, removed: 1 });
    expect(diff?.files.find(file => file.path === 'notes/a.md')?.diffLines.map(line => line.text))
      .toEqual(['one', 'old', 'new', 'three']);
    expect(diff?.files.find(file => file.path === 'bin.dat')?.note).toBe('Binary file changed');
  });

  it('localises distant edits into separate regions with unchanged context between them dropped', async () => {
    const before = Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join('\n');
    const adapter = new FakeVaultAdapter({ 'notes/a.md': before });
    const app = createApp(adapter);

    const beforeSnap = await captureVaultDiffSnapshot(app);
    // Two edits far apart: line 2 and line 18.
    const afterLines = before.split('\n');
    afterLines[1] = 'L2x';
    afterLines[17] = 'L18x';
    adapter.set('notes/a.md', afterLines.join('\n'));
    const afterSnap = await captureVaultDiffSnapshot(app);

    const diff = buildVaultTurnDiff(beforeSnap, afterSnap, 'diff-multi');
    const file = diff?.files.find(f => f.path === 'notes/a.md');
    const lines = file?.diffLines ?? [];

    // Both edits are present as delete+insert pairs.
    expect(lines).toEqual(expect.arrayContaining([
      { type: 'delete', text: 'L2', oldLineNum: 2 },
      { type: 'insert', text: 'L2x', newLineNum: 2 },
      { type: 'delete', text: 'L18', oldLineNum: 18 },
      { type: 'insert', text: 'L18x', newLineNum: 18 },
    ]));
    expect(file?.stats).toEqual({ added: 2, removed: 2 });

    // The unchanged middle (roughly lines 6..14) is dropped, so the equal
    // context lines are discontinuous — that gap is what lets the renderer
    // split this into two localised hunks.
    const equalOldNums = lines.filter(l => l.type === 'equal').map(l => l.oldLineNum);
    expect(equalOldNums).toContain(5); // trailing context of the first edit
    expect(equalOldNums).toContain(15); // leading context of the second edit
    expect(equalOldNums.some(n => n !== undefined && n >= 7 && n <= 13)).toBe(false);
  });

  it('keeps unchanged lines between nearby edits so they stay one region', async () => {
    const before = 'a\nb\nc\nd\ne';
    const adapter = new FakeVaultAdapter({ 'notes/near.md': before });
    const app = createApp(adapter);

    const beforeSnap = await captureVaultDiffSnapshot(app);
    adapter.set('notes/near.md', 'a\nB\nc\nD\ne'); // edits 2 lines apart
    const afterSnap = await captureVaultDiffSnapshot(app);

    const diff = buildVaultTurnDiff(beforeSnap, afterSnap, 'diff-near');
    const lines = diff?.files.find(f => f.path === 'notes/near.md')?.diffLines ?? [];

    // The single unchanged line 'c' between the edits is preserved (no gap).
    expect(lines.some(l => l.type === 'equal' && l.text === 'c')).toBe(true);
    expect(lines.filter(l => l.type !== 'equal').map(l => l.text)).toEqual(['b', 'B', 'd', 'D']);
  });

  it('skips the whole-vault snapshot when the indexed file count exceeds the cap', async () => {
    const adapter = new FakeVaultAdapter({ 'notes/a.md': 'x' });
    const app = {
      vault: {
        adapter,
        getFiles: () => new Array(50).fill({ path: 'f' }),
      },
    } as unknown as App;

    expect(await captureVaultDiffSnapshot(app, { fileCountCap: 10 })).toBeNull();
    expect(await captureVaultDiffSnapshot(app, { fileCountCap: 100 })).not.toBeNull();
  });

  it('builds a turn diff from tool-call diff data (touched files)', () => {
    const toolCalls = [
      {
        diffData: {
          filePath: 'wiki/a.md',
          diffLines: [{ type: 'insert' as const, text: 'first', newLineNum: 1 }],
          stats: { added: 1, removed: 0 },
        },
      },
      {
        diffData: {
          filePath: 'wiki/a.md',
          diffLines: [{ type: 'insert' as const, text: 'final', newLineNum: 2 }],
          stats: { added: 1, removed: 0 },
        },
      },
      {
        diffData: {
          filePath: 'log.md',
          diffLines: [{ type: 'delete' as const, text: 'gone', oldLineNum: 1 }],
          stats: { added: 0, removed: 1 },
        },
      },
      { diffData: undefined },
    ];

    const diff = buildVaultTurnDiffFromToolCalls(toolCalls, 'assistant-2', 7);

    expect(diff).toEqual(expect.objectContaining({ id: 'assistant-2', createdAt: 7, fileCount: 2 }));
    expect(diff?.stats).toEqual({ added: 1, removed: 1 });
    // Files sorted by path; the later edit of wiki/a.md supersedes the earlier one.
    expect(diff?.files.map(file => file.path)).toEqual(['log.md', 'wiki/a.md']);
    expect(diff?.files.find(file => file.path === 'wiki/a.md')?.diffLines).toEqual([
      { type: 'insert', text: 'final', newLineNum: 2 },
    ]);
  });

  it('returns null from tool-call builder when no tool touched a file', () => {
    expect(buildVaultTurnDiffFromToolCalls([{ diffData: undefined }], 'x')).toBeNull();
    expect(buildVaultTurnDiffFromToolCalls(undefined, 'x')).toBeNull();
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
