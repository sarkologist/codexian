import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
} from '@/core/runtime/QueuedTurn';

describe('QueuedTurn chat selection handling', () => {
  it('clones chat selection context', () => {
    const request = {
      text: 'hello',
      chatSelection: {
        selectedText: 'chat text',
        lineCount: 1,
        messageId: 'assistant-1',
        role: 'assistant' as const,
      },
    };

    const cloned = cloneChatTurnRequest(request);

    expect(cloned.chatSelection).toEqual(request.chatSelection);
    expect(cloned.chatSelection).not.toBe(request.chatSelection);
  });

  it('uses the newest non-null chat selection when merging turns', () => {
    const existing = {
      displayContent: 'first',
      request: {
        text: 'first',
        chatSelection: {
          selectedText: 'old chat text',
          lineCount: 1,
          messageId: 'assistant-old',
          role: 'assistant' as const,
        },
      },
    };
    const incoming = {
      displayContent: 'second',
      request: {
        text: 'second',
        chatSelection: {
          selectedText: 'new chat text',
          lineCount: 1,
          messageId: 'assistant-new',
          role: 'assistant' as const,
        },
      },
    };

    const merged = mergeQueuedChatTurns(existing, incoming);

    expect(merged.request.chatSelection).toEqual(incoming.request.chatSelection);
    expect(merged.request.chatSelection).not.toBe(incoming.request.chatSelection);
  });

  it('keeps existing chat selection when incoming turn has none', () => {
    const existing = {
      displayContent: 'first',
      request: {
        text: 'first',
        chatSelection: {
          selectedText: 'old chat text',
          lineCount: 1,
          messageId: 'assistant-old',
          role: 'assistant' as const,
        },
      },
    };
    const incoming = {
      displayContent: 'second',
      request: {
        text: 'second',
      },
    };

    const merged = mergeQueuedChatTurns(existing, incoming);

    expect(merged.request.chatSelection).toEqual(existing.request.chatSelection);
    expect(merged.request.chatSelection).not.toBe(existing.request.chatSelection);
  });
});
