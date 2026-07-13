// GenerationService helpers (extracted to keep generationService.ts small). Each receives
// the GenerationService instance as `svc: any` and mutates its internal state.
import { llmService } from './llm';
import { liteRTService } from './litert';
import { getActiveEngineService } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import type { Message, GenerationMeta } from '../types';
import { runToolLoop, buildLiteRTHistory } from './generationToolLoop';
import { effectiveCacheType } from './llmHelpers';
import type { ToolResult } from './tools/types';
import type { GenerationOptions, CompletionResult } from './providers/types';
import logger from '../utils/logger';

export const FLUSH_INTERVAL_MS = 50; // ~20 updates/sec
type StreamChunk = string | { content?: string; reasoningContent?: string };

/** Returns true when the currently active model uses LiteRT engine. */
function isLiteRTActive(): boolean {
  return getActiveEngineService() === liteRTService;
}

export interface GenerationRequest {
  conversationId: string;
  messages: Message[];
  onFirstToken?: () => void;
}

export interface GenerationWithToolsRequest {
  conversationId: string;
  messages: Message[];
  options: {
    enabledToolIds: string[];
    projectId?: string;
    onToolCallStart?: (name: string, args: Record<string, any>) => void;
    onToolCallComplete?: (name: string, result: ToolResult) => void;
    onFirstToken?: () => void;
  };
}

function buildLiteRTMeta(svc: any, modelName: string | undefined): GenerationMeta {
  const backend = liteRTService.getActiveBackend() ?? 'cpu';
  const stats = svc.liteRTBenchmarkStats ?? liteRTService.getLastBenchmarkStats();
  if (stats) {
    return {
      gpu: backend !== 'cpu',
      gpuBackend: backend.toUpperCase(),
      modelName,
      decodeTokensPerSecond: stats.decodeTokensPerSecond,
      prefillTokensPerSecond: stats.prefillTokensPerSecond,
      timeToFirstToken: stats.ttft,
      tokenCount: stats.prefillTokenCount,
      modelLoadTimeSeconds: stats.initTimeSeconds > 0 ? stats.initTimeSeconds : undefined,
    };
  }
  const contentLength = svc.state.streamingContent?.length ?? 0;
  const estimatedTokenCount = Math.ceil(contentLength / 4);
  const genTime = svc.state.startTime ? (Date.now() - svc.state.startTime) / 1000 : 0;
  return {
    gpu: backend !== 'cpu',
    gpuBackend: backend.toUpperCase(),
    modelName,
    tokenCount: estimatedTokenCount,
    tokensPerSecond: genTime > 0 && estimatedTokenCount > 0 ? estimatedTokenCount / genTime : undefined,
  };
}

export function buildGenerationMetaImpl(svc: any): GenerationMeta {
  const meta = buildBaseGenerationMeta(svc);
  const routed = svc.state?.routedToolNames;
  if (Array.isArray(routed) && routed.length > 0) meta.routedToolNames = routed;
  return meta;
}
function buildBaseGenerationMeta(svc: any): GenerationMeta {
  if (svc.isUsingRemoteProvider()) {
    const remoteStore = useRemoteServerStore.getState();
    const activeServer = remoteStore.getActiveServer();
    const contentLength = svc.state.streamingContent.length + svc.totalReasoningLength;
    const estimatedTokens = Math.ceil(contentLength / 4);
    const generationTime = svc.state.startTime ? (Date.now() - svc.state.startTime) / 1000 : 0;
    const tokensPerSecond = generationTime > 0 ? estimatedTokens / generationTime : undefined;
    return {
      gpu: false,
      gpuBackend: 'Remote',
      modelName: activeServer?.name || 'Remote Model',
      tokenCount: estimatedTokens,
      tokensPerSecond,
      timeToFirstToken: svc.remoteTimeToFirstToken,
    };
  }

  const { downloadedModels, activeModelId, settings } = useAppStore.getState();
  const modelName = downloadedModels.find((m: any) => m.id === activeModelId)?.name;

  if (isLiteRTActive()) {
    return buildLiteRTMeta(svc, modelName);
  }

  const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
  const perf = llmService.getPerformanceStats();
  return {
    gpu, gpuBackend, gpuLayers,
    modelName,
    tokensPerSecond: perf.lastTokensPerSecond,
    decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
    timeToFirstToken: perf.lastTimeToFirstToken,
    tokenCount: perf.lastTokenCount,
    cacheType: effectiveCacheType(settings.inferenceBackend, settings.cacheType),
  };
}

function handleStreamChunk(svc: any, chunk: { content?: string; reasoningContent?: string }): void {
  if (chunk.content) {
    if (!svc.state.streamingContent && svc.remoteTimeToFirstToken === undefined) {
      svc.remoteTimeToFirstToken = svc.state.startTime
        ? (Date.now() - svc.state.startTime) / 1000
        : undefined;
    }
    svc.state.streamingContent += chunk.content;
    svc.tokenBuffer += chunk.content;
  }
  if (chunk.reasoningContent) {
    svc.reasoningBuffer += chunk.reasoningContent;
    svc.totalReasoningLength += chunk.reasoningContent.length;
  }
}

export function buildToolLoopHandlersImpl(svc: any) {
  return {
    isAborted: () => svc.abortRequested,
    onThinkingDone: () => svc.updateState({ isThinking: false }),
    onStream: (data: StreamChunk) => {
      if (svc.abortRequested) return;
      const chunk = typeof data === 'string' ? { content: data } : data;
      handleStreamChunk(svc, chunk);
      if (!svc.flushTimer) {
        svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
      }
    },
    onStreamReset: () => {
      svc.forceFlushTokens();
      svc.state.streamingContent = '';
      svc.tokenBuffer = '';
    },
    onFinalResponse: (content: string) => {
      svc.state.streamingContent = content;
      useChatStore.getState().appendToStreamingMessage(content);
    },
    onToolsRouted: (names: string[]) => { svc.state.routedToolNames = names; },
  };
}

async function checkProviderReadiness(svc: any): Promise<string | null> {
  if (svc.isUsingRemoteProvider()) {
    const provider = svc.getCurrentProvider();
    if (!provider) return 'Remote provider not found';
    const ready = await provider.isReady();
    if (!ready) return 'Remote provider not ready';
  } else if (isLiteRTActive()) {
    if (!liteRTService.isModelLoaded()) return 'No LiteRT model loaded';
  } else {
    if (!llmService.isModelLoaded()) return 'No model loaded';
    if (llmService.isCurrentlyGenerating()) return 'LLM service busy';
  }
  return null;
}

export async function prepareGenerationImpl(svc: any, conversationId: string): Promise<boolean> {
  if (svc.state.isGenerating) return false;
  svc.updateState({
    isGenerating: true, isThinking: true, conversationId,
    streamingContent: '', startTime: Date.now(),
  });
  svc.state.routedToolNames = undefined; // reset so a prior turn's tools don't leak
  useChatStore.getState().startStreaming(conversationId);
  // Drain pending native stop so LLM is idle before we start.
  if (svc.pendingStop !== null) await svc.pendingStop;
  if (!svc.state.isGenerating) return false; // stop called during drain
  svc.abortRequested = false;

  const readinessError = await checkProviderReadiness(svc);
  if (readinessError) {
    svc.resetState();
    useChatStore.getState().clearStreamingMessage();
    throw new Error(readinessError);
  }

  svc.tokenBuffer = '';
  svc.reasoningBuffer = '';
  svc.totalReasoningLength = 0;
  svc.remoteTimeToFirstToken = undefined;
  return true;
}

function assertLiteRTImageSupport(
  imageUris: string[] | undefined,
  svc: any,
  chatStore: ReturnType<typeof useChatStore.getState>,
): void {
  if (!imageUris || imageUris.length === 0) return;
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const activeModel = downloadedModels.find((m: any) => m.id === activeModelId);
  const liteRTActiveModel = activeModel?.engine === 'litert' ? activeModel : null;
  if (!liteRTActiveModel?.liteRTVision) {
    chatStore.clearStreamingMessage();
    svc.resetState();
    throw new Error('This model does not support images. Import it with vision enabled, or remove the image.');
  }
}

function assertLiteRTAudioSupport(
  audioUris: string[] | undefined,
  svc: any,
  chatStore: ReturnType<typeof useChatStore.getState>,
): void {
  if (!audioUris || audioUris.length === 0) return;
  const { downloadedModels, activeModelId } = useAppStore.getState();
  const activeModel = downloadedModels.find((m: any) => m.id === activeModelId);
  const liteRTActiveModel = activeModel?.engine === 'litert' ? activeModel : null;
  if (!liteRTActiveModel?.liteRTAudio) {
    chatStore.clearStreamingMessage();
    svc.resetState();
    throw new Error('This model does not support audio input. Remove the audio clip or switch to an audio-capable model.');
  }
}

async function runLiteRTResponseImpl(svc: any, req: GenerationRequest): Promise<void> {
  const { conversationId, messages, onFirstToken } = req;
  const chatStore = useChatStore.getState();
  let firstTokenReceived = false;
  let jsTtftSeconds: number | undefined;

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) {
    chatStore.clearStreamingMessage();
    svc.resetState();
    return;
  }
  const systemMsg = messages.find(m => m.role === 'system');
  const systemPrompt = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
  const allAttachments = lastUser.attachments ?? [];
  const imageUris = allAttachments
    .filter((a: any) => a.type === 'image' && typeof a.uri === 'string' && a.uri.trim().length > 0)
    .map((a: any) => a.uri);
  const audioUris = allAttachments
    .filter((a: any) => a.type === 'audio' && typeof a.uri === 'string' && a.uri.trim().length > 0)
    .map((a: any) => a.uri);

  assertLiteRTImageSupport(imageUris, svc, chatStore);
  assertLiteRTAudioSupport(audioUris, svc, chatStore);

  const history = buildLiteRTHistory(messages);

  try {
    const { settings } = useAppStore.getState();
    await liteRTService.prepareConversation(conversationId, systemPrompt, {
      samplerConfig: { temperature: settings.liteRTTemperature, topP: settings.liteRTTopP },
      history,
    });

    await liteRTService.sendMessage(
      typeof lastUser.content === 'string' ? lastUser.content : '',
      {
        onToken: (token: string) => {
          if (svc.abortRequested) return;
          if (jsTtftSeconds === undefined && svc.state.startTime) {
            jsTtftSeconds = (Date.now() - svc.state.startTime) / 1000;
          }
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            svc.updateState({ isThinking: false });
            onFirstToken?.();
          }
          svc.state.streamingContent += token;
          svc.tokenBuffer += token;
          if (!svc.flushTimer) {
            svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
          }
        },
        onReasoning: (token: string) => {
          if (svc.abortRequested) return;
          // Capture TTFT on first thinking token so it reflects time-to-first-visible-output
          if (jsTtftSeconds === undefined && svc.state.startTime) {
            jsTtftSeconds = (Date.now() - svc.state.startTime) / 1000;
          }
          svc.reasoningBuffer += token;
          if (!svc.flushTimer) {
            svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
          }
        },
        onComplete: (_content: string, _reasoning: string, stats) => {
          if (svc.abortRequested) return;
          svc.forceFlushTokens();
          svc.liteRTBenchmarkStats = stats ? { ...stats, ttft: jsTtftSeconds ?? stats.ttft } : stats;
          const generationTime = svc.state.startTime ? Date.now() - svc.state.startTime : undefined;
          chatStore.finalizeStreamingMessage(conversationId, generationTime, buildGenerationMetaImpl(svc));
          svc.checkSharePrompt();
          svc.resetState();
        },
        onError: (err: Error) => {
          if (svc.abortRequested) return;
          logger.error('[LiteRT] sendMessage error:', err.message);
          if (svc.flushTimer) { clearTimeout(svc.flushTimer); svc.flushTimer = null; }
          svc.tokenBuffer = '';
          chatStore.clearStreamingMessage();
          svc.resetState();
        },
      },
      { imageUris, audioUris },
    );
  } catch (error: any) {
    if (svc.abortRequested) return;
    if (svc.flushTimer) { clearTimeout(svc.flushTimer); svc.flushTimer = null; }
    svc.tokenBuffer = '';
    chatStore.clearStreamingMessage();
    svc.resetState();
    throw error;
  }
}

export async function generateResponseImpl(
  svc: any,
  req: GenerationRequest,
): Promise<void> {
  const { conversationId, messages, onFirstToken } = req;
  if (!(await prepareGenerationImpl(svc, conversationId))) return;

  if (isLiteRTActive()) {
    return runLiteRTResponseImpl(svc, req);
  }

  const chatStore = useChatStore.getState();
  let firstTokenReceived = false;

  // llama.cpp path — unchanged
  try {
    await llmService.generateResponse(
      messages,
      (data) => {
        if (svc.abortRequested) return;
        const chunk = typeof data === 'string' ? { content: data, reasoningContent: undefined } : data;
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          svc.updateState({ isThinking: false });
          onFirstToken?.();
        }
        if (chunk.content) {
          svc.state.streamingContent += chunk.content;
          svc.tokenBuffer += chunk.content;
        }
        if (chunk.reasoningContent) {
          svc.reasoningBuffer += chunk.reasoningContent;
        }
        if (!svc.flushTimer) {
          svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
        }
      },
      () => {
        // If aborted, stopGeneration() already handled cleanup — don't clobber new generation state.
        if (svc.abortRequested) return;
        svc.forceFlushTokens();
        const generationTime = svc.state.startTime ? Date.now() - svc.state.startTime : undefined;
        chatStore.finalizeStreamingMessage(conversationId, generationTime, buildGenerationMetaImpl(svc));
        svc.checkSharePrompt();
        svc.resetState();
      },
    );
  } catch (error) {
    if (svc.abortRequested) return;
    logger.error('[GenerationService] Generation error:', error);
    if (svc.flushTimer) { clearTimeout(svc.flushTimer); svc.flushTimer = null; }
    svc.tokenBuffer = '';
    chatStore.clearStreamingMessage();
    svc.resetState();
    throw error;
  }
}

export async function generateRemoteResponseImpl(
  svc: any,
  req: GenerationRequest,
): Promise<void> {
  const { conversationId, messages, onFirstToken } = req;
  if (!(await prepareGenerationImpl(svc, conversationId))) return;
  const chatStore = useChatStore.getState();
  const provider = svc.getCurrentProvider();

  if (!provider) { svc.resetState(); throw new Error('No remote provider available'); }
  let firstTokenReceived = false;
  svc.remoteTimeToFirstToken = undefined;

  svc.currentRemoteAbortController = new AbortController();
  // Capture signal per-generation so callbacks stay guarded even after
  // abortRequested is reset by the next generation's prepareGeneration().
  const { signal: generationSignal } = svc.currentRemoteAbortController;

  const { temperature, maxTokens, topP, thinkingEnabled } = useAppStore.getState().settings;
  const options: GenerationOptions = {
    temperature, maxTokens, topP,
    stopSequences: [],
    enableThinking: thinkingEnabled && provider.capabilities.supportsThinking,
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
          svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
        }
      },
      onReasoning: (content: string) => {
        if (generationSignal.aborted) return;
        svc.reasoningBuffer += content;
        svc.totalReasoningLength += content.length;
        if (!svc.flushTimer) {
          svc.flushTimer = setTimeout(() => svc.flushTokenBuffer(), FLUSH_INTERVAL_MS);
        }
      },
      onComplete: (_result: CompletionResult) => {
        if (generationSignal.aborted) return;
        svc.forceFlushTokens();
        const generationTime = svc.state.startTime ? Date.now() - svc.state.startTime : undefined;
        chatStore.finalizeStreamingMessage(conversationId, generationTime, buildGenerationMetaImpl(svc));
        svc.checkSharePrompt();
        svc.resetState();
      },
      onError: (error: Error) => {
        if (generationSignal.aborted) return;
        logger.error('[GenerationService] Remote generation error:', error);
        if (svc.flushTimer) { clearTimeout(svc.flushTimer); svc.flushTimer = null; }
        svc.tokenBuffer = '';
        chatStore.clearStreamingMessage();
        svc.resetState();
        throw error;
      },
    });
  } catch (error) {
    if (generationSignal.aborted) return;
    logger.error('[GenerationService] Remote generation error:', error);
    // Mark server as offline so the Remote Servers screen reflects the failure
    const failedServerId = useRemoteServerStore.getState().activeServerId;
    if (failedServerId) useRemoteServerStore.getState().updateServerHealth(failedServerId, false);
    if (svc.flushTimer) { clearTimeout(svc.flushTimer); svc.flushTimer = null; }
    svc.tokenBuffer = '';
    chatStore.clearStreamingMessage();
    svc.resetState();
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
  logger.log(`[GenService][DEBUG] generateRemoteWithToolsImpl — conv=${conversationId}, messages=${messages.length}, enabledToolIds=[${options.enabledToolIds.join(', ')}]`);
  if (!(await prepareGenerationImpl(svc, conversationId))) {
    logger.log(`[GenService][DEBUG] prepareGeneration returned false, aborting`);
    return;
  }
  const provider = svc.getCurrentProvider();

  if (!provider) { svc.resetState(); throw new Error('No remote provider available'); }
  logger.log(`[GenService][DEBUG] Provider ready — type=${provider.type}, capabilities=${JSON.stringify(provider.capabilities)}`);

  const { enabledToolIds, projectId, ...callbacks } = options;

  // Use the same tool loop but with remote provider
  await runToolLoop({
    conversationId, messages, enabledToolIds, projectId, callbacks,
    ...buildToolLoopHandlersImpl(svc),
    forceRemote: true,
  });

  if (svc.abortRequested) {
    logger.log(`[GenService][DEBUG] Generation was aborted, skipping finalize`);
  } else {
    svc.forceFlushTokens();
    const generationTime = svc.state.startTime ? Date.now() - svc.state.startTime : undefined;
    logger.log(`[GenService][DEBUG] Finalizing — streamingContent length=${svc.state.streamingContent?.length || 0}, generationTime=${generationTime}ms`);
    useChatStore.getState().finalizeStreamingMessage(
      conversationId, generationTime, buildGenerationMetaImpl(svc),
    );
    svc.checkSharePrompt();
    svc.resetState();
  }
}
