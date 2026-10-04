import {
  completeChatStreamTool,
  startChatStreamTool,
  type ChatStreamTool,
} from '@offgrid/sync';
import type { MessageRecord } from '@offgrid/application';

/**
 * Fold the committed messages of one conversation's LAST turn into the portable live tool record.
 *
 * THE single fold. Callers pass canonical `MessageRecord`s straight from root Workspace Content -
 * the one owner of durable message facts - so there is no second projection of the same rule to
 * drift from. The state machine itself stays in `@offgrid/sync` (`startChatStreamTool` /
 * `completeChatStreamTool`); this reads the portable shape and drives it.
 *
 * Canonical order is `position:asc, id:asc` and the facade already applies it, so the filtered
 * slice is read in place and Sync's ordering is preserved without a second sort.
 */
export function chatStreamToolsFromMessages(
  messages: readonly MessageRecord[],
  conversationId: string,
): ChatStreamTool[] | undefined {
  const conversation = messages.filter(
    message => message.conversationId === conversationId,
  );
  let lastUserIndex = -1;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.portable.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  let tools: ChatStreamTool[] = [];

  for (const message of conversation.slice(lastUserIndex + 1)) {
    const { role, content, context } = message.portable;
    if (role === 'assistant') {
      for (const call of context?.toolCalls ?? []) {
        tools = startChatStreamTool(tools, call.name);
      }
      continue;
    }
    const name = context?.tool?.name;
    if (role === 'tool' && name) {
      tools = completeChatStreamTool(
        tools,
        name,
        typeof content === 'string' ? content : '',
      );
    }
  }

  return tools.length > 0 ? tools : undefined;
}
