import type { McpServerManager } from '../../../core/mcp/McpServerManager';
import type { ChatTurnRequest, PreparedChatTurn } from '../../../core/runtime/types';
import { appendBrowserContext } from '../../../utils/browser';
import { appendCanvasContext } from '../../../utils/canvas';
import { appendChatSelectionContext } from '../../../utils/chatSelection';
import { appendCurrentNote } from '../../../utils/context';
import { appendEditorContext } from '../../../utils/editor';

function isCompactCommand(text: string): boolean {
  return /^\/compact(\s|$)/i.test(text);
}

export function encodeClaudeTurn(
  request: ChatTurnRequest,
  mcpManager: Pick<McpServerManager, 'extractMentions' | 'transformMentions'>,
): PreparedChatTurn {
  const isCompact = isCompactCommand(request.text);

  let persistedContent = request.text;
  if (!isCompact) {
    if (request.currentNotePath) {
      persistedContent = appendCurrentNote(persistedContent, request.currentNotePath);
    }

    if (request.editorSelection) {
      persistedContent = appendEditorContext(persistedContent, request.editorSelection);
    }

    if (request.browserSelection) {
      persistedContent = appendBrowserContext(persistedContent, request.browserSelection);
    }

    if (request.chatSelection) {
      persistedContent = appendChatSelectionContext(persistedContent, request.chatSelection);
    }

    if (request.canvasSelection) {
      persistedContent = appendCanvasContext(persistedContent, request.canvasSelection);
    }
  }

  const mcpMentions = mcpManager.extractMentions(persistedContent);

  return {
    request,
    persistedContent,
    prompt: mcpManager.transformMentions(persistedContent),
    isCompact,
    mcpMentions,
  };
}
