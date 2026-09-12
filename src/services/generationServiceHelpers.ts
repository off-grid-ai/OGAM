// GenerationService helpers (extracted to keep generationService.ts small). Each receives
// the GenerationService instance as `svc: any` and mutates its internal state.
import { llmService } from './llm';
import { liteRTService } from './litert';
import { getActiveEngineService, prepareActiveConversation } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import type { Message, GenerationMeta } from '../types';
import { buildLiteRTHistory } from './generationToolLoop';
import { effectiveCacheType } from './llmHelpers';
import { modelInputImageUris, modelInputAudioUris } from './modelMedia';
import { clearModelFailure } from './modelFailureHandler';
import type { ToolResult } from './tools/types';
import logger from '../utils/logger';

export const FLUSH_INTERVAL_MS = 50; // ~20 updates/sec

/**
 * Keep whatever the user has ALREADY seen when a generation errors mid-stream — never discard shown output
 * (device 2026-07-14, the Stop-drops-partial principle extended to the error path, for llama/litert/remote
 * alike). Flush any buffered tokens to the store, then finalizeStreamingMessage: it persists content OR
 * reasoning and resets the streaming state either way (a strict superset of clearStreamingMessage; an empty
 * stream just resets, adding no message). Mirrors GenerationService.keepShownPartialOrClear on the stop path.
 */
export function keepShownPartialOnError(svc: any, conversationId: string): void {
  if (svc.flushTimer) {
    clearTimeout(svc.flushTimer);
    svc.flushTimer = null;
  }
  svc.forceFlushTokens();
  const generationTime = svc.state.startTime
    ? Date.now() - svc.state.startTime
    : undefined;
  useChatStore
    .getState()
    .finalizeStreamingMessage(
      conversationId,
      generationTime,
      buildGenerationMetaImpl(svc),
    );
  svc.resetState();
}
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

function buildLiteRTMeta(
  svc: any,
  modelName: string | undefined,
): GenerationMeta {
  const backend = liteRTService.getActiveBackend() ?? 'cpu';
  const stats =
    svc.liteRTBenchmarkStats ?? liteRTService.getLastBenchmarkStats();
  if (stats) {
    return {
      gpu: backend !== 'cpu',
      gpuBackend: backend.toUpperCase(),
      modelName,
      decodeTokensPerSecond: stats.decodeTokensPerSecond,
      prefillTokensPerSecond: stats.prefillTokensPerSecond,
      timeToFirstToken: stats.ttft,
      tokenCount: stats.prefillTokenCount,
      modelLoadTimeSeconds:
        stats.initTimeSeconds > 0 ? stats.initTimeSeconds : undefined,
    };
  }
  const contentLength = svc.state.streamingContent?.length ?? 0;
  const estimatedTokenCount = Math.ceil(contentLength / 4);
  const genTime = svc.state.startTime
    ? (Date.now() - svc.state.startTime) / 1000
    : 0;
  return {
    gpu: backend !== 'cpu',
    gpuBackend: backend.toUpperCase(),
    modelName,
    tokenCount: estimatedTokenCount,
    tokensPerSecond:
      genTime > 0 && estimatedTokenCount > 0
        ? estimatedTokenCount / genTime
        : undefined,
  };
}

export function buildGenerationMetaImpl(svc: any): GenerationMeta {
  const meta = buildBaseGenerationMeta(svc);
  if (svc.answeringModelName) meta.modelName = svc.answeringModelName;
  const routed = svc.state?.routedToolNames;
  if (Array.isArray(routed) && routed.length > 0) meta.routedToolNames = routed;
  return meta;
}
function buildBaseGenerationMeta(svc: any): GenerationMeta {
  if (svc.isUsingRemoteProvider() && !svc.answeringLocally) {
    const remoteStore = useRemoteServerStore.getState();
    const activeServer = remoteStore.getActiveServer();
    const contentLength =
      svc.state.streamingContent.length + svc.totalReasoningLength;
    const estimatedTokens = Math.ceil(contentLength / 4);
    const generationTime = svc.state.startTime
      ? (Date.now() - svc.state.startTime) / 1000
      : 0;
    const tokensPerSecond =
      generationTime > 0 ? estimatedTokens / generationTime : undefined;
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
  const modelName = downloadedModels.find(
    (m: any) => m.id === activeModelId,
  )?.name;

  if (isLiteRTActive()) {
    return buildLiteRTMeta(svc, modelName);
  }

  const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
  const perf = llmService.getPerformanceStats();
  return {
    gpu,
    gpuBackend,
    gpuLayers,
    modelName,
    tokensPerSecond: perf.lastTokensPerSecond,
    decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
    timeToFirstToken: perf.lastTimeToFirstToken,
    tokenCount: perf.lastTokenCount,
    cacheType: effectiveCacheType(
      settings.inferenceBackend,
      settings.cacheType,
    ),
    truncated: perf.lastTruncated,
  };
}

function handleStreamChunk(
  svc: any,
  chunk: { content?: string; reasoningContent?: string },
): void {
  if (chunk.content) {
    if (
      !svc.state.streamingContent &&
      svc.remoteTimeToFirstToken === undefined
    ) {
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
        svc.flushTimer = setTimeout(
          () => svc.flushTokenBuffer(),
          FLUSH_INTERVAL_MS,
        );
      }
    },
    onStreamReset: () => {
      svc.forceFlushTokens();
      svc.state.streamingContent = '';
      svc.tokenBuffer = '';
      svc.reasoningBuffer = '';
      useChatStore.getState().resetStreamingSegment();
    },
    onFinalResponse: (content: string) => {
      svc.state.streamingContent = content;
      useChatStore.getState().appendToStreamingMessage(content);
    },
    onToolsRouted: (names: string[]) => {
      svc.state.routedToolNames = names;
    },
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
    // A still-unwinding completion (a stop can only take effect once prefill finishes) is NOT an
    // error — wait for the engine to go idle instead of failing the user's send. Only a genuinely
    // stuck/concurrent generation (still busy after the bounded wait) surfaces the busy error.
    if (llmService.isCurrentlyGenerating() && !(await llmService.waitForIdle()))
      return 'LLM service busy';
  }
  return null;
}

export async function prepareGenerationImpl(
  svc: any,
  conversationId: string,
): Promise<boolean> {
  if (svc.state.isGenerating) return false;
  const attempt = ++svc.generationAttempt;
  const stillOwnsAttempt = (): boolean =>
    svc.generationAttempt === attempt &&
    svc.state.isGenerating &&
    !svc.abortRequested;
  // A NEW attempt owns the text failure surface: clear any card left by a previous failed/stopped
  // attempt at the ONE dispatch seam every path (send/retry/regenerate, local/remote, with/without
  // tools) funnels through — a stale card must never sit next to a live stream (device IMG 00:23).
  clearModelFailure('text');
  svc.updateState({
    isGenerating: true,
    isThinking: true,
    conversationId,
    streamingContent: '',
    startTime: Date.now(),
  });
  svc.state.routedToolNames = undefined; // reset so a prior turn's tools don't leak
  useChatStore.getState().startStreaming(conversationId);
  try {
    // Drain pending native stop so LLM is idle before we start.
    if (svc.pendingStop !== null) await svc.pendingStop;
    if (svc.generationAttempt !== attempt || !svc.state.isGenerating) return false;
    svc.abortRequested = false;

    const readinessError = await checkProviderReadiness(svc);
    if (readinessError) throw new Error(readinessError);
    if (!stillOwnsAttempt()) return false;

    // Navigation effects are not a generation barrier: on a new chat, Send can win
    // that race. Clear/switch native conversation state here, after readiness and
    // before any prompt or tool-routing completion reaches the local engine.
    if (!svc.isUsingRemoteProvider()) {
      await prepareActiveConversation(conversationId);
      if (!stillOwnsAttempt()) return false;
    }
  } catch (error) {
    if (svc.generationAttempt !== attempt) return false;
    svc.resetState();
    useChatStore.getState().clearStreamingMessage();
    throw error;
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
  const liteRTActiveModel =
    activeModel?.engine === 'litert' ? activeModel : null;
  if (!liteRTActiveModel?.liteRTVision) {
    chatStore.clearStreamingMessage();
    svc.resetState();
    throw new Error(
      'This model does not support images. Import it with vision enabled, or remove the image.',
    );
  }
}

// assertLiteRTAudioSupport removed: audio is transcript-only (modelInputAudioUris always []), so it
// only ever wrongly hard-rejected a non-audio LiteRT model carrying a voice note. Re-gate at modelMedia.

async function runLiteRTResponseImpl(
  svc: any,
  req: GenerationRequest,
): Promise<void> {
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
  const systemPrompt =
    typeof systemMsg?.content === 'string' ? systemMsg.content : '';
  const allAttachments = lastUser.attachments ?? [];
  // Single source of truth (modelMedia): images may be model input; a voice note is transcript-only
  // (audioUris ALWAYS empty — transcript is already in lastUser.content), matching the llama/OAI path.
  const imageUris = modelInputImageUris(allAttachments);
  const audioUris = modelInputAudioUris(allAttachments);

  assertLiteRTImageSupport(imageUris, svc, chatStore);

  const history = buildLiteRTHistory(messages);

  try {
    const { settings } = useAppStore.getState();
    await liteRTService.prepareConversation(conversationId, systemPrompt, {
      samplerConfig: {
        temperature: settings.liteRTTemperature,
        topP: settings.liteRTTopP,
      },
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
            svc.flushTimer = setTimeout(
              () => svc.flushTokenBuffer(),
              FLUSH_INTERVAL_MS,
            );
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
            svc.flushTimer = setTimeout(
              () => svc.flushTokenBuffer(),
              FLUSH_INTERVAL_MS,
            );
          }
        },
        onComplete: (_content: string, _reasoning: string, stats) => {
          if (svc.abortRequested) return;
          svc.forceFlushTokens();
          svc.liteRTBenchmarkStats = stats
            ? { ...stats, ttft: jsTtftSeconds ?? stats.ttft }
            : stats;
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
        onError: (err: Error) => {
          if (svc.abortRequested) return;
          logger.error('[LiteRT] sendMessage error:', err.message);
          keepShownPartialOnError(svc, conversationId); // keep the partial the user already saw
        },
      },
      { imageUris, audioUris },
    );
  } catch (error: any) {
    if (svc.abortRequested) return;
    keepShownPartialOnError(svc, conversationId);
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
    await llmService.generateResponse(messages, {
      onStream: data => {
        if (svc.abortRequested) return;
        const chunk =
          typeof data === 'string'
            ? { content: data, reasoningContent: undefined }
            : data;
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
          svc.flushTimer = setTimeout(
            () => svc.flushTokenBuffer(),
            FLUSH_INTERVAL_MS,
          );
        }
      },
      onComplete: () => {
        // If aborted, stopGeneration() already handled cleanup — don't clobber new generation state.
        if (svc.abortRequested) return;
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
    });
  } catch (error) {
    if (svc.abortRequested) return;
    logger.error('[GenerationService] Generation error:', error);
    keepShownPartialOnError(svc, conversationId);
    throw error;
  }
}
