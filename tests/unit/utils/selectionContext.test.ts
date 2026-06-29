import type { ChatTurnRequest } from '../../../src/core/runtime/types';
import {
  buildMessageSelectionContext,
  parseCodexMessageSelectionContext,
  parseXmlMessageSelectionContext,
} from '../../../src/utils/selectionContext';

describe('buildMessageSelectionContext', () => {
  it('captures editor, browser, chat, and canvas selection context from turn requests', () => {
    const request: ChatTurnRequest = {
      text: 'Explain this',
      editorSelection: {
        notePath: 'src/main.ts',
        mode: 'selection',
        selectedText: 'const x = 1;',
        startLine: 10,
        lineCount: 1,
      },
      browserSelection: {
        source: 'browser:tab',
        title: 'Docs',
        url: 'https://example.com/docs',
        selectedText: 'browser text',
      },
      chatSelection: {
        selectedText: 'chat text',
        lineCount: 1,
        role: 'assistant',
        messageId: 'assistant-1',
      },
      canvasSelection: {
        canvasPath: 'board.canvas',
        nodeIds: ['node-a', 'node-b'],
      },
    };

    const context = buildMessageSelectionContext(request);
    request.canvasSelection!.nodeIds.push('node-c');

    expect(context).toEqual({
      editor: {
        notePath: 'src/main.ts',
        mode: 'selection',
        selectedText: 'const x = 1;',
        startLine: 10,
        lineCount: 1,
      },
      browser: {
        source: 'browser:tab',
        title: 'Docs',
        url: 'https://example.com/docs',
        selectedText: 'browser text',
      },
      chat: {
        selectedText: 'chat text',
        lineCount: 1,
        role: 'assistant',
        messageId: 'assistant-1',
      },
      canvas: {
        canvasPath: 'board.canvas',
        nodeIds: ['node-a', 'node-b'],
      },
    });
  });

  it('ignores cursor, empty, and non-selection context', () => {
    const context = buildMessageSelectionContext({
      text: 'Continue',
      editorSelection: {
        notePath: 'src/main.ts',
        mode: 'cursor',
        cursorContext: {
          beforeCursor: '',
          afterCursor: '',
          isInbetween: true,
          line: 0,
          column: 0,
        },
      },
      browserSelection: {
        source: 'browser:tab',
        selectedText: '   ',
      },
      chatSelection: {
        selectedText: '',
        lineCount: 0,
      },
      canvasSelection: {
        canvasPath: 'board.canvas',
        nodeIds: [],
      },
    });

    expect(context).toBeUndefined();
  });
});

describe('parseXmlMessageSelectionContext', () => {
  it('returns undefined when there are no XML selection blocks', () => {
    expect(parseXmlMessageSelectionContext('Just a normal message')).toBeUndefined();
  });

  it('hydrates editor, browser, chat, and canvas XML context blocks', () => {
    const context = parseXmlMessageSelectionContext([
      'Explain this',
      '',
      '<editor_selection path="src/&quot;main&quot;.ts" lines="3-4">',
      'const a = 1;',
      'const b = 2;',
      '</editor_selection>',
      '',
      '<browser_selection source="browser:tab" title="A &amp; B" url="https://example.com?a=1&amp;b=2">',
      'Use &lt;strong&gt;text&lt;/strong&gt;',
      '</browser_selection>',
      '',
      '<chat_selection lines="2" role="assistant" message_id="assistant-1">',
      'First',
      'Second',
      '</chat_selection>',
      '',
      '<canvas_selection path="board.canvas">',
      'node-a, node-b',
      '</canvas_selection>',
    ].join('\n'));

    expect(context).toEqual({
      editor: {
        notePath: 'src/"main".ts',
        mode: 'selection',
        selectedText: 'const a = 1;\nconst b = 2;',
        startLine: 3,
        lineCount: 2,
      },
      browser: {
        source: 'browser:tab',
        title: 'A & B',
        url: 'https://example.com?a=1&b=2',
        selectedText: 'Use <strong>text</strong>',
      },
      chat: {
        selectedText: 'First\nSecond',
        lineCount: 2,
        role: 'assistant',
        messageId: 'assistant-1',
      },
      canvas: {
        canvasPath: 'board.canvas',
        nodeIds: ['node-a', 'node-b'],
      },
    });
  });
});

describe('parseCodexMessageSelectionContext', () => {
  it('hydrates Codex bracket-style selection context blocks', () => {
    const context = parseCodexMessageSelectionContext([
      'Explain this',
      '[Editor selection from src/main.ts:',
      'const x = 1;',
      ']',
      '[Browser selection from https://example.com/docs:',
      'browser text',
      ']',
      '[Chat selection from assistant message assistant-1:',
      'chat text',
      ']',
      '[Canvas selection from board.canvas:',
      'node-a, node-b',
      ']',
    ].join('\n'));

    expect(context).toEqual({
      editor: {
        notePath: 'src/main.ts',
        mode: 'selection',
        selectedText: 'const x = 1;',
        lineCount: 1,
      },
      browser: {
        source: 'browser:https://example.com/docs',
        url: 'https://example.com/docs',
        selectedText: 'browser text',
      },
      chat: {
        selectedText: 'chat text',
        lineCount: 1,
        role: 'assistant',
        messageId: 'assistant-1',
      },
      canvas: {
        canvasPath: 'board.canvas',
        nodeIds: ['node-a', 'node-b'],
      },
    });
  });
});
