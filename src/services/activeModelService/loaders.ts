/**
 * Low-level load/unload helpers for ActiveModelService.
 * Extracted to keep index.ts under the max-lines limit.
 */

import { useAppStore } from '../../stores';
import { useDebugLogsStore } from '../../stores/debugLogsStore';
import { DownloadedModel, ONNXImageModel, INFERENCE_BACKENDS } from '../../types';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { modelManager } from '../modelManager';
import logger from '../../utils/logger';
import RNFS from 'react-native-fs';

// ---------------------------------------------------------------------------
// mmproj path resolver
// ---------------------------------------------------------------------------

function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gguf')) return false;
  return (
    lower.includes('mmproj') ||
    lower.includes('projector') ||
    // LLaVA/InternVL-style CLIP vision encoder projectors, e.g.
    // "mmproj-model-f16-clip-vit-large-patch14-336.gguf"
    (lower.includes('clip') && lower.includes('vit'))
  );
}

async function scanDirForMmProj(modelFilePath: string): Promise<RNFS.ReadDirItem | undefined> {
  const modelDir = modelFilePath.substring(0, modelFilePath.lastIndexOf('/'));
  const files = await RNFS.readDir(modelDir);
  return files.find((f: { name: string; isFile: () => boolean }) =>
    f.isFile() && isMMProjFile(f.name),
  );
}

export async function resolveMmProjPath(
  model: DownloadedModel,
  modelId: string,
): Promise<string | undefined> {
  // Fast path: persisted mmProjPath still exists on disk
  if (model.mmProjPath) {
    if (await RNFS.exists(model.mmProjPath)) {
      return model.mmProjPath;
    }
    // Path is stale — fall through to directory scan
  }

  // Scan the model directory for any mmproj file regardless of model name.
  // Previous code only scanned for models whose name contained "vl"/"vision"/
  // "smolvlm", which silently broke vision for models like llava, pixtral,
  // moondream, internvl, minicpm, etc.
  try {
    const mmProjFile = await scanDirForMmProj(model.filePath);
    if (!mmProjFile) {
      return undefined;
    }

    const { downloadedModels, setDownloadedModels } = useAppStore.getState();
    const updatedModels = downloadedModels.map(m => {
      if (m.id !== modelId) {
        return m;
      }
      return {
        ...m,
        mmProjPath: mmProjFile.path,
        mmProjFileName: mmProjFile.name,
        mmProjFileSize:
          typeof mmProjFile.size === 'string'
            ? Number.parseInt(mmProjFile.size, 10)
            : mmProjFile.size,
        isVisionModel: true,
      };
    });
    setDownloadedModels(updatedModels);
    await modelManager.saveModelWithMmproj(modelId, mmProjFile.path);
    return mmProjFile.path;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Text model loader
// ---------------------------------------------------------------------------

export interface TextLoadContext {
  model: DownloadedModel;
  modelId: string;
  store: ReturnType<typeof useAppStore.getState>;
  timeoutMs: number;
  loadedTextModelId: string | null;
  onLoaded: (modelId: string) => void;
  onError: () => void;
  onFinally: () => void;
}

function inferenceBackendToLiteRT(backend: string | undefined): 'cpu' | 'gpu' | 'npu' {
  switch (backend) {
    case INFERENCE_BACKENDS.HTP:    return 'npu';
    case INFERENCE_BACKENDS.OPENCL: return 'gpu';
    case INFERENCE_BACKENDS.METAL:  return 'gpu';
    default:                        return 'cpu';
  }
}

async function doLoadLiteRTModel(ctx: TextLoadContext): Promise<void> {
  const addDebugLog = useDebugLogsStore.getState().addLog;
  try {
    addDebugLog('log', `[LiteRT] Starting model load: ${ctx.model.fileName}`);

    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      addDebugLog('log', '[LiteRT] Unloading previous LiteRT model before load.');
      try {
        await liteRTService.unloadModel();
      } catch (unloadErr) {
        logger.warn('[LiteRT] Error unloading previous model, continuing:', unloadErr);
        addDebugLog('warn', `[LiteRT] Previous model unload warning: ${String(unloadErr)}`);
      }
      ctx.onError();
    }

    const preferredBackend = inferenceBackendToLiteRT(ctx.store.settings.inferenceBackend);
    addDebugLog('log', `[LiteRT] Preferred backend: ${preferredBackend}`);

    const maxTokens = ctx.store.settings.contextLength ?? 4096;
    const contextScalar = Math.max(1, maxTokens / 4096);
    const baseTimeoutMs = preferredBackend === 'npu' ? 45_000
                        : preferredBackend === 'gpu' ? 20_000
                        : 15_000;
    const timeoutMs = Math.min(Math.ceil(baseTimeoutMs * contextScalar), 180_000);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`LiteRT model load timed out after ${timeoutMs / 1000}s.`)),
        timeoutMs,
      );
    });

    try {
      addDebugLog('log', `[LiteRT] Calling liteRTService.loadModel (timeout ${timeoutMs / 1000}s, vision=${ctx.model.liteRTVision ?? false}, maxNumTokens=${maxTokens}).`);
      await Promise.race([
        liteRTService.loadModel(ctx.model.filePath, preferredBackend, { supportsVision: ctx.model.liteRTVision ?? false, maxNumTokens: maxTokens }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    const actualBackend = liteRTService.getActiveBackend();
    addDebugLog('log', `[LiteRT] Load complete — actual backend: ${actualBackend}`);
    if (actualBackend !== preferredBackend) {
      addDebugLog('warn', `[LiteRT] Requested ${preferredBackend}, fell back to ${actualBackend}`);
    }

    // Warmup on GPU/NPU only — primes shader/kernel caches so first real prompt runs at full speed
    if (actualBackend === 'gpu' || actualBackend === 'npu') {
      addDebugLog('log', `[LiteRT] Starting warmup on ${actualBackend}...`);
      const warmupStart = Date.now();
      await liteRTService.warmup();
      addDebugLog('log', `[LiteRT] Warmup complete in ${((Date.now() - warmupStart) / 1000).toFixed(1)}s`);
    }

    // Snapshot the settings that require a full engine reload so the pending-settings
    // banner appears if the user changes them while the model is loaded.
    ctx.store.setLoadedSettings({
      inferenceBackend: ctx.store.settings.inferenceBackend,
      contextLength: maxTokens,
      // Fields not used by LiteRT — set to current values so llama checks don't misfire
      enableGpu: ctx.store.settings.enableGpu,
      gpuLayers: ctx.store.settings.gpuLayers,
      nThreads: ctx.store.settings.nThreads,
      nBatch: ctx.store.settings.nBatch,
      flashAttn: ctx.store.settings.flashAttn,
      cacheType: ctx.store.settings.cacheType,
    });

    ctx.onLoaded(ctx.modelId);
    ctx.store.setActiveModelId(ctx.modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDebugLog('error', `[LiteRT] Model load failed: ${message}`);
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}

export async function doLoadTextModel(ctx: TextLoadContext): Promise<void> {
  // Route LiteRT models to the LiteRT loader — existing llama path is untouched below
  if (ctx.model.engine === 'litert') {
    return doLoadLiteRTModel(ctx);
  }

  const addDebugLog = useDebugLogsStore.getState().addLog;
  try {
    addDebugLog('log', `[Reload] Starting text model load: ${ctx.model.fileName}`);
    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      addDebugLog('log', '[Reload] Unloading previous text model before load.');
      try {
        await llmService.unloadModel();
      } catch (unloadErr) {
        // Log but continue — loadModel will also attempt to release the old context
        logger.warn('[ActiveModel] Error unloading previous model, continuing:', unloadErr);
        addDebugLog('warn', `[Reload] Previous model unload warning: ${String(unloadErr)}`);
      }
      ctx.onError(); // resets loadedTextModelId to null before reassignment
    }

    const mmProjPath = await resolveMmProjPath(ctx.model, ctx.modelId);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new Error(
              `Text model loading timed out after ${ctx.timeoutMs / 1000}s. ` +
                'Try a smaller model or reduce context length in settings.',
            ),
          ),
        ctx.timeoutMs,
      );
    });

    try {
      addDebugLog('log', `[Reload] Calling llmService.loadModel (timeout ${ctx.timeoutMs / 1000}s).`);
      await Promise.race([
        llmService.loadModel(ctx.model.filePath, mmProjPath),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    const multimodalSupport = llmService.getMultimodalSupport();

    // If the model had a pre-existing stored mmproj link but the native layer rejected it
    // (incompatible file), clear it so the eye icon reappears for repair.
    // Only applies when the link was already persisted before this load attempt — not
    // when resolveMmProjPath just discovered the file via directory scan.
    if (ctx.model.mmProjPath && !multimodalSupport?.vision) {
      await modelManager.clearMmProjLink(ctx.modelId);
    }

    // Capture settings that require model reload
    const { settings } = ctx.store;
    const reloadSettings = {
      enableGpu: settings.enableGpu,
      inferenceBackend: settings.inferenceBackend,
      gpuLayers: settings.gpuLayers,
      nThreads: settings.nThreads,
      nBatch: settings.nBatch,
      contextLength: settings.contextLength,
      flashAttn: settings.flashAttn,
      // Store the effective cache type (f16 may be forced for OpenCL) so the
      // banner doesn't show a false mismatch when the user setting differs.
      cacheType: settings.inferenceBackend === INFERENCE_BACKENDS.OPENCL ? 'f16' : settings.cacheType,
    };
    ctx.store.setLoadedSettings(reloadSettings);

    ctx.onLoaded(ctx.modelId);
    ctx.store.setActiveModelId(ctx.modelId);
    addDebugLog('log', `[Reload] Text model load complete: ${ctx.model.fileName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDebugLog('error', `[Reload] Text model load failed: ${message}`);
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}

// ---------------------------------------------------------------------------
// Image model loader
// ---------------------------------------------------------------------------

export interface ImageLoadContext {
  model: ONNXImageModel;
  modelId: string;
  imageThreads: number;
  needsThreadReload: boolean;
  cpuOnly: boolean;
  store: ReturnType<typeof useAppStore.getState>;
  timeoutMs: number;
  loadedImageModelId: string | null;
  onLoaded: (modelId: string, threads: number) => void;
  onError: () => void;
  onFinally: () => void;
}

export async function doLoadImageModel(ctx: ImageLoadContext): Promise<void> {
  try {
    if (
      ctx.loadedImageModelId &&
      (ctx.loadedImageModelId !== ctx.modelId || ctx.needsThreadReload)
    ) {
      await onnxImageGeneratorService.unloadModel();
      ctx.onError(); // resets loadedImageModelId/threads to null
    }

    let imgTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      imgTimeoutId = setTimeout(
        () => reject(new Error('Image model loading timed out')),
        ctx.timeoutMs,
      );
    });

    try {
      await Promise.race([
        onnxImageGeneratorService.loadModel(
          ctx.model.modelPath,
          ctx.imageThreads,
          {
            backend: 'auto',
            cpuOnly: ctx.cpuOnly,
            attentionVariant: ctx.model.attentionVariant,
          },
        ),
        timeoutPromise,
      ]);
    } finally {
      if (imgTimeoutId !== null) clearTimeout(imgTimeoutId);
    }

    ctx.onLoaded(ctx.modelId, ctx.imageThreads);
    ctx.store.setActiveImageModelId(ctx.modelId);
  } catch (error) {
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}
