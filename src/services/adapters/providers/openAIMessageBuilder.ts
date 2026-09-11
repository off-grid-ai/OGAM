/**
 * OpenAI-Compatible Provider — message builder.
 * Mobile only turns its stored Message records into provider-neutral GenerationMessages (encoding
 * image attachments is the one piece of I/O here); the OpenAI wire shape, system-prompt injection
 * and text-as-parts rule are the shared projection. The prepared system prompt must arrive either
 * as a role:'system' entry in `messages` or via `options.systemPrompt` — this adapter never reads
 * committed settings itself.
 */
import { openAIProjectedMessages, type GenerationMessage } from '@offgrid/models';
import type { Message } from '../../../types';
import type { GenerationOptions, ProviderCapabilities } from './types';
import type { OpenAIChatMessage } from './openAICompatibleTypes';
import { imageToBase64DataUrl } from '../../httpClient';
import logger from '../../../utils/logger';
import { generateId } from '../../../utils/generateId';

async function generationMessage(
  msg: Message,
  capabilities: ProviderCapabilities,
): Promise<GenerationMessage> {
  if (msg.role === 'tool') {
    return { role: 'tool', content: msg.content, toolCallId: msg.toolCallId || '' };
  }
  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: msg.content || '',
      toolCalls: msg.toolCalls.map(tc => ({
        id: tc.id || `call_${generateId()}`,
        name: tc.name,
        arguments: tc.arguments,
      })),
    };
  }
  const images = (msg.attachments || []).filter(a => a.type === 'image');
  if (msg.role === 'user' && images.length && capabilities.supportsVision) {
    const parts: GenerationMessage['content'] = [{ type: 'text', text: msg.content }];
    for (const attachment of images) {
      try {
        const dataUrl = await imageToBase64DataUrl(attachment.uri);
        parts.push({ type: 'image', uri: dataUrl });
      } catch (error) {
        logger.warn('[OpenAIProvider] Failed to encode image:', error);
      }
    }
    return { role: 'user', content: parts };
  }
  return { role: msg.role, content: msg.content };
}

export async function buildOpenAIMessagesImpl(
  messages: Message[],
  options: GenerationOptions,
  capabilities: ProviderCapabilities,
): Promise<OpenAIChatMessage[]> {
  const neutral = await Promise.all(messages.map(msg => generationMessage(msg, capabilities)));
  return openAIProjectedMessages(neutral, {
    systemPrompt: options.systemPrompt,
    textAsParts: true,
  }) as OpenAIChatMessage[];
}
