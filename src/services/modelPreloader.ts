/**
 * Boot-time model preloader.
 *
 * Warms the user's selected models in priority order — text → TTS → STT — so the
 * common paths are hot with no cold-start wait. The IMAGE model is deliberately
 * NOT preloaded: it's the heaviest model (large diffusion working set) and is
 * mutually exclusive with the text model in residency, so warming it at boot
 * would either evict text or push memory into swap. It loads on demand the first
 * time an image is requested. Each model loads only if it fits the residency
 * budget WITHOUT evicting a higher-priority model already warmed. Loads run
 * sequentially (one native load at a time) so the UI stays responsive.
 */
import { useAppStore, useWhisperStore } from '../stores';
import { activeModelService } from './activeModelService';
import { hardwareService } from './hardware';
import { WHISPER_MODELS } from './whisperService';
import { modelResidencyManager } from './modelResidency';
import { generationService } from './generationService';
import { imageGenerationService } from './imageGenerationService';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';

let started = false;
let aborted = false;

/**
 * Stop background warming because the user did something that needs the device
 * NOW (e.g. sent a message). Warming is the lowest-priority work — it must yield
 * to the user, never make them wait behind it. Already-running native loads
 * can't be interrupted, but no further models are warmed once this is called.
 */
export function abortPreload(): void {
  aborted = true;
}

/** A generation (text or image) holds the device — never warm a model behind it. */
function isGenerationActive(): boolean {
  return (
    generationService.getState().isGenerating ||
    imageGenerationService.getState().isGenerating
  );
}

const toMB = (bytes: number) => Math.round(bytes / (1024 * 1024));

async function preloadText(): Promise<void> {
  const { activeModelId, lastTextModelId, downloadedModels } = useAppStore.getState();
  const id = activeModelId ?? lastTextModelId;
  if (!id || activeModelService.getActiveModels().text.isLoaded) return;
  const model = downloadedModels.find(m => m.id === id);
  if (!model) return;
  const sizeMB = toMB(hardwareService.estimateModelRam(model));
  if (!modelResidencyManager.canLoadWithoutEviction({ key: 'text', sizeMB })) return;
  await activeModelService.loadTextModel(id);
}

async function preloadTts(): Promise<void> {
  // Pro implements the audio.preload hook (fits-gated + registers the engine);
  // no-op in free builds.
  const pending = callHook<Promise<void>>(HOOKS.audioPreload);
  if (pending) await pending;
}

async function preloadStt(): Promise<void> {
  const whisper = useWhisperStore.getState();
  if (!whisper.downloadedModelId || whisper.isModelLoaded) return;
  const sizeMB = WHISPER_MODELS.find(m => m.id === whisper.downloadedModelId)?.size ?? 200;
  if (!modelResidencyManager.canLoadWithoutEviction({ key: 'whisper', sizeMB })) return;
  await whisper.loadModel();
}

/** Warm selected models in priority order. Safe to call once at app launch. */
export async function preloadSelectedModels(): Promise<void> {
  if (started) return;
  started = true;
  // Image is intentionally excluded — it loads on demand (see file header).
  const steps: Array<[string, () => Promise<void>]> = [
    ['text', preloadText],
    ['tts', preloadTts],
    ['stt', preloadStt],
  ];
  for (const [, step] of steps) {
    // Yield to the user: stop warming the moment they send a message (abort) or a
    // generation is running — they must never wait behind background warming.
    if (aborted) {
      break;
    }
    if (isGenerationActive()) {
      break;
    }
    try {
      await step();
    } catch {
      // ignore — a failed warm is non-fatal; continue with remaining steps
    }
  }
}

/** Test helper. */
export function _resetPreloaderForTesting(): void {
  started = false;
  aborted = false;
}
