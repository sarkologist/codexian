/** @jest-environment jsdom */

import { ChatSelectionController } from '@/features/chat/controllers/ChatSelectionController';
import { CLAUDIAN_MATH_SOURCE_ATTR } from '@/utils/markdownMath';

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

function createCopyEvent() {
  const setData = jest.fn();
  const event = new Event('copy', { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { setData },
  });
  return { event, setData };
}

function createAnnotatedMath(source: string, className = 'math math-inline'): HTMLElement {
  const mathWrapper = document.createElement('span');
  mathWrapper.className = className;
  mathWrapper.setAttribute(CLAUDIAN_MATH_SOURCE_ATTR, source);
  mathWrapper.appendChild(document.createElement('mjx-container'));
  return mathWrapper;
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
    expect(indicatorEl.getAttribute('title')).toBeNull();
    expect(indicatorEl.getAttribute('data-tooltip')).toContain('Selected text:\nselected chat text');
    expect(indicatorEl.getAttribute('data-tooltip')).toContain('role=assistant');
    expect(indicatorEl.getAttribute('data-tooltip')).toContain('message=assistant-1');
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

  it('copies selected rendered math as annotated markdown source', () => {
    const messageEl = messagesEl.querySelector<HTMLElement>('.claudian-message')!;
    const mathWrapper = createAnnotatedMath('$x^2$');
    messageEl.appendChild(mathWrapper);

    const range = document.createRange();
    range.selectNode(mathWrapper);
    selection = createSelection('', mathWrapper, mathWrapper, [range]);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('text/plain', '$x^2$');
    expect(event.defaultPrevented).toBe(true);
  });

  it('copies mixed text and rendered math with math source substituted', () => {
    const messageEl = messagesEl.querySelector<HTMLElement>('.claudian-message')!;
    messageEl.textContent = '';
    const before = document.createTextNode('Value ');
    const mathWrapper = createAnnotatedMath('$x^2$');
    const after = document.createTextNode(' today');
    messageEl.append(before, mathWrapper, after);

    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(after, after.textContent!.length);
    selection = createSelection('Value  today', before, after, [range]);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('text/plain', 'Value $x^2$ today');
    expect(event.defaultPrevented).toBe(true);
  });

  it('preserves indentation after newlines when selected content includes math', () => {
    const messageEl = messagesEl.querySelector<HTMLElement>('.claudian-message')!;
    messageEl.textContent = '';
    const intro = document.createTextNode('Code:');
    const pre = document.createElement('pre');
    pre.textContent = '  const x = 1;\n    return x;';
    const mathWrapper = createAnnotatedMath('$x$');
    messageEl.append(intro, pre, mathWrapper);

    const range = document.createRange();
    range.setStart(intro, 0);
    range.setEndAfter(mathWrapper);
    selection = createSelection('Code:\n  const x = 1;\n    return x;', intro, mathWrapper, [range]);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      'Code:\n  const x = 1;\n    return x;\n$x$'
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it('copies MathJax fallback text when no Claudian source annotation exists', () => {
    const messageEl = messagesEl.querySelector<HTMLElement>('.claudian-message')!;
    const mathJaxEl = document.createElement('mjx-container');
    const assistiveEl = document.createElement('mjx-assistive-mml');
    assistiveEl.textContent = 'Ωx1';
    mathJaxEl.appendChild(assistiveEl);
    messageEl.appendChild(mathJaxEl);

    const range = document.createRange();
    range.selectNode(mathJaxEl);
    selection = createSelection('', mathJaxEl, mathJaxEl, [range]);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('text/plain', 'Ωx1');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept copy for non-math chat selections', () => {
    selection = createSelection('selected chat text', messageTextNode);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not intercept copy for selections outside the chat transcript', () => {
    const outsideText = document.createTextNode('outside math-ish text');
    document.body.appendChild(outsideText);
    selection = createSelection('outside math-ish text', outsideText);

    controller.start();
    const { event, setData } = createCopyEvent();
    document.dispatchEvent(event);

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    outsideText.remove();
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

  it('keeps selection when deselected and clears it only from the indicator', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    selection = createSelection('', null, null);
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(true);
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(false);

    indicatorEl.click();

    expect(controller.hasSelection()).toBe(false);
    expect(indicatorEl.classList.contains('claudian-hidden')).toBe(true);
  });

  it('does not recapture the same live chat selection after context dismissal', () => {
    controller.start();
    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(true);

    controller.dismissSelectionContext();
    expect(controller.hasSelection()).toBe(false);

    jest.advanceTimersByTime(250);
    expect(controller.hasSelection()).toBe(false);

    selection = createSelection('different chat text', messageTextNode);
    jest.advanceTimersByTime(250);

    expect(controller.hasSelection()).toBe(true);
    expect(controller.getContext()?.selectedText).toBe('different chat text');
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
