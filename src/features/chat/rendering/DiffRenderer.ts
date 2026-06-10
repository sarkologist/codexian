import type { DiffLine, DiffStats } from '../../../core/types/diff';

export interface DiffHunk {
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
}

export function renderDiffStats(statsEl: HTMLElement, stats: DiffStats): void {
  if (stats.added > 0) {
    const addedEl = statsEl.createSpan({ cls: 'added' });
    addedEl.setText(`+${stats.added}`);
  }
  if (stats.removed > 0) {
    if (stats.added > 0) {
      statsEl.createSpan({ text: ' ' });
    }
    const removedEl = statsEl.createSpan({ cls: 'removed' });
    removedEl.setText(`-${stats.removed}`);
  }
}

export function splitIntoHunks(diffLines: DiffLine[], contextLines = 3): DiffHunk[] {
  if (diffLines.length === 0) return [];

  // Find indices of all changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type !== 'equal') {
      changedIndices.push(i);
    }
  }

  // If no changes, return empty
  if (changedIndices.length === 0) return [];

  // Group changed lines into ranges with context
  const ranges: Array<{ start: number; end: number }> = [];

  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(diffLines.length - 1, idx + contextLines);

    // Merge with previous range if overlapping or adjacent
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = end;
    } else {
      ranges.push({ start, end });
    }
  }

  // Convert ranges to hunks
  const hunks: DiffHunk[] = [];

  for (const range of ranges) {
    const lines = diffLines.slice(range.start, range.end + 1);

    // Find the starting line numbers for this hunk
    let oldStart = 1;
    let newStart = 1;

    // Count lines before this range
    for (let i = 0; i < range.start; i++) {
      const line = diffLines[i];
      if (line.type === 'equal' || line.type === 'delete') oldStart++;
      if (line.type === 'equal' || line.type === 'insert') newStart++;
    }

    hunks.push({ lines, oldStart, newStart });
  }

  return hunks;
}

/** Max lines to render for all-inserts diffs (new file creation). */
const NEW_FILE_DISPLAY_CAP = 20;

export interface RenderDiffContentOptions {
  /** When set, each rendered line becomes clickable and carries this path + its target line. */
  filePath?: string;
}

/**
 * Tags a rendered diff line so it can be clicked to open `filePath` at its location.
 * Deleted lines no longer exist in the new file, so they point at the nearest
 * preceding new-file line (or line 1 when none has been seen yet).
 */
function tagClickableLine(lineEl: HTMLElement, filePath: string, targetLine: number): void {
  lineEl.addClass('claudian-diff-line-clickable');
  lineEl.dataset.filePath = filePath;
  lineEl.dataset.line = String(targetLine);
}

export function renderDiffContent(
  containerEl: HTMLElement,
  diffLines: DiffLine[],
  contextLines = 3,
  opts?: RenderDiffContentOptions
): void {
  containerEl.empty();

  const filePath = opts?.filePath;

  // New file creation: all lines are inserts — cap display to avoid large DOM
  const allInserts = diffLines.length > 0 && diffLines.every(l => l.type === 'insert');
  if (allInserts && diffLines.length > NEW_FILE_DISPLAY_CAP) {
    const hunkEl = containerEl.createDiv({ cls: 'claudian-diff-hunk' });
    diffLines.slice(0, NEW_FILE_DISPLAY_CAP).forEach((line, index) => {
      const lineEl = hunkEl.createDiv({ cls: 'claudian-diff-line claudian-diff-insert' });
      const prefixEl = lineEl.createSpan({ cls: 'claudian-diff-prefix' });
      prefixEl.setText('+');
      const contentEl = lineEl.createSpan({ cls: 'claudian-diff-text' });
      contentEl.setText(line.text || ' ');
      if (filePath) tagClickableLine(lineEl, filePath, line.newLineNum ?? index + 1);
    });
    const remaining = diffLines.length - NEW_FILE_DISPLAY_CAP;
    const separator = containerEl.createDiv({ cls: 'claudian-diff-separator' });
    separator.setText(`... ${remaining} more lines`);
    return;
  }

  const hunks = splitIntoHunks(diffLines, contextLines);

  if (hunks.length === 0) {
    // No changes
    const noChanges = containerEl.createDiv({ cls: 'claudian-diff-no-changes' });
    noChanges.setText('No changes');
    return;
  }

  let lastNewLineNum = 0;

  hunks.forEach((hunk, hunkIndex) => {
    // Add separator between hunks
    if (hunkIndex > 0) {
      const separator = containerEl.createDiv({ cls: 'claudian-diff-separator' });
      separator.setText('...');
    }

    // Render hunk lines
    const hunkEl = containerEl.createDiv({ cls: 'claudian-diff-hunk' });

    for (const line of hunk.lines) {
      const lineEl = hunkEl.createDiv({ cls: `claudian-diff-line claudian-diff-${line.type}` });

      // Line prefix
      const prefix = line.type === 'insert' ? '+' : line.type === 'delete' ? '-' : ' ';
      const prefixEl = lineEl.createSpan({ cls: 'claudian-diff-prefix' });
      prefixEl.setText(prefix);

      // Line content
      const contentEl = lineEl.createSpan({ cls: 'claudian-diff-text' });
      contentEl.setText(line.text || ' '); // Show space for empty lines

      if (line.newLineNum !== undefined) lastNewLineNum = line.newLineNum;
      if (filePath) tagClickableLine(lineEl, filePath, line.newLineNum ?? Math.max(1, lastNewLineNum));
    }
  });
}
