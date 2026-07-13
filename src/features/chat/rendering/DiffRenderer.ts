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

  // A context-trimmed diff drops the unchanged span between two distant edits,
  // so the surviving context lines are array-adjacent but discontinuous in line
  // numbers. Split on those jumps first, then hunk each segment on its own so
  // separate edits never merge into one block by raw array adjacency.
  const hunks: DiffHunk[] = [];
  let segStart = 0;
  for (const boundary of [...lineNumberGaps(diffLines), diffLines.length]) {
    collectSegmentHunks(diffLines, segStart, boundary, contextLines, hunks);
    segStart = boundary;
  }
  return hunks;
}

/**
 * Indices at which the diff skipped lines — a jump in old or new line numbers
 * between consecutive lines. Trimming the unchanged gap between distant edits
 * produces exactly these jumps.
 */
function lineNumberGaps(diffLines: DiffLine[]): number[] {
  const gaps: number[] = [];
  let expectedOld: number | undefined;
  let expectedNew: number | undefined;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    let jumped = false;
    if (line.oldLineNum !== undefined) {
      if (expectedOld !== undefined && line.oldLineNum > expectedOld) jumped = true;
      expectedOld = line.oldLineNum + 1;
    }
    if (line.newLineNum !== undefined) {
      if (expectedNew !== undefined && line.newLineNum > expectedNew) jumped = true;
      expectedNew = line.newLineNum + 1;
    }
    if (jumped && i > 0) gaps.push(i);
  }

  return gaps;
}

function collectSegmentHunks(
  diffLines: DiffLine[],
  segStart: number,
  segEnd: number,
  contextLines: number,
  out: DiffHunk[],
): void {
  // Group changed lines in [segStart, segEnd) into ranges with context.
  const ranges: Array<{ start: number; end: number }> = [];

  for (let idx = segStart; idx < segEnd; idx++) {
    if (diffLines[idx].type === 'equal') continue;

    const start = Math.max(segStart, idx - contextLines);
    const end = Math.min(segEnd - 1, idx + contextLines);

    // Merge with previous range if overlapping or adjacent
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = Math.max(ranges[ranges.length - 1].end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  for (const range of ranges) {
    const lines = diffLines.slice(range.start, range.end + 1);
    // Read starts from the hunk's own absolute line numbers rather than counting
    // preceding array entries: after a trimmed gap the array no longer mirrors
    // file position, so counting would report the wrong start for later hunks.
    out.push({
      lines,
      oldStart: firstLineNumber(lines, 'oldLineNum'),
      newStart: firstLineNumber(lines, 'newLineNum'),
    });
  }
}

function firstLineNumber(lines: DiffLine[], key: 'oldLineNum' | 'newLineNum'): number {
  for (const line of lines) {
    const value = line[key];
    if (value !== undefined) return value;
  }
  return 1;
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
