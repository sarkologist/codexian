const DEFAULT_SELECTION_PREVIEW_LENGTH = 160;

export function formatSelectionPreview(text: string, maxLength = DEFAULT_SELECTION_PREVIEW_LENGTH): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}
