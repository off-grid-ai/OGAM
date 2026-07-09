import { initLlama, LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { APP_CONFIG } from '../constants';
import { Message, INFERENCE_BACKENDS } from '../types';
import { MultimodalSupport, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { ensureNativeLogCapture, resetNativeLogCapture, recentNativeLog } from './llmNativeLog';

import { HTP_ENABLED } from '../config/featureFlags';

export const RESPONSE_RESERVE = 512;
const DEFAULT_THREADS = 4; // targets performance cores only; over-threading onto efficiency cores (A520) hurts
const DEFAULT_BATCH = 512;
export const DEFAULT_GPU_LAYERS = Platform.OS === 'ios' ? 99 : 0;
export function getOptimalThreadCount(): number { return DEFAULT_THREADS; }
export function getOptimalBatchSize(): number { return DEFAULT_BATCH; }
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
  return backend === INFERENCE_BACKENDS.OPENCL || (HTP_ENABLED && backend === INFERENCE_BACKENDS.HTP);
}

/** The KV cache type that will ACTUALLY be used, after backend coercion to f16. */
export function effectiveCacheType(backend: string | undefined, requested: string | undefined): string {
  return backendForcesF16Cache(backend) ? 'f16' : (requested || 'q8_0');
}

export function buildModelParams(
  modelPath: string,
  settings: { nThreads?: number; nBatch?: number; contextLength?: number; flashAttn?: boolean; enableGpu?: boolean; gpuLayers?: number; cacheType?: string; inferenceBackend?: string },
): ModelLoadParams {
  const nThreads = settings.nThreads || getOptimalThreadCount();
  const nBatch = settings.nBatch || getOptimalBatchSize();
  const ctxLen = settings.contextLength || APP_CONFIG.maxContextLength;
  // inferenceBackend takes precedence; fall back to legacy enableGpu flag
  const backend = settings.inferenceBackend;
  // Use flash_attn_type string API (replaces deprecated flash_attn boolean).
  // OpenCL and HTP backends crash with flash attn on — disable for those.
  // CPU (Android/iOS) and Metal both support it; use 'auto' to let llama.cpp decide.
  const gpuBackendIncompatible = backendForcesF16Cache(backend);
  const flash_attn_type = (settings.flashAttn === false || gpuBackendIncompatible) ? 'off' : 'auto';
  const gpuEnabled = backend ? backend !== INFERENCE_BACKENDS.CPU : settings.enableGpu !== false;
  const nGpuLayers = gpuEnabled ? (settings.gpuLayers ?? DEFAULT_GPU_LAYERS) : 0;
  const isFlashAttnEffective = flash_attn_type !== 'off';
  const requestedCache = settings.cacheType || (isFlashAttnEffective ? 'q8_0' : 'f16');
  // OpenCL init on affected Adreno devices can fail when cache_type_k/v are passed.
  // effectiveCacheType coerces OpenCL/HTP to f16 (single source shared with the UI).
  const cacheType = effectiveCacheType(backend, requestedCache);
  return {
    baseParams: {
      model: modelPath, use_mlock: false, n_batch: nBatch, n_ubatch: nBatch, n_threads: nThreads,
      use_mmap: !shouldDisableMmap(modelPath), vocab_only: false, flash_attn_type,
      // Do NOT force kv_unified — let llama.cpp pick it per architecture. Forcing
      // `true` (a marginal single-seq perf tweak) hung gemma3n (gemma-4 E2B/E4B):
      // its interleaved sliding-window + heterogeneous KV layers froze building the
      // unified KV-cache reuse map ("kv_cache: reusing layers"). The engine's
      // per-arch default (false) handles SWA models correctly and keeps GPU/Metal.
      no_extra_bufts: false,
      ...(backend === INFERENCE_BACKENDS.OPENCL ? {} : { cache_type_k: cacheType, cache_type_v: cacheType }),
    },
    nThreads, nBatch, ctxLen, nGpuLayers,
    // cacheType is already coerced to 'f16' above for OpenCL/HTP; OpenCL also omits the
    // explicit cache params and llama.cpp defaults to f16 — both are captured here.
    usesF16Cache: cacheType === 'f16',
  };
}
export interface ContextInitResult {
  context: LlamaContext;
  gpuAttemptFailed: boolean;
  actualLength: number;
}
/** Timeout for Adreno GPU context init on Android -- bail before OS triggers ANR. */
const GPU_INIT_TIMEOUT_MS = 8000;
/** Timeout for HTP/NPU context init -- DSP firmware load takes longer than Adreno. */
const HTP_INIT_TIMEOUT_MS = 30000;
/** iOS Metal init timeout. Larger than Android's because a legit large-model
 *  Metal setup takes longer — but bounded, so a Metal graph that HANGS (e.g.
 *  gemma3n froze indefinitely at kv-cache/graph construction) falls back to CPU
 *  instead of spinning the loader forever. */
const GPU_INIT_TIMEOUT_MS_IOS = 45000;
/** Race a promise against a timeout; rejects with descriptive error on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
/** Safely release a context, swallowing errors (used during fallback cleanup). */
async function safeRelease(ctx: LlamaContext | null): Promise<void> {
  if (!ctx) return;
  try { await ctx.release(); } catch (e) { logger.warn('[LLM] Error releasing context during fallback:', e); }
}
/** The bounded time a GPU/HTP context init may take before we fall back to CPU.
 *  Platform/backend only changes the DURATION (data) — the timeout policy itself
 *  is uniform. */
function gpuInitTimeoutMs(isHtp: boolean): number {
  if (isHtp) return HTP_INIT_TIMEOUT_MS;            // Android HTP/NPU
  return Platform.OS === 'ios' ? GPU_INIT_TIMEOUT_MS_IOS : GPU_INIT_TIMEOUT_MS;
}
/**
 * Race a GPU/HTP context init against a timeout so a HUNG backend (an iOS Metal
 * graph that never returns, an Android Adreno ANR) falls back to CPU instead of
 * spinning the loader forever. This applies on EVERY platform — the only
 * platform/backend difference is the timeout duration (see gpuInitTimeoutMs).
 * Previously it was gated to Android, which is exactly why a hung iOS Metal load
 * (e.g. gemma3n freezing at kv-cache/graph construction) had no escape hatch.
 */
async function tryGpuInit(promise: Promise<LlamaContext>, nGpuLayers: number, isHtp: boolean = false): Promise<LlamaContext> {
  if (nGpuLayers <= 0) return promise; // pure-CPU init — nothing to time out
  const timeoutMs = gpuInitTimeoutMs(isHtp);
  let timedOut = false;
  promise.then(ctx => { if (timedOut) safeRelease(ctx); }).catch(() => {});
  try { return await withTimeout(promise, timeoutMs, isHtp ? 'HTP context init' : 'GPU context init'); }
  catch (e) { timedOut = true; throw e; }
}

/** Init llama with GPU/HTP, fall back to CPU, then retry with ctx=2048 on failure. */
export async function initContextWithFallback(
  params: object,
  contextLength: number,
  nGpuLayers: number,
): Promise<ContextInitResult> {
  const modelPath = (params as any).model || 'unknown';
  const isHtp = HTP_ENABLED && Array.isArray((params as any).devices) && (params as any).devices.some((d: string) => d.startsWith('HTP'));
  // Capture llama.cpp's own log so a load failure surfaces its REAL reason
  // (missing tensor / unknown architecture / wrong size) instead of rnllama's
  // opaque "Failed to load model". Reset the buffer for this attempt.
  ensureNativeLogCapture();
  resetNativeLogCapture();
  logger.log(`[LLM] initContextWithFallback: model=${modelPath}, ctx=${contextLength}, gpuLayers=${nGpuLayers}${isHtp ? ', backend=HTP' : ''}`);
  let gpuAttemptFailed = false;
  try {
    logger.log(`[LLM] Attempt 1/3: ${isHtp ? 'HTP' : 'GPU'} init (ctx=${contextLength}, gpu_layers=${nGpuLayers})`);
    const gpuInitPromise = initLlama({ ...params, n_ctx: contextLength, n_gpu_layers: nGpuLayers } as any);
    const context = await tryGpuInit(gpuInitPromise, nGpuLayers, isHtp);
    logger.log('[LLM] GPU init succeeded');
    return { context, gpuAttemptFailed, actualLength: contextLength };
  } catch (gpuError: any) {
    const gpuMsg = gpuError?.message || String(gpuError);
    if (nGpuLayers > 0) {
      logger.warn(`[LLM] Attempt 1/3 failed (GPU): ${gpuMsg}`);
      gpuAttemptFailed = true;
    } else {
      logger.warn(`[LLM] Attempt 1/3 failed (no GPU requested): ${gpuMsg}`);
    }
    try {
      logger.log(`[LLM] Attempt 2/3: CPU init (ctx=${contextLength}, gpu_layers=0)`);
      // Strip devices — HTP requires n_gpu_layers > 0; CPU fallback must not request it
      const cpuParams = { ...(params as Record<string, unknown>) };
      delete cpuParams.devices;
      const context = await initLlama({ ...cpuParams, n_ctx: contextLength, n_gpu_layers: 0 } as any);
      logger.log('[LLM] CPU init succeeded');
      return { context, gpuAttemptFailed, actualLength: contextLength };
    } catch (cpuError: any) {
      const cpuMsg = cpuError?.message || String(cpuError);
      logger.warn(`[LLM] Attempt 2/3 failed (CPU, ctx=${contextLength}): ${cpuMsg}`);
      try {
        logger.log('[LLM] Attempt 3/3: CPU init (ctx=2048, gpu_layers=0)');
        const cpuMinParams = { ...(params as Record<string, unknown>) };
        delete cpuMinParams.devices;
        const context = await initLlama({ ...cpuMinParams, n_ctx: 2048, n_gpu_layers: 0 } as any);
        logger.log('[LLM] CPU init with ctx=2048 succeeded');
        return { context, gpuAttemptFailed, actualLength: 2048 };
      } catch (finalError: any) {
        const finalMsg = finalError?.message || String(finalError);
        logger.error(`[LLM] Attempt 3/3 failed (CPU, ctx=2048): ${finalMsg}`);
        logger.error(`[LLM] All 3 init attempts failed for model: ${modelPath}`);
        logger.error(`[LLM] Error chain — GPU: "${gpuMsg}" | CPU: "${cpuMsg}" | min-ctx: "${finalMsg}"`);
        const errorParts = [
          gpuMsg && gpuMsg !== finalMsg ? `GPU: ${gpuMsg}` : null,
          cpuMsg && cpuMsg !== finalMsg ? `CPU: ${cpuMsg}` : null,
          `min-ctx: ${finalMsg}`,
        ].filter(Boolean).join(' | ');
        // Surface llama.cpp's actual reason (rnllama only gives "Failed to load
        // model"); the native log says e.g. "missing tensor" / "unknown arch".
        const nativeReason = recentNativeLog();
        logger.error(`[LLM] llama.cpp native log tail:\n${nativeReason}`);
        const nativeSuffix = nativeReason ? `\n\nllama.cpp: ${nativeReason}` : '';
        throw new Error(`Failed to load model even at minimum context (2048). This may indicate insufficient memory, a corrupted model file, or an unsupported model format.\n\nError chain: ${errorParts}${nativeSuffix}`);
      }
    }
  }
}
export interface GpuInfo {
  gpuEnabled: boolean;
  gpuReason: string;
  gpuDevices: string[];
  activeGpuLayers: number;
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
  return { gpuEnabled, gpuReason, gpuDevices, activeGpuLayers };
}
export function supportsNativeThinking(context: LlamaContext | null): boolean {
  if (!context) return false;
  try {
    if (typeof context.isJinjaSupported === 'function') {
      return context.isJinjaSupported();
    }
    const jinja = (context as any)?.model?.chatTemplates?.jinja;
    return !!(jinja?.default || jinja?.toolUse);
  } catch {
    return false;
  }
}
export function buildThinkingCompletionParams(enableThinking: boolean, isGemma4: boolean = false): { enable_thinking: boolean; reasoning_format: 'none' | 'deepseek' } {
  // Gemma 4 uses its own <|channel>thought\n...<channel|> format — not DeepSeek's <think> tags.
  // Set reasoning_format:'none' so llama.rn doesn't try to strip DeepSeek tags; we parse it ourselves.
  return { enable_thinking: enableThinking, reasoning_format: (enableThinking && !isGemma4) ? 'deepseek' : 'none' };
}
export function getStreamingDelta(nextValue: string | undefined, previousValue: string): string | undefined {
  if (!nextValue) return undefined;
  if (!previousValue) return nextValue;
  return nextValue.startsWith(previousValue) ? nextValue.slice(previousValue.length) || undefined : nextValue;
}

/** Reads the model's trained context length from metadata, or null if unavailable. */
export function getModelMaxContext(context: LlamaContext): number | null {
  try {
    const metadata = (context as any).model?.metadata;
    if (!metadata) return null;
    const trainCtx = metadata['llama.context_length'] || metadata['general.context_length'] || metadata.context_length;
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
/** Max safe context length based on device RAM to prevent OOM on low-RAM devices. */
export const BYTES_PER_GB = 1024 * 1024 * 1024;
export function getMaxContextForDevice(totalMemoryBytes: number): number {
  const gb = totalMemoryBytes / BYTES_PER_GB;
  if (gb <= 6) return 2048;
  if (gb <= 8) return 4096;
  return 8192;
}
// Android Adreno GPU caps (≤4GB/≤6GB→0, ≤8GB→12, >8GB→24).
const ANDROID_GPU_LAYER_CAPS: { maxGB: number; layers: number }[] = [{ maxGB: 4, layers: 0 }, { maxGB: 6, layers: 0 }, { maxGB: 8, layers: 12 }];
const ANDROID_GPU_LAYERS_FALLBACK = 24;

/**
 * iOS Metal uses UNIFIED memory: offloaded weights + the compute-graph
 * (sched_reserve) buffer + KV all draw from system RAM. Full offload (99 layers)
 * of a non-trivial model on a memory-tight device overflows the Metal allocation
 * → null buffer → SIGSEGV in lm_ggml_backend_metal_buffer_type_*alloc_buffer (the
 * #1 crash). Cap the offloaded layers so the weights fit free RAM minus a reserve
 * for the compute graph + KV + the app/OS. RESERVE is the tuning knob: raise it if
 * crashes persist on a device, lower it to claw back GPU speed.
 */
const IOS_METAL_RESERVE_BYTES = 1.6 * BYTES_PER_GB;

/** Safe GPU layer count for the device + model. Skips GPU on ≤4 GB to prevent abort();
 *  caps iOS Metal offload to what fits free RAM so the buffer alloc can't overflow. */
export function getGpuLayersForDevice(
  totalMemoryBytes: number,
  requestedLayers: number,
  opts?: { modelBytes?: number; availableBytes?: number },
): number {
  const totalGB = totalMemoryBytes / BYTES_PER_GB;
  if (totalGB <= 4) return 0;

  // Android / Adreno-specific caps to prevent GPU ANRs
  if (Platform.OS === 'android') {
    const tier = ANDROID_GPU_LAYER_CAPS.find(t => totalGB <= t.maxGB);
    const maxLayers = tier ? tier.layers : ANDROID_GPU_LAYERS_FALLBACK;
    return Math.min(requestedLayers, maxLayers);
  }

  // iOS: cap Metal offload by free RAM vs model size (see IOS_METAL_RESERVE_BYTES).
  if (Platform.OS === 'ios' && opts?.modelBytes && opts?.availableBytes) {
    const weightBudget = opts.availableBytes - IOS_METAL_RESERVE_BYTES;
    if (weightBudget <= 0) return 0; // no headroom → run on CPU rather than crash
    if (opts.modelBytes <= weightBudget) return requestedLayers; // fits → full offload
    return Math.max(0, Math.floor(requestedLayers * (weightBudget / opts.modelBytes)));
  }
  return requestedLayers;
}
export { validateModelFile, checkMemoryForModel, safeCompletion } from './llmSafetyChecks';
export const STOP_TOKENS = ['</s>', '<|end|>', '<|eot_id|>'];
export function buildCompletionParams(settings: {
  maxTokens?: number; temperature?: number; topP?: number; repeatPenalty?: number;
}, options?: { disableCtxShift?: boolean }): Record<string, any> {
  return {
    n_predict: settings.maxTokens || RESPONSE_RESERVE,
    temperature: settings.temperature ?? 0.7,
    top_k: 40,
    top_p: settings.topP ?? 0.95,
    penalty_repeat: settings.repeatPenalty ?? 1.1,
    stop: STOP_TOKENS,
    ctx_shift: options?.disableCtxShift ? false : true,
  };
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
