import { initLlama, type LlamaContext } from 'llama.rn';
import type { NativeLoadService } from '@offgrid/models';
import logger from '../../../utils/logger';
import { recentNativeLog } from '../../llmNativeLog';

/** Release a context, reporting (never hiding) an error raised during fallback cleanup. */
async function safeRelease(context: LlamaContext | null): Promise<void> {
  if (!context) return;
  try {
    await context.release();
  } catch (error) {
    logger.warn('[LLM] Error releasing context during fallback:', error);
  }
}

/** llama.rn init/release and log capture. Shared owns the fallback ladder. */
export function mobileNativeLoadPorts(): ConstructorParameters<typeof NativeLoadService<LlamaContext>>[0] {
  return {
    initialize: input => initLlama({
      ...input.params,
      n_ctx: input.contextLength,
      n_gpu_layers: input.gpuLayers,
    } as any),
    release: context => safeRelease(context),
    nativeFailureDetail: recentNativeLog,
    reportAttempt: attempt => logger.log(
      `[LLM] ${attempt.kind}: ${attempt.backend} init (ctx=${attempt.contextLength}, gpu_layers=${attempt.gpuLayers})`,
    ),
    reportFailure: (attempt, error: any) => logger.warn(
      `[LLM] ${attempt.kind} failed (${attempt.backend}, ctx=${attempt.contextLength}): ${error?.message || String(error)}`,
    ),
  };
}
