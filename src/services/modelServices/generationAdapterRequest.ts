import type {
  GenerationContentPart,
  GenerationMessage,
  GenerationRequest,
  ReasoningWireFragment,
} from '@offgrid/models';
import type { MediaAttachment, Message } from '../../types';
import type { GenerationOptions } from '../adapters/providers/types';

function textAndAttachments(content: GenerationMessage['content']): {
  text: string;
  attachments?: MediaAttachment[];
} {
  if (typeof content === 'string') return { text: content };
  const text = content
    .filter(
      (part): part is Extract<GenerationContentPart, { type: 'text' }> =>
        part.type === 'text',
    )
    .map(part => part.text)
    .join('\n');
  const attachments = content.flatMap((part, index): MediaAttachment[] => {
    if (part.type === 'text' || !part.uri) return [];
    return [
      {
        id: `shared-part-${index}`,
        type: part.type === 'file' ? 'document' : part.type,
        uri: part.uri,
        mimeType: part.mimeType,
        fileName: part.type === 'file' ? part.name : undefined,
      },
    ];
  });
  return { text, attachments: attachments.length ? attachments : undefined };
}

export function mobileMessages(messages: GenerationMessage[]): Message[] {
  return messages.map((message, index) => {
    const content = textAndAttachments(message.content);
    return {
      id: `shared-generation-${index}`,
      role: message.role,
      content: content.text,
      attachments: content.attachments,
      timestamp: 0,
      toolCallId: message.toolCallId,
      toolName: message.name,
      toolCalls: message.toolCalls,
      reasoningContent: message.reasoning,
    };
  });
}

/** Read the one canonical system prompt from the prepared message list. */
function preparedSystemPrompt(request: GenerationRequest): string | undefined {
  const message = request.messages?.find(
    candidate => candidate.role === 'system',
  );
  return message ? textAndAttachments(message.content).text : undefined;
}

export function providerOptions(
  request: GenerationRequest,
  reasoningWire: ReasoningWireFragment,
): GenerationOptions {
  return {
    temperature: request.sampling?.temperature,
    topP: request.sampling?.topP,
    topK: request.sampling?.topK,
    repeatPenalty: request.sampling?.repetitionPenalty,
    seed: request.sampling?.seed,
    stopSequences: request.sampling?.stop,
    maxTokens: request.maxTokens,
    enableThinking: request.reasoning?.enabled,
    reasoningWire,
    // The provider projection adds this only when no system message is present.
    systemPrompt: preparedSystemPrompt(request),
    tools: request.tools?.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    })),
  };
}
