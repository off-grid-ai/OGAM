import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import {
  MOBILE_BACKEND_ROWS,
  MOBILE_DEVICE_ROWS,
  classifyMobileDevice,
  fastestBenchedBackend,
  planMobileFastestSettings,
  type BackendBenchResult,
  type MobileBackend,
  type MobileDevice,
} from '@offgrid/models';
import logger from '../utils/logger';
import { useAppStore } from '../stores/appStore';
import type { InferenceBackend } from '../types';
import { hardwareService } from './hardware';
import { buildModelParams } from './llmHelpers';
import { readModelFileType } from './modelHeader';
import { modelResidencyManager } from './modelResidency';
import { activeModelService } from './activeModelService';

/**
 * "Use fastest settings" on a phone: gather the device facts, measure each backend the device
 * class may run, and write the shared table's answer into settings. The rules live in
 * @offgrid/models (planMobileFastestSettings); this is the IO around them.
 */

/** The whole benchmark stops after this long; a backend not reached by then counts as failed. */
const BENCHMARK_BUDGET_MS = 30_000;
/** A short prompt read and a short generation: enough to rank backends, cheap enough to repeat. */
const BENCH_PROMPT_TOKENS = 64;
const BENCH_GENERATED_TOKENS = 16;
const BENCH_CONTEXT = 512;

async function readMobileDevice(): Promise<MobileDevice> {
  const [info, acceleration] = await Promise.all([
    hardwareService.getDeviceInfo(),
    hardwareService.getAccelerationCapability(),
  ]);
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    totalRamGb: info.totalMemory / 1024 ** 3,
    hasNpu: acceleration.hasNpu,
    // After the Mali fix, the OpenCL capability means an Adreno GPU.
    hasAdreno: acceleration.hasGpu,
  };
}

/** Settles with the promise, or rejects at the deadline or on Cancel, whichever comes first. */
function withDeadline<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void = () => {};
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`benchmark step timed out after ${ms}ms`)), ms);
    onAbort = () => reject(new Error('benchmark cancelled'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);
  });
  return Promise.race([promise, stop]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
}

/** Load the model on one backend, measure generation speed, release it. Null on any failure. */
async function benchOne(modelPath: string, backend: MobileBackend, fileType: number | null, remainingMs: number, signal?: AbortSignal): Promise<number | null> {
  const { baseParams } = buildModelParams(
    modelPath,
    { inferenceBackend: backend, nThreads: await hardwareService.getRecommendedThreadCount(), contextLength: BENCH_CONTEXT },
    { fileType },
  );
  const params = {
    ...baseParams,
    n_ctx: BENCH_CONTEXT,
    n_gpu_layers: backend === 'cpu' ? 0 : 99,
    ...(backend === 'htp' ? { devices: ['HTP0'] } : {}),
  };
  const started = Date.now();
  const contextPromise = initLlama(params as Parameters<typeof initLlama>[0]);
  let context: LlamaContext | null = null;
  try {
    context = await withDeadline(contextPromise, remainingMs, signal);
    const result = await withDeadline(
      context.bench(BENCH_PROMPT_TOKENS, BENCH_GENERATED_TOKENS, 1, 1),
      Math.max(1, remainingMs - (Date.now() - started)),
      signal,
    );
    // A backend that silently fell back to the CPU did not run where we asked.
    if (backend !== 'cpu' && result.nGpuLayers <= 0) return null;
    return result.speedTg;
  } catch (error) {
    logger.warn(`[SPEED] ${backend} benchmark failed:`, error);
    // A load still in flight after the deadline is released when it lands.
    if (!context) contextPromise.then(late => late.release()).catch(() => {});
    return null;
  } finally {
    if (context) await context.release().catch(() => {});
  }
}

/**
 * Measure each backend the device class may run, within the budget. The text model is unloaded
 * first and the measuring runs under the residency lock, so no other load can overlap it.
 */
async function benchmarkBackends(
  modelPath: string,
  backends: readonly MobileBackend[],
  signal?: AbortSignal,
  budgetMs: number = BENCHMARK_BUDGET_MS,
): Promise<BackendBenchResult[]> {
  await activeModelService.unloadTextModel(true);
  return modelResidencyManager.runExclusive('benchmark:backends', async () => {
    const fileType = await readModelFileType(modelPath);
    const deadline = Date.now() + budgetMs;
    const results: BackendBenchResult[] = [];
    for (const backend of backends) {
      const remaining = deadline - Date.now();
      if (signal?.aborted || remaining <= 0) {
        results.push({ backend, tokensPerSecond: null });
        continue;
      }
      const tokensPerSecond = await benchOne(modelPath, backend, fileType, remaining, signal);
      const measured = tokensPerSecond === null ? 'failed' : `${tokensPerSecond.toFixed(1)} tok/s`;
      logger.log(`[SPEED] ${backend}: ${measured}`);
      results.push({ backend, tokensPerSecond });
    }
    return results;
  });
}

export interface FastestSettingsOutcome {
  backend: MobileBackend;
  /** False when the run was cancelled: nothing was written. */
  applied: boolean;
}

/**
 * Apply the fastest settings. When a model file is given and the device has more than one backend
 * to choose from, the backends are measured first. Writes every setting the table owns; the person
 * can change any of them afterwards, and a later run is again their own explicit choice.
 */
export async function applyFastestSettings(opts: { modelPath?: string; signal?: AbortSignal } = {}): Promise<FastestSettingsOutcome> {
  const device = await readMobileDevice();
  const row = MOBILE_DEVICE_ROWS[classifyMobileDevice(device)];
  let benched: MobileBackend | null = useAppStore.getState().speedBenchmarkBackend ?? null;
  if (opts.modelPath && row.benchBackends.length > 1) {
    const results = await benchmarkBackends(opts.modelPath, row.benchBackends, opts.signal);
    if (opts.signal?.aborted) return { backend: row.defaultBackend, applied: false };
    benched = fastestBenchedBackend(results, row.defaultBackend);
    useAppStore.getState().setSpeedBenchmarkBackend(benched as InferenceBackend);
  }
  const plan = planMobileFastestSettings({
    device,
    coreValues: [],
    freeRamMb: 0,
    modelFileType: null,
    benchedBackend: benched,
  });
  useAppStore.getState().updateSettings({
    inferenceBackend: plan.backend as InferenceBackend,
    // Threads and batch stay automatic: the load path resolves them from the same table.
    nThreads: 0,
    nBatch: 0,
    // A guarded backend (HTP, OpenCL) forces flash attention off and f16 at load; keep the stored
    // preference as it is so a later switch to the CPU still gets the fast defaults.
    ...(MOBILE_BACKEND_ROWS[plan.backend].quantizedKv ? { flashAttn: plan.flashAttn, cacheType: plan.kvCacheType } : {}),
    speculativeDecoding: plan.mtp,
    speculativeDraftMax: plan.mtpDraftTokens,
  });
  logger.log(`[SPEED] fastest settings applied: backend=${plan.backend}`);
  return { backend: plan.backend, applied: true };
}
