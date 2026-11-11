/**
 * "Find the best settings for this device": loads the model a few ways (automatic acceleration, and the
 * CPU with a few thread counts), times a short reply each way, and keeps the fastest. Hand-testing on
 * the onn tablet showed the best thread count and the GPU/CPU choice differ a lot between devices
 * (CPU with 4 threads 4.5 tok/s, 8 threads 2.1, Vulkan about 2), so this measures instead of guessing.
 * The pure choices (candidates, the winner) are tested without a device.
 */
import { useAppStore } from '../stores/appStore';
import { INFERENCE_BACKENDS, type InferenceBackend } from '../types';
import { hardwareService } from './hardware';
import { llmService } from './llm';
import { activeModelService } from './activeModelService';
import { useSpeedStats, useTuned } from '../atlasTools/speed';
import logger from '../utils/logger';

export interface TuneOption { id: string; label: string; backend: InferenceBackend; threads: number }
export interface TuneResult { option: TuneOption; tps: number; firstWordSec: number; error?: string }

/**
 * What to try: automatic acceleration, then the CPU with the recommended thread count, fewer threads
 * and a couple more. Fewer threads often win (the slow cores drag the pool), more rarely do.
 */
export function tuneOptions(cores: number, recommended: number): TuneOption[] {
  const rec = Math.max(1, Math.min(recommended, cores));
  const cpu = (threads: number): TuneOption => ({ id: `cpu-${threads}`, label: `CPU, ${threads} threads`, backend: INFERENCE_BACKENDS.CPU, threads });
  const counts = [...new Set([rec, Math.max(2, Math.round(rec * 0.67)), Math.min(cores, rec + 2)])].filter((n) => n >= 1 && n <= cores);
  return [
    { id: 'auto', label: 'Automatic (GPU or NPU if the phone has one)', backend: INFERENCE_BACKENDS.AUTO, threads: rec },
    ...counts.map(cpu),
  ];
}

/** The fastest result; when two are within 5%, the one with fewer threads (cooler and kinder to the battery). */
export function pickBest(results: TuneResult[]): TuneResult | null {
  const ok = results.filter((r) => !r.error && r.tps > 0);
  if (!ok.length) return null;
  const top = Math.max(...ok.map((r) => r.tps));
  return ok.filter((r) => r.tps >= top * 0.95).sort((a, b) => a.option.threads - b.option.threads || b.tps - a.tps)[0];
}

export interface TuneProgress { step: number; steps: number; label: string; results: TuneResult[] }
export interface TuneOutcome { best: TuneResult | null; results: TuneResult[]; applied: boolean; cancelled: boolean }

let cancelFlag = false;
export const cancelTuning = () => { cancelFlag = true; };

const PROMPT = 'Write one short paragraph (about 50 words) about rivers. No title.';

/** Runs every option on the model, then applies the fastest (or puts the old settings back if cancelled / nothing worked). */
export async function tuneDevice(modelId: string, onProgress: (p: TuneProgress) => void): Promise<TuneOutcome> {
  cancelFlag = false;
  const store = useAppStore.getState();
  const model = store.downloadedModels.find((m) => m.id === modelId);
  if (!model || model.engine !== 'llama') throw new Error('Pick a downloaded GGUF text model to tune.');
  if (llmService.isCurrentlyGenerating()) throw new Error('A chat answer is still being written. Wait for it to finish, then try again.');
  const old = { inferenceBackend: store.settings.inferenceBackend, nThreads: store.settings.nThreads, backendUserChosen: store.settings.backendUserChosen };
  const [cores, recommended] = await Promise.all([hardwareService.getCpuCoreCount(), hardwareService.getRecommendedThreadCount()]);
  const options = tuneOptions(cores, recommended);
  const results: TuneResult[] = [];
  const restore = () => useAppStore.getState().updateSettings(old as any);

  try {
    for (const [i, option] of options.entries()) {
      if (cancelFlag) break;
      onProgress({ step: i + 1, steps: options.length, label: option.label, results: [...results] });
      useAppStore.getState().updateSettings({ inferenceBackend: option.backend, nThreads: option.threads, backendUserChosen: true } as any);
      try {
        // A fresh load each time: threads and acceleration are fixed when the model loads.
        await activeModelService.unloadTextModel(true);
        await activeModelService.loadTextModel(modelId);
        await llmService.generateResponse([{ id: 'u', role: 'user', content: PROMPT, timestamp: 0 }], { disableThinking: true });
        const st = llmService.getPerformanceStats();
        results.push({ option, tps: st.lastDecodeTokensPerSecond || st.lastTokensPerSecond || 0, firstWordSec: (st.lastTimeToFirstToken || 0) / 1000 });
      } catch (e: any) {
        logger.warn(`[TUNE] ${option.id} failed: ${e?.message || e}`);
        results.push({ option, tps: 0, firstWordSec: 0, error: String(e?.message || e) });
      }
    }
  } finally {
    // Whatever happens, the settings end as the best one (below) or as they were.
    restore();
  }
  const best = cancelFlag ? null : pickBest(results);
  if (best) {
    useAppStore.getState().updateSettings({ inferenceBackend: best.option.backend, nThreads: best.option.threads, backendUserChosen: true } as any);
    useTuned.getState().mark(modelId);
    // The speeds measured with the other options are not how this model runs now: store the winner's.
    useSpeedStats.setState((st) => ({ byModel: { ...st.byModel, [modelId]: { ...(st.byModel[modelId] ?? { prefill: 0, outLen: 0, samples: 1 }), decode: best.tps } } }));
    // Load it the way it was just measured, so the next chat starts at the winning speed.
    try { await activeModelService.unloadTextModel(true); await activeModelService.loadTextModel(modelId); } catch { /* the chat reloads it on demand */ }
  }
  return { best, results, applied: !!best, cancelled: cancelFlag };
}

