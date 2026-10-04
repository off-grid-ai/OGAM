import {
  bindGenerationCancellation,
  GenerationAbortedError,
  GenerationCancellationFailedError,
  type ClassifierExecutionPort,
} from '@offgrid/models';
import { llmService } from '../../llm';
import logger from '../../../utils/logger';

export class ClassifierStopError extends GenerationCancellationFailedError {
  readonly code = 'classifier-stop-failed' as const;

  constructor(readonly cause: unknown) {
    super('The classifier runtime did not confirm that generation stopped.', cause);
    this.name = 'ClassifierStopError';
  }
}

export async function stopClassifierAtBoundary(stop: () => Promise<void>): Promise<void> {
  try {
    await stop();
  } catch (cause) {
    const failure = new ClassifierStopError(cause);
    logger.error('[ClassifierExecutionAdapter] Classifier stop failed:', failure);
    throw failure;
  }
}

/** Raw Mobile classifier execution. Shared supplies the request and interprets the response. */
export const classifierExecutionAdapter: ClassifierExecutionPort = {
  async execute(request, signal) {
    if (signal?.aborted) throw new GenerationAbortedError();
    let response = '';
    const cancellation = bindGenerationCancellation(
      signal,
      () => stopClassifierAtBoundary(() => llmService.stopGeneration()),
      () => undefined,
    );
    try {
      await llmService.runNativeCompletion(request.messages.map((message, index) => ({
        id: `classifier:${index}`,
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : message.content
              .filter(part => part.type === 'text')
              .map(part => part.text)
              .join('\n'),
        timestamp: 0,
        ...(message.reasoning ? { reasoningContent: message.reasoning } : {}),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      })), {
        disableThinking: request.disableThinking,
        onStream: data => { response += data.content ?? ''; },
      });
      await cancellation.wait();
      if (signal?.aborted) throw new GenerationAbortedError();
      return response;
    } finally {
      cancellation.dispose();
      await cancellation.wait();
    }
  },
};
