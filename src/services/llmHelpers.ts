import { initLlama, LlamaContext } from 'llama.rn';
import { activeAgentOverrides } from '../stores/agentStore';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { APP_CONFIG } from '../constants';
import { Message, INFERENCE_BACKENDS } from '../types';
import { MultimodalSupport, LLMPerformanceStats } from './llmTypes';
import logger from '../utils/logger';
import { templateEmitsReasoning } from '../utils/messageContent';
import { ensureNativeLogCapture, resetNativeLogCapture, recentNativeLog } from './llmNativeLog';
import {
  startInitTrace, recordInitProgress, watchInit, describeTrace, trackAbandonedInit, settleAbandonedInit, type InitWindows,
} from './nativeInit';

import { HTP_ENABLED } from '../config/featureFlags';
import { BYTES_PER_GB } from '../utils/contextLimits';
export { BYTES_PER_GB, getMaxContextForDevice } from '../utils/contextLimits';

const RESPONSE_RESERVE = 512;
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
  // Vulkan (llama.kt) is always loaded with an f16 cache: the cache type setting is not passed to it.
  return backend === INFERENCE_BACKENDS.OPENCL || backend === INFERENCE_BACKENDS.VULKAN
    || (HTP_ENABLED && backend === INFERENCE_BACKENDS.HTP);
}

/**
 * Model families whose attention layers cannot use a quantized KV cache: the app crashes when they are loaded with one
 * (Gemma 4 and Gemma 3n mix attention layouts). They always run with an f16 cache, whatever the setting says.
 */
export function modelForcesF16Cache(modelPath: string | undefined): boolean {
  const name = (modelPath ?? '').split('/').pop() ?? '';
  return /gemma[-_ ]?(3n|4)/i.test(name);
}

/** The KV cache type that will ACTUALLY be used, after backend (and model family) coercion to f16. */
export function effectiveCacheType(backend: string | undefined, requested: string | undefined, modelPath?: string): string {
  return backendForcesF16Cache(backend) || modelForcesF16Cache(modelPath) ? 'f16' : (requested || 'q8_0');
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
  const cacheType = effectiveCacheType(backend, requestedCache, modelPath);
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
/**
 * Extra context params that turn on MTP (multi-token prediction): the engine drafts a few tokens ahead with the attached MTP
 * file and the main model checks them. Empty when there is no file or the switch is off.
 */
export function mtpParams(draftPath: string | undefined, enabled: boolean, embedded = false): Record<string, unknown> {
  if (!enabled || (!draftPath && !embedded)) return {};
  // Embedded: the model's own MTP layers draft (no second file); otherwise the attached file does.
  return { ...(draftPath ? { model_draft: draftPath } : {}), speculative: { enabled: true, type: 'mtp', n_max: 3 } };
}

export interface ContextInitResult {
  context: LlamaContext;
  gpuAttemptFailed: boolean;
  actualLength: number;
}
/** Timeout for Adreno GPU context init on Android. 8s proved too tight on-device: Adreno 735
 *  first-load OpenCL kernel compilation exceeded it (2026-07-13 20:11 log: "timed out after
 *  8000ms" on a load that succeeded with 24 offloaded layers in an earlier session), silently
 *  downgrading every reload to CPU. The init runs on a native thread (no ANR exposure); 25s
 *  bounds a genuinely hung driver while letting a slow first compile finish (raised to 45s:
 *  first-load kernel compiles of 3-4B models still ran past 25s). */
const GPU_INIT_TIMEOUT_MS = 45000;
/** Timeout for HTP/NPU context init -- DSP firmware load plus the first weight repack take
 *  longer than Adreno; 30s cut off first NPU loads of 3-4B models. */
const HTP_INIT_TIMEOUT_MS = 90000;
/** iOS Metal init timeout. Larger than Android's because a legit large-model
 *  Metal setup takes longer — but bounded, so a Metal graph that HANGS (e.g.
 *  gemma3n froze indefinitely at kv-cache/graph construction) falls back to CPU
 *  instead of spinning the loader forever. */
const GPU_INIT_TIMEOUT_MS_IOS = 45000;
/** Safely release a context, swallowing errors (used during fallback cleanup). */
async function safeRelease(ctx: LlamaContext | null): Promise<void> {
  if (!ctx) return;
  try { await ctx.release(); } catch (e) { logger.warn('[LLM] Error releasing context during fallback:', e); }
}
/** How long a GPU/HTP context init may go quiet before it counts as hung. Platform/backend only changes the DURATION
 *  (data); the policy itself is uniform. The window it applies to depends on what the load is doing (see nativeInit.ts):
 *  a load whose weight-loading percentage is still moving is not hung. */
function gpuInitWindows(isHtp: boolean): InitWindows {
  const base = isHtp ? HTP_INIT_TIMEOUT_MS : (Platform.OS === 'ios' ? GPU_INIT_TIMEOUT_MS_IOS : GPU_INIT_TIMEOUT_MS);
  return { stallMs: base, setupMs: base * 2, hardCapMs: 300000 };
}
/** initLlama, with the progress callback only when there is one (so a load without it is called exactly as before). */
const initWith = (params: object, onProgress?: (percent: number) => void): Promise<LlamaContext> =>
  (onProgress ? initLlama(params as any, onProgress) : initLlama(params as any));
/** Why a load stalled, written to the log at the moment it happens: free memory and llama.cpp's own last lines. */
async function logInitStall(label: string): Promise<void> {
  try {
    const { hardwareService } = require('./hardware');
    const info = await hardwareService.getDeviceInfo();
    logger.error(`[LLM] ${label} stalled. Memory now: ${(info.availableMemory / BYTES_PER_GB).toFixed(2)} GB free of ${(info.totalMemory / BYTES_PER_GB).toFixed(1)} GB`);
  } catch { /* memory info is best effort */ }
  logger.error(`[LLM] llama.cpp native log tail at the stall:\n${recentNativeLog()}`);
}
/**
 * Starts a native load and, for GPU/HTP loads, watches it so a HUNG backend (an iOS Metal graph that never returns, an
 * Android OpenCL driver that wedges) falls back instead of spinning the loader forever, while a slow but advancing
 * load (a 7 GB model still reading its weights) is left alone. A timed-out load keeps running natively; it is
 * remembered so the next load waits for it to finish and release its context (nativeInit.settleAbandonedInit).
 */
async function tryGpuInit(start: (onProgress?: (percent: number) => void) => Promise<LlamaContext>, nGpuLayers: number, isHtp: boolean = false): Promise<LlamaContext> {
  const trace = startInitTrace();
  let lastLogged = -1;
  // A pure-CPU init is started exactly as before (no progress callback) and has nothing to time out.
  if (nGpuLayers <= 0) return start();
  const promise = start((percent) => {
    recordInitProgress(trace, percent);
    const step = Math.floor(trace.percent / 10);
    if (step > lastLogged) { lastLogged = step; logger.log(`[LLM] init progress ${trace.percent}% after ${((Date.now() - trace.startedAt) / 1000).toFixed(1)}s`); }
  });
  const label = isHtp ? 'HTP context init' : 'GPU context init';
  try {
    const context = await watchInit(promise, trace, { label, windows: gpuInitWindows(isHtp) });
    logger.log(`[LLM] ${label} finished: ${describeTrace(trace)}`);
    return context;
  } catch (e: any) {
    if (/timed out after/i.test(String(e?.message))) {
      trackAbandonedInit(promise, safeRelease);
      logger.error(`[LLM] ${e.message} | ${describeTrace(trace)}`);
      await logInitStall(label);
    }
    throw e;
  }
}

/** Errors that indicate the app's native llama runtime is unavailable, not a bad model. */
export function isNativeLlamaRuntimeError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('jsi bindings not installed') ||
    normalized.includes('failed to install jsi') ||
    normalized.includes('native module') && normalized.includes('rnllama');
}

function throwNativeLlamaRuntimeError(message: string): never {
  throw new Error(
    `Atlas's native LLM runtime is unavailable. This is an app installation/build problem, not a problem with this model.\n\nNative runtime error: ${message}`,
  );
}

/** Init llama with GPU/HTP, fall back to CPU, then retry with ctx=2048 on failure. */
export async function initContextWithFallback(
  params: object,
  contextLength: number,
  nGpuLayers: number,
  allowCpuFallback: boolean = true,
): Promise<ContextInitResult> {
  const modelPath = (params as any).model || 'unknown';
  const isHtp = HTP_ENABLED && Array.isArray((params as any).devices) && (params as any).devices.some((d: string) => d.startsWith('HTP'));
  // Capture llama.cpp's own log so a load failure surfaces its REAL reason
  // (missing tensor / unknown architecture / wrong size) instead of rnllama's
  // opaque "Failed to load model". Reset the buffer for this attempt.
  // A GPU load that timed out earlier may still be running natively: wait for it to finish and release (or refuse).
  await settleAbandonedInit();
  ensureNativeLogCapture();
  resetNativeLogCapture();
  logger.log(`[LLM] initContextWithFallback: model=${modelPath}, ctx=${contextLength}, gpuLayers=${nGpuLayers}${isHtp ? ', backend=HTP' : ''}`);
  logger.log(`[WIRE-LLAMA-LOAD] ${JSON.stringify({ modelPath, contextLength, nGpuLayers, isHtp, params: { ...(params as Record<string, unknown>), model: undefined } })}`); // [WIRE] settings→native model-load config
  let gpuAttemptFailed = false;
  try {
    logger.log(`[LLM] Attempt 1/3: ${isHtp ? 'HTP' : 'GPU'} init (ctx=${contextLength}, gpu_layers=${nGpuLayers})`);
    const context = await tryGpuInit((onProgress) => initWith({ ...params, n_ctx: contextLength, n_gpu_layers: nGpuLayers }, onProgress), nGpuLayers, isHtp);
    if (!allowCpuFallback && nGpuLayers > 0 && context.gpu !== true) {
      await safeRelease(context);
      throw new Error('Native context did not confirm GPU/NPU acceleration');
    }
    logger.log('[LLM] GPU init succeeded');
    return { context, gpuAttemptFailed, actualLength: contextLength };
  } catch (gpuError: any) {
    const gpuMsg = gpuError?.message || String(gpuError);
    if (isNativeLlamaRuntimeError(gpuMsg)) throwNativeLlamaRuntimeError(gpuMsg);
    if (!allowCpuFallback && nGpuLayers > 0) {
      throw new Error(`GPU/NPU initialization failed: ${gpuMsg}. CPU fallback is disabled.`);
    }
    if (nGpuLayers > 0) {
      logger.warn(`[LLM] Attempt 1/3 failed (GPU): ${gpuMsg}`);
      gpuAttemptFailed = true;
    } else {
      logger.warn(`[LLM] Attempt 1/3 failed (no GPU requested): ${gpuMsg}`);
    }
    // When Hexagon fails, try the bundled default GPU backend before CPU.
    // Removing the HTP device pin lets llama.rn select OpenCL when available.
    if (isHtp && nGpuLayers > 0) {
      const gpuParams = { ...(params as Record<string, unknown>) };
      delete gpuParams.devices;
      try {
        logger.log('[LLM] Hexagon failed; attempting OpenCL GPU before CPU');
        const context = await tryGpuInit((onProgress) => initWith({ ...gpuParams, n_ctx: contextLength, n_gpu_layers: nGpuLayers }, onProgress), nGpuLayers);
        return { context, gpuAttemptFailed: !(context.gpu ?? false), actualLength: contextLength };
      } catch (openclError: any) {
        const message = openclError?.message || String(openclError);
        if (isNativeLlamaRuntimeError(message)) throwNativeLlamaRuntimeError(message);
        logger.warn(`[LLM] OpenCL retry failed; continuing to CPU: ${message}`);
      }
    }
    // The failed GPU load may still be running (it timed out): never start the CPU load beside it.
    await settleAbandonedInit();
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
      if (isNativeLlamaRuntimeError(cpuMsg)) throwNativeLlamaRuntimeError(cpuMsg);
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
        if (isNativeLlamaRuntimeError(finalMsg)) throwNativeLlamaRuntimeError(finalMsg);
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
  if (info.requestedGpuLayers <= 0 || info.activeGpuLayers > 0) return null;
  return info.gpuAttemptFailed
    ? 'GPU unavailable - its initialization failed or timed out. Running on CPU.'
    : 'GPU unavailable on this device - running on CPU.';
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
    return templateEmitsReasoning(typeof template === 'string' ? template : undefined);
  } catch {
    return false;
  }
}
export function buildThinkingCompletionParams(enableThinking: boolean, isGemma4: boolean = false): { enable_thinking: boolean; reasoning_format: 'none' | 'auto' | 'deepseek' } {
  if (!enableThinking) return { enable_thinking: false, reasoning_format: 'none' };
  // Native-first (parse-once at the runtime boundary): Gemma 4 uses its own
  // <|channel>thought\n...<channel|> format, not DeepSeek's <think> tags. reasoning_format:'auto'
  // lets llama.cpp detect the model's chat_format and parse reasoning + tool calls NATIVELY —
  // populating reasoning_content/tool_calls and returning already-filtered content — instead of
  // forcing 'none' and hand-parsing the raw channel tags ourselves. Safe by construction: finalize
  // and resolveToolCalls only fall back to our hand-parser when the native fields are empty, so
  // native wins when it works and the hand-parser is a pure fallback. (Non-Gemma reasoning models
  // keep the known-good 'deepseek' path.)
  return { enable_thinking: true, reasoning_format: isGemma4 ? 'auto' : 'deepseek' };
}
/**
 * New text in an ACCUMULATED stream value (llama.rn re-parses all generated text into
 * `content` on every token) relative to what was already DISPLAYED. The parser can revise
 * displayed text: a held-back partial tag such as "<tool_call" released, trimmed
 * whitespace, or a switch from raw token pieces to parsed content after a failed partial
 * parse. Returning the whole value then re-appended the entire reply (repeated text and
 * characters, stored in the chat). Only characters beyond the displayed length are new;
 * the final reply is reconciled with the authoritative content when generation completes.
 */
export function getStreamingDelta(nextValue: string | undefined, displayed: string): string | undefined {
  if (!nextValue) return undefined;
  if (!displayed) return nextValue;
  if (nextValue.startsWith(displayed)) return nextValue.slice(displayed.length) || undefined;
  return nextValue.length > displayed.length ? nextValue.slice(displayed.length) : undefined;
}

/** Accumulated content for a stream event: parsed content, else displayed text + raw token. */
export function nextStreamedContent(
  data: { content?: string; reasoning_content?: string; token?: string }, displayed: string,
): string | undefined {
  if (data.content != null) return data.content;
  return !data.reasoning_content && data.token ? displayed + data.token : undefined;
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
// Android Adreno GPU caps for models too big to offload whole (≤4GB/≤6GB→0, ≤8GB→12, >8GB→24).
// A model whose weights fit in this share of RAM offloads fully: the caps alone meant no
// phone ever ran a model fully on the GPU, and ≤6GB phones never used it at all.
const ANDROID_FULL_OFFLOAD_RAM_SHARE = 0.4;
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
    if (opts?.modelBytes && opts.modelBytes <= totalMemoryBytes * ANDROID_FULL_OFFLOAD_RAM_SHARE) return requestedLayers;
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
export { validateModelFile, checkMemoryForModel, safeCompletion, resolveSafeContext } from './llmSafetyChecks';
const STOP_TOKENS = ['</s>', '<|end|>', '<|eot_id|>'];
export function buildCompletionParams(settings: {
  maxTokens?: number; temperature?: number; topP?: number; repeatPenalty?: number;
}, options?: { disableCtxShift?: boolean }): Record<string, any> {
  // Atlas: the active agent's own temperature / top-p / max tokens / repeat penalty win.
  settings = { ...settings, ...activeAgentOverrides() };
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
/**
 * Was a completion cut off at the n_predict cap (B15), vs finishing on EOS or being STOPPED? SINGLE
 * truncation verdict for both the plain and tool-loop paths. A user stop is `interrupted:true`
 * (stopped_eos:false) — NOT truncation; only a stopped_limit/truncated hit is (device 2026-07-14).
 */
export function isTruncatedResult(
  cr: { interrupted?: boolean; stopped_limit?: number | boolean; truncated?: boolean } | null | undefined,
): boolean {
  if (!cr || cr.interrupted === true) return false;
  return cr.stopped_limit === 1 || cr.stopped_limit === true || cr.truncated === true;
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
