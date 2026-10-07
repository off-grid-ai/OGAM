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
import {
  cancelImagePromptEnhancement,
  enhanceImagePrompt,
} from './imagePromptEnhancement';
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

/**
 * One generate request. Cancel and the remote request belong to the request, not the service, so
 * a cancelled request that is still unwinding can never read the next request's flag, clear its
 * controller or write its progress.
 */
interface ImageJob {
  conversationId: string | null;
  cancelled: boolean;
  remoteRequest: AbortController | null;
  /** Settles when the request has fully ended, whatever its outcome. */
  settled: Promise<unknown>;
}

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
  /** The latest request. A deleted chat waits for its own job; only this job may publish state. */
  private job: ImageJob | null = null;
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
  }

  /** True while `job` is the latest request and nobody cancelled it. */
  private isLive(job: ImageJob): boolean {
    return this.job === job && !job.cancelled;
  }

  /** Publish state for `job` only while it is live, so a cancelled request stays silent. */
  private updateFor(job: ImageJob, partial: Partial<ImageGenerationState>): void {
    if (this.isLive(job)) this.updateState(partial);
  }

  /** A request that noticed its cancel returns the card to idle, unless a newer request owns it. */
  private resetFor(job: ImageJob): null {
    if (this.job === job) this.resetState();
    return null;
  }

  /** Fail `job`; a cancelled or replaced request shows no failure card. */
  private failFor(
    job: ImageJob,
    error: string,
    opts?: { cause?: unknown; remote?: boolean },
  ): null {
    return this.isLive(job) ? this._fail(error, opts) : null;
  }

  /** Own the terminal error state and its retry actions. */
  private _fail(error: string, opts?: { cause?: unknown; remote?: boolean }): null {
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
          if (memoryPressure && !opts?.remote)
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
      title: opts?.remote ? 'Remote image error' : undefined,
      remote: opts?.remote,
      onRetry,
      onLoadAnyway,
    });
    return null;
  }

  private _setEnhancementState(
    job: ImageJob,
    params: GenerateImageParams,
    status: string,
  ): void {
    this.updateFor(job, {
      phase: 'enhancing',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      status,
      previewPath: null,
      progress: null,
      error: null,
      result: null,
    });
  }

  private async _enhancePrompt(
    job: ImageJob,
    params: GenerateImageParams,
  ): Promise<string> {
    return enhanceImagePrompt(
      params,
      status => this._setEnhancementState(job, params, status),
      () => !this.isLive(job),
    );
  }

  private async _ensureImageModelLoaded(
    job: ImageJob,
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
      this.failFor(job, 'No image model selected');
      return false;
    }
    try {
      this.updateFor(job, {
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
      this.failFor(
        job,
        `Failed to load image model: ${error?.message || 'Unknown error'}`,
        { cause: error },
      );
      return false;
    }
  }

  private async _runGenerationAndSave(
    job: ImageJob,
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

    this.updateFor(job, {
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
          if (!this.isLive(job)) return;
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
          if (!this.isLive(job)) return;
          const displayStep = Math.min(preview.step, steps);
          this.updateState({
            previewPath: `file://${preview.previewPath}?t=${Date.now()}`,
            status: `Refining image (${displayStep}/${steps})...`,
          });
        },
      );
      if (!this.isLive(job) || !result?.imagePath) return this.resetFor(job);
      this.updateState(completedImageGenerationState(result));
      return await saveImageGenerationResult(result, {
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
      if (errorMsg.includes('cancelled') || !this.isLive(job)) {
        this.resetFor(job);
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

        this.failFor(job, userMessage);
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
    if (isInFlight(this.state.phase) || (this.job && !this.job.cancelled)) {
      logger.log(
        '[ImageGenerationService] Already generating, ignoring request',
      );
      return null;
    }
    // A cancelled request may still be unwinding (a text model mid-load, a native cancel). It owns
    // its own flag and controller and publishes nothing once replaced, so the new request starts now.
    const job: ImageJob = {
      conversationId: params.conversationId || null,
      cancelled: false,
      remoteRequest: null,
      settled: Promise.resolve(),
    };
    this.job = job;
    this._lastParams = params; // so a failure card's Retry can re-run this exact request
    const run = this._generate(job, params, opts);
    job.settled = run.catch(() => null);
    try {
      return await run;
    } finally {
      if (this.job === job) this.job = null;
    }
  }

  private async _generate(
    job: ImageJob,
    params: GenerateImageParams,
    opts?: { override?: boolean },
  ): Promise<GeneratedImage | null> {
    const remoteServer = useRemoteServerStore
      .getState()
      .getActiveRemoteMediaServer('image');
    if (remoteServer?.mediaModels?.image) {
      const enhancedPrompt = await this._enhancePrompt(job, params);
      if (!this.isLive(job)) return this.resetFor(job);
      return runRemoteImageGeneration(params, remoteServer, {
        updateState: state => this.updateFor(job, state),
        fail: (message, cause) => this.failFor(job, message, { cause, remote: true }),
        isCancelled: () => !this.isLive(job),
        setRequest: controller => {
          job.remoteRequest = controller;
          // Cancelled between the check and the request: stop it before it is sent.
          if (controller && job.cancelled) controller.abort();
        },
      }, { ...opts, enhancedPrompt });
    }
    const { settings, activeImageModelId, downloadedImageModels } =
      useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(
      m => m.id === activeImageModelId,
    );
    if (!activeImageModel) return this.failFor(job, 'No image model selected');

    const messageId = params.conversationId ? generateId() : null;

    const imageParameters = resolveMobileImageParameters(
      activeImageModel,
      settings,
      params,
    );
    const { steps, guidanceScale } = imageParameters;
    const imageWidth = imageParameters.size;
    const imageHeight = imageParameters.size;

    this.updateFor(job, {
      phase: settings.enhanceImagePrompts ? 'enhancing' : 'loading',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      messageId,
      status: settings.enhanceImagePrompts
        ? 'Preparing prompt enhancement...'
        : 'Preparing image generation...',
      previewPath: null,
      progress: null,
      error: null,
      result: null,
    });

    const enhancedPrompt = await this._enhancePrompt(job, params);
    logger.log(
      '[ImageGen] enhanceImagePrompts setting:',
      settings.enhanceImagePrompts,
    );
    // Stop can arrive while prompt enhancement owns the text engine. Do not clear that request and
    // continue into the image model after the user already pressed X.
    if (!this.isLive(job)) return this.resetFor(job);

    // Establish the generating state unconditionally — not only when enhancement
    // is off. When enhancement is ON but _enhancePrompt bailed early (e.g. no text
    // model loaded, so enhancement was skipped), it never set isGenerating, so the
    // in-progress card never appeared. Setting it here fixes that; on the
    // enhancement-ran path this just swaps the 'Enhancing…' status for 'Preparing…'
    // before the image model loads.
    this.updateFor(job, {
      phase: 'loading',
      prompt: params.prompt,
      conversationId: params.conversationId || null,
      status: 'Preparing image generation...',
      previewPath: null,
      progress: null,
      error: null,
      result: null,
    });

    const loaded = await this._ensureImageModelLoaded(
      job,
      activeImageModelId,
      activeImageModel,
      { desiredThreads: settings.imageThreads ?? 4, override: opts?.override },
    );
    if (!loaded) return null;
    if (!this.isLive(job)) return this.resetFor(job);

    return this._runGenerationAndSave(job, {
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

  /**
   * Cancel the request drawing an image for this conversation and wait until it has ended. Deleting
   * a chat calls this first, so no image is saved for the chat after its images are removed.
   */
  async cancelGenerationFor(conversationId: string): Promise<void> {
    const job = this.job;
    if (job?.conversationId !== conversationId) return;
    await this.cancelGeneration();
    await job.settled;
  }

  async cancelGeneration(): Promise<void> {
    const job = this.job;
    if (!isInFlight(this.state.phase)) {
      // Started but not yet showing progress: the run checks its job before each step.
      if (job) job.cancelled = true;
      return;
    }
    if (job) {
      job.cancelled = true;
      job.remoteRequest?.abort();
    }
    // While enhancing, the job waits on a text request that the image backends cannot stop.
    const enhancement =
      this.state.phase === 'enhancing' ? cancelImagePromptEnhancement() : null;
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
      await enhancement;
      await onnxImageGeneratorService.cancelGeneration();
    } catch {
      /* Ignore */
    } finally {
      // A newer request may own the card by now; only clear what this cancel ended.
      if (!job || this.job === job) this.resetState();
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
