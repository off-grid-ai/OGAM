import { parseModelOutput } from '../../utils/messageContent';
import type { Message } from '../../types';
import type { ParsedContent } from './types';
export { parseThinkingContent, parseModelOutput } from '../../utils/messageContent';
;



/** A message's time, from the one formatter that answers in the device's own zone. */
export { formatClockTime as formatTime } from '../../utils/localTime';

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export type MessageData = { displayContent: string; parsedContent: ParsedContent };

const parsedMessages = new WeakMap<
  Message,
  {
    content: string;
    reasoningContent?: string;
    data: MessageData;
  }
>();

export function buildMessageData(message: Message): MessageData {
  const cached = parsedMessages.get(message);
  if (
    cached?.content === message.content &&
    cached.reasoningContent === message.reasoningContent
  ) {
    return cached.data;
  }
  const data = parseMessageData(message);
  parsedMessages.set(message, {
    content: message.content,
    reasoningContent: message.reasoningContent,
    data,
  });
  return data;
}

function parseMessageData(message: Message): MessageData {
  // Non-assistant messages carry no model markup — pass content straight through.
  if (message.role !== 'assistant') {
    return { displayContent: message.content, parsedContent: { thinking: null, response: message.content, isThinkingComplete: true } };
  }
  // ONE parse (parseModelOutput) owns the reasoning-vs-clean-answer split for every render path,
  // so the answer can never carry raw tool-call/control markup (the leak class). This maps its
  // result onto the legacy ParsedContent shape existing renderers consume.
  const parsed = parseModelOutput(message.content, message.reasoningContent);
  return {
    displayContent: parsed.answer,
    parsedContent: { thinking: parsed.reasoning, response: parsed.answer, isThinkingComplete: parsed.isReasoningComplete, thinkingLabel: parsed.reasoningLabel },
  };
}
