import { initLlama, LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import { HTP_ENABLED } from '../config/featureFlags';
import { MultimodalSupport } from './llmTypes';
import logger from '../utils/logger';
import { templateEmitsReasoning } from '../utils/messageContent';
import {
  ensureNativeLogCapture,
  resetNativeLogCapture,
  recentNativeLog,
} from './llmNativeLog';

export {
  backendForcesF16Cache,
  buildModelParams,
  effectiveCacheType,
  ensureSessionCacheDir,
  getSessionPath,
  hashString,
} from './llmModelParams';
export interface ContextInitResult {
  context: LlamaContext;
  gpuAttemptFailed: boolean;
  actualLength: number;
}
/** Timeout for Adreno GPU context init on Android. 8s proved too tight on-device: Adreno 735
 *  first-load OpenCL kernel compilation exceeded it (2026-07-13 20:11 log: "timed out after
 *  8000ms" on a load that succeeded with 24 offloaded layers in an earlier session), silently
 *  downgrading every reload to CPU. The init runs on a native thread (no ANR exposure); 25s
 *  bounds a genuinely hung driver while letting a slow first compile finish. */
const GPU_INIT_TIMEOUT_MS = 25000;
/** Timeout for HTP/NPU context init -- DSP firmware load takes longer than Adreno. */
const HTP_INIT_TIMEOUT_MS = 30000;
/** iOS Metal init timeout. Larger than Android's because a legit large-model
 *  Metal setup takes longer — but bounded, so a Metal graph that HANGS (e.g.
 *  gemma3n froze indefinitely at kv-cache/graph construction) falls back to CPU
 *  instead of spinning the loader forever. */
const GPU_INIT_TIMEOUT_MS_IOS = 45000;
/** Race a promise against a timeout; rejects with descriptive error on expiry. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
/** Safely release a context, swallowing errors (used during fallback cleanup). */
async function safeRelease(ctx: LlamaContext | null): Promise<void> {
  if (!ctx) return;
  try {
    await ctx.release();
  } catch (e) {
    logger.warn('[LLM] Error releasing context during fallback:', e);
  }
}
/** The bounded time a GPU/HTP context init may take before we fall back to CPU.
 *  Platform/backend only changes the DURATION (data) — the timeout policy itself
 *  is uniform. */
function gpuInitTimeoutMs(isHtp: boolean): number {
  if (isHtp) return HTP_INIT_TIMEOUT_MS; // Android HTP/NPU
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
async function tryGpuInit(
  promise: Promise<LlamaContext>,
  nGpuLayers: number,
  isHtp: boolean = false,
): Promise<LlamaContext> {
  if (nGpuLayers <= 0) return promise; // pure-CPU init — nothing to time out
  const timeoutMs = gpuInitTimeoutMs(isHtp);
  let timedOut = false;
  promise
    .then(ctx => {
      if (timedOut) safeRelease(ctx);
    })
    .catch(() => {});
  try {
    return await withTimeout(
      promise,
      timeoutMs,
      isHtp ? 'HTP context init' : 'GPU context init',
    );
  } catch (e) {
    timedOut = true;
    throw e;
  }
}

/** Init llama with GPU/HTP, fall back to CPU, then retry with ctx=2048 on failure. */
export async function initContextWithFallback(
  params: object,
  contextLength: number,
  nGpuLayers: number,
): Promise<ContextInitResult> {
  const modelPath = (params as any).model || 'unknown';
  const isHtp =
    HTP_ENABLED &&
    Array.isArray((params as any).devices) &&
    (params as any).devices.some((d: string) => d.startsWith('HTP'));
  // Capture llama.cpp's own log so a load failure surfaces its REAL reason
  // (missing tensor / unknown architecture / wrong size) instead of rnllama's
  // opaque "Failed to load model". Reset the buffer for this attempt.
  ensureNativeLogCapture();
  resetNativeLogCapture();
  logger.log(
    `[LLM] initContextWithFallback: model=${modelPath}, ctx=${contextLength}, gpuLayers=${nGpuLayers}${
      isHtp ? ', backend=HTP' : ''
    }`,
  );
  logger.log(
    `[WIRE-LLAMA-LOAD] ${JSON.stringify({
      modelPath,
      contextLength,
      nGpuLayers,
      isHtp,
      params: { ...(params as Record<string, unknown>), model: undefined },
    })}`,
  ); // [WIRE] settings→native model-load config
  let gpuAttemptFailed = false;
  try {
    logger.log(
      `[LLM] Attempt 1/3: ${
        isHtp ? 'HTP' : 'GPU'
      } init (ctx=${contextLength}, gpu_layers=${nGpuLayers})`,
    );
    const gpuInitPromise = initLlama({
      ...params,
      n_ctx: contextLength,
      n_gpu_layers: nGpuLayers,
    } as any);
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
      logger.log(
        `[LLM] Attempt 2/3: CPU init (ctx=${contextLength}, gpu_layers=0)`,
      );
      // Strip devices — HTP requires n_gpu_layers > 0; CPU fallback must not request it
      const cpuParams = { ...(params as Record<string, unknown>) };
      delete cpuParams.devices;
      const context = await initLlama({
        ...cpuParams,
        n_ctx: contextLength,
        n_gpu_layers: 0,
      } as any);
      logger.log('[LLM] CPU init succeeded');
      return { context, gpuAttemptFailed, actualLength: contextLength };
    } catch (cpuError: any) {
      const cpuMsg = cpuError?.message || String(cpuError);
      logger.warn(
        `[LLM] Attempt 2/3 failed (CPU, ctx=${contextLength}): ${cpuMsg}`,
      );
      try {
        logger.log('[LLM] Attempt 3/3: CPU init (ctx=2048, gpu_layers=0)');
        const cpuMinParams = { ...(params as Record<string, unknown>) };
        delete cpuMinParams.devices;
        const context = await initLlama({
          ...cpuMinParams,
          n_ctx: 2048,
          n_gpu_layers: 0,
        } as any);
        logger.log('[LLM] CPU init with ctx=2048 succeeded');
        return { context, gpuAttemptFailed, actualLength: 2048 };
      } catch (finalError: any) {
        const finalMsg = finalError?.message || String(finalError);
        logger.error(`[LLM] Attempt 3/3 failed (CPU, ctx=2048): ${finalMsg}`);
        logger.error(
          `[LLM] All 3 init attempts failed for model: ${modelPath}`,
        );
        logger.error(
          `[LLM] Error chain — GPU: "${gpuMsg}" | CPU: "${cpuMsg}" | min-ctx: "${finalMsg}"`,
        );
        const errorParts = [
          gpuMsg && gpuMsg !== finalMsg ? `GPU: ${gpuMsg}` : null,
          cpuMsg && cpuMsg !== finalMsg ? `CPU: ${cpuMsg}` : null,
          `min-ctx: ${finalMsg}`,
        ]
          .filter(Boolean)
          .join(' | ');
        // Surface llama.cpp's actual reason (rnllama only gives "Failed to load
        // model"); the native log says e.g. "missing tensor" / "unknown arch".
        const nativeReason = recentNativeLog();
        logger.error(`[LLM] llama.cpp native log tail:\n${nativeReason}`);
        const nativeSuffix = nativeReason
          ? `\n\nllama.cpp: ${nativeReason}`
          : '';
        throw new Error(
          `Failed to load model even at minimum context (2048). This may indicate insufficient memory, a corrupted model file, or an unsupported model format.\n\nError chain: ${errorParts}${nativeSuffix}`,
        );
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
  // Native context truth wins over requested params: some drivers accept init
  // but decline every offload layer without throwing.
  const activeGpuLayers =
    gpuAttemptFailed || !nativeGpuAvailable ? 0 : nGpuLayers;
  const gpuEnabled = nativeGpuAvailable && activeGpuLayers > 0;
  return {
    gpuEnabled,
    gpuReason,
    gpuDevices,
    activeGpuLayers,
    gpuAttemptFailed,
  };
}

/**
 * UI notice for a GPU-selected load that landed on CPU (requested GPU layers, got 0 — init
 * failure/timeout, or a device/RAM refusal). Null when nothing to report. Never a silent CPU
 * downgrade (device 2026-07-13 18:57: "Backend=GPU but ran on CPU at 3.4 tok/s").
 */
export function describeGpuFallback(info: {
  requestedGpuLayers: number;
  activeGpuLayers: number;
  gpuAttemptFailed: boolean;
}): string | null {
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
    const template =
      metadata?.['tokenizer.chat_template'] ?? metadata?.chat_template;
    return templateEmitsReasoning(
      typeof template === 'string' ? template : undefined,
    );
  } catch {
    return false;
  }
}
export function buildThinkingCompletionParams(
  enableThinking: boolean,
  isGemma4: boolean = false,
): {
  enable_thinking: boolean;
  reasoning_format: 'none' | 'auto' | 'deepseek';
} {
  if (!enableThinking)
    return { enable_thinking: false, reasoning_format: 'none' };
  // Native-first (parse-once at the runtime boundary): Gemma 4 uses its own
  // <|channel>thought\n...<channel|> format, not DeepSeek's <think> tags. reasoning_format:'auto'
  // lets llama.cpp detect the model's chat_format and parse reasoning + tool calls NATIVELY —
  // populating reasoning_content/tool_calls and returning already-filtered content — instead of
  // forcing 'none' and hand-parsing the raw channel tags ourselves. Safe by construction: finalize
  // and resolveToolCalls only fall back to our hand-parser when the native fields are empty, so
  // native wins when it works and the hand-parser is a pure fallback. (Non-Gemma reasoning models
  // keep the known-good 'deepseek' path.)
  return {
    enable_thinking: true,
    reasoning_format: isGemma4 ? 'auto' : 'deepseek',
  };
}
export function getStreamingDelta(
  nextValue: string | undefined,
  previousValue: string,
): string | undefined {
  if (!nextValue) return undefined;
  if (!previousValue) return nextValue;
  return nextValue.startsWith(previousValue)
    ? nextValue.slice(previousValue.length) || undefined
    : nextValue;
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
      metadata['llama.context_length'] ||
      metadata['general.context_length'] ||
      metadata.context_length;
    if (!trainCtx) return null;
    const maxModelCtx = Number.parseInt(trainCtx, 10);
    return Number.isNaN(maxModelCtx) || maxModelCtx <= 0 ? null : maxModelCtx;
  } catch {
    return null;
  }
}
export function logContextMetadata(
  context: LlamaContext,
  contextLength: number,
): void {
  const maxModelCtx = getModelMaxContext(context);
  if (maxModelCtx == null) return;
  logger.log(
    `[LLM] Model trained context: ${maxModelCtx}, using: ${contextLength}`,
  );
  if (contextLength > maxModelCtx)
    logger.warn(
      `[LLM] Requested context (${contextLength}) exceeds model max (${maxModelCtx})`,
    );
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
  const noSupport: MultimodalInitResult = {
    initialized: false,
    support: { vision: false, audio: false },
  };
  try {
    const success = await context.initMultimodal({
      path: mmProjPath,
      use_gpu: useGpuForClip,
    });
    if (!success) {
      logger.warn(
        '[LLM] initMultimodal returned false - mmproj may be incompatible with model',
      );
      return noSupport;
    }
    let support: MultimodalSupport = { vision: true, audio: false };
    try {
      const s = await context.getMultimodalSupport();
      support = { vision: s?.vision || true, audio: s?.audio || false };
    } catch {
      // getMultimodalSupport not available, keep defaults
    }
    logger.log(
      '[LLM] Multimodal initialized successfully, vision:',
      support.vision,
    );
    return { initialized: true, support };
  } catch (error: any) {
    logger.error('[LLM] Multimodal init exception:', error?.message || error);
    return noSupport;
  }
}
export async function checkContextMultimodal(
  context: LlamaContext,
): Promise<MultimodalSupport> {
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
export {
  validateModelFile,
  checkMemoryForModel,
  resolveSafeContext,
} from './llmSafetyChecks';
export {
  BYTES_PER_GB,
  buildCompletionParams,
  getGpuLayersForDevice,
  getMaxContextForDevice,
  isTruncatedResult,
  recordGenerationStats,
} from './llmRuntimeSettings';
