import { collapseElement, setupCollapsible } from './collapsible';

export interface TurnTranscriptCounts {
  thoughts: number;
  tools: number;
  subagents: number;
}

export interface TurnTranscriptState extends TurnTranscriptCounts {
  wrapperEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  contentEl: HTMLElement;
  isExpanded: boolean;
}

export type TurnTranscriptKind = 'thought' | 'tool' | 'subagent';

export interface TurnTranscriptOptions {
  initiallyExpanded?: boolean;
  counts?: Partial<TurnTranscriptCounts>;
}

const SEPARATOR = ' \u00B7 ';

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatTranscriptLabel(counts: TurnTranscriptCounts): string {
  const parts = ['Transcript'];

  if (counts.thoughts > 0) {
    parts.push(pluralize(counts.thoughts, 'thought'));
  }
  if (counts.tools > 0) {
    parts.push(pluralize(counts.tools, 'tool'));
  }
  if (counts.subagents > 0) {
    parts.push(pluralize(counts.subagents, 'subagent'));
  }

  return parts.join(SEPARATOR);
}

export function updateTurnTranscriptLabel(state: TurnTranscriptState): void {
  state.labelEl.setText(formatTranscriptLabel(state));
  state.headerEl.setAttribute('aria-label', `${formatTranscriptLabel(state)} - click to ${state.isExpanded ? 'collapse' : 'expand'}`);
}

export function createTurnTranscript(
  parentEl: HTMLElement,
  options: TurnTranscriptOptions = {},
): TurnTranscriptState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudian-turn-transcript' });
  const headerEl = wrapperEl.createDiv({ cls: 'claudian-turn-transcript-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const labelEl = headerEl.createSpan({ cls: 'claudian-turn-transcript-label' });
  const contentEl = wrapperEl.createDiv({ cls: 'claudian-turn-transcript-content' });

  const state: TurnTranscriptState = {
    wrapperEl,
    headerEl,
    labelEl,
    contentEl,
    thoughts: options.counts?.thoughts ?? 0,
    tools: options.counts?.tools ?? 0,
    subagents: options.counts?.subagents ?? 0,
    isExpanded: options.initiallyExpanded ?? false,
  };

  setupCollapsible(wrapperEl, headerEl, contentEl, state, {
    initiallyExpanded: options.initiallyExpanded ?? false,
    onToggle: () => updateTurnTranscriptLabel(state),
  });
  updateTurnTranscriptLabel(state);

  return state;
}

export function incrementTurnTranscriptCount(
  state: TurnTranscriptState,
  kind: TurnTranscriptKind,
): void {
  if (kind === 'thought') {
    state.thoughts += 1;
  } else if (kind === 'tool') {
    state.tools += 1;
  } else {
    state.subagents += 1;
  }
  updateTurnTranscriptLabel(state);
}

export function finalizeTurnTranscript(state: TurnTranscriptState | null): void {
  if (!state) return;
  collapseElement(state.wrapperEl, state.headerEl, state.contentEl, state);
  updateTurnTranscriptLabel(state);
}
