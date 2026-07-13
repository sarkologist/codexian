import type { App } from 'obsidian';

import type {
  DiffLine,
  DiffStats,
  VaultTurnDiff,
  VaultTurnDiffFile,
  VaultTurnDiffFileKind,
  VaultTurnDiffFileMode,
} from '../core/types/diff';
import { countLineChanges } from './diff';

export const VAULT_TURN_DIFF_TEXT_SIZE_LIMIT = 1024 * 1024;

// A whole-vault snapshot reads every file twice per turn. Past this many files
// the walk is too expensive (and risks throwing) on large vaults, so we skip it
// and let the tool-call fallback build the diff from touched files instead.
export const VAULT_TURN_DIFF_FILE_COUNT_CAP = 20000;

interface VaultAdapterLike {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  stat?(path: string): Promise<{ mtime: number; size: number } | null>;
}

interface ToolCallDiffLike {
  diffData?: { filePath: string; diffLines: DiffLine[]; stats: DiffStats };
}

interface VaultFileSnapshot {
  path: string;
  mode: VaultTurnDiffFileMode;
  size?: number;
  mtime?: number;
  content?: string;
}

export interface VaultDiffSnapshot {
  files: Map<string, VaultFileSnapshot>;
}

export async function captureVaultDiffSnapshot(
  app: App,
  options: { textSizeLimit?: number; fileCountCap?: number } = {},
): Promise<VaultDiffSnapshot | null> {
  try {
    const textSizeLimit = options.textSizeLimit ?? VAULT_TURN_DIFF_TEXT_SIZE_LIMIT;
    const fileCountCap = options.fileCountCap ?? VAULT_TURN_DIFF_FILE_COUNT_CAP;

    // Cheap over-cap short-circuit: Obsidian's file index is in-memory and
    // already excludes hidden folders, so a huge vault bails before any I/O.
    const indexedCount = getIndexedFileCount(app);
    if (indexedCount !== null && indexedCount > fileCountCap) return null;

    const adapter = app.vault.adapter as unknown as VaultAdapterLike;
    const paths = await listVaultFiles(adapter, '', fileCountCap);
    if (paths.length > fileCountCap) return null;

    const files = new Map<string, VaultFileSnapshot>();
    for (const filePath of paths) {
      files.set(filePath, await readFileSnapshot(adapter, filePath, textSizeLimit));
    }

    return { files };
  } catch {
    return null;
  }
}

function getIndexedFileCount(app: App): number | null {
  const getFiles = (app.vault as { getFiles?: () => unknown[] }).getFiles;
  if (typeof getFiles !== 'function') return null;
  try {
    return getFiles.call(app.vault).length;
  } catch {
    return null;
  }
}

/**
 * Builds a turn diff from the turn's Write/Edit tool results instead of a
 * whole-vault snapshot. Used when the vault is too large to snapshot; each
 * touched file is diffed from its final edit's pre-computed patch, so line
 * numbers stay coherent for jump-to-file even when a file is edited repeatedly.
 */
export function buildVaultTurnDiffFromToolCalls(
  toolCalls: ToolCallDiffLike[] | undefined,
  diffId: string,
  createdAt = Date.now(),
): VaultTurnDiff | null {
  if (!toolCalls || toolCalls.length === 0) return null;

  const byPath = new Map<string, { diffLines: DiffLine[]; stats: DiffStats }>();
  for (const call of toolCalls) {
    const data = call.diffData;
    if (!data || data.diffLines.length === 0) continue;
    // Later edits supersede earlier ones so the shown diff matches the file's
    // final state (and its line numbers point at that state).
    byPath.set(data.filePath, { diffLines: data.diffLines, stats: data.stats });
  }

  if (byPath.size === 0) return null;

  const files: VaultTurnDiffFile[] = [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, entry]) => ({
      path,
      kind: 'modified' as VaultTurnDiffFileKind,
      mode: 'text' as VaultTurnDiffFileMode,
      diffLines: entry.diffLines,
      stats: entry.stats,
    }));

  const stats = files.reduce<DiffStats>(
    (acc, file) => ({
      added: acc.added + file.stats.added,
      removed: acc.removed + file.stats.removed,
    }),
    { added: 0, removed: 0 },
  );

  return { id: diffId, createdAt, files, stats, fileCount: files.length };
}

export function buildVaultTurnDiff(
  before: VaultDiffSnapshot | null,
  after: VaultDiffSnapshot | null,
  diffId: string,
  createdAt = Date.now(),
): VaultTurnDiff | null {
  if (!before || !after) return null;

  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
  const files: VaultTurnDiffFile[] = [];

  for (const filePath of paths) {
    const beforeFile = before.files.get(filePath);
    const afterFile = after.files.get(filePath);

    if (!beforeFile && afterFile) {
      files.push(createFileDiff(filePath, 'added', undefined, afterFile));
      continue;
    }

    if (beforeFile && !afterFile) {
      files.push(createFileDiff(filePath, 'deleted', beforeFile, undefined));
      continue;
    }

    if (!beforeFile || !afterFile) continue;
    const fileDiff = createModifiedFileDiff(filePath, beforeFile, afterFile);
    if (fileDiff) files.push(fileDiff);
  }

  if (files.length === 0) return null;

  const stats = files.reduce<DiffStats>(
    (acc, file) => ({
      added: acc.added + file.stats.added,
      removed: acc.removed + file.stats.removed,
    }),
    { added: 0, removed: 0 },
  );

  return {
    id: diffId,
    createdAt,
    files,
    stats,
    fileCount: files.length,
  };
}

export function attachVaultTurnDiffsToMessages(
  messages: Array<{
    id: string;
    role: string;
    assistantMessageId?: string;
    contentBlocks?: Array<{ type: string; [key: string]: unknown }>;
    vaultDiffs?: Record<string, VaultTurnDiff>;
  }>,
  turnDiffs: Record<string, VaultTurnDiff> | undefined,
): void {
  if (!turnDiffs || Object.keys(turnDiffs).length === 0) return;

  for (const [diffId, diff] of Object.entries(turnDiffs)) {
    const message = messages.find(msg =>
      msg.role === 'assistant'
      && (msg.assistantMessageId === diffId || msg.id === diffId)
    );
    if (!message) continue;

    message.vaultDiffs = {
      ...(message.vaultDiffs ?? {}),
      [diffId]: diff,
    };

    message.contentBlocks = message.contentBlocks ?? [];
    if (!message.contentBlocks.some(block => block.type === 'vault_diff' && block.diffId === diffId)) {
      message.contentBlocks.push({ type: 'vault_diff', diffId });
    }
  }
}

export function collectVaultTurnDiffsFromMessages(
  messages: Array<{
    contentBlocks?: Array<{ type: string; [key: string]: unknown }>;
    vaultDiffs?: Record<string, VaultTurnDiff>;
  }>,
): Record<string, VaultTurnDiff> | undefined {
  const result: Record<string, VaultTurnDiff> = {};

  for (const message of messages) {
    for (const block of message.contentBlocks ?? []) {
      if (block.type !== 'vault_diff' || typeof block.diffId !== 'string') continue;
      const diff = message.vaultDiffs?.[block.diffId];
      if (diff) result[block.diffId] = diff;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

async function listVaultFiles(
  adapter: VaultAdapterLike,
  folder = '',
  cap = Number.POSITIVE_INFINITY,
  acc: string[] = [],
): Promise<string[]> {
  const listing = await adapter.list(folder);

  for (const filePath of listing.files) {
    if (isHiddenPath(filePath)) continue;
    acc.push(filePath);
    if (acc.length > cap) return acc;
  }

  for (const childFolder of listing.folders) {
    if (isHiddenPath(childFolder)) continue;
    await listVaultFiles(adapter, childFolder, cap, acc);
    if (acc.length > cap) return acc;
  }

  return acc;
}

// Skip dotfiles/dotfolders (.git, .obsidian, .claude, .trash, …): they are not
// vault content and dominate the file count on repo-backed vaults.
function isHiddenPath(path: string): boolean {
  const name = path.split('/').pop() ?? path;
  return name.startsWith('.');
}

async function readFileSnapshot(
  adapter: VaultAdapterLike,
  filePath: string,
  textSizeLimit: number,
): Promise<VaultFileSnapshot> {
  const stat = await safeStat(adapter, filePath);
  const base = {
    path: filePath,
    ...(stat?.size !== undefined ? { size: stat.size } : {}),
    ...(stat?.mtime !== undefined ? { mtime: stat.mtime } : {}),
  };

  if (stat?.size !== undefined && stat.size > textSizeLimit) {
    return { ...base, mode: 'oversized' };
  }

  try {
    const content = await adapter.read(filePath);
    if (isProbablyBinary(content)) {
      return { ...base, mode: 'binary' };
    }
    return { ...base, mode: 'text', content };
  } catch {
    return { ...base, mode: 'unreadable' };
  }
}

async function safeStat(
  adapter: VaultAdapterLike,
  filePath: string,
): Promise<{ mtime: number; size: number } | null> {
  if (!adapter.stat) return null;

  try {
    return await adapter.stat(filePath);
  } catch {
    return null;
  }
}

function isProbablyBinary(content: string): boolean {
  return content.includes('\u0000');
}

function createModifiedFileDiff(
  filePath: string,
  beforeFile: VaultFileSnapshot,
  afterFile: VaultFileSnapshot,
): VaultTurnDiffFile | null {
  if (beforeFile.mode === 'text' && afterFile.mode === 'text') {
    if (beforeFile.content === afterFile.content) return null;
    return createTextFileDiff(
      filePath,
      'modified',
      beforeFile,
      afterFile,
      buildLineDiff(beforeFile.content ?? '', afterFile.content ?? ''),
    );
  }

  if (
    beforeFile.mode === afterFile.mode
    && beforeFile.size === afterFile.size
    && beforeFile.mtime === afterFile.mtime
  ) {
    return null;
  }

  return createMetadataFileDiff(filePath, 'modified', beforeFile, afterFile);
}

function createFileDiff(
  filePath: string,
  kind: VaultTurnDiffFileKind,
  beforeFile: VaultFileSnapshot | undefined,
  afterFile: VaultFileSnapshot | undefined,
): VaultTurnDiffFile {
  const textFile = afterFile?.mode === 'text' ? afterFile : beforeFile?.mode === 'text' ? beforeFile : undefined;
  if (textFile) {
    const lines = splitLines(textFile.content ?? '');
    const diffLines = lines.map<DiffLine>((text, index) => kind === 'deleted'
      ? { type: 'delete', text, oldLineNum: index + 1 }
      : { type: 'insert', text, newLineNum: index + 1 });
    return createTextFileDiff(filePath, kind, beforeFile, afterFile, diffLines);
  }

  return createMetadataFileDiff(filePath, kind, beforeFile, afterFile);
}

function createTextFileDiff(
  filePath: string,
  kind: VaultTurnDiffFileKind,
  beforeFile: VaultFileSnapshot | undefined,
  afterFile: VaultFileSnapshot | undefined,
  diffLines: DiffLine[],
): VaultTurnDiffFile {
  return {
    path: filePath,
    kind,
    mode: 'text',
    diffLines,
    stats: countLineChanges(diffLines),
    ...(beforeFile?.size !== undefined ? { beforeSize: beforeFile.size } : {}),
    ...(afterFile?.size !== undefined ? { afterSize: afterFile.size } : {}),
  };
}

function createMetadataFileDiff(
  filePath: string,
  kind: VaultTurnDiffFileKind,
  beforeFile: VaultFileSnapshot | undefined,
  afterFile: VaultFileSnapshot | undefined,
): VaultTurnDiffFile {
  const mode = afterFile?.mode ?? beforeFile?.mode ?? 'unreadable';
  return {
    path: filePath,
    kind,
    mode,
    diffLines: [],
    stats: { added: 0, removed: 0 },
    ...(beforeFile?.size !== undefined ? { beforeSize: beforeFile.size } : {}),
    ...(afterFile?.size !== undefined ? { afterSize: afterFile.size } : {}),
    note: describeMetadataDiff(mode),
  };
}

function describeMetadataDiff(mode: VaultTurnDiffFileMode): string {
  switch (mode) {
    case 'binary':
      return 'Binary file changed';
    case 'oversized':
      return 'File changed, but is too large to diff';
    case 'unreadable':
      return 'File changed, but could not be read';
    default:
      return 'File changed';
  }
}

// Above this old*new line-count product the LCS table gets too big to build, so
// the changed region falls back to a single delete-all/insert-all block — the
// same whole-middle behavior this function had before it learned to localise,
// so it is no worse for these files. It only bites when a file's edits span more
// than ~2000 lines on both sides (large notes edited far apart); realistically
// sized notes stay well under the cap and get properly localised hunks. ~2000x2000
// keeps the transient Int32Array under ~16MB.
const LCS_CELL_CAP = 4_000_000;

/**
 * Builds a line diff that preserves the unchanged lines between separate edits,
 * then trims each edited region to `contextLines` of surrounding context. The
 * dropped span between distant edits leaves a line-number gap the renderer uses
 * to split the file into localised hunks instead of one coarse block.
 */
function buildLineDiff(oldText: string, newText: string, contextLines = 3): DiffLine[] {
  const full = diffLinesFull(splitLines(oldText), splitLines(newText));
  return trimToContext(full, contextLines);
}

function diffLinesFull(oldLines: string[], newLines: string[]): DiffLine[] {
  let prefix = 0;
  while (
    prefix < oldLines.length
    && prefix < newLines.length
    && oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const diffLines: DiffLine[] = [];
  for (let i = 0; i < prefix; i++) {
    diffLines.push({ type: 'equal', text: oldLines[i], oldLineNum: i + 1, newLineNum: i + 1 });
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  diffLines.push(...diffMiddle(oldMid, newMid, prefix));

  const oldSuffixStart = oldLines.length - suffix;
  const newSuffixStart = newLines.length - suffix;
  for (let i = 0; i < suffix; i++) {
    diffLines.push({
      type: 'equal',
      text: oldLines[oldSuffixStart + i],
      oldLineNum: oldSuffixStart + i + 1,
      newLineNum: newSuffixStart + i + 1,
    });
  }

  return diffLines;
}

// `offset` is the number of common-prefix lines already emitted, so local
// indices map back to absolute 1-based line numbers.
function diffMiddle(oldMid: string[], newMid: string[], offset: number): DiffLine[] {
  if (oldMid.length === 0 && newMid.length === 0) return [];

  const deletions = (): DiffLine[] =>
    oldMid.map((text, i) => ({ type: 'delete', text, oldLineNum: offset + i + 1 }));
  const insertions = (): DiffLine[] =>
    newMid.map((text, i) => ({ type: 'insert', text, newLineNum: offset + i + 1 }));

  if (oldMid.length === 0) return insertions();
  if (newMid.length === 0) return deletions();
  if (oldMid.length * newMid.length > LCS_CELL_CAP) return [...deletions(), ...insertions()];

  return lcsDiff(oldMid, newMid, offset);
}

function lcsDiff(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const lengths = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j]
        ? lengths[(i + 1) * width + (j + 1)] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }

  const diffLines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      diffLines.push({ type: 'equal', text: a[i], oldLineNum: offset + i + 1, newLineNum: offset + j + 1 });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      diffLines.push({ type: 'delete', text: a[i], oldLineNum: offset + i + 1 });
      i++;
    } else {
      diffLines.push({ type: 'insert', text: b[j], newLineNum: offset + j + 1 });
      j++;
    }
  }
  for (; i < n; i++) diffLines.push({ type: 'delete', text: a[i], oldLineNum: offset + i + 1 });
  for (; j < m; j++) diffLines.push({ type: 'insert', text: b[j], newLineNum: offset + j + 1 });

  return diffLines;
}

// Keeps every changed line plus up to `contextLines` equal lines adjacent to a
// change, dropping equal lines farther from any edit. Edits more than
// 2*contextLines apart end up separated by a line-number gap.
function trimToContext(diffLines: DiffLine[], contextLines: number): DiffLine[] {
  const keep = new Array<boolean>(diffLines.length).fill(false);
  for (let i = 0; i < diffLines.length; i++) {
    if (diffLines[i].type === 'equal') continue;
    const from = Math.max(0, i - contextLines);
    const to = Math.min(diffLines.length - 1, i + contextLines);
    for (let j = from; j <= to; j++) keep[j] = true;
  }
  return diffLines.filter((_, i) => keep[i]);
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
