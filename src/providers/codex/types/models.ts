import type { ProviderUIOption } from '../../../core/providers/types';

export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';
export const DEFAULT_CODEX_MINI_MODEL: CodexModel = 'gpt-5.4-mini';

/**
 * Previous-generation flagship. Retained as the fast-mode service-tier anchor
 * (the tier the app-server exposes fast mode on); superseded as the default
 * selection by the GPT-5.6 trio below.
 */
export const DEFAULT_CODEX_PRIMARY_MODEL: CodexModel = 'gpt-5.5';
export const FAST_TIER_CODEX_MODEL = DEFAULT_CODEX_PRIMARY_MODEL;

/** Current-generation (GPT-5.6) model trio. */
export const CODEX_MODEL_SOL: CodexModel = 'gpt-5.6-sol';
export const CODEX_MODEL_TERRA: CodexModel = 'gpt-5.6-terra';
export const CODEX_MODEL_LUNA: CodexModel = 'gpt-5.6-luna';

/**
 * The default Codex model: the fresh-install selection and the fallback used
 * whenever the configured model is missing, stale, or otherwise unavailable.
 */
export const DEFAULT_CODEX_MODEL: CodexModel = CODEX_MODEL_SOL;

function formatCodexModelSuffix(suffix: string): string {
  return suffix
    .split('-')
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function formatCodexModelLabel(model: string): string {
  const match = model.match(/^gpt-([^-]+)(?:-(.+))?$/i);
  if (!match) {
    return model;
  }

  const [, version, suffix] = match;
  return `GPT-${version}${suffix ? ` ${formatCodexModelSuffix(suffix)}` : ''}`;
}

function createCodexModelOption(model: CodexModel, description: string): ProviderUIOption {
  return {
    value: model,
    label: formatCodexModelLabel(model),
    description,
  };
}

export const DEFAULT_CODEX_MINI_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_MINI_MODEL);
export const DEFAULT_CODEX_PRIMARY_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_PRIMARY_MODEL);
export const FAST_TIER_CODEX_MODEL_LABEL = formatCodexModelLabel(FAST_TIER_CODEX_MODEL);
export const FAST_TIER_CODEX_DESCRIPTION = `Enable ${FAST_TIER_CODEX_MODEL_LABEL} fast mode for this conversation. Faster responses use more credits.`;

export const DEFAULT_CODEX_MODELS: ProviderUIOption[] = [
  createCodexModelOption(CODEX_MODEL_SOL, 'Latest'),
  createCodexModelOption(CODEX_MODEL_TERRA, 'Latest'),
  createCodexModelOption(CODEX_MODEL_LUNA, 'Latest'),
  createCodexModelOption(DEFAULT_CODEX_PRIMARY_MODEL, 'Previous'),
  createCodexModelOption(DEFAULT_CODEX_MINI_MODEL, 'Fast'),
];

export const DEFAULT_CODEX_MODEL_SET = new Set(DEFAULT_CODEX_MODELS.map(model => model.value));
