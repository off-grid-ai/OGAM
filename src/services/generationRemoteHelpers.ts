// Remote (OpenAI-compatible server) generation paths for GenerationService.
//
// Split from generationServiceHelpers.ts, which owns the LOCAL engines (llama.rn and LiteRT). The two
// answer different questions - what this device can run, versus what a server on the network will run -
// and only the shared preparation, meta and tool-loop wiring is common to both.
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { runToolLoop } from './generationToolLoop';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';
import { providerRegistry } from './providers';
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

  const callbacks = {
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
      throw error;
    },
  };

  try {
    await provider.generate(messages, options, callbacks);
  } catch (error) {
    if (generationSignal.aborted) return;
    logger.error('[GenerationService] Remote generation error:', error);
    // Mark server as offline so the Remote Servers screen reflects the failure
    const failedServerId = useRemoteServerStore.getState().activeServerId;
    if (failedServerId)
      useRemoteServerStore.getState().updateServerHealth(failedServerId, false);
    const local = providerRegistry.getProvider('local');
    if (local?.isModelLoaded?.()) {
      svc.forceFlushTokens();
      chatStore.clearStreamingMessage();
      svc.state.streamingContent = '';
      svc.tokenBuffer = '';
      svc.reasoningBuffer = '';
      svc.remoteTimeToFirstToken = undefined;
      firstTokenReceived = false;
      const failedName =
        useRemoteServerStore.getState().getActiveServer()?.name ??
        'Remote model';
      const loadedId = local.getLoadedModelId?.();
      const nextName =
        useAppStore.getState().downloadedModels.find(
          model => model.id === loadedId || model.filePath === loadedId,
        )?.name ?? loadedId ?? 'Local model';
      const rawReason =
        error instanceof Error ? error.message.trim().split('\n')[0] : '';
      const reason = rawReason.length > 160
        ? `${rawReason.slice(0, 157).trimEnd()}...`
        : rawReason;
      chatStore.addMessage(conversationId, {
        role: 'tool',
        toolName: 'model_fallback',
        content: `${failedName} could not answer (${reason || 'unknown error'}). ${nextName} answered instead.`,
      });
      chatStore.startStreaming(conversationId);
      svc.updateState({ isThinking: true, startTime: Date.now() });
      svc.answeringModelName = nextName;
      svc.answeringLocally = true;
      await local.generate(
        messages,
        {
          ...options,
          enableThinking:
            thinkingEnabled && local.capabilities.supportsThinking,
        },
        callbacks,
      );
      return;
    }
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

  const { enabledToolIds, projectId, ...callbacks } = options;

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
