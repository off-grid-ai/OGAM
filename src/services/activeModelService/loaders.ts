/**
 * Low-level load/unload helpers for ActiveModelService.
 * Extracted to keep index.ts under the max-lines limit.
 */

import { Platform, ToastAndroid } from 'react-native';
import { useAppStore } from '../../stores';
import { DownloadedModel, LlamaDownloadedModel, ONNXImageModel, INFERENCE_BACKENDS } from '../../types';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { modelManager } from '../modelManager';
import logger from '../../utils/logger';
import RNFS from 'react-native-fs';

function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gguf')) return false;
  return (
    lower.includes('mmproj') ||
    lower.includes('projector') ||
    (lower.includes('clip') && lower.includes('vit'))
  );
}

async function scanDirForMmProj(modelFilePath: string): Promise<RNFS.ReadDirResItemT | undefined> {
  const modelDir = modelFilePath.substring(0, modelFilePath.lastIndexOf('/'));
  const files = await RNFS.readDir(modelDir);
  return files.find((f: { name: string; isFile: () => boolean }) =>
    f.isFile() && isMMProjFile(f.name),
  );
}

export async function resolveMmProjPath(
  model: LlamaDownloadedModel,
  modelId: string,
): Promise<string | undefined> {
  // Fast path: persisted mmProjPath still exists on disk
  if (model.mmProjPath) {
    if (await RNFS.exists(model.mmProjPath)) {
      return model.mmProjPath;
    }
  }

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

async function doLoadLiteRTModel(ctx: TextLoadContext): Promise<void> {
  if (ctx.model.engine !== 'litert') {
    throw new Error('doLoadLiteRTModel called with non-LiteRT model');
  }
  const liteRTModel = ctx.model;
  try {
    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      try {
        await liteRTService.unloadModel();
      } catch (unloadErr) {
        logger.warn('[LiteRT] Error unloading previous model, continuing:', unloadErr);
      }
      ctx.onError();
    }

    const preferredBackend = ctx.store.settings.liteRTBackend;

    const maxTokens = ctx.store.settings.liteRTMaxTokens ?? 4096;
    const contextScalar = Math.max(1, maxTokens / 4096);
    const baseTimeoutMs = 90_000;
    const timeoutMs = Math.min(Math.ceil(baseTimeoutMs * contextScalar), 180_000);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`LiteRT model load timed out after ${timeoutMs / 1000}s.`)),
        timeoutMs,
      );
    });

    try {
      await Promise.race([
        liteRTService.loadModel(ctx.model.filePath, preferredBackend, { supportsVision: liteRTModel.liteRTVision ?? false, supportsAudio: liteRTModel.liteRTAudio ?? false, maxNumTokens: maxTokens }),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    const actualBackend = liteRTService.getActiveBackend();
    if (actualBackend !== preferredBackend) {
      if (preferredBackend === 'gpu' && actualBackend === 'cpu' && maxTokens > 8192 && Platform.OS === 'android') {
        ToastAndroid.showWithGravity(
          `GPU unavailable at ${maxTokens.toLocaleString()} token context. Running on CPU — reduce context length to use GPU.`,
          ToastAndroid.LONG,
          ToastAndroid.BOTTOM,
        );
      }
    }

    // Warmup on GPU/NPU only — primes shader/kernel caches so first real prompt runs at full speed
    if (actualBackend === 'gpu' || actualBackend === 'npu') {
      await liteRTService.warmup();
    }

    // Snapshot the settings that require a full engine reload so the pending-settings
    // banner appears if the user changes them while the model is loaded.
    ctx.store.setLoadedSettings({
      liteRTBackend: ctx.store.settings.liteRTBackend,
      liteRTMaxTokens: maxTokens,
      // Fields not used by LiteRT — set to current values so llama checks don't misfire
      contextLength: ctx.store.settings.contextLength,
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

  try {
    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      try {
        await llmService.unloadModel();
      } catch (unloadErr) {
        // Log but continue — loadModel will also attempt to release the old context
        logger.warn('[ActiveModel] Error unloading previous model, continuing:', unloadErr);
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
  } catch (error) {
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
