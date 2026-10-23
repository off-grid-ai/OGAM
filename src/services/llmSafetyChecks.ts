import { isDraftModelFile, isImatrixFile, isLoadableOnDevice, isMtpHeadFile, splitGgufPartNames } from '@offgrid/models';
import { LlamaContext } from 'llama.rn';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import logger from '../utils/logger';
import { OverridableMemoryError } from '../utils/modelLoadErrors';
import { textModelBudget } from './memoryBudget';

/**
 * GGUF magic number — first 4 bytes of every valid GGUF file.
 * Used to detect corrupted or truncated model files before loading.
 */
const GGUF_MAGIC = 'GGUF';

/** Minimum plausible GGUF file size (header + at least some tensors) */
const MIN_GGUF_FILE_SIZE = 1024; // 1 KB

function decodeLittleEndianUint32(bytes: string): number | null {
  if (bytes.length < 4) return null;
  const byteValues = Array.from(bytes)
    .slice(0, 4)
    .map(char => char.charCodeAt(0));
  return byteValues.reduce(
    (sum, value, index) => sum + value * 256 ** index,
    0,
  );
}

/**
 * Validate that a model file is a plausible GGUF file.
 * Checks magic bytes and minimum file size to catch corrupted/truncated downloads.
 */
/** Why a split model cannot load from its first part (a part is not beside it), or null when it can. */
async function missingSplitPartReason(modelPath: string): Promise<string | null> {
  const parts = splitGgufPartNames(modelPath);
  const present = await Promise.all(parts.slice(1).map(async part => !!(await statFile(part))));
  const missing = parts.slice(1).filter((_, i) => !present[i]).map(part => part.split('/').pop());
  if (missing.length === 0) return null;
  return `This model comes in ${parts.length} parts and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. Download it again to fetch the missing part.`;
}

export async function validateModelFile(
  modelPath: string,
): Promise<{ valid: boolean; reason?: string }> {
  // An MTP head or a draft model carries only the extra layers that speed a model up. Loaded on its
  // own, the engine builds the graph with no main weights and crashes the app (null tensor in the
  // Qwen3.5 linear-attention layers), so it is refused before it reaches the engine.
  if (isMtpHeadFile(modelPath) || isDraftModelFile(modelPath)) {
    return {
      valid: false,
      reason: 'This file only speeds up another model. It cannot run on its own.',
    };
  }
  // An importance matrix is the quantizer's calibration data: it has no model weights at all.
  if (isImatrixFile(modelPath)) {
    return {
      valid: false,
      reason: 'This file is calibration data for making a model, not a model. Choose one of the sizes instead.',
    };
  }
  try {
    const facts = await statFile(modelPath);
    if (!facts) {
      return { valid: false, reason: `Model file not found at: ${modelPath}` };
    }
    if (!facts.isFile) {
      return { valid: false, reason: `Model path is not a file: ${modelPath}` };
    }
    const missingPart = await missingSplitPartReason(modelPath);
    if (missingPart) return { valid: false, reason: missingPart };
    const fileSize = facts.size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    logger.log(`[LLM] Validating model: ${modelPath}`);
    logger.log(`[LLM] Model file size: ${fileSizeMB}MB (${fileSize} bytes)`);
    if (fileSize < MIN_GGUF_FILE_SIZE) {
      return {
        valid: false,
        reason: `Model file too small (${fileSize} bytes) — likely corrupted or incomplete download`,
      };
    }
    // Read first 4 bytes to check GGUF magic number.
    // RNFS.read() has an iOS bridging bug with NSInteger arguments on
    // react-native-fs 2.x, so we catch and skip the magic check if it fails.
    // llama.rn will still validate the file format natively on load.
    let header: string | undefined;
    try {
      header = await RNFS.read(modelPath, 4, 0, 'ascii');
    } catch (readErr) {
      logger.warn(
        '[LLM] RNFS.read() failed for magic check, skipping header validation:',
        readErr,
      );
    }
    if (header !== undefined && !header.startsWith(GGUF_MAGIC)) {
      return {
        valid: false,
        reason: `Invalid model file — not a GGUF file (header: ${header})`,
      };
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
    return {
      valid: false,
      reason: `Failed to validate model file: ${e?.message || e}`,
    };
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
  /** The weights are memory-mapped and paged in from the file (every iPhone load): they are not
   *  charged against the app's free memory but bounded by the fit rule against total RAM. */
  weightsMapped?: boolean;
  /** A vision projector loaded beside mapped weights: it is copied into memory, so it counts against
   *  what is free and within the fit rule's bound. */
  projectorFileSize?: number;
}

export async function checkMemoryForModel(
  args: MemoryCheckArgs,
): Promise<{
  safe: boolean;
  reason?: string;
  estimatedMB: number;
  /** What the verdict compares against: the estimate plus the OS/app headroom. Copy must quote this. */
  requiredMB: number;
  availableMB: number;
}> {
  const { modelFileSize, contextLength, getAvailableMemory, quantizedCache, weightsMapped, projectorFileSize = 0 } =
    args;
  try {
    const { available, total } = await getAvailableMemory();
    const availableMB = available / (1024 * 1024);
    const totalMB = total / (1024 * 1024);
    // Model weights in RAM (~1x file size for mmap, up to 1.2x without)
    const modelMB = (modelFileSize * (weightsMapped ? 1 : 1.2)) / (1024 * 1024);
    // KV cache estimate: a fraction of the model weights per 1024 tokens (see above).
    const kvFractionPer1k = quantizedCache
      ? KV_FRACTION_PER_1K_QUANT
      : KV_FRACTION_PER_1K_F16;
    const kvCacheMB = (contextLength / 1024) * modelMB * kvFractionPer1k;
    const estimatedMB = modelMB + kvCacheMB;
    // Require at least 200MB headroom after model load for OS and app
    const MIN_HEADROOM_MB = 200;
    // Mapped weights page in from the file and are not charged against the app's limit (a 12 GB
    // iPhone loads a 5.6 GB 9B Q4_K_M with 6.0 GB free): the shared fit rule bounds them against
    // total RAM, and only the KV cache and headroom must fit in what is free.
    // A vision projector is copied, not mapped: it counts against what is free.
    const projectorMB = weightsMapped ? projectorFileSize / (1024 * 1024) : 0;
    const weightsFit = !weightsMapped || isLoadableOnDevice((modelFileSize + projectorFileSize) / 1e9, total / 1024 ** 3, textModelBudget());
    const requiredMB = weightsMapped && weightsFit ? kvCacheMB + projectorMB + MIN_HEADROOM_MB : estimatedMB + projectorMB + MIN_HEADROOM_MB;
    const safe = weightsFit && availableMB > requiredMB;
    // [MEM-SM] the pre-load fit decision — kept (surfaces the exact "it needs ~X but only Y" call
    // on-device AND in tests via DEBUG_LOGS=1). This is the gate the qwythos refusal came from.
    logger.log(
      `[MEM-SM] checkMemoryForModel modelMB=${Math.round(
        modelMB,
      )} kvMB=${Math.round(kvCacheMB)} estMB=${Math.round(
        estimatedMB,
      )} availMB=${Math.round(availableMB)} ctx=${contextLength} mapped=${!!weightsMapped} safe=${safe}`,
    );
    if (!safe) {
      return {
        safe: false,
        reason: `Not enough memory: model needs ~${Math.round(
          requiredMB,
        )}MB but only ${Math.round(
          availableMB,
        )}MB available (device total: ${Math.round(
          totalMB,
        )}MB). Try closing other apps or using a smaller model.`,
        estimatedMB,
        requiredMB,
        availableMB,
      };
    }
    return { safe: true, estimatedMB, requiredMB, availableMB };
  } catch (e: any) {
    // If we can't check memory, proceed anyway but log a warning
    logger.warn('[LLM] Could not check available memory:', e?.message || e);
    return { safe: true, estimatedMB: 0, requiredMB: 0, availableMB: 0 };
  }
}

/** Check the selected context without changing it. A memory refusal can be overridden by the user. */
export async function resolveSafeContext(args: {
  fileSize: number;
  requestedCtx: number;
  quantizedCache: boolean;
  weightsMapped?: boolean;
  projectorFileSize?: number;
  override?: boolean;
  getAvailableMemory: () => Promise<{ available: number; total: number }>;
  /** The check the caller already ran. Reused so the copy quotes the snapshot that failed. */
  memCheck?: Awaited<ReturnType<typeof checkMemoryForModel>>;
}): Promise<{
  ctxLen: number;
  memCheck: Awaited<ReturnType<typeof checkMemoryForModel>>;
}> {
  const {
    fileSize,
    requestedCtx,
    quantizedCache,
    override = false,
    getAvailableMemory: getMem,
  } = args;
  const memCheck = args.memCheck ?? await checkMemoryForModel({
    modelFileSize: fileSize,
    contextLength: requestedCtx,
    getAvailableMemory: getMem,
    quantizedCache,
    weightsMapped: args.weightsMapped,
    projectorFileSize: args.projectorFileSize,
  });
  if (!memCheck.safe && !override) {
    throw new OverridableMemoryError(
      `Not enough memory to load this model at ${requestedCtx.toLocaleString()} context tokens: it needs ~${Math.round(memCheck.requiredMB)}MB but only ${Math.round(memCheck.availableMB)}MB is available. Close other apps or choose a smaller model.`,
    );
  }
  if (!memCheck.safe && override) {
    logger.warn(
      `[LLM] OVERRIDE — trying selected context ${requestedCtx} despite tight memory`,
    );
  }
  return { ctxLen: requestedCtx, memCheck };
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
    const isNativeCrash =
      msg.includes('ggml') ||
      msg.includes('abort') ||
      msg.includes('SIGABRT') ||
      msg.includes('tensor') ||
      msg.includes('alloc') ||
      msg.includes('out of memory') ||
      msg.includes('failed to allocate') ||
      msg.includes('OOM');
    if (isNativeCrash) {
      logger.error(`[LLM] Native crash during ${label}: ${msg}`);
      // Try to recover the context by clearing KV cache
      try {
        await (context as any).clearCache(true);
        logger.log(`[LLM] KV cache cleared after native error in ${label}`);
      } catch (clearError) {
        logger.warn(
          `[LLM] Failed to clear KV cache after crash: ${clearError}`,
        );
      }
      throw new Error(
        `Model inference failed (native error). The model's KV cache has been cleared. Please try again, or use a smaller model/context size. (${msg})`,
      );
    }
    throw error;
  }
}
