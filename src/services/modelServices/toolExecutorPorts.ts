import type {
  ConversationPort,
  GenerationToolCall,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutorPort,
} from '@offgrid/models';
import { executeToolCall } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import type { ToolCall } from '../tools/types';

function toolCall(
  call: GenerationToolCall,
  context: ToolExecutionContext,
): ToolCall {
  return {
    id: call.id,
    name: call.name,
    // Shared executeGenerationTool has already decoded and schema-validated this
    // JSON object before the platform boundary is called.
    arguments: JSON.parse(call.arguments || '{}') as Record<string, unknown>,
    context: {
      conversationId: context.identity?.conversationId,
      projectId: context.projectId,
    },
  };
}

/** Invoke Mobile built-in and extension tools. Shared owns all result policy. */
export const mobileToolExecutor: ToolExecutorPort = {
  async execute(call, context): Promise<ToolExecutionResult> {
    const mobileCall = toolCall(call, context);
    const extension = getToolExtensions().find(item =>
      item.canHandle(mobileCall.name),
    );
    const result = extension
      ? await extension.execute(mobileCall)
      : await executeToolCall(mobileCall);
    return {
      content: result.error || result.content,
      isError: !!result.error,
      terminal: result.terminal,
      metadata: { platformResult: result },
    };
  },
};

/**
 * The generation loop already reports every tool-call/result message to ChatSession. This port has
 * no persistence side effect: ChatSession commits the captured response list and owns its IDs once.
 */
export const mobileConversationPort: ConversationPort = {
  append: () => Promise.resolve(),
};
