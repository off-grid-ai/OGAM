import {
  GenerationAbortedError,
  ModelsFailureError,
  modelsFailureMessage,
  PartialGenerationError,
  type GenerationEvents,
  type GenerationLifecycleEvent,
  type GenerationRequest,
  type GenerationResult,
  type ModelsFailure,
} from '@offgrid/application';
import { applicationFacade } from '../../applicationFacade';

function publishLifecycle(
  event: GenerationLifecycleEvent,
  events: GenerationEvents,
): void {
  switch (event.type) {
    case 'route':
      events.route?.(event.model);
      break;
    case 'fallback':
      events.fallback?.(event.failed, event.next, event.error);
      break;
    case 'partial_discarded':
      events.partialDiscarded?.(event.model);
      break;
    case 'tool_started':
      events.toolStarted?.(event.call);
      break;
    case 'tool_completed':
      events.toolCompleted?.(event.call, event.result);
      break;
    case 'vision_recovery':
      events.visionRecovery?.(event.model, event.note);
      break;
  }
}

function failureError(failure: ModelsFailure): Error {
  switch (failure.kind) {
    case 'cancelled':
      return new GenerationAbortedError();
    case 'context_full':
    case 'unknown_model':
    case 'remote_http':
    case 'runtime':
      return new Error(modelsFailureMessage(failure));
    default:
      return new ModelsFailureError(failure);
  }
}

export async function generateChatWithModelsFacade(
  request: GenerationRequest,
  events: GenerationEvents,
): Promise<GenerationResult> {
  for await (const event of applicationFacade().models.generate({ request })) {
    if (event.type === 'chunk') events.chunk?.(event.chunk);
    else if (event.type === 'lifecycle') publishLifecycle(event.event, events);
    else if (event.type === 'message') events.message?.(event.message);
    else if (event.type === 'result') return event.result;
    else {
      const cause = failureError(event.failure);
      if (cause instanceof GenerationAbortedError || !event.partial) throw cause;
      throw new PartialGenerationError(cause, event.partial.model, {
        ...event.partial,
        toolCalls: [...event.partial.toolCalls],
      });
    }
  }
  throw new Error('Model generation ended without a result');
}
