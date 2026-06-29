import type { ChatTurnRequest } from '../core/runtime/types';
import type { MessageSelectionContext } from '../core/types';
import type { BrowserSelectionContext } from './browser';
import type { CanvasSelectionContext } from './canvas';
import type { ChatSelectionContext } from './chatSelection';
import type { EditorSelectionContext } from './editor';

type XmlTagName = 'editor_selection' | 'browser_selection' | 'chat_selection' | 'canvas_selection';

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneEditorContext(context: EditorSelectionContext | null | undefined): EditorSelectionContext | undefined {
  if (context?.mode !== 'selection' || !hasText(context.selectedText)) return undefined;
  return { ...context };
}

function cloneBrowserContext(context: BrowserSelectionContext | null | undefined): BrowserSelectionContext | undefined {
  if (!hasText(context?.selectedText)) return undefined;
  return { ...context };
}

function cloneChatContext(context: ChatSelectionContext | null | undefined): ChatSelectionContext | undefined {
  if (!hasText(context?.selectedText)) return undefined;
  return { ...context };
}

function cloneCanvasContext(context: CanvasSelectionContext | null | undefined): CanvasSelectionContext | undefined {
  if (!context || context.nodeIds.length === 0) return undefined;
  return { ...context, nodeIds: [...context.nodeIds] };
}

export function buildMessageSelectionContext(request: ChatTurnRequest): MessageSelectionContext | undefined {
  const selectionContext: MessageSelectionContext = {};

  const editor = cloneEditorContext(request.editorSelection);
  if (editor) selectionContext.editor = editor;

  const browser = cloneBrowserContext(request.browserSelection);
  if (browser) selectionContext.browser = browser;

  const chat = cloneChatContext(request.chatSelection);
  if (chat) selectionContext.chat = chat;

  const canvas = cloneCanvasContext(request.canvasSelection);
  if (canvas) selectionContext.canvas = canvas;

  return hasMessageSelectionContext(selectionContext) ? selectionContext : undefined;
}

export function hasMessageSelectionContext(context: MessageSelectionContext | undefined): context is MessageSelectionContext {
  return !!context && (
    hasText(context.editor?.selectedText)
    || hasText(context.browser?.selectedText)
    || hasText(context.chat?.selectedText)
    || (context.canvas?.nodeIds.length ?? 0) > 0
  );
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(rawAttributes: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([\w:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rawAttributes)) !== null) {
    attrs[match[1]] = decodeXmlText(match[2]);
  }
  return attrs;
}

function stripWrapperNewlines(text: string): string {
  let result = text;
  if (result.startsWith('\n')) result = result.slice(1);
  if (result.endsWith('\n')) result = result.slice(0, -1);
  return decodeXmlText(result);
}

function findXmlBlocks(text: string, tagName: XmlTagName): Array<{ attrs: Record<string, string>; body: string }> {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const blocks: Array<{ attrs: Record<string, string>; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push({
      attrs: parseAttributes(match[1]),
      body: stripWrapperNewlines(match[2]),
    });
  }
  return blocks;
}

function parseLineRange(value: string | undefined, body: string): { startLine?: number; lineCount: number } {
  if (value) {
    const match = value.match(/^(\d+)-(\d+)$/);
    if (match) {
      const startLine = Number(match[1]);
      const endLine = Number(match[2]);
      if (Number.isFinite(startLine) && Number.isFinite(endLine) && endLine >= startLine) {
        return { startLine, lineCount: endLine - startLine + 1 };
      }
    }
  }
  return { lineCount: body.split(/\r?\n/).length };
}

export function parseXmlMessageSelectionContext(text: string): MessageSelectionContext | undefined {
  const selectionContext: MessageSelectionContext = {};

  const editorBlock = findXmlBlocks(text, 'editor_selection')[0];
  if (editorBlock && hasText(editorBlock.body)) {
    const lineRange = parseLineRange(editorBlock.attrs.lines, editorBlock.body);
    selectionContext.editor = {
      notePath: editorBlock.attrs.path ?? 'unknown',
      mode: 'selection',
      selectedText: editorBlock.body,
      lineCount: lineRange.lineCount,
      ...(lineRange.startLine !== undefined && { startLine: lineRange.startLine }),
    };
  }

  const browserBlock = findXmlBlocks(text, 'browser_selection')[0];
  if (browserBlock && hasText(browserBlock.body)) {
    selectionContext.browser = {
      source: browserBlock.attrs.source ?? 'browser:unknown',
      selectedText: browserBlock.body,
      ...(browserBlock.attrs.title && { title: browserBlock.attrs.title }),
      ...(browserBlock.attrs.url && { url: browserBlock.attrs.url }),
    };
  }

  const chatBlock = findXmlBlocks(text, 'chat_selection')[0];
  if (chatBlock && hasText(chatBlock.body)) {
    const parsedLineCount = Number(chatBlock.attrs.lines);
    const role = chatBlock.attrs.role === 'user' || chatBlock.attrs.role === 'assistant'
      ? chatBlock.attrs.role
      : undefined;
    selectionContext.chat = {
      selectedText: chatBlock.body,
      lineCount: Number.isFinite(parsedLineCount) && parsedLineCount > 0
        ? parsedLineCount
        : chatBlock.body.split(/\r?\n/).length,
      ...(chatBlock.attrs.message_id && { messageId: chatBlock.attrs.message_id }),
      ...(role && { role }),
    };
  }

  const canvasBlock = findXmlBlocks(text, 'canvas_selection')[0];
  if (canvasBlock) {
    const nodeIds = canvasBlock.body
      .split(',')
      .map(nodeId => nodeId.trim())
      .filter(Boolean);
    if (nodeIds.length > 0) {
      selectionContext.canvas = {
        canvasPath: canvasBlock.attrs.path ?? 'unknown',
        nodeIds,
      };
    }
  }

  return hasMessageSelectionContext(selectionContext) ? selectionContext : undefined;
}

function parseCodexSourceSelection(
  text: string,
  label: 'Editor' | 'Browser' | 'Chat' | 'Canvas',
): { source: string; body: string } | null {
  const pattern = new RegExp(`\\n?\\[${label} selection from ([\\s\\S]*?):\\n([\\s\\S]*?)\\n\\]`, 'i');
  const match = text.match(pattern);
  if (!match) return null;
  return {
    source: match[1].trim(),
    body: match[2],
  };
}

export function parseCodexMessageSelectionContext(text: string): MessageSelectionContext | undefined {
  const selectionContext: MessageSelectionContext = {};

  const editor = parseCodexSourceSelection(text, 'Editor');
  if (editor && hasText(editor.body)) {
    selectionContext.editor = {
      notePath: editor.source || 'current note',
      mode: 'selection',
      selectedText: editor.body,
      lineCount: editor.body.split(/\r?\n/).length,
    };
  }

  const browser = parseCodexSourceSelection(text, 'Browser');
  if (browser && hasText(browser.body)) {
    const isKnownUrl = browser.source !== 'unknown page';
    selectionContext.browser = {
      source: isKnownUrl ? `browser:${browser.source}` : 'browser:unknown',
      selectedText: browser.body,
      ...(isKnownUrl && { url: browser.source }),
    };
  }

  const chat = parseCodexSourceSelection(text, 'Chat');
  if (chat && hasText(chat.body)) {
    const role = chat.source.includes('assistant message')
      ? 'assistant'
      : chat.source.includes('user message')
        ? 'user'
        : undefined;
    const messageIdMatch = chat.source.match(/\bmessage\s+(.+)$/);
    selectionContext.chat = {
      selectedText: chat.body,
      lineCount: chat.body.split(/\r?\n/).length,
      ...(role && { role }),
      ...(messageIdMatch?.[1] && { messageId: messageIdMatch[1] }),
    };
  }

  const canvas = parseCodexSourceSelection(text, 'Canvas');
  if (canvas) {
    const nodeIds = canvas.body
      .split(',')
      .map(nodeId => nodeId.trim())
      .filter(Boolean);
    if (nodeIds.length > 0) {
      selectionContext.canvas = {
        canvasPath: canvas.source,
        nodeIds,
      };
    }
  }

  return hasMessageSelectionContext(selectionContext) ? selectionContext : undefined;
}
