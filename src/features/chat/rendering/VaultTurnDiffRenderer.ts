import { setIcon } from 'obsidian';

import type { VaultTurnDiff, VaultTurnDiffFile } from '../../../core/types/diff';
import { setupCollapsible } from './collapsible';
import { renderDiffContent, renderDiffStats } from './DiffRenderer';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatFileSummary(file: VaultTurnDiffFile): string {
  if (file.mode === 'text') {
    const parts: string[] = [];
    if (file.stats.added > 0) parts.push(`+${file.stats.added}`);
    if (file.stats.removed > 0) parts.push(`-${file.stats.removed}`);
    return parts.length > 0 ? parts.join(' ') : 'text changed';
  }

  return file.note ?? 'file changed';
}

function renderMetadataRow(parentEl: HTMLElement, file: VaultTurnDiffFile): void {
  const noteEl = parentEl.createDiv({ cls: 'claudian-vault-diff-note' });
  noteEl.setText(file.note ?? 'No textual diff available');

  const sizeParts: string[] = [];
  if (file.beforeSize !== undefined) sizeParts.push(`before ${file.beforeSize} B`);
  if (file.afterSize !== undefined) sizeParts.push(`after ${file.afterSize} B`);
  if (sizeParts.length > 0) {
    const sizeEl = parentEl.createDiv({ cls: 'claudian-vault-diff-size' });
    sizeEl.setText(sizeParts.join(', '));
  }
}

function renderFileSection(parentEl: HTMLElement, file: VaultTurnDiffFile): void {
  const sectionEl = parentEl.createDiv({ cls: 'claudian-vault-diff-file' });
  const headerEl = sectionEl.createDiv({ cls: 'claudian-vault-diff-file-header' });
  headerEl.createSpan({ cls: `claudian-vault-diff-kind is-${file.kind}`, text: file.kind });
  headerEl.createSpan({ cls: 'claudian-vault-diff-path', text: file.path });
  headerEl.createSpan({ cls: 'claudian-vault-diff-file-stats', text: formatFileSummary(file) });

  if (file.diffLines.length > 0) {
    const diffRow = sectionEl.createDiv({ cls: 'claudian-write-edit-diff-row' });
    const diffEl = diffRow.createDiv({ cls: 'claudian-write-edit-diff' });
    renderDiffContent(diffEl, file.diffLines);
  } else {
    renderMetadataRow(sectionEl, file);
  }
}

export function renderVaultTurnDiff(
  parentEl: HTMLElement,
  diff: VaultTurnDiff,
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-vault-diff-block' });
  wrapperEl.dataset.diffId = diff.id;

  const headerEl = wrapperEl.createDiv({ cls: 'claudian-vault-diff-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createSpan({ cls: 'claudian-vault-diff-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, 'file-diff');

  headerEl.createSpan({ cls: 'claudian-vault-diff-name', text: 'Vault changes' });
  headerEl.createSpan({
    cls: 'claudian-vault-diff-summary',
    text: pluralize(diff.fileCount, 'file'),
  });

  const statsEl = headerEl.createSpan({ cls: 'claudian-vault-diff-stats claudian-write-edit-stats' });
  renderDiffStats(statsEl, diff.stats);

  const contentEl = wrapperEl.createDiv({ cls: 'claudian-vault-diff-content' });
  for (const file of diff.files) {
    renderFileSection(contentEl, file);
  }

  setupCollapsible(wrapperEl, headerEl, contentEl, { isExpanded: false }, {
    initiallyExpanded: false,
    baseAriaLabel: 'Vault changes',
  });

  return wrapperEl;
}
