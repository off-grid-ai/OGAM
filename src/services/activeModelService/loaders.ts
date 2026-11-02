/**
 * Low-level load/unload helpers for ActiveModelService.
 * Extracted to keep index.ts under the max-lines limit.
 */

import { Platform, ToastAndroid } from 'react-native';
import { useAppStore } from '../../stores';
import { DownloadedModel, LlamaDownloadedModel, ONNXImageModel, INFERENCE_BACKENDS } from '../../types';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { unloadAllTextEngines } from '../engines';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { modelManager } from '../modelManager';
import { hardwareService } from '../hardware';
import { modelResidencyManager } from '../modelResidency';
import logger from '../../utils/logger';
import { beginLoad, loadWorked, loadFailed } from '../../atlasTools/ctxGuard';
import RNFS from 'react-native-fs';
import { isMMProjFile, mmProjBelongsToModel, pickMmProjForModel } from '../mmproj';

async function scanDirForMmProj(modelFilePath: string): Promise<RNFS.ReadDirResItemT | undefined> {
  const modelDir = modelFilePath.substring(0, modelFilePath.lastIndexOf('/'));
  const modelName = modelFilePath.substring(modelFilePath.lastIndexOf('/') + 1);
  const files = await RNFS.readDir(modelDir);
  const mmProjFiles = files.filter((f: { name: string; isFile: () => boolean }) => f.isFile() && isMMProjFile(f.name));
  const chosen = pickMmProjForModel(modelName, mmProjFiles.map(f => f.name));
  return mmProjFiles.find(f => f.name === chosen);
}

export async function resolveMmProjPath(
  model: LlamaDownloadedModel,
  modelId: string,
): Promise<string | undefined> {
  // Fast path: a persisted mmProjPath that still exists AND actually belongs to this model. The old
  // first-match scan could persist a MISMATCHED projector (E2B model → E4B mmproj); without the belongs-to
  // check the fast path would keep returning that stale wrong path forever, so the vision fix never lands on
  // an already-broken install. Validate the stem and re-scan (self-heal) when it doesn't match.
  if (model.mmProjPath && (await RNFS.exists(model.mmProjPath))) {
    const persistedName = model.mmProjPath.substring(model.mmProjPath.lastIndexOf('/') + 1);
    const modelName = model.filePath.substring(model.filePath.lastIndexOf('/') + 1);
    if ((model as any).mmProjManual || modelId.startsWith('local_import/') || mmProjBelongsToModel(modelName, persistedName)) {
      return model.mmProjPath;
    }
    logger.warn(`[LLM] persisted mmproj "${persistedName}" does not belong to model "${modelName}" — rescanning`);
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
  /** User forced this load ("Load Anyway"/continue) — skip the conservative native
   *  memory gate so the loader's own fallbacks try instead of a hard block. */
  override?: boolean;
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
      await unloadAllTextEngines(); // cross-engine switch → no co-residence (engine set owned by engines.ts)
      ctx.onError();
    }

    const preferredBackend = ctx.store.settings.liteRTBackend;

    await beginLoad('litert', ctx.modelId);
    const maxTokens = useAppStore.getState().settings.liteRTMaxTokens ?? 4096;
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
    // Snapshot the RAW setting the banner compares against, NOT the normalized `maxTokens`
    // (`settings.liteRTMaxTokens ?? 4096`): the banner checks `settings.liteRTMaxTokens
    // !== loadedSettings.liteRTMaxTokens`, so if the setting is undefined here we'd store
    // 4096 and it would never equal undefined — a false mismatch that pops the banner the
    // instant a LiteRT model loads, with nothing actually changed.
    ctx.store.setLoadedSettings({
      liteRTBackend: ctx.store.settings.liteRTBackend,
      liteRTMaxTokens: useAppStore.getState().settings.liteRTMaxTokens,
      // Fields not used by LiteRT — set to current values so llama checks don't misfire
      contextLength: ctx.store.settings.contextLength,
      enableGpu: ctx.store.settings.enableGpu,
      gpuLayers: ctx.store.settings.gpuLayers,
      nThreads: ctx.store.settings.nThreads,
      nBatch: ctx.store.settings.nBatch,
      flashAttn: ctx.store.settings.flashAttn,
      cacheType: ctx.store.settings.cacheType,
    });

    await loadWorked('litert', ctx.modelId);
    ctx.onLoaded(ctx.modelId);
    ctx.store.setActiveModelId(ctx.modelId);
  } catch (error) {
    ctx.onError();
    // Preserve selection on failed load; a retry after correcting backend settings
    // must not require re-selecting the model or hide the chat composer.
    throw error;
  } finally {
    ctx.onFinally();
  }
}

/** Atlas: if a bigger memory size (context) broke the load, go back to the last size that worked and try once more. */
export async function doLoadTextModel(ctx: TextLoadContext): Promise<void> {
  const engine = ctx.model.engine === 'litert' ? 'litert' : 'llama';
  try {
    return await (engine === 'litert' ? doLoadLiteRTModel(ctx) : doLoadTextModelOnce(ctx));
  } catch (error) {
    const back = await loadFailed(engine, ctx.modelId);
    if (back === null) throw error;
    return engine === 'litert' ? doLoadLiteRTModel(ctx) : doLoadTextModelOnce(ctx);
  }
}

async function doLoadTextModelOnce(ctx: TextLoadContext): Promise<void> {
  if (ctx.model.engine === 'litert') return doLoadLiteRTModel(ctx); // (narrows the type below)

  try {
    if (ctx.loadedTextModelId && ctx.loadedTextModelId !== ctx.modelId) {
      await unloadAllTextEngines(); // cross-engine switch → no co-residence (engine set owned by engines.ts)
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

    await beginLoad('llama', ctx.modelId);
    try {
      await Promise.race([
        llmService.loadModel(ctx.model.filePath, mmProjPath, { override: ctx.override, draftPath: ctx.model.engine === 'llama' ? ctx.model.draftPath : undefined, embeddedMtp: ctx.model.engine === 'llama' && !!ctx.model.embeddedMtp }),
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
    // The Vulkan engine is text only by design, so it reports no picture support for a model whose
    // picture file is fine: leave the link in place for the engines that can use it.
    const onVulkan = /vulkan/i.test(llmService.getGpuInfo?.()?.gpuBackend ?? '');
    if (ctx.model.mmProjPath && !multimodalSupport?.vision && !onVulkan) {
      await modelManager.clearMmProjLink(ctx.modelId);
    }

    await loadWorked('llama', ctx.modelId);
    // Capture settings that require model reload (read fresh: the memory-size guard may have changed them)
    const settings = useAppStore.getState().settings;
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
    // Preserve selection on failed load; a retry after correcting backend settings
    // must not require re-selecting the model or hide the chat composer.
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
  /** iOS Core ML: prefer the GPU over the Neural Engine (chosen by RAM tier). */
  preferGpu: boolean;
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
            backend: ctx.model.backend === 'sdcpp' ? 'sdcpp' : (ctx.cpuOnly ? 'mnn' : (ctx.model.backend === 'mnn' || ctx.model.backend === 'qnn' ? ctx.model.backend : 'auto')),
            cpuOnly: ctx.cpuOnly,
            attentionVariant: ctx.model.attentionVariant,
            preferGpu: ctx.preferGpu,
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
    // If the outer JS timeout/error wins a race with native startup, explicitly
    // tear native state down before clearing JS bookkeeping. This prevents a
    // late native success from leaving an unmanaged image model resident.
    await onnxImageGeneratorService.unloadModel().catch(() => {});
    ctx.onError();
    throw error;
  } finally {
    ctx.onFinally();
  }
}

/**
 * Gate an image-model load: hardware-capability check (NPU) + residency memory fit
 * (evicting others to make room). Returns whether the load may proceed, and — on a
 * refusal — whether it is overridable ("Load Anyway"). Extracted from ActiveModelService
 * to keep index.ts under the max-lines limit; behavior is unchanged.
 */
export async function checkImageModelCanLoad(
  modelId: string,
  model: ONNXImageModel,
  opts?: { override?: boolean },
): Promise<{ canLoad: boolean; error?: string; overridable?: boolean }> {
  if (model.backend === 'qnn') {
    const socInfo = await hardwareService.getSoCInfo();
    if (!socInfo.hasNPU) {
      return {
        canLoad: false,
        // A missing NPU is a hardware capability gap, not a memory budget — not overridable.
        error:
          'NPU models require a Qualcomm Snapdragon processor. Your device does not have a compatible NPU. Please use a GPU model instead.',
      };
    }
  }
  // Residency manager is authoritative for memory: evict others to fit the budget
  // before loading. If it can't fit even after eviction, block — unless "Load Anyway".
  const { fits } = await modelResidencyManager.makeRoomFor(
    {
      key: 'image',
      type: 'image',
      modelId: model.id,
      sizeMB: Math.round((hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024)),
      // CoreML/ONNX image weights are dirty (jetsam-counted) memory → gate on real free RAM.
      dirtyMemory: true,
    },
    { override: opts?.override },
  );
  if (!fits) {
    // Refusal UNDER override = survival floor (hard limit) → non-overridable, so the
    // UI stops re-offering "Load Anyway" as a no-op that re-runs the same failing load.
    const overridable = !opts?.override;
    return { canLoad: false, overridable, error: overridable
      ? `Not enough memory to load ${model.name}. Free up space or choose a smaller model.`
      : `Not enough memory to load ${model.name}, even after freeing other models. Close other apps or choose a smaller model.` };
  }
  return { canLoad: true };
}
