import { LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { OverridableMemoryError } from '../utils/modelLoadErrors';

/**
 * GGUF magic number — first 4 bytes of every valid GGUF file.
 * Used to detect corrupted or truncated model files before loading.
 */
const GGUF_MAGIC = 'GGUF';

/** Minimum plausible GGUF file size (header + at least some tensors) */
const MIN_GGUF_FILE_SIZE = 1024; // 1 KB

function decodeLittleEndianUint32(bytes: string): number | null {
  if (bytes.length < 4) return null;
  const byteValues = Array.from(bytes).slice(0, 4).map(char => char.charCodeAt(0));
  return byteValues.reduce((sum, value, index) => sum + (value * (256 ** index)), 0);
}

/**
 * Validate that a model file is a plausible GGUF file.
 * Checks magic bytes and minimum file size to catch corrupted/truncated downloads.
 */
export async function validateModelFile(modelPath: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const stat = await RNFS.stat(modelPath);
    const fileSize = typeof stat.size === 'string' ? Number.parseInt(stat.size, 10) : stat.size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    logger.log(`[LLM] Validating model: ${modelPath}`);
    logger.log(`[LLM] Model file size: ${fileSizeMB}MB (${fileSize} bytes)`);
    if (fileSize < MIN_GGUF_FILE_SIZE) {
      return { valid: false, reason: `Model file too small (${fileSize} bytes) — likely corrupted or incomplete download` };
    }
    // Read first 4 bytes to check GGUF magic number.
    // RNFS.read() has an iOS bridging bug with NSInteger arguments on
    // react-native-fs 2.x, so we catch and skip the magic check if it fails.
    // llama.rn will still validate the file format natively on load.
    let header: string | undefined;
    try {
      header = await RNFS.read(modelPath, 4, 0, 'ascii');
    } catch (readErr) {
      logger.warn('[LLM] RNFS.read() failed for magic check, skipping header validation:', readErr);
    }
    if (header !== undefined && !header.startsWith(GGUF_MAGIC)) {
      return { valid: false, reason: `Invalid model file — not a GGUF file (header: ${header})` };
    }
    if (header !== undefined) {
      logger.log(`[LLM] GGUF magic OK`);
    }
    // Try to read GGUF version (bytes 4-7, little-endian uint32)
    try {
      const versionBytes = await RNFS.read(modelPath, 4, 4, 'ascii');
      if (versionBytes) {
        const version = decodeLittleEndianUint32(versionBytes);
        if (version !== null) logger.log(`[LLM] GGUF version: ${version}`);
      }
    } catch (_e) {
      // Non-critical, just skip
    }
    // Log the model filename for easier identification
    const filename = modelPath.split('/').pop() || modelPath;
    logger.log(`[LLM] Model filename: ${filename}`);
    return { valid: true };
  } catch (e: any) {
    return { valid: false, reason: `Failed to validate model file: ${e?.message || e}` };
  }
}

/**
 * Check whether the device has enough available memory to safely load a model.
 * Returns the estimated RAM needed and whether it's safe to proceed.
 *
 * Uses a 1.2x multiplier on file size as a conservative estimate of runtime RAM.
 * Context window KV cache adds additional memory proportional to context length.
 */
/**
 * KV cache scales with both context length AND model size (layers × hidden dim).
 * We don't know the architecture before load, so approximate the per-1024-token KV
 * cost as a fraction of the model's resident weights — ~6% for an f16 cache, ~3%
 * for a quantized (q8_0/q4) cache. For a ~4 GB 7-8B model at 4096 ctx this yields
 * ~1 GB (f16) / ~0.5 GB (quant), the right order of magnitude. The previous estimate
 * (~2 MB at any size) was ~1000x too low, so the guard never caught oversized loads.
 */
const KV_FRACTION_PER_1K_F16 = 0.06;
const KV_FRACTION_PER_1K_QUANT = 0.03;

export interface MemoryCheckArgs {
  modelFileSize: number;
  contextLength: number;
  getAvailableMemory: () => Promise<{ available: number; total: number }>;
  quantizedCache?: boolean;
}

export async function checkMemoryForModel(
  args: MemoryCheckArgs,
): Promise<{ safe: boolean; reason?: string; estimatedMB: number; availableMB: number }> {
  const { modelFileSize, contextLength, getAvailableMemory, quantizedCache } = args;
  try {
    const { available, total } = await getAvailableMemory();
    const availableMB = available / (1024 * 1024);
    const totalMB = total / (1024 * 1024);
    // Model weights in RAM (~1x file size for mmap, up to 1.2x without)
    const modelMB = (modelFileSize * 1.2) / (1024 * 1024);
    // KV cache estimate: a fraction of the model weights per 1024 tokens (see above).
    const kvFractionPer1k = quantizedCache ? KV_FRACTION_PER_1K_QUANT : KV_FRACTION_PER_1K_F16;
    const kvCacheMB = (contextLength / 1024) * modelMB * kvFractionPer1k;
    const estimatedMB = modelMB + kvCacheMB;
    // Require at least 200MB headroom after model load for OS and app
    const MIN_HEADROOM_MB = 200;
    const safe = availableMB > estimatedMB + MIN_HEADROOM_MB;
    // [MEM-SM] the pre-load fit decision — kept (surfaces the exact "it needs ~X but only Y" call
    // on-device AND in tests via DEBUG_LOGS=1). This is the gate the qwythos refusal came from.
    logger.log(`[MEM-SM] checkMemoryForModel modelMB=${Math.round(modelMB)} kvMB=${Math.round(kvCacheMB)} estMB=${Math.round(estimatedMB)} availMB=${Math.round(availableMB)} ctx=${contextLength} safe=${safe}`);
    if (!safe) {
      return {
        safe: false,
        reason: `Not enough memory: model needs ~${Math.round(estimatedMB)}MB but only ${Math.round(availableMB)}MB available (device total: ${Math.round(totalMB)}MB). Try closing other apps or using a smaller model.`,
        estimatedMB,
        availableMB,
      };
    }
    return { safe: true, estimatedMB, availableMB };
  } catch (e: any) {
    // If we can't check memory, proceed anyway but log a warning
    logger.warn('[LLM] Could not check available memory:', e?.message || e);
    return { safe: true, estimatedMB: 0, availableMB: 0 };
  }
}

/**
 * Find the largest context that fits available memory, stepping down from the
 * requested size. Throws only when the model weights alone exceed available RAM
 * (a load that would certainly crash the allocator); otherwise proceeds at the
 * smallest context, since the estimate is intentionally conservative.
 *
 * Extracted from LLMService to keep llm.ts under the max-lines limit; behavior is
 * unchanged. `getAvailableMemory` is passed in so this stays free of the hardware dep.
 */
export async function resolveSafeContext(args: {
  fileSize: number;
  requestedCtx: number;
  quantizedCache: boolean;
  override?: boolean;
  getAvailableMemory: () => Promise<{ available: number; total: number }>;
}): Promise<{ ctxLen: number; memCheck: Awaited<ReturnType<typeof checkMemoryForModel>> }> {
  const { fileSize, requestedCtx, quantizedCache, override = false, getAvailableMemory: getMem } = args;
  // Step down from the requested size so the LARGEST fitting context wins — a request
  // of 16384 tries 14336, 12288, ... rather than jumping straight to a hardcoded 8192
  // ceiling and needlessly shrinking context on devices that could hold more.
  const STEP = 2048;
  const fallbacks: number[] = [];
  for (let ctx = requestedCtx - STEP; ctx >= 1024; ctx -= STEP) fallbacks.push(ctx);
  for (const ctx of fallbacks) {
    const mc = await checkMemoryForModel({ modelFileSize: fileSize, contextLength: ctx, getAvailableMemory: getMem, quantizedCache });
    if (mc.safe) {
      logger.warn(`[LLM] Memory tight — reducing context ${requestedCtx} → ${ctx} (~${mc.estimatedMB.toFixed(0)}MB of ${mc.availableMB.toFixed(0)}MB available)`);
      return { ctxLen: ctx, memCheck: mc };
    }
  }
  const minCtx = fallbacks.length ? fallbacks[fallbacks.length - 1] : requestedCtx;
  const finalCheck = await checkMemoryForModel({ modelFileSize: fileSize, contextLength: minCtx, getAvailableMemory: getMem, quantizedCache });
  const modelMB = (fileSize * 1.2) / (1024 * 1024);
  // [MEM-SM] the weights-alone refusal decision — kept. weightsExceedAvail && !override is the
  // dead-end that used to throw a plain Error; it now throws OverridableMemoryError (Load Anyway).
  logger.log(`[MEM-SM] resolveSafeContext gate modelMB=${Math.round(modelMB)} availMB=${Math.round(finalCheck.availableMB)} override=${override} weightsExceedAvail=${finalCheck.availableMB > 0 && modelMB > finalCheck.availableMB}`);
  if (finalCheck.availableMB > 0 && modelMB > finalCheck.availableMB && !override) {
    // OVERRIDABLE, always: a budget refusal in ANY mode must offer "Load Anyway" — never a
    // dead-end. This is the single behavior the image path already had (makeRoomFor →
    // OverridableMemoryError); the text pre-load gate used to throw a plain Error here, which
    // surfaced as an OK-only alert with no override (the 12GB-Aggressive-refused-with-no-Load-
    // Anyway bug). OverridableMemoryError is pure, so this stays layering-clean.
    throw new OverridableMemoryError(`Not enough memory to load this model: it needs ~${Math.round(modelMB)}MB but only ${Math.round(finalCheck.availableMB)}MB is available. Close other apps or choose a smaller model.`);
  }
  if (override && finalCheck.availableMB > 0 && modelMB > finalCheck.availableMB) {
    // User forced the load ("Load Anyway" / continue). Skip the hard block and let the
    // native loader's GPU→CPU→smaller-ctx fallback + OOM recovery try — they accepted
    // the risk, and eviction already freed everything it could. NORMAL loads still throw.
    logger.warn(`[LLM] OVERRIDE — proceeding despite tight memory (~${Math.round(modelMB)}MB needed, ${Math.round(finalCheck.availableMB)}MB free)`);
  }
  logger.warn(`[LLM] Memory very tight — proceeding at minimum context ${minCtx} (estimate may be conservative)`);
  return { ctxLen: minCtx, memCheck: finalCheck };
}

/**
 * Wraps a llama.rn completion call with error handling for native crashes.
 * Catches ggml_abort and OOM-style errors and returns a structured error
 * instead of letting the app crash unrecoverably.
 */
export async function safeCompletion<T>(
  context: LlamaContext,
  completionFn: () => Promise<T>,
  label: string = 'completion',
): Promise<T> {
  try {
    return await completionFn();
  } catch (error: any) {
    const msg = error?.message || String(error) || '';
    const isNativeCrash = msg.includes('ggml') || msg.includes('abort') ||
      msg.includes('SIGABRT') || msg.includes('tensor') ||
      msg.includes('alloc') || msg.includes('out of memory') ||
      msg.includes('failed to allocate') || msg.includes('OOM');
    if (isNativeCrash) {
      logger.error(`[LLM] Native crash during ${label}: ${msg}`);
      // Try to recover the context by clearing KV cache
      try {
        await (context as any).clearCache(true);
        logger.log(`[LLM] KV cache cleared after native error in ${label}`);
      } catch (clearError) {
        logger.warn(`[LLM] Failed to clear KV cache after crash: ${clearError}`);
      }
      throw new Error(`Model inference failed (native error). The model's KV cache has been cleared. Please try again, or use a smaller model/context size. (${msg})`);
    }
    throw error;
  }
}
