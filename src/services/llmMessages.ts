import { RNLlamaOAICompatibleMessage, RNLlamaMessagePart } from 'llama.rn';
import { Message } from '../types';

export function formatLlamaMessages(messages: Message[], supportsVision: boolean, supportsAudio = false): string {
  let prompt = '';
  for (const message of messages.filter(m => !m.isSystemInfo)) {
    if (message.role === 'system') {
      prompt += `<|im_start|>system\n${message.content}<|im_end|>\n`;
    } else if (message.role === 'user') {
      let content = message.content;
      if (message.attachments && message.attachments.length > 0) {
        const imageMarkers = supportsVision
          ? message.attachments.filter(a => a.type === 'image').map(() => '<__media__>').join('')
          : '';
        const audioMarkers = supportsAudio
          ? message.attachments.filter(a => a.type === 'audio').map(() => '<__media__>').join('')
          : '';
        content = imageMarkers + audioMarkers + content;
      }
      prompt += `<|im_start|>user\n${content}<|im_end|>\n`;
    } else if (message.role === 'assistant') {
      prompt += `<|im_start|>assistant\n${message.content}<|im_end|>\n`;
    }
  }
  prompt += '<|im_start|>assistant\n';
  return prompt;
}

export function extractImageUris(messages: Message[]): string[] {
  const uris: string[] = [];
  for (const message of messages) {
    if (message.attachments) {
      for (const attachment of message.attachments) {
        if (attachment.type === 'image') {
          uris.push(attachment.uri);
        }
      }
    }
  }
  return uris;
}

/**
 * Format a tool call as plain text for the assistant message.
 * Avoids structured tool_calls which cause Jinja template errors
 * (C++ wants arguments as string, Jinja wants dict — can't satisfy both).
 */
function formatToolCallAsText(tc: { name: string; arguments: string }): string {
  const escapedName = JSON.stringify(tc.name);
  return `<tool_call>{"name":${escapedName},"arguments":${tc.arguments}}</tool_call>`;
}

function toFileUrl(uri: string, requireFilePrefix = false): string {
  if (requireFilePrefix) return uri.startsWith('file://') ? uri : `file://${uri}`;
  return uri.startsWith('file://') || uri.startsWith('http') ? uri : `file://${uri}`;
}

function buildMediaParts(message: Message, supportsAudio: boolean): RNLlamaMessagePart[] {
  const parts: RNLlamaMessagePart[] = [];
  for (const a of message.attachments?.filter(att => att.type === 'image') ?? []) {
    parts.push({ type: 'image_url', image_url: { url: toFileUrl(a.uri) } });
  }
  if (supportsAudio) {
    for (const a of message.attachments?.filter(att => att.type === 'audio') ?? []) {
      parts.push({ type: 'input_audio', input_audio: { format: a.audioFormat ?? 'wav', url: toFileUrl(a.uri, true) } });
    }
  }
  if (message.content) parts.push({ type: 'text', text: message.content });
  return parts;
}

export function buildOAIMessages(messages: Message[], supportsAudio = false): RNLlamaOAICompatibleMessage[] {
  return messages.filter(m => !m.isSystemInfo).map((message) => {
    if (message.role === 'tool') {
      const label = message.toolName || 'tool';
      return { role: 'user' as const, content: `[Tool Result: ${label}]\n${message.content}\n[End Tool Result]` };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const toolCallText = message.toolCalls.map(formatToolCallAsText).join('\n');
      return { role: 'assistant' as const, content: message.content ? `${message.content}\n${toolCallText}` : toolCallText };
    }
    const hasImage = message.role === 'user' && message.attachments?.some(a => a.type === 'image');
    const hasAudio = supportsAudio && message.role === 'user' && message.attachments?.some(a => a.type === 'audio');
    if (!hasImage && !hasAudio) return { role: message.role, content: message.content };
    return { role: message.role, content: buildMediaParts(message, supportsAudio) };
  });
}
