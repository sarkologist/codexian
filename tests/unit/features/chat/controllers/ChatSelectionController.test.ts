/** @jest-environment jsdom */

import { ChatSelectionController } from '@/features/chat/controllers/ChatSelectionController';

function patchObsidianElement<T extends HTMLElement>(el: T): T {
  (el as any).addClass = (cls: string) => {
    cls.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c));
    return el;
  };
  (el as any).removeClass = (cls: string) => {
    cls.split(/\s+/).filter(Boolean).forEach(c => el.classList.remove(c));
    return el;
  };
  (el as any).hasClass = (cls: string) => el.classList.contains(cls);
  return el;
}

function createSelection(
  text: string,
  anchorNode: Node | null,
  focusNode: Node | null = anchorNode,
  ranges?: Range[],
): Selection {
  const resolvedRanges = ranges ?? (anchorNode && focusNode ? [createRange(anchorNode, focusNode)] : []);
  return {
    toString: () => text,
    anchorNode,
    focusNode,
    rangeCount: resolvedRanges.length,
    getRangeAt: jest.fn((index: number) => resolvedRanges[index]),
  } as unknown as Selection;
}

function createRange(startNode: Node, endNode: Node = startNode): Range {
  const range = document.createRange();
  range.setStart(startNode, 0);
  range.setEnd(endNode, endNode.textContent?.length ?? 0);
  return range;
}

describe('ChatSelectionController', () => {
  let controller: ChatSelectionController;
  let messagesEl: HTMLElement;
  let indicatorEl: HTMLElement;
  let inputEl: HTMLTextAreaElement;
  let contextRowEl: HTMLElement;
  let messageTextNode: Text;
  let getSelectionSpy: jest.SpyInstance;
  let selection: Selection;

  beforeEach(() => {
    jest.useFakeTimers();

    contextRowEl = patchObsidianElement(document.createElement('div'));
    indicatorEl = patchObsidianElement(document.createElement('div'));
    indicatorEl.classList.add('claudian-chat-selection-indicator', 'claudian-hidden');
    contextRowEl.appendChild(indicatorEl);

    inputEl = document.createElement('textarea');
    messagesEl = document.createElement('div');
    const messageEl = document.createElement('div');
    messageEl.classList.add('claudian-message', 'claudian-message-assistant');
    messageEl.dataset.messageId = 'assistant-1';
    messageEl.dataset.role = 'assistant';
    const contentEl = document.createElement('span');
    messageTextNode = document.createTextNode('selected chat text');
    contentEl.appendChild(messageTextNode);
    messageEl.appendChild(contentEl);
    messagesEl.appendChild(messageEl);

    document.body.appendChild(messagesEl);
    document.body.appendChild(inputEl);
    selection = createSelection('selected chat text', messageTextNode);
    getSelectionSpy = jest.spyOn(document, 'getSelection').mockImplementation(() => selection);

    controller = new ChatSelectionController(messagesEl, indicatorEl, inputEl, contextRowEl);
  });

  afterEach(() => {
    controller.stop();
    getSelectionSpy.mockRestore();
    messagesEl.remove();
    inputEl.remove();
    jest.useRealTimers();
  });

  it('captures chat selection with message metadata', () => {
    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()).toEqual({
      selectedText: 'selected chat text',
      lineCount: 1,
      messageId: 'assistant-1',
      role: 'assistant',
    });
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(false);
    expect(indicatorEl.textContent).toBe('1 line selected in chat');
    expect(indicatorEl.getAttribute('title')).toContain('role=assistant');
    expect(indicatorEl.getAttribute('title')).toContain('message=assistant-1');
  });

  it('counts multiline chat selections', () => {
    selection = createSelection('line one\nline two', messageTextNode);

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()?.lineCount).toBe(2);
    expect(indicatorEl.textContent).toBe('2 lines selected in chat');
  });

  it('captures chat selection when only the range intersects the transcript', () => {
    const range = createRange(messageTextNode);
    selection = createSelection('selected chat text', document.body, document.body, [range]);

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()).toEqual({
      selectedText: 'selected chat text',
      lineCount: 1,
      messageId: 'assistant-1',
      role: 'assistant',
    });
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(false);
  });

  it('captures MathJax selections when native selection text is empty', () => {
    const messageEl = messagesEl.querySelector<HTMLElement>('.claudian-message')!;
    const mathWrapper = document.createElement('span');
    mathWrapper.classList.add('math', 'math-inline');
    const mathJaxEl = document.createElement('mjx-container');
    mathJaxEl.appendChild(document.createElement('mjx-math'));
    const assistiveEl = document.createElement('mjx-assistive-mml');
    assistiveEl.textContent = 'Ωx1';
    mathJaxEl.appendChild(assistiveEl);
    mathWrapper.appendChild(mathJaxEl);
    messageEl.appendChild(mathWrapper);

    const range = document.createRange();
    range.selectNode(mathJaxEl);
    selection = createSelection('', mathJaxEl, mathJaxEl, [range]);

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.getContext()).toEqual({
      selectedText: 'Ωx1',
      lineCount: 1,
      messageId: 'assistant-1',
      role: 'assistant',
    });
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(false);
  });

  it('captures chat selection on selectionchange without waiting for the timer', () => {
    selection = createSelection('', null, null);
    controller.start();

    selection = createSelection('selected chat text', messageTextNode);
    document.dispatchEvent(new Event('selectionchange'));

    expect(controller.hasSelection()).toBe(true);
    expect(indicatorEl.textContent).toBe('1 line selected in chat');
  });

  it('captures selection after a transcript pointer gesture even when selection endpoints are outside', () => {
    selection = createSelection('selected chat text', document.body, document.body, []);
    controller.start();

    messagesEl.dispatchEvent(new Event('pointerdown'));
    jest.runOnlyPendingTimers();

    expect(controller.getContext()).toEqual({
      selectedText: 'selected chat text',
      lineCount: 1,
    });
    expect(indicatorEl.textContent).toBe('1 line selected in chat');
  });

  it('keeps selection while input is focused', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    selection = createSelection('', null, null);
    inputEl.focus();
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(true);
  });

  it('clears selection when deselected and input is not focused', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    selection = createSelection('', null, null);
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(false);
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(true);
  });

  it('ignores selections outside the chat transcript', () => {
    const outsideText = document.createTextNode('outside');
    document.body.appendChild(outsideText);
    selection = createSelection('outside', outsideText);

    controller.start();
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(false);
    outsideText.remove();
  });
});
