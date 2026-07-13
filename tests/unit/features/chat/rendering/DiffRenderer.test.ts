import { createMockEl } from '@test/helpers/mockElement';

import type { DiffLine, StructuredPatchHunk } from '@/core/types/diff';
import { renderDiffContent, splitIntoHunks } from '@/features/chat/rendering/DiffRenderer';
import { countLineChanges, structuredPatchToDiffLines } from '@/utils/diff';

/** Recursively count elements matching a class. */
function countByClass(el: any, cls: string): number {
  let count = el.hasClass(cls) ? 1 : 0;
  for (const child of el._children) count += countByClass(child, cls);
  return count;
}

/** Recursively collect elements matching a class. */
function collectByClass(el: any, cls: string): any[] {
  const out: any[] = el.hasClass(cls) ? [el] : [];
  for (const child of el._children) out.push(...collectByClass(child, cls));
  return out;
}

/** Generate N insert DiffLines. */
function makeInsertLines(n: number): DiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'insert' as const,
    text: `line ${i + 1}`,
    newLineNum: i + 1,
  }));
}

describe('DiffRenderer', () => {
  describe('structuredPatchToDiffLines', () => {
    it('should return empty array for empty hunks', () => {
      const result = structuredPatchToDiffLines([]);
      expect(result).toEqual([]);
    });

    it('should convert a simple insertion hunk', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
        lines: [' line1', '+inserted', ' line2'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 });
      expect(result[1]).toEqual({ type: 'insert', text: 'inserted', newLineNum: 2 });
      expect(result[2]).toEqual({ type: 'equal', text: 'line2', oldLineNum: 2, newLineNum: 3 });
    });

    it('should convert a simple deletion hunk', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 2,
        lines: [' line1', '-deleted', ' line2'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 });
      expect(result[1]).toEqual({ type: 'delete', text: 'deleted', oldLineNum: 2 });
      expect(result[2]).toEqual({ type: 'equal', text: 'line2', oldLineNum: 3, newLineNum: 2 });
    });

    it('should convert a replacement (delete + insert)', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
        lines: [' line1', '-old', '+new', ' line3'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 });
      expect(result[1]).toEqual({ type: 'delete', text: 'old', oldLineNum: 2 });
      expect(result[2]).toEqual({ type: 'insert', text: 'new', newLineNum: 2 });
      expect(result[3]).toEqual({ type: 'equal', text: 'line3', oldLineNum: 3, newLineNum: 3 });
    });

    it('should handle multiple hunks', () => {
      const hunks: StructuredPatchHunk[] = [
        {
          oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
          lines: [' ctx', '-old1', '+new1'],
        },
        {
          oldStart: 10, oldLines: 2, newStart: 10, newLines: 2,
          lines: [' ctx2', '-old2', '+new2'],
        },
      ];
      const result = structuredPatchToDiffLines(hunks);

      expect(result).toHaveLength(6);
      // First hunk
      expect(result[0]).toEqual({ type: 'equal', text: 'ctx', oldLineNum: 1, newLineNum: 1 });
      expect(result[1]).toEqual({ type: 'delete', text: 'old1', oldLineNum: 2 });
      expect(result[2]).toEqual({ type: 'insert', text: 'new1', newLineNum: 2 });
      // Second hunk
      expect(result[3]).toEqual({ type: 'equal', text: 'ctx2', oldLineNum: 10, newLineNum: 10 });
      expect(result[4]).toEqual({ type: 'delete', text: 'old2', oldLineNum: 11 });
      expect(result[5]).toEqual({ type: 'insert', text: 'new2', newLineNum: 11 });
    });

    it('should handle hunk with only insertions (new file)', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 0, oldLines: 0, newStart: 1, newLines: 3,
        lines: ['+line1', '+line2', '+line3'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result).toHaveLength(3);
      expect(result.every(l => l.type === 'insert')).toBe(true);
      expect(result[0]).toEqual({ type: 'insert', text: 'line1', newLineNum: 1 });
      expect(result[1]).toEqual({ type: 'insert', text: 'line2', newLineNum: 2 });
      expect(result[2]).toEqual({ type: 'insert', text: 'line3', newLineNum: 3 });
    });

    it('should handle lines with special characters', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-return "bar";', '+return `bar`;'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result[0].text).toBe('return "bar";');
      expect(result[1].text).toBe('return `bar`;');
    });

    it('should handle unicode content', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
        lines: ['-こんにちは', '+さようなら'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      expect(result[0]).toEqual({ type: 'delete', text: 'こんにちは', oldLineNum: 1 });
      expect(result[1]).toEqual({ type: 'insert', text: 'さようなら', newLineNum: 1 });
    });

    it('should track line numbers correctly across mixed operations', () => {
      const hunks: StructuredPatchHunk[] = [{
        oldStart: 5, oldLines: 4, newStart: 5, newLines: 5,
        lines: [' ctx', '-del1', '-del2', '+ins1', '+ins2', '+ins3', ' ctx2'],
      }];
      const result = structuredPatchToDiffLines(hunks);

      // Context: oldLine=5, newLine=5
      expect(result[0]).toEqual({ type: 'equal', text: 'ctx', oldLineNum: 5, newLineNum: 5 });
      // Deletes: oldLine 6,7
      expect(result[1]).toEqual({ type: 'delete', text: 'del1', oldLineNum: 6 });
      expect(result[2]).toEqual({ type: 'delete', text: 'del2', oldLineNum: 7 });
      // Inserts: newLine 6,7,8
      expect(result[3]).toEqual({ type: 'insert', text: 'ins1', newLineNum: 6 });
      expect(result[4]).toEqual({ type: 'insert', text: 'ins2', newLineNum: 7 });
      expect(result[5]).toEqual({ type: 'insert', text: 'ins3', newLineNum: 8 });
      // Context: oldLine=8, newLine=9
      expect(result[6]).toEqual({ type: 'equal', text: 'ctx2', oldLineNum: 8, newLineNum: 9 });
    });
  });

  describe('countLineChanges', () => {
    it('should return zeros for no changes', () => {
      const diffLines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'equal', text: 'line2', oldLineNum: 2, newLineNum: 2 },
      ];
      const stats = countLineChanges(diffLines);
      expect(stats).toEqual({ added: 0, removed: 0 });
    });

    it('should count inserted lines', () => {
      const diffLines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'insert', text: 'new1', newLineNum: 2 },
        { type: 'insert', text: 'new2', newLineNum: 3 },
        { type: 'equal', text: 'line2', oldLineNum: 2, newLineNum: 4 },
      ];
      const stats = countLineChanges(diffLines);
      expect(stats).toEqual({ added: 2, removed: 0 });
    });

    it('should count deleted lines', () => {
      const diffLines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'delete', text: 'old1', oldLineNum: 2 },
        { type: 'delete', text: 'old2', oldLineNum: 3 },
        { type: 'equal', text: 'line2', oldLineNum: 4, newLineNum: 2 },
      ];
      const stats = countLineChanges(diffLines);
      expect(stats).toEqual({ added: 0, removed: 2 });
    });

    it('should count both insertions and deletions', () => {
      const diffLines: DiffLine[] = [
        { type: 'delete', text: 'old', oldLineNum: 1 },
        { type: 'insert', text: 'new1', newLineNum: 1 },
        { type: 'insert', text: 'new2', newLineNum: 2 },
      ];
      const stats = countLineChanges(diffLines);
      expect(stats).toEqual({ added: 2, removed: 1 });
    });

    it('should return zeros for empty array', () => {
      const stats = countLineChanges([]);
      expect(stats).toEqual({ added: 0, removed: 0 });
    });
  });

  describe('splitIntoHunks', () => {
    it('should return empty array for no changes', () => {
      const diffLines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'equal', text: 'line2', oldLineNum: 2, newLineNum: 2 },
      ];
      const hunks = splitIntoHunks(diffLines);
      expect(hunks).toEqual([]);
    });

    it('should return empty array for empty diff', () => {
      const hunks = splitIntoHunks([]);
      expect(hunks).toEqual([]);
    });

    it('should create single hunk for adjacent changes', () => {
      const diffLines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'delete', text: 'old', oldLineNum: 2 },
        { type: 'insert', text: 'new', newLineNum: 2 },
        { type: 'equal', text: 'line2', oldLineNum: 3, newLineNum: 3 },
      ];
      const hunks = splitIntoHunks(diffLines, 3);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].lines).toHaveLength(4);
    });

    it('should include context lines around changes', () => {
      const lines: DiffLine[] = [];
      // 10 equal lines, then 1 change, then 10 equal lines
      for (let i = 1; i <= 10; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i });
      }
      lines.push({ type: 'insert', text: 'inserted', newLineNum: 11 });
      for (let i = 11; i <= 20; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i + 1 });
      }

      const hunks = splitIntoHunks(lines, 3);

      expect(hunks).toHaveLength(1);
      // Should include 3 context lines before, 1 change, 3 context lines after = 7 lines
      expect(hunks[0].lines.length).toBe(7);
    });

    it('should create multiple hunks for distant changes', () => {
      const lines: DiffLine[] = [];
      // 10 equal lines
      for (let i = 1; i <= 10; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i });
      }
      // 1 change
      lines.push({ type: 'insert', text: 'change1', newLineNum: 11 });
      // 20 equal lines (more than 2*context, so hunks will be separate)
      for (let i = 11; i <= 30; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i + 1 });
      }
      // Another change
      lines.push({ type: 'insert', text: 'change2', newLineNum: 32 });
      // 10 more equal lines
      for (let i = 31; i <= 40; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i + 2 });
      }

      const hunks = splitIntoHunks(lines, 3);

      expect(hunks).toHaveLength(2);
    });

    it('should merge overlapping context regions into single hunk', () => {
      const lines: DiffLine[] = [];
      // 3 equal lines
      for (let i = 1; i <= 3; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i });
      }
      // Change 1
      lines.push({ type: 'insert', text: 'change1', newLineNum: 4 });
      // 4 equal lines (less than 2*3=6, so contexts overlap)
      for (let i = 4; i <= 7; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i + 1 });
      }
      // Change 2
      lines.push({ type: 'insert', text: 'change2', newLineNum: 9 });
      // 3 equal lines
      for (let i = 8; i <= 10; i++) {
        lines.push({ type: 'equal', text: `line${i}`, oldLineNum: i, newLineNum: i + 2 });
      }

      const hunks = splitIntoHunks(lines, 3);

      // Should merge into single hunk since context regions overlap
      expect(hunks).toHaveLength(1);
    });

    it('should calculate correct starting line numbers for hunks', () => {
      const lines: DiffLine[] = [
        { type: 'equal', text: 'line1', oldLineNum: 1, newLineNum: 1 },
        { type: 'equal', text: 'line2', oldLineNum: 2, newLineNum: 2 },
        { type: 'equal', text: 'line3', oldLineNum: 3, newLineNum: 3 },
        { type: 'delete', text: 'old', oldLineNum: 4 },
        { type: 'insert', text: 'new', newLineNum: 4 },
        { type: 'equal', text: 'line5', oldLineNum: 5, newLineNum: 5 },
      ];

      const hunks = splitIntoHunks(lines, 2);

      expect(hunks).toHaveLength(1);
      expect(hunks[0].oldStart).toBe(2); // Context starts at line 2
      expect(hunks[0].newStart).toBe(2);
    });

    it('should split on a line-number gap even when lines are array-adjacent', () => {
      // A context-trimmed diff drops the unchanged span between two distant
      // edits, leaving the surviving context lines adjacent in the array but
      // discontinuous in line numbers. Each edit must stay its own hunk.
      const lines: DiffLine[] = [
        { type: 'equal', text: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'delete', text: 'old', oldLineNum: 2 },
        { type: 'insert', text: 'new', newLineNum: 2 },
        { type: 'equal', text: 'b', oldLineNum: 3, newLineNum: 3 },
        // gap: lines 4..49 were trimmed out
        { type: 'equal', text: 'y', oldLineNum: 50, newLineNum: 50 },
        { type: 'delete', text: 'old2', oldLineNum: 51 },
        { type: 'insert', text: 'new2', newLineNum: 51 },
        { type: 'equal', text: 'z', oldLineNum: 52, newLineNum: 52 },
      ];

      const hunks = splitIntoHunks(lines, 3);

      expect(hunks).toHaveLength(2);
      expect(hunks[0].lines.map(l => l.text)).toEqual(['a', 'old', 'new', 'b']);
      expect(hunks[1].lines.map(l => l.text)).toEqual(['y', 'old2', 'new2', 'z']);
      // Starts come from absolute line numbers, not the trimmed array position.
      expect([hunks[0].oldStart, hunks[0].newStart]).toEqual([1, 1]);
      expect([hunks[1].oldStart, hunks[1].newStart]).toEqual([50, 50]);
    });

    it('should not split a large deletion that keeps line numbers contiguous', () => {
      // Deleting a run advances only old line numbers, with no skipped lines —
      // that is one hunk, not a gap.
      const lines: DiffLine[] = [
        { type: 'equal', text: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'delete', text: 'd1', oldLineNum: 2 },
        { type: 'delete', text: 'd2', oldLineNum: 3 },
        { type: 'delete', text: 'd3', oldLineNum: 4 },
        { type: 'equal', text: 'b', oldLineNum: 5, newLineNum: 2 },
      ];

      expect(splitIntoHunks(lines, 3)).toHaveLength(1);
    });
  });

  describe('renderDiffContent', () => {
    it('should render all lines when all-inserts count is within cap', () => {
      const container = createMockEl();
      const lines = makeInsertLines(20);

      renderDiffContent(container, lines);

      // All 20 insert lines rendered, no separator
      expect(countByClass(container, 'claudian-diff-insert')).toBe(20);
      expect(countByClass(container, 'claudian-diff-separator')).toBe(0);
    });

    it('should cap all-inserts diff at 20 lines with remainder message', () => {
      const container = createMockEl();
      const lines = makeInsertLines(100);

      renderDiffContent(container, lines);

      // Only 20 insert lines rendered
      expect(countByClass(container, 'claudian-diff-insert')).toBe(20);

      // Separator shows remaining count
      const separator = container._children.find(
        (c: any) => c.hasClass('claudian-diff-separator'),
      );
      expect(separator).toBeDefined();
      expect(separator.textContent).toBe('... 80 more lines');
    });

    it('should render a separator between hunks split by a line-number gap', () => {
      const container = createMockEl();
      const lines: DiffLine[] = [
        { type: 'equal', text: 'a', oldLineNum: 1, newLineNum: 1 },
        { type: 'insert', text: 'ins1', newLineNum: 2 },
        { type: 'equal', text: 'b', oldLineNum: 2, newLineNum: 3 },
        // gap
        { type: 'equal', text: 'y', oldLineNum: 40, newLineNum: 41 },
        { type: 'insert', text: 'ins2', newLineNum: 42 },
        { type: 'equal', text: 'z', oldLineNum: 41, newLineNum: 43 },
      ];

      renderDiffContent(container, lines, 3);

      expect(countByClass(container, 'claudian-diff-hunk')).toBe(2);
      const separators = collectByClass(container, 'claudian-diff-separator');
      expect(separators).toHaveLength(1);
      expect(separators[0].textContent).toBe('...');
    });

    it('should not cap mixed diff lines (edits with context)', () => {
      const container = createMockEl();
      // Build a diff with equal + insert lines — not all-inserts
      const lines: DiffLine[] = [
        { type: 'equal', text: 'ctx', oldLineNum: 1, newLineNum: 1 },
        ...makeInsertLines(30),
      ];

      renderDiffContent(container, lines);

      // All 30 insert lines rendered (not capped because not all-inserts)
      expect(countByClass(container, 'claudian-diff-insert')).toBe(30);
    });

    describe('clickable lines (filePath)', () => {
      const mixed: DiffLine[] = [
        { type: 'equal', text: 'ctx', oldLineNum: 5, newLineNum: 5 },
        { type: 'delete', text: 'gone', oldLineNum: 6 },
        { type: 'insert', text: 'added', newLineNum: 6 },
      ];

      it('tags each line with the file path, target line, and clickable class', () => {
        const container = createMockEl();
        renderDiffContent(container, mixed, 3, { filePath: 'notes/todo.md' });

        const lines = collectByClass(container, 'claudian-diff-line');
        expect(lines).toHaveLength(3);
        for (const line of lines) {
          expect(line.hasClass('claudian-diff-line-clickable')).toBe(true);
          expect(line.dataset.filePath).toBe('notes/todo.md');
        }
        // equal -> newLineNum 5, delete -> nearest preceding newLineNum (5), insert -> newLineNum 6
        expect(lines[0].dataset.line).toBe('5');
        expect(lines[1].dataset.line).toBe('5');
        expect(lines[2].dataset.line).toBe('6');
      });

      it('falls back to line 1 for a leading delete with no preceding new line', () => {
        const container = createMockEl();
        const lines: DiffLine[] = [
          { type: 'delete', text: 'first', oldLineNum: 1 },
          { type: 'insert', text: 'replacement', newLineNum: 1 },
        ];
        renderDiffContent(container, lines, 3, { filePath: 'a.md' });

        const rendered = collectByClass(container, 'claudian-diff-line');
        expect(rendered[0].dataset.line).toBe('1');
        expect(rendered[1].dataset.line).toBe('1');
      });

      it('tags capped new-file inserts with their line numbers', () => {
        const container = createMockEl();
        renderDiffContent(container, makeInsertLines(100), 3, { filePath: 'new.md' });

        const lines = collectByClass(container, 'claudian-diff-line');
        expect(lines).toHaveLength(20);
        expect(lines[0].dataset.filePath).toBe('new.md');
        expect(lines[0].dataset.line).toBe('1');
        expect(lines[19].dataset.line).toBe('20');
      });

      it('does not tag lines when no filePath is provided', () => {
        const container = createMockEl();
        renderDiffContent(container, mixed);

        const lines = collectByClass(container, 'claudian-diff-line');
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.hasClass('claudian-diff-line-clickable')).toBe(false);
          expect(line.dataset.filePath).toBeUndefined();
          expect(line.dataset.line).toBeUndefined();
        }
      });
    });
  });
});
