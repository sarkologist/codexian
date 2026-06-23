/**
 * Diff-related type definitions.
 */

export interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export type VaultTurnDiffFileKind = 'added' | 'modified' | 'deleted';

export type VaultTurnDiffFileMode =
  | 'text'
  | 'binary'
  | 'oversized'
  | 'unreadable';

export interface VaultTurnDiffFile {
  path: string;
  kind: VaultTurnDiffFileKind;
  mode: VaultTurnDiffFileMode;
  diffLines: DiffLine[];
  stats: DiffStats;
  beforeSize?: number;
  afterSize?: number;
  note?: string;
}

export interface VaultTurnDiff {
  id: string;
  createdAt: number;
  files: VaultTurnDiffFile[];
  stats: DiffStats;
  fileCount: number;
}

/** A single hunk from the SDK's structuredPatch format. */
export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** Shape of the SDK's toolUseResult object for Write/Edit tools. */
export interface SDKToolUseResult {
  structuredPatch?: StructuredPatchHunk[];
  filePath?: string;
  [key: string]: unknown;
}
