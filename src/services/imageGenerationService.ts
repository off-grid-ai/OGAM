/** ImageGenerationService - Handles image generation independently of UI lifecycle */
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { getActiveEngineService, generateStandalone, isRemoteTextModelActive } from './engines';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForImage } from './proPrompt';
import { SWEET_SPOT_SIZE, DEFAULT_IMAGE_GUIDANCE } from '../utils/imageGenAdvice';
import { buildEnhancementMessages, getConversationContext, cleanEnhancedPrompt, buildImageGenMeta } from './imageGenerationHelpers';
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
  UpdateEnhancementOptions,
} from './imageGenerationTypes';

// Re-export the public types + phase predicate (moved to imageGenerationTypes.ts to
// keep this file within the max-lines budget). Behavior-neutral: every existing
// `import { ImageGenPhase, isInFlight, ImageGenerationState } from './imageGenerationService'`
// keeps working.
export { isInFlight } from './imageGenerationTypes';
export type { ImageGenPhase, ImageGenerationState } from './imageGenerationTypes';

const SHARE_PROMPT_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

class ImageGenerationService {
  // The ONLY stored state is `phase` (+ the data fields). `isGenerating` is NOT
  // stored — there's no second source to desync. It's computed from phase in
  // getState() (see below) for back-compat readers.
  private state: Omit<ImageGenerationState, 'isGenerating'> = {
    phase: 'idle', progress: null, status: null, previewPath: null,
    prompt: null, conversationId: null, error: null, result: null,
  };

  private readonly listeners: Set<ImageGenerationListener> = new Set();
  private cancelRequested: boolean = false;
  /** Last generate request, so a failure card's Retry button can re-run it. */
  private _lastParams: GenerateImageParams | null = null;

  /** Public snapshot: isGenerating is computed from phase, never stored. */
  getState(): ImageGenerationState { return { ...this.state, isGenerating: isInFlight(this.state.phase) }; }

  isGeneratingFor(conversationId: string): boolean {
    return isInFlight(this.state.phase) && this.state.conversationId === conversationId;
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
      logger.log(`[IMG-SM] phase ${prevPhase} → ${this.state.phase}${this.state.status ? ` (${this.state.status})` : ''}${this.state.error ? ` error=${this.state.error}` : ''}`);
    }
    this.notifyListeners();
    // appStore mirror is a one-way PROJECTION of phase (the UI reads it). Computed
    // from phase, never a second stored source.
    const appStore = useAppStore.getState();
    if ('phase' in partial) appStore.setIsGeneratingImage(isInFlight(this.state.phase));
    if ('progress' in partial) appStore.setImageGenerationProgress(this.state.progress);
    if ('status' in partial) appStore.setImageGenerationStatus(this.state.status);
    if ('previewPath' in partial) appStore.setImagePreviewPath(this.state.previewPath);
  }

  /**
   * The SINGLE owner of generation failure (SRP): move to the error phase AND
   * surface the reason via the common dismissible failure card (modelFailureHandler)
   * — NOT a flat chat message. So a failure is never silent, never a chat bubble,
   * and the handling is defined once. The card detects insufficient-memory from the
   * error text and offers "Free memory & Retry" (re-runs the last request); when the
   * underlying cause is the OVERRIDABLE memory gate it ALSO offers "Load Anyway"
   * (re-run forcing the load past the budget) — parity with the text-model path.
   * Returns null for `return this._fail(...)`.
   *
   * `opts.cause` carries the ORIGINAL thrown error (not just its message) so the
   * failure surface can read the OverridableMemoryError discriminant. Without it the
   * typed error is lost to a string and the override can never be offered — the exact
   * bug this fixes.
   */
  private _fail(error: string, opts?: { cause?: unknown }): null {
    this.updateState({ phase: 'error', progress: null, status: null, previewPath: null, error });
    // On a memory-pressure failure the card offers "Free memory & Retry" — so the retry
    // must ACTUALLY free memory (eject resident models) before re-running, not just
    // re-run into the same wall. Derive memory-pressure from the SAME single source the
    // card's label uses (reasonFromLoadError) so the label and the eject can never
    // disagree — no second regex to drift.
    const memoryPressure = reasonFromLoadError(error) === 'insufficient-memory';
    const onRetry = this._lastParams
      ? async () => {
          if (memoryPressure) await activeModelService.ejectAll().catch(() => {});
          void this.generateImage(this._lastParams as GenerateImageParams);
        }
      : undefined;
    // Load Anyway: only when the cause is the overridable memory gate. Re-run the last
    // request forcing the image-model load past the budget (override evicts every
    // evictable resident, then loads). reportModelFailure ignores onLoadAnyway unless
    // the cause is actually overridable, so passing it here is safe for other errors.
    const onLoadAnyway = isOverridableMemoryError(opts?.cause) && this._lastParams
      ? () => { void this.generateImage(this._lastParams as GenerateImageParams, { override: true }); }
      : undefined;
    // Report with the typed cause (not the wrapped string) so the overridable
    // discriminant survives; `message` keeps the user-facing wrapped text.
    reportModelFailure('image', opts?.cause ?? error, { message: error, onRetry, onLoadAnyway });
    return null;
  }

  /**
   * Prompt enhancement was skipped (best-effort text-model load failed). This is a
   * SOFT degradation — the image still generates from the original prompt — so it
   * surfaces as a non-blocking 'warning' on the same dismissible card instead of
   * being silently swallowed. We pass the underlying reason as the error so the
   * card can still flag memory pressure when that's the cause.
   */
  private _noticeEnhancementSkipped(reason: string): void {
    reportModelFailure('text', reason, {
      severity: 'warning',
      title: 'Prompt enhancement skipped',
      message: `Generating from your original prompt — ${reason}.`,
    });
  }

  private _checkSharePrompt(): void {
    const s = useAppStore.getState();
    const count = s.incrementImageGenerationCount();
    maybeScheduleSharePrompt({ variant: 'image', count, hasEngaged: s.hasEngagedSharePrompt, delayMs: SHARE_PROMPT_DELAY_MS });
    checkProPromptForImage(SHARE_PROMPT_DELAY_MS);
  }

  private async _resetLlmAfterEnhancement(): Promise<void> {
    // Engine-agnostic: reset whichever text engine ran the enhancement (llama OR LiteRT).
    // stopGeneration is supported by both; binding to llmService left a LiteRT generation
    // running after enhancement.
    try {
      await getActiveEngineService()?.stopGeneration();
      logger.log('[ImageGen] ✓ text engine stopGeneration() called');
    } catch (resetError) {
      logger.error('[ImageGen] ❌ Failed to reset text engine:', resetError);
    }
  }

  private async _updateEnhancementMessage(opts: UpdateEnhancementOptions): Promise<void> {
    const { conversationId, tempMessageId, enhancedPrompt, originalPrompt } = opts;
    if (!conversationId || !tempMessageId) return;
    const chatStore = useChatStore.getState();
    if (enhancedPrompt && enhancedPrompt !== originalPrompt) {
      chatStore.updateMessageContent(conversationId, tempMessageId, `<think>__LABEL:Enhanced prompt__\n${enhancedPrompt}</think>`);
      chatStore.updateMessageThinking(conversationId, tempMessageId, false);
    } else {
      logger.warn('[ImageGen] Enhancement produced no change, deleting thinking message');
      chatStore.deleteMessage(conversationId, tempMessageId);
    }
  }

  private async _enhancePrompt(params: GenerateImageParams, steps: number): Promise<string> {
    const { settings } = useAppStore.getState();
    if (!settings.enhanceImagePrompts) {
      logger.log('[ImageGen] Enhancement disabled, using original prompt');
      return params.prompt;
    }
    // Engine-agnostic loaded check — a LiteRT text model lives in liteRTService, so the
    // old llmService.isModelLoaded() always read false for it and enhancement was skipped
    // even though the model was resident. A REMOTE text model has no LOCAL residency at all
    // (it runs over the network), so "loaded" for it means the remote provider is active —
    // otherwise the gate below tries a pointless on-demand LOCAL load of a remote model id,
    // stays "not loaded", and skips enhancement entirely (B30, remote path).
    let isTextModelLoaded = isRemoteTextModelActive() || (getActiveEngineService()?.isModelLoaded() ?? false);
    logger.log('[ImageGen] 🎨 Starting prompt enhancement - Model loaded:', isTextModelLoaded);
    if (!isTextModelLoaded) {
      // Text and image models are mutually exclusive (one resident at a time), so
      // during image gen the text model usually isn't loaded. Load it on demand to
      // enhance; _ensureImageModelLoaded swaps back to the image model afterwards.
      // This costs two heavy model loads per enhanced generation — the accepted
      // price for the feature when one-at-a-time residency is in force.
      const { activeModelId, lastTextModelId } = useAppStore.getState();
      const textModelId = activeModelId ?? lastTextModelId;
      if (!textModelId) {
        logger.warn('[ImageGen] No text model available, skipping enhancement');
        this._noticeEnhancementSkipped('no text model is selected');
        return params.prompt;
      }
      this.updateState({
        phase: 'enhancing', prompt: params.prompt, conversationId: params.conversationId || null,
        status: 'Loading text model to enhance prompt...', previewPath: null,
        progress: { step: 0, totalSteps: steps }, error: null, result: null,
      });
      let loadError: unknown = null;
      try {
        await activeModelService.loadTextModel(textModelId);
        isTextModelLoaded = getActiveEngineService()?.isModelLoaded() ?? false;
      } catch (err) {
        loadError = err;
        logger.warn('[ImageGen] Failed to load text model for enhancement, using original prompt:', err);
      }
      if (!isTextModelLoaded) {
        logger.warn('[ImageGen] Text model still not loaded after on-demand load, skipping enhancement');
        // Soft, non-blocking notice: the image still generates from the original
        // prompt — surfaced on the same dismissible card (never silent), and the
        // text-model error text lets the card flag memory pressure if that's why.
        this._noticeEnhancementSkipped(
          loadError instanceof Error ? loadError.message : 'the text model could not load',
        );
        return params.prompt;
      }
    }
    this.updateState({
      phase: 'enhancing', prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Enhancing prompt with AI...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });
    const contextMessages = params.conversationId ? getConversationContext(params.conversationId) : [];
    let tempMessageId: string | null = null;
    if (params.conversationId) {
      const tempMessage = useChatStore.getState().addMessage(params.conversationId, {
        role: 'assistant', content: 'Enhancing your prompt...', isThinking: true,
      });
      tempMessageId = tempMessage.id;
    }
    try {
      logger.log('[ImageGen] 📤 Calling generateStandalone for enhancement (active engine)...');
      // Stream the partial rewrite into the temp thinking message so the user sees live
      // progress instead of a frozen "Enhancing..." (B30b) — the enhancement can take a
      // while and looked hung. Rendered under the same "Enhanced prompt" label the final
      // result uses, so the partial reads as the answer forming.
      let streamed = '';
      const onEnhanceToken = (token: string) => {
        streamed += token;
        if (params.conversationId && tempMessageId) {
          useChatStore.getState().updateMessageContent(
            params.conversationId, tempMessageId, `<think>__LABEL:Enhanced prompt__\n${streamed}</think>`,
          );
        }
      };
      let raw = await generateStandalone(buildEnhancementMessages(params.prompt, contextMessages), onEnhanceToken);
      logger.log('[ImageGen] 📥 generateStandalone returned');
      raw = cleanEnhancedPrompt(raw);
      logger.log('[ImageGen] ✅ Original prompt:', params.prompt);
      logger.log('[ImageGen] ✅ Enhanced prompt:', raw);
      await this._resetLlmAfterEnhancement();
      const enhancedPrompt = raw || params.prompt;
      await this._updateEnhancementMessage({ conversationId: params.conversationId, tempMessageId, enhancedPrompt, originalPrompt: params.prompt });
      return enhancedPrompt;
    } catch (error: any) {
      logger.error('[ImageGen] ❌ Prompt enhancement failed:', error);
      logger.error('[ImageGen] Error details:', error?.message || 'Unknown error');
      await this._resetLlmAfterEnhancement();
      if (params.conversationId && tempMessageId) {
        useChatStore.getState().deleteMessage(params.conversationId, tempMessageId);
      }
      return params.prompt;
    }
  }

  private async _ensureImageModelLoaded(activeImageModelId: string | null, activeImageModel: ActiveImageModel, opts: { desiredThreads: number; override?: boolean }): Promise<boolean> {
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
    const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
    const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
    const needsThreadReload = loadedThreads == null || loadedThreads !== opts.desiredThreads;
    if (isImageModelLoaded && loadedPath === activeImageModel.modelPath && !needsThreadReload) return true;
    if (!activeImageModelId) {
      this._fail('No image model selected');
      return false;
    }
    try {
      this.updateState({ phase: 'loading', status: `Loading ${activeImageModel.name}...` });
      await activeModelService.loadImageModel(activeImageModelId, undefined, opts.override ? { override: true } : undefined);
      return true;
    } catch (error: any) {
      // Pass the TYPED error as `cause` — an OverridableMemoryError here is what lets
      // the failure card offer "Load Anyway". Stringifying it (as before) hid it.
      this._fail(`Failed to load image model: ${error?.message || 'Unknown error'}`, { cause: error });
      return false;
    }
  }

  private _saveResult(result: any, opts: { params: GenerateImageParams; activeImageModel: any; meta: { steps: number; guidanceScale: number; useOpenCL: boolean; startTime: number } }): GeneratedImage {
    const { params, activeImageModel, meta } = opts;
    result.modelId = activeImageModel.id;
    if (params.conversationId) result.conversationId = params.conversationId;
    useAppStore.getState().addGeneratedImage(result);
    // First successful generation warmed the backend — don't show the ~120s
    // one-time notice for this model again (persisted across launches).
    useAppStore.getState().markImageModelWarmed(activeImageModel.id);
    useAppStore.getState().completeChecklistStep('triedImageGen');
    this._checkSharePrompt();
    if (params.conversationId) {
      const genTime = Date.now() - meta.startTime;
      useChatStore.getState().addMessage(params.conversationId, {
        role: 'assistant',
        content: `Generated image for: "${params.prompt}"`,
        attachments: [{ id: result.id, type: 'image', uri: `file://${result.imagePath}`, width: result.width, height: result.height }],
        generationTimeMs: genTime,
        generationMeta: buildImageGenMeta(activeImageModel, { steps: meta.steps, guidanceScale: meta.guidanceScale, result, useOpenCL: meta.useOpenCL }),
      });
    }
    this.updateState({ phase: 'done', progress: null, status: null, previewPath: null, result, error: null });
    return result;
  }

  private async _runGenerationAndSave(opts: RunGenerationOptions): Promise<GeneratedImage | null> {
    const { params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL } = opts;

    // The first generation for a model compiles/warms the backend and takes ~120s.
    // This is platform-agnostic: on iOS the CoreML model compiles on first use, on
    // Android the OpenCL kernels compile. The persisted `warmedImageModels` flag is
    // the single cross-platform signal (so the notice shows once on every device);
    // the OpenCL kernel-cache check is an extra Android signal in case the cache was
    // cleared after the flag was set.
    let isFirstRun = !useAppStore.getState().warmedImageModels.includes(activeImageModel.id);
    if (useOpenCL) {
      try {
        const hasCache = await onnxImageGeneratorService.hasKernelCache(activeImageModel.modelPath);
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
        { prompt: enhancedPrompt, negativePrompt: params.negativePrompt || '', steps, guidanceScale, seed: params.seed, width: imageWidth, height: imageHeight, previewInterval: params.previewInterval ?? 2, useOpenCL },
        (progress) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(progress.step, steps);
          // Once steps are advancing it IS generating — don't mislabel it "GPU
          // optimization" (which read as if generation hadn't started). On the first run
          // the GPU is still warming, so note that as a one-time aside, not the headline.
          const status = displayStep <= 1 && isFirstRun
            ? 'Optimizing GPU for your device (~120s, one-time)...'
            : `Generating image (${displayStep}/${steps})...${isFirstRun ? ' (optimizing GPU, one-time)' : ''}`;
          this.updateState({ progress: { step: displayStep, totalSteps: steps }, status });
        },
        (preview) => {
          if (this.cancelRequested) return;
          const displayStep = Math.min(preview.step, steps);
          this.updateState({ previewPath: `file://${preview.previewPath}?t=${Date.now()}`, status: `Refining image (${displayStep}/${steps})...` });
        },
      );
      if (this.cancelRequested || !result?.imagePath) { this.resetState(); return null; }
      return this._saveResult(result, { params, activeImageModel, meta: { steps, guidanceScale, useOpenCL, startTime } });
    } catch (error: any) {
      const errorMsg = error?.message || 'Image generation failed';
      if (errorMsg.includes('cancelled')) {
        this.resetState();
      } else {
        logger.error('[ImageGenerationService] Generation error:', error);

        // If the pipeline crashed or the model was unloaded, surface a
        // user-friendly message and allow retry (model will auto-reload).
        const isPipelineCrash = errorMsg.includes('Pipeline failed') ||
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
  async generateImage(params: GenerateImageParams, opts?: { override?: boolean }): Promise<GeneratedImage | null> {
    if (isInFlight(this.state.phase)) {
      logger.log('[ImageGenerationService] Already generating, ignoring request');
      return null;
    }
    this._lastParams = params; // so a failure card's Retry can re-run this exact request
    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeImageModel) return this._fail('No image model selected');

    const steps = params.steps || settings.imageSteps || 8;
    const guidanceScale = params.guidanceScale || settings.imageGuidanceScale || DEFAULT_IMAGE_GUIDANCE;
    // Floor to 256: SD-class models render garbage (incoherent, not "smaller") below 256,
    // so a stale sub-256 setting must never reach the pipeline. The slider min is also 256;
    // this guards the persisted-value + programmatic paths so the user never sees garbage.
    const imageWidth = Math.max(SWEET_SPOT_SIZE, settings.imageWidth || SWEET_SPOT_SIZE);
    const imageHeight = Math.max(SWEET_SPOT_SIZE, settings.imageHeight || SWEET_SPOT_SIZE);

    const enhancedPrompt = await this._enhancePrompt(params, steps);
    logger.log('[ImageGen] enhanceImagePrompts setting:', settings.enhanceImagePrompts);
    this.cancelRequested = false;

    // Establish the generating state unconditionally — not only when enhancement
    // is off. When enhancement is ON but _enhancePrompt bailed early (e.g. no text
    // model loaded, so enhancement was skipped), it never set isGenerating, so the
    // in-progress card never appeared. Setting it here fixes that; on the
    // enhancement-ran path this just swaps the 'Enhancing…' status for 'Preparing…'
    // before the image model loads.
    this.updateState({
      phase: 'loading', prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Preparing image generation...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });

    const loaded = await this._ensureImageModelLoaded(activeImageModelId, activeImageModel, { desiredThreads: settings.imageThreads ?? 4, override: opts?.override });
    if (!loaded) return null;
    if (this.cancelRequested) { this.resetState(); return null; }

    return this._runGenerationAndSave({ params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL: settings.imageUseOpenCL ?? true });
  }

  async cancelGeneration(): Promise<void> {
    if (!isInFlight(this.state.phase)) return;
    this.cancelRequested = true;
    try { await onnxImageGeneratorService.cancelGeneration(); } catch { /* Ignore */ }
    this.resetState();
  }

  private resetState(): void {
    this.updateState({
      phase: 'idle', progress: null, status: null, previewPath: null,
      prompt: null, conversationId: null, error: null,
      // Keep result so the last generated image is still accessible
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
