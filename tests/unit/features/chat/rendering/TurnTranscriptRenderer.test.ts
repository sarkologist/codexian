import { createMockEl } from '@test/helpers/mockElement';

import {
  createTurnTranscript,
  finalizeTurnTranscript,
  incrementTurnTranscriptCount,
} from '@/features/chat/rendering/TurnTranscriptRenderer';

describe('TurnTranscriptRenderer', () => {
  it('starts expanded for live transcripts', () => {
    const parentEl = createMockEl();

    const state = createTurnTranscript(parentEl, { initiallyExpanded: true });

    expect(state.isExpanded).toBe(true);
    expect(state.wrapperEl.hasClass('expanded')).toBe(true);
    expect(state.contentEl.hasClass('claudian-hidden')).toBe(false);
    expect(state.headerEl.getAttribute('aria-expanded')).toBe('true');
  });

  it('starts collapsed for stored transcripts', () => {
    const parentEl = createMockEl();

    const state = createTurnTranscript(parentEl);

    expect(state.isExpanded).toBe(false);
    expect(state.contentEl.hasClass('claudian-hidden')).toBe(true);
    expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');
  });

  it('updates the summary as transcript items are added', () => {
    const parentEl = createMockEl();
    const state = createTurnTranscript(parentEl);

    incrementTurnTranscriptCount(state, 'thought');
    incrementTurnTranscriptCount(state, 'tool');
    incrementTurnTranscriptCount(state, 'tool');
    incrementTurnTranscriptCount(state, 'subagent');

    expect(state.labelEl.textContent).toBe('Transcript \u00B7 1 thought \u00B7 2 tools \u00B7 1 subagent');
  });

  it('collapses on finalize but remains manually expandable', () => {
    const parentEl = createMockEl();
    const state = createTurnTranscript(parentEl, { initiallyExpanded: true });

    finalizeTurnTranscript(state);

    expect(state.isExpanded).toBe(false);
    expect(state.wrapperEl.hasClass('expanded')).toBe(false);
    expect(state.contentEl.hasClass('claudian-hidden')).toBe(true);
    expect(state.headerEl.getAttribute('aria-expanded')).toBe('false');

    state.headerEl.click();

    expect(state.isExpanded).toBe(true);
    expect(state.contentEl.hasClass('claudian-hidden')).toBe(false);
  });
});
