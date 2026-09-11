import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { useAppStore } from '../stores';
import { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { generateId } from '../utils/generateId';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { runRemoteImageGeneration } from './remoteImageGeneration';
import { resolveMobileImageParameters } from './imageParameterPolicy';
import {
  generationProgressStatus,
  imagePhaseTransitionLog,
} from './imageGenerationHelpers';
import { enhanceImagePrompt } from './imagePromptEnhancement';
import {
  completedImageGenerationState,
  saveImageGenerationResult,
} from './imageGenerationResult';
import { reportModelFailure } from './modelFailureHandler';
import { reasonFromLoadError } from './modelFailureReasons';
import { isOverridableMemoryError } from './modelLoadErrors';
import {
  isInFlight,
  ImageGenerationState,
  ImageGenerationListener,
  GenerateImageParams,
  ActiveImageModel,
  RunGenerationOptions,
} from './imageGenerationTypes';

export { isInFlight } from './imageGenerationTypes';
export type {
  ImageGenPhase,
  ImageGenerationState,
} from './imageGenerationTypes';

class ImageGenerationService {
  // The ONLY stored state is `phase` (+ the data fields). `isGenerating` is NOT
  // stored — there's no second source to desync. It's computed from phase in
  // getState() (see below) for back-compat readers.
  private state: Omit<ImageGenerationState, 'isGenerating'> = {
    phase: 'idle',
    progress: null,
    status: null,
    previewPath: null,
    prompt: null,
    conversationId: null,
    messageId: null,
    error: null,
    result: null,
  };

  private readonly listeners: Set<ImageGenerationListener> = new Set();
  private cancelRequested: boolean = false;
  private remoteRequest: AbortController | null = null;
  /** Last generate request, so a failure card's Retry button can re-run it. */
  private _lastParams: GenerateImageParams | null = null;

  /** Public snapshot: isGenerating is computed from phase, never stored. */
  getState(): ImageGenerationState {
    return { ...this.state, isGenerating: isInFlight(this.state.phase) };
  }

  isGeneratingFor(conversationId: string): boolean {
    return (
      isInFlight(this.state.phase) &&
      this.state.conversationId === conversationId
    );
  }

  subscribe(listener: ImageGenerationListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private updateState(partial: Partial<ImageGenerationState>): void {
    // Strip any derived field a caller might pass — phase is the only stored truth.
    const { isGenerating: _ignored, ...rest } = partial;
    const prevPhase = this.state.phase;
    this.state = { ...this.state, ...rest };
    // [IMG-SM] state-machine trace (kept forever, like [TTS-SM]): every phase
    // transition logs one line so one repro reads as a linear state machine and a
    // silent stall/flash is never undiagnosable again.
    if ('phase' in partial && this.state.phase !== prevPhase) {
      logger.log(imagePhaseTransitionLog(prevPhase, this.state));
    }
    this.notifyListeners();
    // appStore mirror is a one-way PROJECTION of phase (the UI reads it). Computed
    // from phase, never a second stored source.
    const appStore = useAppStore.getState();
    if ('phase' in partial)
      appStore.setIsGeneratingImage(isInFlight(this.state.phase));
    if ('progress' in partial)
      appStore.setImageGenerationProgress(this.state.progress);
    if ('status' in partial)
      appStore.setImageGenerationStatus(this.state.status);
    if ('previewPath' in partial)
      appStore.setImagePreviewPath(this.state.previewPath);
  }

  /** Own the terminal error state and its retry actions. */
  private _fail(error: string, opts?: { cause?: unknown }): null {
    this.updateState({
      phase: 'error',
      progress: null,
      status: null,
      previewPath: null,
      error,
    });
    // On a memory-pressure failure the card offers "Free memory & Retry" — so the retry
    // must ACTUALLY free memory (eject resident models) before re-running, not just
    // re-run into the same wall. Derive memory-pressure from the SAME single source the
    // card's label uses (reasonFromLoadError) so the label and the eject can never
    // disagree — no second regex to drift.
    const memoryPressure = reasonFromLoadError(error) === 'insufficient-memory';
    const onRetry = this._lastParams
      ? async () => {
          if (memoryPressure)
            await activeModelService.ejectAll().catch(() => {});
          await this.generateImage(this._lastParams as GenerateImageParams);
        }
      : undefined;
    // Load Anyway: only when the cause is the overridable memory gate. Re-run the last
    // request forcing the image-model load past the budget (override evicts every
    // evictable resident, then loads). reportModelFailure ignores onLoadAnyway unless
    // the cause is actually overridable, so passing it here is safe for other errors.
    const onLoadAnyway =
      isOverridableMemoryError(opts?.cause) && this._lastParams
        ? async () => {
            await this.generateImage(this._lastParams as GenerateImageParams, {
              override: true,
            });
          }
        : undefined;
    // Report with the typed cause (not the wrapped string) so the overridable
    // discriminant survives; `message` keeps the user-facing wrapped text.
    reportModelFailure('image', opts?.cause ?? error, {
      message: error,
      onRetry,
      onLoadAnyway,
    });
    return null;
  }

  private _setEnhancementState(
    params: GenerateImageParams,
    steps: number,
    status: string,
  ): void {
    this.updateState({
      phase: 'enhancing',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      status,
      previewPath: null,
      progress: { step: 0, totalSteps: steps },
      error: null,
      result: null,
    });
  }

  private async _enhancePrompt(
    params: GenerateImageParams,
    steps: number,
  ): Promise<string> {
    return enhanceImagePrompt(params, status =>
      this._setEnhancementState(params, steps, status),
    );
  }

  private async _ensureImageModelLoaded(
    activeImageModelId: string | null,
    activeImageModel: ActiveImageModel,
    opts: { desiredThreads: number; override?: boolean },
  ): Promise<boolean> {
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
    const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
    const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
    const needsThreadReload =
      loadedThreads == null || loadedThreads !== opts.desiredThreads;
    if (
      isImageModelLoaded &&
      loadedPath === activeImageModel.modelPath &&
      !needsThreadReload
    )
      return true;
    if (!activeImageModelId) {
      this._fail('No image model selected');
      return false;
    }
    try {
      this.updateState({
        phase: 'loading',
        status: `Loading ${activeImageModel.name}...`,
      });
      await activeModelService.loadImageModel(
        activeImageModelId,
        undefined,
        opts.override ? { override: true } : undefined,
      );
      return true;
    } catch (error: any) {
      // Pass the TYPED error as `cause` — an OverridableMemoryError here is what lets
      // the failure card offer "Load Anyway". Stringifying it (as before) hid it.
      this._fail(
        `Failed to load image model: ${error?.message || 'Unknown error'}`,
        { cause: error },
      );
      return false;
    }
  }

  private async _runGenerationAndSave(
    opts: RunGenerationOptions,
  ): Promise<GeneratedImage | null> {
    const {
      params,
      enhancedPrompt,
      activeImageModel,
      steps,
      guidanceScale,
      imageWidth,
      imageHeight,
      useOpenCL,
    } = opts;

    // The first generation for a model compiles/warms the backend and takes ~120s.
    // This is platform-agnostic: on iOS the CoreML model compiles on first use, on
    // Android the OpenCL kernels compile. The persisted `warmedImageModels` flag is
    // the single cross-platform signal (so the notice shows once on every device);
    // the OpenCL kernel-cache check is an extra Android signal in case the cache was
    // cleared after the flag was set.
    let isFirstRun = !useAppStore
      .getState()
      .warmedImageModels.includes(activeImageModel.id);
    if (useOpenCL) {
      try {
        const hasCache = await onnxImageGeneratorService.hasKernelCache(
          activeImageModel.modelPath,
        );
        isFirstRun = isFirstRun || !hasCache;
      } catch (e) {
        // If check fails, don't add a false first-run signal (keep the warmed-flag result).
        logger.warn('[ImageGen] Failed to check for OpenCL kernel cache:', e);
      }
    }

    this.updateState({
      phase: 'generating',
      status: isFirstRun
        ? 'Optimizing GPU for your device (~120s, one-time)...'
        : 'Starting image generation...',
    });
    const startTime = Date.now();
    try {
      const result = await onnxImageGeneratorService.generateImage(
        {
          prompt: enhancedPrompt,
          negativePrompt: params.negativePrompt || '',
          steps,
          guidanceScale,
          seed: params.seed,
          width: imageWidth,
          height: imageHeight,
          previewInterval: params.previewInterval ?? 2,
          useOpenCL,
        },
        progress => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(progress.step, steps);
          // Once steps are advancing it IS generating — don't mislabel it "GPU
          // optimization" (which read as if generation hadn't started). On the first run
          // the GPU is still warming, so note that as a one-time aside, not the headline.
          const status = generationProgressStatus(
            displayStep,
            steps,
            isFirstRun,
          );
          this.updateState({
            progress: { step: displayStep, totalSteps: steps },
            status,
          });
        },
        preview => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(preview.step, steps);
          this.updateState({
            previewPath: `file://${preview.previewPath}?t=${Date.now()}`,
            status: `Refining image (${displayStep}/${steps})...`,
          });
        },
      );
      if (this.cancelRequested || !result?.imagePath) {
        this.resetState();
        return null;
      }
      this.updateState(completedImageGenerationState(result));
      return saveImageGenerationResult(result, {
        params,
        activeImageModel,
        messageId: this.state.messageId,
        steps,
        guidanceScale,
        useOpenCL,
        startTime,
      });
    } catch (error: any) {
      const errorMsg = error?.message || 'Image generation failed';
      if (errorMsg.includes('cancelled')) {
        this.resetState();
      } else {
        logger.error('[ImageGenerationService] Generation error:', error);

        // If the pipeline crashed or the model was unloaded, surface a
        // user-friendly message and allow retry (model will auto-reload).
        const isPipelineCrash =
          errorMsg.includes('Pipeline failed') ||
          errorMsg.includes('unloaded') ||
          errorMsg.includes('ERR_NO_MODEL') ||
          errorMsg.includes('TextEncoder');
        const userMessage = isPipelineCrash
          ? 'Image generation failed — the model encountered an error and was unloaded. Please try again.'
          : errorMsg;

        this._fail(userMessage);
      }
      return null;
    }
  }

  /**
   * Generate an image. Runs independently of UI lifecycle.
   * If conversationId is provided, the result will be added as a chat message.
   */
  async generateImage(
    params: GenerateImageParams,
    opts?: { override?: boolean },
  ): Promise<GeneratedImage | null> {
    if (isInFlight(this.state.phase)) {
      logger.log(
        '[ImageGenerationService] Already generating, ignoring request',
      );
      return null;
    }
    this.cancelRequested = false;
    this._lastParams = params; // so a failure card's Retry can re-run this exact request
    const remoteServer = useRemoteServerStore
      .getState()
      .getActiveRemoteMediaServer('image');
    if (remoteServer?.mediaModels?.image) {
      return runRemoteImageGeneration(params, remoteServer, {
        updateState: state => this.updateState(state),
        fail: message => this._fail(message),
        isCancelled: () => this.cancelRequested,
        setRequest: controller => {
          this.remoteRequest = controller;
        },
      });
    }
    const { settings, activeImageModelId, downloadedImageModels } =
      useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(
      m => m.id === activeImageModelId,
    );
    if (!activeImageModel) return this._fail('No image model selected');

    const messageId = params.conversationId ? generateId() : null;

    const imageParameters = resolveMobileImageParameters(
      activeImageModel,
      settings,
      params,
    );
    const { steps, guidanceScale } = imageParameters;
    const imageWidth = imageParameters.size;
    const imageHeight = imageParameters.size;

    this.updateState({
      phase: settings.enhanceImagePrompts ? 'enhancing' : 'loading',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      messageId,
      status: settings.enhanceImagePrompts
        ? 'Preparing prompt enhancement...'
        : 'Preparing image generation...',
      previewPath: null,
      progress: { step: 0, totalSteps: steps },
      error: null,
      result: null,
    });

    const enhancedPrompt = await this._enhancePrompt(params, steps);
    logger.log(
      '[ImageGen] enhanceImagePrompts setting:',
      settings.enhanceImagePrompts,
    );
    // Stop can arrive while prompt enhancement owns the text engine. Do not clear that request and
    // continue into the image model after the user already pressed X.
    if (this.cancelRequested) {
      this.resetState();
      return null;
    }

    // Establish the generating state unconditionally — not only when enhancement
    // is off. When enhancement is ON but _enhancePrompt bailed early (e.g. no text
    // model loaded, so enhancement was skipped), it never set isGenerating, so the
    // in-progress card never appeared. Setting it here fixes that; on the
    // enhancement-ran path this just swaps the 'Enhancing…' status for 'Preparing…'
    // before the image model loads.
    this.updateState({
      phase: 'loading',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      status: 'Preparing image generation...',
      previewPath: null,
      progress: { step: 0, totalSteps: steps },
      error: null,
      result: null,
    });

    const loaded = await this._ensureImageModelLoaded(
      activeImageModelId,
      activeImageModel,
      { desiredThreads: settings.imageThreads ?? 4, override: opts?.override },
    );
    if (!loaded) return null;
    if (this.cancelRequested) {
      this.resetState();
      return null;
    }

    return this._runGenerationAndSave({
      params,
      enhancedPrompt,
      activeImageModel,
      steps,
      guidanceScale,
      imageWidth,
      imageHeight,
      useOpenCL: settings.imageUseOpenCL ?? true,
    });
  }

  async cancelGeneration(): Promise<void> {
    if (!isInFlight(this.state.phase)) return;
    this.cancelRequested = true;
    this.remoteRequest?.abort();
    // Publish the terminal while conversation identity is still present. Sync subscribers run
    // synchronously, so every peer can remove its live image card before native cancellation waits.
    this.updateState({
      phase: 'cancelled',
      progress: null,
      status: null,
      previewPath: null,
      error: null,
    });
    try {
      await onnxImageGeneratorService.cancelGeneration();
    } catch {
      /* Ignore */
    } finally {
      this.resetState();
    }
  }

  private resetState(): void {
    this.updateState({
      phase: 'idle',
      progress: null,
      status: null,
      previewPath: null,
      prompt: null,
      conversationId: null,
      messageId: null,
      error: null,
      // Keep result so the last generated image is still accessible
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
