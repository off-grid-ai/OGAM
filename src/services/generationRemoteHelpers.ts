// Remote (OpenAI-compatible server) generation paths for GenerationService.
//
// Split from generationServiceHelpers.ts, which owns the LOCAL engines (llama.rn and LiteRT). The two
// answer different questions - what this device can run, versus what a server on the network will run -
// and only the shared preparation, meta and tool-loop wiring is common to both.
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { runToolLoop } from './generationToolLoop';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';
import {
  FLUSH_INTERVAL_MS,
  buildGenerationMetaImpl,
  buildToolLoopHandlersImpl,
  keepShownPartialOnError,
  prepareGenerationImpl,
  type GenerationRequest,
  type GenerationWithToolsRequest,
} from './generationServiceHelpers';

export async function generateRemoteResponseImpl(
  svc: any,
  req: GenerationRequest,
): Promise<void> {
  const { conversationId, messages, onFirstToken } = req;
  if (!(await prepareGenerationImpl(svc, conversationId))) return;
  svc.contextUsage = req.contextUsage;
  const chatStore = useChatStore.getState();
  const provider = svc.getCurrentProvider();

  if (!provider) {
    svc.resetState();
    throw new Error('No remote provider available');
  }
  let firstTokenReceived = false;
  svc.remoteTimeToFirstToken = undefined;

  svc.currentRemoteAbortController = new AbortController();
  // Capture signal per-generation so callbacks stay guarded even after
  // abortRequested is reset by the next generation's prepareGeneration().
  const { signal: generationSignal } = svc.currentRemoteAbortController;

  const { temperature, maxTokens, topP, thinkingEnabled, reasoningBudget } =
    useAppStore.getState().settings;
  const options: GenerationOptions = {
    temperature,
    maxTokens,
    topP,
    stopSequences: [],
    enableThinking: thinkingEnabled && provider.capabilities.supportsThinking,
    reasoningBudget,
  };

  try {
    await provider.generate(messages, options, {
      onToken: (token: string) => {
        if (generationSignal.aborted) return;
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          svc.remoteTimeToFirstToken = svc.state.startTime
            ? (Date.now() - svc.state.startTime) / 1000
            : undefined;
          svc.updateState({ isThinking: false });
          onFirstToken?.();
        }
        svc.state.streamingContent += token;
        svc.tokenBuffer += token;
        if (!svc.flushTimer) {
          svc.flushTimer = setTimeout(
            () => svc.flushTokenBuffer(),
            FLUSH_INTERVAL_MS,
          );
        }
      },
      onReasoning: (content: string) => {
        if (generationSignal.aborted) return;
        svc.reasoningBuffer += content;
        svc.totalReasoningLength += content.length;
        if (!svc.flushTimer) {
          svc.flushTimer = setTimeout(
            () => svc.flushTokenBuffer(),
            FLUSH_INTERVAL_MS,
          );
        }
      },
      onComplete: (_result: CompletionResult) => {
        if (generationSignal.aborted) return;
        svc.forceFlushTokens();
        const generationTime = svc.state.startTime
          ? Date.now() - svc.state.startTime
          : undefined;
        chatStore.finalizeStreamingMessage(
          conversationId,
          generationTime,
          buildGenerationMetaImpl(svc),
        );
        svc.checkSharePrompt();
        svc.resetState();
      },
      onError: (error: Error) => {
        if (generationSignal.aborted) return;
        logger.error('[GenerationService] Remote generation error:', error);
        keepShownPartialOnError(svc, conversationId);
        throw error;
      },
    });
  } catch (error) {
    if (generationSignal.aborted) return;
    logger.error('[GenerationService] Remote generation error:', error);
    // Mark server as offline so the Remote Servers screen reflects the failure
    const failedServerId = useRemoteServerStore.getState().activeServerId;
    if (failedServerId)
      useRemoteServerStore.getState().updateServerHealth(failedServerId, false);
    keepShownPartialOnError(svc, conversationId);
    throw error;
  } finally {
    svc.currentRemoteAbortController = null;
  }
}

export async function generateRemoteWithToolsImpl(
  svc: any,
  req: GenerationWithToolsRequest,
): Promise<void> {
  const { conversationId, messages, options } = req;
  const { enabledToolIds, projectId, contextUsage, ...callbacks } = options;
  logger.log(
    `[GenService][DEBUG] generateRemoteWithToolsImpl — conv=${conversationId}, messages=${
      messages.length
    }, enabledToolIds=[${options.enabledToolIds.join(', ')}]`,
  );
  if (!(await prepareGenerationImpl(svc, conversationId))) {
    logger.log(
      `[GenService][DEBUG] prepareGeneration returned false, aborting`,
    );
    return;
  }
  svc.contextUsage = contextUsage;
  const provider = svc.getCurrentProvider();

  if (!provider) {
    svc.resetState();
    throw new Error('No remote provider available');
  }
  logger.log(
    `[GenService][DEBUG] Provider ready — type=${
      provider.type
    }, capabilities=${JSON.stringify(provider.capabilities)}`,
  );

  try {
    // Use the same tool loop but with remote provider
    await runToolLoop({
      conversationId,
      messages,
      enabledToolIds,
      projectId,
      callbacks,
      ...buildToolLoopHandlersImpl(svc),
      forceRemote: true,
    });

    if (svc.abortRequested) {
      logger.log(
        `[GenService][DEBUG] Generation was aborted, skipping finalize`,
      );
    } else {
      svc.forceFlushTokens();
      const generationTime = svc.state.startTime
        ? Date.now() - svc.state.startTime
        : undefined;
      logger.log(
        `[GenService][DEBUG] Finalizing — streamingContent length=${
          svc.state.streamingContent?.length || 0
        }, generationTime=${generationTime}ms`,
      );
      useChatStore
        .getState()
        .finalizeStreamingMessage(
          conversationId,
          generationTime,
          buildGenerationMetaImpl(svc),
        );
      svc.checkSharePrompt();
      svc.resetState();
    }
  } catch (error) {
    if (svc.abortRequested) return;
    logger.error('[GenerationService] Remote tool generation error:', error);
    // Reset generating state on error, else isGenerating stays stuck → red stop, next send blocked (2026-07-14).
    keepShownPartialOnError(svc, conversationId);
    throw error;
  }
}
