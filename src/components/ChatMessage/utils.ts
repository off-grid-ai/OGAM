import { parseModelOutput } from '../../utils/messageContent';
import type { Message } from '../../types';
import type { ParsedContent } from './types';
export { parseThinkingContent, parseModelOutput } from '../../utils/messageContent';
export type { ParsedModelOutput } from '../../utils/messageContent';



export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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

export function buildMessageData(message: Message): { displayContent: string; parsedContent: ParsedContent } {
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