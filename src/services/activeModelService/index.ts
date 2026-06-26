// ActiveModelService — THE ONLY PLACE models should be loaded/unloaded from.
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { hardwareService } from '../hardware';
import { modelResidencyManager } from '../modelResidency';
import { useAppStore } from '../../stores';
import { ONNXImageModel } from '../../types';
import type {
  ActiveModelInfo,
  ResourceUsage,
  ModelType,
  MemoryCheckResult,
  ModelChangeListener,
} from './types';
import {
  checkMemoryForModel as _checkMemoryForModel,
  checkMemoryForDualModel as _checkMemoryForDualModel,
  getCurrentlyLoadedMemoryGB as _getCurrentlyLoadedMemoryGB,
} from './memory';
import { doLoadTextModel, doLoadImageModel } from './loaders';
import {
  getResourceUsage as _getResourceUsage,
  syncWithNativeState as _syncWithNativeState,
} from './utils';
export type {
  ModelType,
  MemoryCheckSeverity,
  MemoryCheckResult,
  ActiveModelInfo,
  ResourceUsage,
} from './types';
class ActiveModelService {
  private readonly listeners: Set<ModelChangeListener> = new Set();
  private readonly loadingState = { text: false, image: false };
  private loadedTextModelId: string | null = null;
  private loadedImageModelId: string | null = null;
  private loadedImageModelThreads: number | null = null;
  private textLoadPromise: Promise<void> | null = null;
  private imageLoadPromise: Promise<void> | null = null;
  getActiveModels(): ActiveModelInfo {
    const store = useAppStore.getState();
    const textModel =
      store.downloadedModels.find(m => m.id === store.activeModelId) ?? null;
    const imageModel =
      store.downloadedImageModels.find(
        m => m.id === store.activeImageModelId,
      ) ?? null;
    return {
      text: {
        model: textModel,
        // Engine-aware: a text model lives in llmService (GGUF) or liteRTService
        // (LiteRT). Checking only llmService reported a loaded LiteRT model as
        // not-loaded, which made the preloader and UI treat it as absent.
        isLoaded: llmService.isModelLoaded() || liteRTService.isModelLoaded(),
        isLoading: this.loadingState.text,
      },
      image: {
        model: imageModel,
        isLoaded: this.loadedImageModelId != null,
        isLoading: this.loadingState.image,
      },
    };
  }
  hasAnyModelLoaded(): boolean {
    const info = this.getActiveModels();
    return info.text.isLoaded || info.image.isLoaded;
  }
  /**
   * Whether the currently-active text model accepts audio input directly (no
   * Whisper STT needed). Engine-aware dispatch lives here so UI/hooks never
   * branch on engine type: LiteRT reports via its loaded model's audio flag,
   * llama.cpp via the multimodal projector's reported audio support.
   */
  supportsAudioInput(): boolean {
    const store = useAppStore.getState();
    const model = store.downloadedModels.find(m => m.id === store.activeModelId);
    if (!model) return false;
    if (model.engine === 'litert') {
      return liteRTService.supportsAudio();
    }
    return llmService.isModelLoaded() && !!llmService.getMultimodalSupport()?.audio;
  }
  getLoadedModelIds(): {
    textModelId: string | null;
    imageModelId: string | null;
  } {
    return {
      textModelId: this.loadedTextModelId,
      imageModelId: this.loadedImageModelId,
    };
  }
  getPerformanceStats() {
    return llmService.getPerformanceStats();
  }
  /**
   * Whether `modelId` is the currently-loaded text model. Engine-aware: LiteRT
   * models live in liteRTService, llama/GGUF models in llmService. Checking only
   * llmService reported a loaded LiteRT model as not-loaded, so the fast path
   * below missed and re-loaded it (unload+load) every time the chat called
   * loadTextModel — the "second loader" seen only for LiteRT models.
   */
  private isTextModelCurrent(modelId: string): boolean {
    if (this.loadedTextModelId !== modelId) return false;
    const model = useAppStore.getState().downloadedModels.find(m => m.id === modelId);
    return model?.engine === 'litert'
      ? liteRTService.isModelLoaded()
      : llmService.isModelLoaded();
  }

  async loadTextModel(
    modelId: string,
    timeoutMs: number = 120000,
  ): Promise<void> {
    // Fast path — model already loaded (no lock; just sync the store).
    if (this.isTextModelCurrent(modelId)) {
      const store = useAppStore.getState();
      if (store.activeModelId !== modelId) {
        store.setActiveModelId(modelId);
      }
      return;
    }
    // Everything else goes through the residency manager's global lock so no two
    // model operations ever touch memory at once (the single load gateway).
    await modelResidencyManager.runExclusive(`load:text:${modelId}`, () =>
      this.doLoadTextModelLocked(modelId, timeoutMs),
    );
  }
  private async doLoadTextModelLocked(
    modelId: string,
    timeoutMs: number,
  ): Promise<void> {
    // Re-check after acquiring — a queued call may have loaded it already.
    if (this.isTextModelCurrent(modelId)) {
      const store = useAppStore.getState();
      if (store.activeModelId !== modelId) {
        store.setActiveModelId(modelId);
      }
      return;
    }
    const store = useAppStore.getState();
    const model = store.downloadedModels.find(m => m.id === modelId);
    if (!model) {
      throw new Error('Model not found');
    }
    // Use estimated runtime RAM (file size + overhead), not just file size,
    // so the residency budget reflects the model's real memory footprint.
    const textSizeMB = Math.round((hardwareService.estimateModelRam(model) || 0) / (1024 * 1024));
    // Residency manager is authoritative: evict other generation models (and
    // extras) to fit the RAM budget before loading this text model. The evicted
    // models' unload fns are the non-locking internal variants (we already hold
    // the lock here), so this never deadlocks.
    await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: textSizeMB });
    this.loadingState.text = true;
    this.notifyListeners();
    this.textLoadPromise = doLoadTextModel({
      model,
      modelId,
      store,
      timeoutMs,
      loadedTextModelId: this.loadedTextModelId,
      onLoaded: id => {
        this.loadedTextModelId = id;
        modelResidencyManager.register(
          { key: 'text', type: 'text', sizeMB: textSizeMB },
          () => this.doUnloadTextModelLocked(true), // eviction keeps the selection
        );
      },
      onError: () => {
        this.loadedTextModelId = null;
      },
      onFinally: () => {
        this.loadingState.text = false;
        this.textLoadPromise = null;
        this.notifyListeners();
      },
    });
    await this.textLoadPromise;
  }
  async unloadTextModel(): Promise<void> {
    await modelResidencyManager.runExclusive('unload:text', () =>
      this.doUnloadTextModelLocked(),
    );
  }
  /**
   * Non-locking unload core. Safe to call from inside a held lock (eviction).
   * `keepSelection` is true for residency EVICTION: free the RAM but keep the
   * model SELECTED (activeModelId) so the UI still shows it and it reloads on
   * demand — clearing the selection here is what made chat fall back to "Load a
   * model" and thrash. A user-initiated unload passes false to fully deselect.
   */
  private async doUnloadTextModelLocked(keepSelection = false): Promise<void> {
    if (this.textLoadPromise !== null) {
      await this.textLoadPromise;
    }
    const storeActiveModelId = useAppStore.getState().activeModelId;
    const isNativeLoaded = llmService.isModelLoaded();
    if (!storeActiveModelId && !this.loadedTextModelId && !isNativeLoaded) {
      return;
    }
    this.loadingState.text = true;
    this.notifyListeners();
    try {
      if (isNativeLoaded) {
        await llmService.unloadModel();
      }
      this.loadedTextModelId = null;
      if (!keepSelection) {
        useAppStore.getState().setActiveModelId(null);
      }
      modelResidencyManager.release('text');
    } finally {
      this.loadingState.text = false;
      this.notifyListeners();
    }
  }
  private async checkImageModelCanLoad(
    modelId: string,
    model: ONNXImageModel,
  ): Promise<{ canLoad: boolean; error?: string }> {
    if (model.backend === 'qnn') {
      const socInfo = await hardwareService.getSoCInfo();
      if (!socInfo.hasNPU) {
        return {
          canLoad: false,
          error:
            'NPU models require a Qualcomm Snapdragon processor. Your device does not have a compatible NPU. Please use a GPU model instead.',
        };
      }
    }
    // Residency manager is authoritative for memory: evict other generation
    // models (and extras) to fit the RAM budget before loading this image
    // model. (Replaces the old per-load critical-memory gate.) If it can't fit
    // even after eviction, block the load.
    const { fits } = await modelResidencyManager.makeRoomFor({
      key: 'image',
      type: 'image',
      sizeMB: Math.round((hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024)),
    });
    if (!fits) {
      return {
        canLoad: false,
        error: `Not enough memory to load ${model.name}. Free up space or choose a smaller model.`,
      };
    }
    return { canLoad: true };
  }
  async loadImageModel(
    modelId: string,
    timeoutMs: number = 180000,
  ): Promise<void> {
    await modelResidencyManager.runExclusive(`load:image:${modelId}`, () =>
      this.doLoadImageModelLocked(modelId, timeoutMs),
    );
  }
  private async doLoadImageModelLocked(
    modelId: string,
    timeoutMs: number,
  ): Promise<void> {
    const store = useAppStore.getState();
    const imageThreads = store.settings?.imageThreads ?? 4;
    const needsThreadReload =
      this.loadedImageModelId === modelId &&
      this.loadedImageModelThreads !== imageThreads;
    if (this.loadedImageModelId === modelId) {
      const isLoaded = await onnxImageGeneratorService.isModelLoaded();
      if (isLoaded && !needsThreadReload) {
        if (store.activeImageModelId !== modelId) {
          store.setActiveImageModelId(modelId);
        }
        return;
      }
    }
    const model = store.downloadedImageModels.find(m => m.id === modelId);
    if (!model) {
      throw new Error('Model not found');
    }
    const check = await this.checkImageModelCanLoad(modelId, model);
    if (!check.canLoad) {
      throw new Error(check.error);
    }
    this.loadingState.image = true;
    this.notifyListeners();
    this.imageLoadPromise = doLoadImageModel({
      model,
      modelId,
      imageThreads,
      needsThreadReload,
      cpuOnly: false,
      store,
      timeoutMs,
      loadedImageModelId: this.loadedImageModelId,
      onLoaded: (id, threads) => {
        this.loadedImageModelId = id;
        this.loadedImageModelThreads = threads;
        modelResidencyManager.register(
          { key: 'image', type: 'image', sizeMB: Math.round((hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024)) },
          () => this.doUnloadImageModelLocked(true), // eviction keeps the selection
        );
      },
      onError: () => {
        this.loadedImageModelId = null;
        this.loadedImageModelThreads = null;
      },
      onFinally: () => {
        this.loadingState.image = false;
        this.imageLoadPromise = null;
        this.notifyListeners();
      },
    });
    await this.imageLoadPromise;
  }
  async unloadImageModel(): Promise<void> {
    await modelResidencyManager.runExclusive('unload:image', () =>
      this.doUnloadImageModelLocked(),
    );
  }
  /**
   * Non-locking unload core. Safe to call from inside a held lock (eviction).
   * `keepSelection` true for residency eviction (free RAM, keep the model
   * selected so it reloads on demand); false for a user-initiated unload.
   */
  private async doUnloadImageModelLocked(keepSelection = false): Promise<void> {
    if (this.imageLoadPromise !== null) {
      await this.imageLoadPromise;
    }
    const store = useAppStore.getState();
    const isNativeLoaded = await onnxImageGeneratorService.isModelLoaded();
    if (
      !store.activeImageModelId &&
      !this.loadedImageModelId &&
      !isNativeLoaded
    ) {
      return;
    }
    this.loadingState.image = true;
    this.notifyListeners();
    try {
      if (isNativeLoaded) {
        await onnxImageGeneratorService.unloadModel();
      }
      this.loadedImageModelId = null;
      this.loadedImageModelThreads = null;
      if (!keepSelection) {
        store.setActiveImageModelId(null);
      }
      modelResidencyManager.release('image');
    } finally {
      this.loadingState.image = false;
      this.notifyListeners();
    }
  }
  async unloadAllModels(): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
    const store = useAppStore.getState();
    const results = { textUnloaded: false, imageUnloaded: false };
    const hasTextModel =
      !!store.activeModelId ||
      !!this.loadedTextModelId ||
      llmService.isModelLoaded();
    const hasImageModel =
      !!store.activeImageModelId || !!this.loadedImageModelId;
    if (hasTextModel) {
      try {
        await this.unloadTextModel();
        results.textUnloaded = true;
      } catch {
        /* partial */
      }
    }
    if (hasImageModel) {
      try {
        await this.unloadImageModel();
        results.imageUnloaded = true;
      } catch {
        /* partial */
      }
    }
    return results;
  }
  async getResourceUsage(): Promise<ResourceUsage> {
    return _getResourceUsage();
  }
  private getIds() {
    return { loadedTextModelId: this.loadedTextModelId, loadedImageModelId: this.loadedImageModelId };
  }
  private getLists() {
    const s = useAppStore.getState();
    return { downloadedModels: s.downloadedModels, downloadedImageModels: s.downloadedImageModels };
  }
  private getCurrentlyLoadedMemoryGB(): number {
    return _getCurrentlyLoadedMemoryGB(this.getIds(), this.getLists());
  }
  async checkMemoryForModel(modelId: string, modelType: ModelType): Promise<MemoryCheckResult> {
    return _checkMemoryForModel({ modelId, modelType, ids: this.getIds(), lists: this.getLists() });
  }
  async checkMemoryForDualModel(textModelId: string | null, imageModelId: string | null): Promise<MemoryCheckResult> {
    return _checkMemoryForDualModel({ textModelId, imageModelId, lists: this.getLists() });
  }
  async clearTextModelCache(): Promise<void> {
    if (llmService.isModelLoaded()) {
      await llmService.clearKVCache(false);
    }
  }
  async syncWithNativeState(): Promise<void> {
    await _syncWithNativeState({
      loadedTextModelId: this.loadedTextModelId,
      loadedImageModelId: this.loadedImageModelId,
      setLoadedTextModelId: id => {
        this.loadedTextModelId = id;
      },
      setLoadedImageModelId: id => {
        this.loadedImageModelId = id;
      },
      setLoadedImageModelThreads: n => {
        this.loadedImageModelThreads = n;
      },
    });
  }
  subscribe(listener: ModelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notifyListeners(): void {
    const info = this.getActiveModels();
    this.listeners.forEach(listener => listener(info));
  }
}
export const activeModelService = new ActiveModelService();
