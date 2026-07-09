import { LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import logger from '../utils/logger';

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
