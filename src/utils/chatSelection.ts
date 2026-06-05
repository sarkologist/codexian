export interface ChatSelectionContext {
  selectedText: string;
  lineCount: number;
  messageId?: string;
  role?: 'user' | 'assistant';
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlBody(text: string): string {
  return text.replace(/<\/chat_selection>/gi, '&lt;/chat_selection&gt;');
}

function buildAttributeList(context: ChatSelectionContext): string {
  const attrs: string[] = [`lines="${context.lineCount}"`];

  if (context.role) {
    attrs.push(`role="${escapeXmlAttribute(context.role)}"`);
  }

  if (context.messageId?.trim()) {
    attrs.push(`message_id="${escapeXmlAttribute(context.messageId.trim())}"`);
  }

  return attrs.join(' ');
}

export function formatChatSelectionContext(context: ChatSelectionContext): string {
  const selectedText = context.selectedText.trim();
  if (!selectedText) return '';
  return `<chat_selection ${buildAttributeList(context)}>\n${escapeXmlBody(selectedText)}\n</chat_selection>`;
}

export function appendChatSelectionContext(prompt: string, context: ChatSelectionContext): string {
  const formatted = formatChatSelectionContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
