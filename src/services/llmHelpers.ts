import { LlamaContext } from 'llama.rn';
import {
  cumulativeTextDelta,
  chatTemplateSupportsReasoning,
  isCompletionTruncated,
  llamaRnCompletionPayload,
  llamaRnReasoningMetadata,
  backendForcesF16Cache as sharedBackendForcesF16Cache,
  effectiveTextCacheType,
  llamaRnModelLoadPlan,
  gpuFallbackNotice,
  nativeBackendForLoad,
  type ModelReasoningMetadata,
} from '@offgrid/models';
import { nativeTextLoad } from './composition/text-load';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { APP_CONFIG } from '../constants';
import { Message } from '../types';
import { MultimodalSupport, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { ensureNativeLogCapture, resetNativeLogCapture } from './llmNativeLog';

import { HTP_ENABLED } from '../config/featureFlags';

/** Prompt compaction target. Output length is the user's model-aware maxTokens setting. */
const DEFAULT_THREADS = 4; // targets performance cores only; over-threading onto efficiency cores (A520) hurts
const DEFAULT_BATCH = 512;
const DEFAULT_GPU_LAYERS = Platform.OS === 'ios' ? 99 : 0;
function getOptimalThreadCount(): number { return DEFAULT_THREADS; }
function getOptimalBatchSize(): number { return DEFAULT_BATCH; }
const REPACKABLE_QUANTS = ['q4_0', 'iq4_nl'];
/** Detect repackable quant formats where disabling mmap improves inference speed. */
export function shouldDisableMmap(modelPath: string): boolean {
  if (Platform.OS !== 'android') return false;
  return REPACKABLE_QUANTS.some(q => modelPath.toLowerCase().includes(q));
}
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.codePointAt(i) ?? 0;
    // eslint-disable-next-line no-bitwise
    hash = ((hash << 5) - hash) + char;
    // eslint-disable-next-line no-bitwise
    hash = hash & hash;
  }
  return hash.toString(16);
}
export async function ensureSessionCacheDir(cacheDir: string): Promise<void> {
  try {
    if (!await RNFS.exists(cacheDir)) await RNFS.mkdir(cacheDir);
  } catch (e) {
    logger.log('[LLM] Failed to create session cache dir:', e);
  }
}
export function getSessionPath(cacheDir: string, promptHash: string): string {
  return `${cacheDir}/session-${promptHash}.bin`;
}
export interface ModelLoadParams {
  baseParams: object;
  nThreads: number;
  nBatch: number;
  ctxLen: number;
  nGpuLayers: number;
  /** Whether the EFFECTIVE KV cache is f16 (OpenCL/HTP coerce to it regardless of the
   *  user setting). The single source for the memory guard's KV-size estimate — read
   *  this instead of re-deriving from settings.cacheType, which misses the coercion. */
  usesF16Cache: boolean;
}

/**
 * Backends whose native loader coerces the KV cache to f16 regardless of the user's
 * chosen cacheType: OpenCL and HTP (their llama.cpp paths don't support a quantized KV
 * cache). SINGLE source of truth — the loader, the settings display, the "settings
 * changed" diff, and the generation-details recorder must all agree via this, so the UI
 * never shows one cache type while the model ran another.
 */
export function backendForcesF16Cache(backend: string | undefined): boolean {
  return sharedBackendForcesF16Cache(backend);
}

/** The KV cache type that will ACTUALLY be used, after backend coercion to f16. */
export function effectiveCacheType(backend: string | undefined, requested: string | undefined): string {
  return effectiveTextCacheType(backend, requested);
}

export function buildModelParams(
  modelPath: string,
  settings: { nThreads?: number; nBatch?: number; contextLength?: number; flashAttn?: boolean; enableGpu?: boolean; gpuLayers?: number; cacheType?: string; inferenceBackend?: string; speculativeDecoding?: boolean },
): ModelLoadParams {
  return llamaRnModelLoadPlan({
    modelPath,
    settings,
    defaultThreads: getOptimalThreadCount(),
    defaultBatch: getOptimalBatchSize(),
    defaultContextLength: APP_CONFIG.maxContextLength,
    defaultGpuLayers: DEFAULT_GPU_LAYERS,
    disableMmap: shouldDisableMmap(modelPath),
  });
}
export interface ContextInitResult {
  context: LlamaContext;
  gpuAttemptFailed: boolean;
  actualLength: number;
}
/** Native llama.rn port. Shared owns timeout and fallback policy/workflow. */
export async function initContextWithFallback(
  params: object,
  contextLength: number,
  nGpuLayers: number,
): Promise<ContextInitResult> {
  const modelPath = (params as any).model || 'unknown';
  const backend = nativeBackendForLoad({
    htpEnabled: HTP_ENABLED,
    devices: Array.isArray((params as any).devices) ? (params as any).devices : undefined,
    gpuLayers: nGpuLayers,
  });
  // Capture llama.cpp's own log so a load failure surfaces its REAL reason
  // (missing tensor / unknown architecture / wrong size) instead of rnllama's
  // opaque "Failed to load model". Reset the buffer for this attempt.
  ensureNativeLogCapture();
  resetNativeLogCapture();
  logger.log(`[LLM] initContextWithFallback: model=${modelPath}, ctx=${contextLength}, gpuLayers=${nGpuLayers}, backend=${backend.toUpperCase()}`);
  logger.log(`[WIRE-LLAMA-LOAD] ${JSON.stringify({ modelPath, contextLength, nGpuLayers, backend, params: { ...(params as Record<string, unknown>), model: undefined } })}`);
  const service = nativeTextLoad();
  return service.load({
    platform: Platform.OS === 'android' ? 'android' : 'ios',
    backend,
    params: params as Record<string, unknown>,
    contextLength,
    gpuLayers: nGpuLayers,
  });
}
export interface GpuInfo {
  gpuEnabled: boolean;
  gpuReason: string;
  gpuDevices: string[];
  activeGpuLayers: number;
  gpuAttemptFailed: boolean;
}

export function captureGpuInfo(
  context: LlamaContext,
  gpuAttemptFailed: boolean,
  nGpuLayers: number,
): GpuInfo {
  const nativeGpuAvailable = context.gpu ?? false;
  const gpuReason = (context as any).reasonNoGPU ?? '';
  const gpuDevices = (context as any).devices ?? [];
  const activeGpuLayers = gpuAttemptFailed ? 0 : nGpuLayers;
  const gpuEnabled = nativeGpuAvailable && activeGpuLayers > 0;
  return { gpuEnabled, gpuReason, gpuDevices, activeGpuLayers, gpuAttemptFailed };
}

/**
 * UI notice for a GPU-selected load that landed on CPU (requested GPU layers, got 0 — init
 * failure/timeout, or a device/RAM refusal). Null when nothing to report. Never a silent CPU
 * downgrade (device 2026-07-13 18:57: "Backend=GPU but ran on CPU at 3.4 tok/s").
 */
export function describeGpuFallback(info: { requestedGpuLayers: number; activeGpuLayers: number; gpuAttemptFailed: boolean }): string | null {
  return gpuFallbackNotice(info);
}
export function supportsNativeThinking(context: LlamaContext | null): boolean {
  if (!context) return false;
  try {
    // Thinking capability comes SOLELY from the model's own chat_template emitting reasoning
    // delimiters (<think>, Gemma/Qwen channels) or exposing the enable_thinking kwarg — the same
    // single-source predicate remote capability probing uses (templateEmitsReasoning). It is NEVER
    // derived from whether Jinja renders: a model with a perfectly valid Jinja template but no
    // reasoning markers (e.g. Mistral 7B, which has a tool-use template) does NOT think, yet the old
    // `isJinjaSupported() → true` short-circuit falsely surfaced the Thinking toggle for it. Covers
    // both jinja-supported and OD7 jinja-unsupported reasoning models: both carry the template here.
    const metadata = (context as any)?.model?.metadata;
    const template = metadata?.['tokenizer.chat_template'] ?? metadata?.chat_template;
    return chatTemplateSupportsReasoning(typeof template === 'string' ? template : undefined);
  } catch {
    return false;
  }
}

/** Publish only reasoning controls proven by the loaded GGUF chat template. */
export function llamaReasoningMetadata(
  context: LlamaContext | null,
): ModelReasoningMetadata | undefined {
  if (!context) return undefined;
  const metadata = (context as any)?.model?.metadata;
  const template = metadata?.['tokenizer.chat_template'] ?? metadata?.chat_template;
  if (typeof template !== 'string') return undefined;
  return llamaRnReasoningMetadata(template);
}
export function getStreamingDelta(nextValue: string | undefined, previousValue: string): string | undefined {
  return cumulativeTextDelta(nextValue, previousValue);
}

/** Reads the model's trained context length from metadata, or null if unavailable. */
export function getModelMaxContext(context: LlamaContext): number | null {
  try {
    const metadata = (context as any).model?.metadata;
    if (!metadata) return null;
    // GGUF stores the trained context under an ARCHITECTURE-prefixed key (gemma4.context_length,
    // qwen3.context_length, …). Reading only the llama key returned null for gemma/qwen → 32K slider cap.
    const arch = metadata['general.architecture'];
    const trainCtx =
      (arch && metadata[`${arch}.context_length`]) ||
      metadata['llama.context_length'] || metadata['general.context_length'] || metadata.context_length;
    if (!trainCtx) return null;
    const maxModelCtx = Number.parseInt(trainCtx, 10);
    return Number.isNaN(maxModelCtx) || maxModelCtx <= 0 ? null : maxModelCtx;
  } catch {
    return null;
  }
}
export function logContextMetadata(context: LlamaContext, contextLength: number): void {
  const maxModelCtx = getModelMaxContext(context);
  if (maxModelCtx == null) return;
  logger.log(`[LLM] Model trained context: ${maxModelCtx}, using: ${contextLength}`);
  if (contextLength > maxModelCtx) logger.warn(`[LLM] Requested context (${contextLength}) exceeds model max (${maxModelCtx})`);
}
export interface MultimodalInitResult {
  initialized: boolean;
  support: MultimodalSupport;
}
export async function initMultimodal(
  context: LlamaContext,
  mmProjPath: string,
  useGpuForClip: boolean,
): Promise<MultimodalInitResult> {
  const noSupport: MultimodalInitResult = { initialized: false, support: { vision: false, audio: false } };
  try {
    const success = await context.initMultimodal({ path: mmProjPath, use_gpu: useGpuForClip });
    if (!success) {
      logger.warn('[LLM] initMultimodal returned false - mmproj may be incompatible with model');
      return noSupport;
    }
    let support: MultimodalSupport = { vision: true, audio: false };
    try {
      const s = await context.getMultimodalSupport();
      support = { vision: s?.vision || true, audio: s?.audio || false };
    } catch {
      // getMultimodalSupport not available, keep defaults
    }
    logger.log('[LLM] Multimodal initialized successfully, vision:', support.vision);
    return { initialized: true, support };
  } catch (error: any) {
    logger.error('[LLM] Multimodal init exception:', error?.message || error);
    return noSupport;
  }
}
export async function checkContextMultimodal(context: LlamaContext): Promise<MultimodalSupport> {
  try {
    // @ts-ignore - llama.rn may have this method
    if (typeof context.getMultimodalSupport === 'function') {
      const s = await context.getMultimodalSupport();
      return { vision: s?.vision || false, audio: s?.audio || false };
    }
  } catch {
    logger.log('Multimodal support check not available');
  }
  return { vision: false, audio: false };
}
export async function estimateTokens(context: LlamaContext, text: string): Promise<number> {
  try {
    return (await context.tokenize(text)).tokens?.length || 0;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
export async function fitMessagesInBudget(
  context: LlamaContext,
  messages: Message[],
  budget: number,
): Promise<Message[]> {
  const result: Message[] = [];
  let remaining = budget;
  for (let i = messages.length - 1; i >= 0 && remaining > 0; i--) {
    const msg = messages[i];
    let tokens: number;
    try {
      tokens = ((await context.tokenize(msg.content)).tokens?.length || 0) + 10;
    } catch {
      tokens = Math.ceil(msg.content.length / 4) + 10;
    }
    if (tokens <= remaining) {
      result.unshift(msg);
      remaining -= tokens;
    } else if (result.length === 0) {
      result.unshift(msg);
      break;
    } else {
      break;
    }
  }
  return result;
}
// Pure GPU hardware rules live in their own module and need no engine.
export { BYTES_PER_GB, getGpuLayersForDevice } from './llmDeviceLimits';
export {  safeCompletion } from './llmSafetyChecks';
export function buildCompletionParams(settings: {
  maxTokens?: number; temperature?: number; topP?: number; repeatPenalty?: number;
}, options?: { disableCtxShift?: boolean }): Record<string, any> {
  return llamaRnCompletionPayload(
    {
      maxTokens: settings.maxTokens,
      temperature: settings.temperature,
      topP: settings.topP,
      repetitionPenalty: settings.repeatPenalty,
    },
    { disableContextShift: options?.disableCtxShift },
  );
}
/**
 * Was a completion cut off at the n_predict cap (B15), vs finishing on EOS or being STOPPED? SINGLE
 * truncation verdict for both the plain and tool-loop paths. A user stop is `interrupted:true`
 * (stopped_eos:false) — NOT truncation; only a stopped_limit/truncated hit is (device 2026-07-14).
 */
export function isTruncatedResult(
  cr: { interrupted?: boolean; stopped_limit?: number | boolean; truncated?: boolean } | null | undefined,
): boolean {
  return isCompletionTruncated(cr);
}
export function recordGenerationStats(
  startTime: number,
  firstTokenMs: number,
  tokenCount: number,
): LLMPerformanceStats {
  const elapsed = (Date.now() - startTime) / 1000;
  const tokensPerSec = elapsed > 0 ? tokenCount / elapsed : 0;
  const ttft = firstTokenMs / 1000;
  const decodeTime = elapsed - ttft;
  const decodeTokensPerSec = decodeTime > 0 && tokenCount > 1 ? (tokenCount - 1) / decodeTime : 0;
  logger.log(`[LLM] Generated ${tokenCount} tokens in ${elapsed.toFixed(1)}s (${tokensPerSec.toFixed(1)} tok/s, TTFT ${ttft.toFixed(2)}s)`);
  return {
    lastTokensPerSecond: tokensPerSec,
    lastDecodeTokensPerSecond: decodeTokensPerSec,
    lastTimeToFirstToken: ttft,
    lastGenerationTime: elapsed,
    lastTokenCount: tokenCount,
  };
}
