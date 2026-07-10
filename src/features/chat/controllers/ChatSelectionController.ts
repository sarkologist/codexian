import type { ChatSelectionContext } from '../../../utils/chatSelection';
import {
  collectRenderedMathElements,
  extractRenderedMathSource,
} from '../../../utils/markdownMath';
import { updateContextRowHasContent } from './contextRowVisibility';
import { formatSelectionPreview } from './selectionPreview';

const CHAT_SELECTION_POLL_INTERVAL = 250;
const MESSAGE_SELECTION_GRACE_MS = 1500;
const CLIPBOARD_BLOCK_SELECTOR = [
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
].join(',');

export class ChatSelectionController {
  private messagesEl: HTMLElement;
  private indicatorEl: HTMLElement;
  private contextRowEl: HTMLElement;
  private onVisibilityChange: (() => void) | null;
  private storedSelection: ChatSelectionContext | null = null;
  private dismissedSelectionSignature: string | null = null;
  private pollInterval: number | null = null;
  private recentMessagesSelectionUntil: number | null = null;
  private readonly selectionChangeHandler = () => this.poll();
  private readonly copyHandler = (event: ClipboardEvent) => this.handleCopy(event);
  private readonly messagesPointerHandler = () => {
    this.recentMessagesSelectionUntil = Date.now() + MESSAGE_SELECTION_GRACE_MS;
    window.setTimeout(() => this.poll(), 0);
  };
  private readonly indicatorClickHandler = () => this.dismissFromIndicator();

  constructor(
    messagesEl: HTMLElement,
    indicatorEl: HTMLElement,
    inputEl: HTMLElement,
    contextRowEl: HTMLElement,
    onVisibilityChange?: () => void
  ) {
    this.messagesEl = messagesEl;
    this.indicatorEl = indicatorEl;
    this.contextRowEl = contextRowEl;
    this.onVisibilityChange = onVisibilityChange ?? null;
  }

  start(): void {
    if (this.pollInterval) return;
    this.messagesEl.ownerDocument.addEventListener('selectionchange', this.selectionChangeHandler);
    this.messagesEl.ownerDocument.addEventListener('copy', this.copyHandler);
    this.messagesEl.addEventListener('pointerdown', this.messagesPointerHandler);
    this.messagesEl.addEventListener('pointerup', this.messagesPointerHandler);
    this.messagesEl.addEventListener('mouseup', this.messagesPointerHandler);
    this.indicatorEl.addEventListener('click', this.indicatorClickHandler);
    this.pollInterval = window.setInterval(() => this.poll(), CHAT_SELECTION_POLL_INTERVAL);
    this.poll();
  }

  stop(): void {
    if (this.pollInterval) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.messagesEl.ownerDocument.removeEventListener('selectionchange', this.selectionChangeHandler);
    this.messagesEl.ownerDocument.removeEventListener('copy', this.copyHandler);
    this.messagesEl.removeEventListener('pointerdown', this.messagesPointerHandler);
    this.messagesEl.removeEventListener('pointerup', this.messagesPointerHandler);
    this.messagesEl.removeEventListener('mouseup', this.messagesPointerHandler);
    this.indicatorEl.removeEventListener('click', this.indicatorClickHandler);
    this.clear();
  }

  private poll(): void {
    const selection = this.messagesEl.ownerDocument.getSelection?.() ?? null;
    const selectedText = this.getSelectedText(selection);

    if (selectedText.trim() && this.shouldCaptureSelection(selection)) {
      const nextContext = this.buildContext(selection, selectedText);
      const signature = this.getSelectionSignature(nextContext);
      if (signature === this.dismissedSelectionSignature) return;
      if (!this.isSameSelection(nextContext, this.storedSelection)) {
        this.dismissedSelectionSignature = null;
        this.storedSelection = nextContext;
        this.updateIndicator();
      }
      return;
    }

  }

  private handleCopy(event: ClipboardEvent): void {
    const selection = this.messagesEl.ownerDocument.getSelection?.() ?? null;
    if (!this.shouldCaptureSelection(selection)) return;

    const text = this.buildClipboardText(selection);
    if (!text || !event.clipboardData) return;

    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  }

  private buildClipboardText(selection: Selection | null): string | null {
    if (!selection || selection.rangeCount === 0) return null;

    const parts: string[] = [];
    let shouldOverride = false;

    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!this.rangeIntersectsMessages(range)) continue;

      let container: HTMLElement;
      try {
        container = this.messagesEl.ownerDocument.createElement('div');
        container.appendChild(range.cloneContents());
      } catch {
        continue;
      }

      if (this.replaceMathElementsWithSourceText(container)) {
        shouldOverride = true;
      }
      // Dragging across list items clones bare <li> nodes without their
      // <ul>/<ol> wrapper; re-wrap so marker type and numbering survive.
      this.wrapBareListItems(container, range);
      if (container.querySelector('ul, ol, li')) {
        shouldOverride = true;
      }
      parts.push(this.extractClipboardText(container));
    }

    // Native copy drops list markers, so only override for math or lists;
    // otherwise let the browser serialize the selection.
    if (!shouldOverride) return null;
    return this.normalizeClipboardText(parts.join('\n')) || null;
  }

  private wrapBareListItems(container: HTMLElement, range: Range): void {
    const bareItems = Array.from(container.children).filter(el => el.tagName === 'LI');
    if (bareItems.length === 0) return;

    // Bare top-level <li> clones are direct children of the range's common
    // ancestor, so that list — not the range start, which may sit in a
    // differently-typed nested list — defines the wrapper type and numbering.
    const sourceList = this.closestListElement(range.commonAncestorContainer)
      ?? this.closestListElement(range.startContainer);
    const ordered = sourceList?.tagName === 'OL';
    const wrapper = container.ownerDocument.createElement(ordered ? 'ol' : 'ul');

    if (ordered && sourceList) {
      const startIndex = this.firstSelectedListItemIndex(range, sourceList);
      if (startIndex > 1) wrapper.setAttribute('start', String(startIndex));
    }

    container.insertBefore(wrapper, bareItems[0]);
    for (const item of bareItems) {
      wrapper.appendChild(item);
    }
  }

  private closestListElement(node: Node | null): HTMLElement | null {
    const el = node ? this.elementFromNode(node) : null;
    return el?.closest<HTMLElement>('ul, ol') ?? null;
  }

  private firstSelectedListItemIndex(range: Range, list: HTMLElement): number {
    const start = range.startContainer;
    const items = Array.from(list.children).filter(el => el.tagName === 'LI');
    const position = items.findIndex(item => item === start || item.contains(start));
    const base = Number.parseInt(list.getAttribute('start') ?? '', 10);
    return (Number.isFinite(base) ? base : 1) + Math.max(0, position);
  }

  private replaceMathElementsWithSourceText(container: HTMLElement): boolean {
    const mathEls = collectRenderedMathElements(container);
    let replaced = false;

    for (const mathEl of mathEls) {
      const source = this.extractMathText(mathEl);
      if (!source) continue;

      const replacementText = this.isBlockMathElement(mathEl)
        ? `\n${source}\n`
        : source;
      mathEl.replaceWith(container.ownerDocument.createTextNode(replacementText));
      replaced = true;
    }

    return replaced;
  }

  private extractClipboardText(container: HTMLElement): string {
    let text = '';
    // Suppresses the line break a block child would otherwise insert right
    // after a list marker, keeping loose-list content on the marker's line.
    let suppressLeadingBreak = false;
    const listStack: Array<{ ordered: boolean; index: number }> = [];

    const appendLineBreak = () => {
      if (suppressLeadingBreak) {
        suppressLeadingBreak = false;
        return;
      }
      if (text && !text.endsWith('\n')) {
        text += '\n';
      }
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue ?? '';
        text += value;
        if (value.trim()) suppressLeadingBreak = false;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as Element;
      if (this.shouldSkipClipboardElement(el)) return;

      const tag = el.tagName;
      if (tag === 'UL' || tag === 'OL') {
        const ordered = tag === 'OL';
        const start = ordered ? Number.parseInt(el.getAttribute('start') ?? '', 10) : NaN;
        listStack.push({ ordered, index: Number.isFinite(start) ? start - 1 : 0 });
        appendLineBreak();
        el.childNodes.forEach(walk);
        appendLineBreak();
        listStack.pop();
        return;
      }

      if (tag === 'LI') {
        appendLineBreak();
        text += this.listItemMarker(listStack);
        suppressLeadingBreak = true;
        el.childNodes.forEach(walk);
        appendLineBreak();
        return;
      }

      const isBlock = this.isClipboardBlockElement(el);
      if (isBlock) appendLineBreak();
      el.childNodes.forEach(walk);
      if (isBlock) appendLineBreak();
    };

    container.childNodes.forEach(walk);
    return text;
  }

  private listItemMarker(listStack: Array<{ ordered: boolean; index: number }>): string {
    const indent = '  '.repeat(Math.max(0, listStack.length - 1));
    const frame = listStack[listStack.length - 1];
    if (!frame) return `${indent}- `;

    frame.index += 1;
    return frame.ordered ? `${indent}${frame.index}. ` : `${indent}- `;
  }

  private shouldSkipClipboardElement(el: Element): boolean {
    return el.matches('.claudian-text-copy-btn, .claudian-user-msg-actions, .copy-code-button');
  }

  private isClipboardBlockElement(el: Element): boolean {
    return el.matches(CLIPBOARD_BLOCK_SELECTOR);
  }

  private normalizeClipboardText(text: string): string {
    return text
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private getSelectedText(selection: Selection | null): string {
    const selectedText = selection?.toString() ?? '';
    if (selectedText.trim()) return selectedText;
    return this.getSelectedMathText(selection);
  }

  private shouldCaptureSelection(selection: Selection | null): boolean {
    return this.isSelectionInsideMessages(selection) || this.hasRecentMessagesSelectionGesture();
  }

  private hasRecentMessagesSelectionGesture(): boolean {
    return this.recentMessagesSelectionUntil !== null && Date.now() <= this.recentMessagesSelectionUntil;
  }

  private isSelectionInsideMessages(selection: Selection | null): boolean {
    if (!selection || selection.rangeCount === 0) return false;

    const { anchorNode, focusNode } = selection;
    if (!!anchorNode
      && !!focusNode
      && this.messagesEl.contains(anchorNode)
      && this.messagesEl.contains(focusNode)) {
      return true;
    }

    for (let i = 0; i < selection.rangeCount; i++) {
      if (this.rangeIntersectsMessages(selection.getRangeAt(i))) {
        return true;
      }
    }

    return false;
  }

  private rangeIntersectsMessages(range: Range): boolean {
    try {
      if (typeof range.intersectsNode === 'function' && range.intersectsNode(this.messagesEl)) {
        return true;
      }
    } catch {
      // Some host ranges can throw on detached nodes; fall back to endpoints.
    }

    return this.messagesEl.contains(range.startContainer)
      || this.messagesEl.contains(range.endContainer)
      || this.messagesEl.contains(range.commonAncestorContainer);
  }

  private getSelectedMathText(selection: Selection | null): string {
    if (!selection || selection.rangeCount === 0) return '';

    const mathEls = new Set<HTMLElement>();
    const addMathElFromNode = (node: Node | null) => {
      const el = node ? this.elementFromNode(node) : null;
      const mathEl = el ? this.closestMathElement(el) : null;
      if (mathEl) mathEls.add(mathEl);
    };

    addMathElFromNode(selection.anchorNode);
    addMathElFromNode(selection.focusNode);

    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      this.collectMathElementsFromRange(range, mathEls);
    }

    return [...mathEls]
      .map(el => this.extractMathText(el))
      .filter(Boolean)
      .join('\n');
  }

  private collectMathElementsFromRange(range: Range, mathEls: Set<HTMLElement>): void {
    for (const candidate of collectRenderedMathElements(this.messagesEl)) {
      if (!this.rangeIntersectsNode(range, candidate)) continue;
      mathEls.add(candidate);
    }
  }

  private rangeIntersectsNode(range: Range, node: Node): boolean {
    try {
      return typeof range.intersectsNode === 'function' && range.intersectsNode(node);
    } catch {
      return false;
    }
  }

  private closestMathElement(el: Element): HTMLElement | null {
    const mathWrapper = el.closest<HTMLElement>('.math');
    if (mathWrapper && this.messagesEl.contains(mathWrapper)) return mathWrapper;

    const mathJaxContainer = el.closest<HTMLElement>('mjx-container');
    if (mathJaxContainer && this.messagesEl.contains(mathJaxContainer)) return mathJaxContainer;

    return null;
  }

  private extractMathText(el: HTMLElement): string {
    return extractRenderedMathSource(el);
  }

  private isBlockMathElement(el: HTMLElement): boolean {
    return el.classList.contains('math-block') || el.getAttribute('display') === 'true';
  }

  private buildContext(selection: Selection | null, selectedText: string): ChatSelectionContext {
    const lineCount = selectedText.split(/\r?\n/).length;
    const messageEl = this.getSelectedMessageEl(selection);
    const role = messageEl?.dataset.role === 'user' || messageEl?.dataset.role === 'assistant'
      ? messageEl.dataset.role
      : undefined;

    return {
      selectedText,
      lineCount,
      ...(messageEl?.dataset.messageId && { messageId: messageEl.dataset.messageId }),
      ...(role && { role }),
    };
  }

  private getSelectedMessageEl(selection: Selection | null): HTMLElement | null {
    if (!selection?.anchorNode || !selection.focusNode) return null;

    const anchorMessage = this.findMessageEl(selection.anchorNode);
    const focusMessage = this.findMessageEl(selection.focusNode);
    if (anchorMessage && anchorMessage === focusMessage) {
      return anchorMessage;
    }

    return this.getSelectedMessageElFromRanges(selection);
  }

  private getSelectedMessageElFromRanges(selection: Selection): HTMLElement | null {
    let selectedMessage: HTMLElement | null = null;
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (!this.rangeIntersectsMessages(range)) continue;

      const message = this.findMessageEl(range.commonAncestorContainer)
        ?? this.findMessageEl(range.startContainer)
        ?? this.findMessageEl(range.endContainer);
      if (!message) {
        return null;
      }
      if (selectedMessage && selectedMessage !== message) {
        return null;
      }
      selectedMessage = message;
    }
    return selectedMessage;
  }

  private elementFromNode(node: Node): Element | null {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node as Element;
    }

    const parent = node.parentNode;
    return parent instanceof Element ? parent : null;
  }

  private findMessageEl(node: Node): HTMLElement | null {
    const el = this.elementFromNode(node);
    return el?.closest<HTMLElement>('.claudian-message') ?? null;
  }

  private isSameSelection(
    left: ChatSelectionContext | null,
    right: ChatSelectionContext | null
  ): boolean {
    if (!left || !right) return false;
    return left.selectedText === right.selectedText
      && left.lineCount === right.lineCount
      && left.messageId === right.messageId
      && left.role === right.role;
  }

  private updateIndicator(): void {
    if (!this.indicatorEl) return;

    if (this.storedSelection) {
      const lineLabel = this.storedSelection.lineCount === 1 ? 'line' : 'lines';
      this.indicatorEl.textContent = `${this.storedSelection.lineCount} ${lineLabel} selected in chat`;
      this.indicatorEl.setAttribute('data-tooltip', this.buildIndicatorTitle());
      this.indicatorEl.removeClass('claudian-hidden');
    } else {
      this.indicatorEl.addClass('claudian-hidden');
      this.indicatorEl.textContent = '';
      this.indicatorEl.removeAttribute('data-tooltip');
    }
    this.updateContextRowVisibility();
  }

  private buildIndicatorTitle(): string {
    if (!this.storedSelection) return '';

    const charCount = this.storedSelection.selectedText.length;
    const charLabel = charCount === 1 ? 'char' : 'chars';
    const lines = [
      `Selected text:\n${formatSelectionPreview(this.storedSelection.selectedText)}`,
      `${charCount} ${charLabel} selected from chat`,
    ];
    if (this.storedSelection.role) {
      lines.push(`role=${this.storedSelection.role}`);
    }
    if (this.storedSelection.messageId) {
      lines.push(`message=${this.storedSelection.messageId}`);
    }
    return lines.join('\n');
  }

  updateContextRowVisibility(): void {
    if (!this.contextRowEl) return;
    updateContextRowHasContent(this.contextRowEl);
    this.onVisibilityChange?.();
  }

  getContext(): ChatSelectionContext | null {
    return this.storedSelection;
  }

  hasSelection(): boolean {
    return this.storedSelection !== null;
  }

  private getSelectionSignature(selection: ChatSelectionContext): string {
    return [
      selection.selectedText,
      selection.lineCount,
      selection.messageId ?? '',
      selection.role ?? '',
    ].join('\u001f');
  }

  private dismissFromIndicator(): void {
    const dismissedSelectionSignature = this.storedSelection
      ? this.getSelectionSignature(this.storedSelection)
      : null;
    this.clear();
    this.dismissedSelectionSignature = dismissedSelectionSignature;
  }

  dismissSelectionContext(): void {
    this.dismissFromIndicator();
  }

  clear(): void {
    this.dismissedSelectionSignature = null;
    this.storedSelection = null;
    this.updateIndicator();
  }
}
