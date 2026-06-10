import { createMockEl } from '@test/helpers/mockElement';

import type { VaultTurnDiff } from '@/core/types/diff';
import { renderVaultTurnDiff } from '@/features/chat/rendering/VaultTurnDiffRenderer';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

describe('VaultTurnDiffRenderer', () => {
  it('renders aggregate stats, file sections, text diffs, and metadata-only rows', () => {
    const parentEl = createMockEl();
    const diff: VaultTurnDiff = {
      id: 'diff-1',
      createdAt: 1,
      fileCount: 2,
      stats: { added: 1, removed: 1 },
      files: [
        {
          path: 'notes/a.md',
          kind: 'modified',
          mode: 'text',
          diffLines: [
            { type: 'delete', text: 'old', oldLineNum: 1 },
            { type: 'insert', text: 'new', newLineNum: 1 },
          ],
          stats: { added: 1, removed: 1 },
          beforeSize: 3,
          afterSize: 3,
        },
        {
          path: 'image.png',
          kind: 'modified',
          mode: 'binary',
          diffLines: [],
          stats: { added: 0, removed: 0 },
          beforeSize: 10,
          afterSize: 11,
          note: 'Binary file changed',
        },
      ],
    };

    const blockEl = renderVaultTurnDiff(parentEl, diff);

    expect(blockEl.hasClass('claudian-vault-diff-block')).toBe(true);
    expect(blockEl.querySelector('.claudian-vault-diff-name')?.textContent).toBe('Vault changes');
    expect(blockEl.querySelector('.claudian-vault-diff-summary')?.textContent).toBe('2 files');
    expect(blockEl.querySelector('.added')?.textContent).toBe('+1');
    expect(blockEl.querySelector('.removed')?.textContent).toBe('-1');
    expect(Array.from(blockEl.querySelectorAll('.claudian-vault-diff-path')).map(el => el.textContent))
      .toEqual(['notes/a.md', 'image.png']);
    expect(Array.from(blockEl.querySelectorAll('.claudian-diff-text')).map(el => el.textContent))
      .toEqual(['old', 'new']);
    expect(blockEl.querySelector('.claudian-vault-diff-note')?.textContent).toBe('Binary file changed');
    expect(blockEl.querySelector('.claudian-vault-diff-size')?.textContent).toBe('before 10 B, after 11 B');
  });

  it('makes diff lines of existing files clickable but not deleted files', () => {
    const parentEl = createMockEl();
    const diff: VaultTurnDiff = {
      id: 'diff-2',
      createdAt: 1,
      fileCount: 2,
      stats: { added: 1, removed: 1 },
      files: [
        {
          path: 'notes/a.md',
          kind: 'modified',
          mode: 'text',
          diffLines: [{ type: 'insert', text: 'new', newLineNum: 4 }],
          stats: { added: 1, removed: 0 },
        },
        {
          path: 'notes/gone.md',
          kind: 'deleted',
          mode: 'text',
          diffLines: [{ type: 'delete', text: 'bye', oldLineNum: 1 }],
          stats: { added: 0, removed: 1 },
        },
      ],
    };

    const blockEl = renderVaultTurnDiff(parentEl, diff);
    const clickable = Array.from(
      blockEl.querySelectorAll('.claudian-diff-line-clickable'),
    ) as HTMLElement[];

    expect(clickable).toHaveLength(1);
    expect(clickable[0].dataset.filePath).toBe('notes/a.md');
    expect(clickable[0].dataset.line).toBe('4');
  });
});
