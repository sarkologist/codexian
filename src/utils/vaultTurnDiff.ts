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

interface VaultAdapterLike {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  stat?(path: string): Promise<{ mtime: number; size: number } | null>;
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
  options: { textSizeLimit?: number } = {},
): Promise<VaultDiffSnapshot | null> {
  try {
    const adapter = app.vault.adapter as unknown as VaultAdapterLike;
    const textSizeLimit = options.textSizeLimit ?? VAULT_TURN_DIFF_TEXT_SIZE_LIMIT;
    const files = new Map<string, VaultFileSnapshot>();

    for (const filePath of await listVaultFiles(adapter)) {
      files.set(filePath, await readFileSnapshot(adapter, filePath, textSizeLimit));
    }

    return { files };
  } catch {
    return null;
  }
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

async function listVaultFiles(adapter: VaultAdapterLike, folder = ''): Promise<string[]> {
  const listing = await adapter.list(folder);
  const files = [...listing.files];

  for (const childFolder of listing.folders) {
    files.push(...await listVaultFiles(adapter, childFolder));
  }

  return files.sort();
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

function buildLineDiff(oldText: string, newText: string, contextLines = 3): DiffLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let prefixLength = 0;

  while (
    prefixLength < oldLines.length
    && prefixLength < newLines.length
    && oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength
    && suffixLength < newLines.length - prefixLength
    && oldLines[oldLines.length - 1 - suffixLength] === newLines[newLines.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const diffLines: DiffLine[] = [];
  const contextStart = Math.max(0, prefixLength - contextLines);

  for (let i = contextStart; i < prefixLength; i++) {
    diffLines.push({ type: 'equal', text: oldLines[i], oldLineNum: i + 1, newLineNum: i + 1 });
  }

  for (let i = prefixLength; i < oldLines.length - suffixLength; i++) {
    diffLines.push({ type: 'delete', text: oldLines[i], oldLineNum: i + 1 });
  }

  for (let i = prefixLength; i < newLines.length - suffixLength; i++) {
    diffLines.push({ type: 'insert', text: newLines[i], newLineNum: i + 1 });
  }

  const oldSuffixStart = oldLines.length - suffixLength;
  const newSuffixStart = newLines.length - suffixLength;
  const suffixContextLength = Math.min(contextLines, suffixLength);
  for (let i = 0; i < suffixContextLength; i++) {
    diffLines.push({
      type: 'equal',
      text: oldLines[oldSuffixStart + i],
      oldLineNum: oldSuffixStart + i + 1,
      newLineNum: newSuffixStart + i + 1,
    });
  }

  return diffLines;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
