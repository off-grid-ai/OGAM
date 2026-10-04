import { LlamaContext } from 'llama.rn';
import {
  artifactVerificationError,
  runWithNativeInferenceRecovery,
} from '@offgrid/models';
import logger from '../utils/logger';
import { artifactVerification } from './composition/artifact-verification';

/**
 * GGUF magic number — first 4 bytes of every valid GGUF file.
 * Used to detect corrupted or truncated model files before loading.
 */
/**
 * Validate that a model file is a plausible GGUF file.
 * Checks magic bytes and minimum file size to catch corrupted/truncated downloads.
 */
export async function validateModelFile(
  modelPath: string,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    logger.log(`[LLM] Validating model: ${modelPath}`);
    const request = {
      path: modelPath,
      name: modelPath.split('/').pop() || modelPath,
      format: 'gguf' as const,
      origin: 'runtime' as const,
      removeInvalid: false,
    };
    const result = await artifactVerification().verify(request);
    if (result.valid) {
      logger.log(
        `[LLM] Model file size: ${(result.sizeBytes / (1024 * 1024)).toFixed(1)}MB (${result.sizeBytes} bytes)`,
      );
      if (result.ggufVersion) logger.log(`[LLM] GGUF version: ${result.ggufVersion}`);
      return { valid: true };
    }
    return { valid: false, reason: artifactVerificationError(request, result) };
  } catch (e: any) {
    return {
      valid: false,
      reason: `Failed to validate model file: ${e?.message || e}`,
    };
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
  return runWithNativeInferenceRecovery(completionFn, {
    clearContext: () => (context as any).clearCache(true),
    report: (event, detail) => {
      if (event === 'native-failure') logger.error(`[LLM] Native crash during ${label}:`, detail);
      else if (event === 'context-clear-failed') logger.warn(`[LLM] Failed to clear KV cache after ${label}:`, detail);
      else logger.log(`[LLM] KV cache cleared after native error in ${label}`);
    },
  });
}
