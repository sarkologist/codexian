import type { ChatSelectionContext } from '../../../utils/chatSelection';
import { updateContextRowHasContent } from './contextRowVisibility';
import { formatSelectionPreview } from './selectionPreview';

const CHAT_SELECTION_POLL_INTERVAL = 250;
const MESSAGE_SELECTION_GRACE_MS = 1500;

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
    const candidates = this.messagesEl.querySelectorAll<HTMLElement>('.math, mjx-container');
    for (const candidate of candidates) {
      if (!this.rangeIntersectsNode(range, candidate)) continue;
      const mathEl = this.closestMathElement(candidate);
      if (mathEl) mathEls.add(mathEl);
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
    const sourceText = this.extractMathSourceText(el);
    if (sourceText) return sourceText;

    const assistiveText = el.querySelector('mjx-assistive-mml, math')?.textContent?.trim();
    if (assistiveText) return assistiveText;

    return el.textContent?.trim() ?? '';
  }

  private extractMathSourceText(el: HTMLElement): string {
    const annotation = el.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="application/tex"], annotation[encoding="TeX"]'
    );
    const annotationText = annotation?.textContent?.trim();
    if (annotationText) return annotationText;

    for (const attr of ['data-source', 'data-tex', 'data-latex', 'aria-label', 'title']) {
      const value = el.getAttribute(attr)?.trim();
      if (value) return value;
    }

    return '';
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
