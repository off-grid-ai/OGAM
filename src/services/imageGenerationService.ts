/* eslint-disable max-lines, complexity, prefer-template -- Image generation's existing orchestrator owns retries, metadata, and model residency. */
/** ImageGenerationService - Handles image generation independently of UI lifecycle */
import { Platform } from 'react-native';
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { getActiveEngineService, generateStandalone, isRemoteTextModelActive, stopStandaloneGeneration } from './engines';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { holdScreenAwake, releaseScreenAwake } from '../atlasTools/runtimePower';
import { maybeScheduleSharePrompt } from '../utils/sharePrompt';

import { getImageTuning, getImageGuidance } from '../utils/nativeImageTuning';
import { hardwareService } from './hardware';
import { selectImageAccelerator, imageComputeMode } from './imageAcceleratorSelection';
import { getMissingImageSupportGuides, imageFamilyDisplay, isRunnableNativeModel } from '../utils/nativeImageCompatibility';
import { buildEnhancementMessages, getConversationContext, cleanEnhancedPrompt, buildImageGenMeta } from './imageGenerationHelpers';
import { reportModelFailure } from './modelFailureHandler';
import { reasonFromLoadError } from './modelFailureReasons';
import { isOverridableMemoryError } from './modelLoadErrors';
import { applyImageStyle } from './imageStyles';
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

/** The prompt and negative prompt with the chosen image style added. */
const styled = (prompt: string, negative?: string) => {
  const s = applyImageStyle(prompt, negative || '', useAppStore.getState().settings.imageStyle);
  return { prompt: s.prompt, negativePrompt: s.negative };
};

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
  private requestEpoch = 0;
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
    if (!isInFlight(prevPhase) && isInFlight(this.state.phase)) holdScreenAwake('image-generation');
    else if (isInFlight(prevPhase) && !isInFlight(this.state.phase)) releaseScreenAwake('image-generation');
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
  }

  private async _resetLlmAfterEnhancement(): Promise<void> {
    // Engine-agnostic: reset whichever text engine ran the enhancement (llama OR LiteRT).
    // stopGeneration is supported by both; binding to llmService left a LiteRT generation
    // running after enhancement.
    try {
      await stopStandaloneGeneration();
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

  private _isRequestCurrent(requestEpoch: number): boolean {
    return requestEpoch === this.requestEpoch && !this.cancelRequested;
  }

  private async _ensureEnhancementTextModel(
    params: GenerateImageParams,
    steps: number,
    requestEpoch: number,
  ): Promise<boolean> {
    let loaded = isRemoteTextModelActive() || (getActiveEngineService()?.isModelLoaded() ?? false);
    logger.log('[ImageGen] 🎨 Starting prompt enhancement - Model loaded:', loaded);
    if (loaded) return true;

    // The chosen text model, or the last one used; failing that, the smallest downloaded one
    // (a prompt rewrite does not need a big model), so enhancement does not quietly stop.
    const { activeModelId, lastTextModelId, downloadedModels, settings: appSettings } = useAppStore.getState();
    // Never the small intent-classifier model: loading it for this would make it the chat model.
    const smallest = downloadedModels.filter(m => m.id !== appSettings.classifierModelId).sort((x, y) => (x.fileSize || 0) - (y.fileSize || 0))[0]?.id;
    const textModelId = activeModelId ?? lastTextModelId ?? smallest;
    if (!textModelId) {
      logger.warn('[ImageGen] No text model available, skipping enhancement');
      this._noticeEnhancementSkipped('no text model is selected');
      return false;
    }

    this.updateState({
      phase: 'enhancing', prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Loading text model to enhance prompt...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });

    let loadError: unknown = null;
    try {
      await activeModelService.loadTextModel(textModelId);
      if (!this._isRequestCurrent(requestEpoch)) return false;
      loaded = getActiveEngineService()?.isModelLoaded() ?? false;
    } catch (error) {
      loadError = error;
      logger.warn('[ImageGen] Failed to load text model for enhancement, using original prompt:', error);
    }
    if (loaded) return true;

    this._noticeEnhancementSkipped(
      loadError instanceof Error ? loadError.message : 'the text model could not load',
    );
    return false;
  }

  private _createEnhancementMessage(conversationId?: string): string | null {
    if (!conversationId) return null;
    return useChatStore.getState().addMessage(conversationId, {
      role: 'assistant', content: 'Enhancing your prompt...', isThinking: true,
    }).id;
  }

  private _removeEnhancementMessage(conversationId?: string, tempMessageId?: string | null): void {
    if (conversationId && tempMessageId) {
      useChatStore.getState().deleteMessage(conversationId, tempMessageId);
    }
  }

  private async _streamEnhancedPrompt(params: GenerateImageParams, requestEpoch: number): Promise<string> {
    const contextMessages = params.conversationId ? getConversationContext(params.conversationId) : [];
    const tempMessageId = this._createEnhancementMessage(params.conversationId);
    try {
      logger.log('[ImageGen] 📤 Calling generateStandalone for enhancement (active engine)...');
      let streamed = '';
      const onEnhanceToken = (token: string) => {
        if (!this._isRequestCurrent(requestEpoch)) return;
        streamed += token;
        if (!params.conversationId || !tempMessageId) return;
        useChatStore.getState().updateMessageContent(
          params.conversationId, tempMessageId, `<think>__LABEL:Enhanced prompt__\n${streamed}</think>`,
        );
      };
      let raw = await generateStandalone(buildEnhancementMessages(params.prompt, contextMessages), onEnhanceToken);
      logger.log('[ImageGen] 📥 generateStandalone returned');
      if (!this._isRequestCurrent(requestEpoch)) {
        this._removeEnhancementMessage(params.conversationId, tempMessageId);
        return params.prompt;
      }

      raw = cleanEnhancedPrompt(raw);
      await this._resetLlmAfterEnhancement();
      const enhancedPrompt = raw || params.prompt;
      await this._updateEnhancementMessage({
        conversationId: params.conversationId,
        tempMessageId,
        enhancedPrompt,
        originalPrompt: params.prompt,
      });
      return enhancedPrompt;
    } catch (error: any) {
      logger.error('[ImageGen] ❌ Prompt enhancement failed:', error);
      if (this._isRequestCurrent(requestEpoch)) await this._resetLlmAfterEnhancement();
      this._removeEnhancementMessage(params.conversationId, tempMessageId);
      return params.prompt;
    }
  }

  private async _enhancePrompt(params: GenerateImageParams, steps: number, requestEpoch: number = this.requestEpoch): Promise<string> {
    const { settings } = useAppStore.getState();
    if (!settings.enhanceImagePrompts) {
      logger.log('[ImageGen] Enhancement disabled, using original prompt');
      return params.prompt;
    }
    if (!(await this._ensureEnhancementTextModel(params, steps, requestEpoch))) return params.prompt;

    this.updateState({
      phase: 'enhancing', prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Enhancing prompt with AI...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });
    return this._streamEnhancedPrompt(params, requestEpoch);
  }

  private async _ensureImageModelLoaded(activeImageModelId: string | null, activeImageModel: ActiveImageModel, opts: { desiredThreads: number; override?: boolean; requestEpoch?: number }): Promise<boolean> {
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
      // A request cancelled while its model was loading must not fail a newer request.
      if (opts.requestEpoch !== undefined && !this._isRequestCurrent(opts.requestEpoch)) return false;
      this._fail(`Failed to load image model: ${error?.message || 'Unknown error'}`, { cause: error });
      return false;
    }
  }

  private _saveResult(result: any, opts: { params: GenerateImageParams; activeImageModel: any; meta: { steps: number; guidanceScale: number; useOpenCL: boolean; computeBackend?: 'vulkan' | 'opencl' | 'cpu'; fallbackNotes?: string[]; startTime: number } }): GeneratedImage {
    const { params, activeImageModel, meta } = opts;
    result.modelId = activeImageModel.id;
    if (params.conversationId) result.conversationId = params.conversationId;
    // A picture made in a private or PIN-locked chat stays with that chat: it is hidden from the
    // Gallery and never written to the saved image list (its prompt would be readable there).
    const sensitiveChat = params.conversationId
      ? require('../stores/chatStore').useChatStore.getState().conversations.find((c: any) => c.id === params.conversationId)
      : undefined;
    if (sensitiveChat?.isPrivate || sensitiveChat?.pinVerifier) {
      useAppStore.getState().hideGeneratedImage(result.id, sensitiveChat.isPrivate ? 'private' : 'locked');
    }
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
        content: `Generated image for: "${params.prompt}"`
          + (meta.fallbackNotes?.length ? `\n\n${meta.fallbackNotes.join('. ')}. Made on ${meta.computeBackend === 'cpu' ? 'the CPU' : meta.computeBackend === 'opencl' ? 'OpenCL' : 'Vulkan'} instead.` : ''),
        attachments: [{ id: result.id, type: 'image', uri: `file://${result.imagePath}`, width: result.width, height: result.height }],
        generationTimeMs: genTime,
        generationMeta: buildImageGenMeta(activeImageModel, { steps: meta.steps, guidanceScale: meta.guidanceScale, result, useOpenCL: meta.useOpenCL, computeBackend: meta.computeBackend }),
      });
    }
    this.updateState({ phase: 'done', progress: null, status: null, previewPath: null, result, error: null });
    return result;
  }

  private async _getImageWarmupState(activeImageModel: ActiveImageModel, useOpenCL: boolean) {
    const actualBackend = await onnxImageGeneratorService.getLoadedBackend?.() ?? null;
    const runtimeModel = actualBackend ? { ...activeImageModel, backend: actualBackend } : activeImageModel;
    let isFirstRun = !useAppStore.getState().warmedImageModels.includes(activeImageModel.id);
    if (Platform.OS === 'android' && useOpenCL && runtimeModel.backend === 'mnn') {
      try {
        const hasCache = await onnxImageGeneratorService.hasKernelCache(activeImageModel.modelPath);
        isFirstRun = isFirstRun || !hasCache;
      } catch (error) {
        logger.warn('[ImageGen] Failed to check for OpenCL kernel cache:', error);
      }
    }
    let warmupStatus = 'Optimizing GPU for your device (~120s, one-time)...';
    if (runtimeModel.backend === 'sdcpp') {
      // Native Vulkan first run is not OpenCL kernel warmup. Avoid false ETAs.
      warmupStatus = 'Preparing native image model and checking Vulkan GPU...';
    }
    if (runtimeModel.backend === 'qnn') warmupStatus = 'Preparing NPU image model (one-time)...';
    else if (Platform.OS === 'ios') warmupStatus = 'Preparing Core ML image model (one-time)...';
    return { runtimeModel, isFirstRun, warmupStatus };
  }

  private _imageProgressHandlers(opts: { steps: number; isFirstRun: boolean; warmupStatus: string; requestEpoch: number }) {
    const { steps, isFirstRun, warmupStatus, requestEpoch } = opts;
    return {
      onProgress: (progress: { step: number }) => {
        if (!this._isRequestCurrent(requestEpoch)) return;
        const displayStep = Math.min(progress.step, steps);
        const suffix = isFirstRun ? ' (one-time warm-up)' : '';
        const status = displayStep === 0 && isFirstRun ? warmupStatus : `Generating image (${displayStep}/${steps})...${suffix}`;
        this.updateState({ progress: { step: displayStep, totalSteps: steps }, status });
      },
      onPreview: (preview: { step: number; previewPath: string }) => {
        if (!this._isRequestCurrent(requestEpoch)) return;
        const displayStep = Math.min(preview.step, steps);
        this.updateState({
          previewPath: `file://${preview.previewPath}?t=${Date.now()}`,
          status: `Refining image (${displayStep}/${steps})...`,
        });
      },
    };
  }

  private _handleImageGenerationError(error: any): void {
    const errorMsg = error?.message || 'Image generation failed';
    if (errorMsg.toLowerCase().includes('cancel')) {
      this.resetState();
      return;
    }
    logger.error('[ImageGenerationService] Generation error:', error);
    const crashMarkers = ['Pipeline failed', 'unloaded', 'ERR_NO_MODEL', 'TextEncoder'];
    const userMessage = crashMarkers.some(marker => errorMsg.includes(marker))
      ? 'Image generation failed — the model encountered an error and was unloaded. Please try again.'
      : errorMsg;
    this._fail(userMessage);
  }

  private async _runGenerationAndSave(opts: RunGenerationOptions, requestEpoch: number): Promise<GeneratedImage | null> {
    const { params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL, computeBackend } = opts;
    const { runtimeModel, isFirstRun, warmupStatus } = await this._getImageWarmupState(activeImageModel, useOpenCL);
    if (!this._isRequestCurrent(requestEpoch)) return null;

    this.updateState({ phase: 'generating', status: isFirstRun ? warmupStatus : 'Starting image generation...' });
    const startTime = Date.now();
    const handlers = this._imageProgressHandlers({ steps, isFirstRun, warmupStatus, requestEpoch });
    try {
      const result = await onnxImageGeneratorService.generateImage(
        { ...styled(enhancedPrompt, params.negativePrompt), steps, guidanceScale, seed: params.seed, width: imageWidth, height: imageHeight, previewInterval: params.previewInterval ?? 2, useOpenCL,
          ...(computeBackend ? { computeBackend } : {}),
          threads: useAppStore.getState().settings.imageThreads ?? 4 },
        handlers.onProgress,
        handlers.onPreview,
      );
      if (!this._isRequestCurrent(requestEpoch)) return null;
      if (!result?.imagePath) { this.resetState(); return null; }
      return this._saveResult(result, { params, activeImageModel: runtimeModel, meta: { steps, guidanceScale, useOpenCL, computeBackend, fallbackNotes: opts.fallbackNotes, startTime } });
    } catch (error: any) {
      if (!this._isRequestCurrent(requestEpoch)) return null;
      // A GPU engine that fails (driver rejects a shader, unsupported op, stall) is not the
      // end: try the next backend and say so, instead of leaving the user with no image.
      const message = String(error?.message || error || '');
      const [next, ...later] = opts.fallbacks ?? [];
      if (next && !this.cancelRequested && !/cancel/i.test(message)) {
        const label = (b?: string) => b === 'opencl' ? 'OpenCL' : b === 'cpu' ? 'CPU' : 'Vulkan';
        const why = `${label(computeBackend)} failed (${message.slice(0, 160)})`;
        logger.warn(`[ImageGen] ${why}; trying ${label(next.computeBackend)}`);
        // The failed attempt's picture is gone (the next run clears it), so do not keep showing it.
        this.updateState({ status: `${why}. Trying ${label(next.computeBackend)}...`, previewPath: null, progress: { step: 0, totalSteps: steps } });
        return this._runGenerationAndSave({
          ...opts, useOpenCL: next.useOpenCL, computeBackend: next.computeBackend,
          fallbacks: later, fallbackNotes: [...(opts.fallbackNotes ?? []), why],
        }, requestEpoch);
      }
      this._handleImageGenerationError(error);
      return null;
    } finally {
      if (requestEpoch === this.requestEpoch) {
        await Promise.resolve(activeModelService.syncWithNativeState?.()).catch(() => {});
      }
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
    const requestEpoch = ++this.requestEpoch;
    this.cancelRequested = false;
    this._lastParams = params; // so a failure card's Retry can re-run this exact request
    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeImageModel) return this._fail('No image model selected');
    if (!isRunnableNativeModel(activeImageModel)) {
      return this._fail('Unsupported image architecture: ' + imageFamilyDisplay(activeImageModel.nativeImageFamily) +
        '. Use a compatible checkpoint instead of attempting incorrect inference.');
    }
    if (activeImageModel.backend === 'sdcpp') {
      const missing = getMissingImageSupportGuides(activeImageModel);
      if (missing.length) return this._fail(imageFamilyDisplay(activeImageModel.nativeImageFamily) +
        ' needs these supporting files: ' + missing.map(item => item.label).join(', ') +
        '. In My models, download the listed files and attach them to this image model before generating.');
    }

    const preset = getImageTuning(activeImageModel, settings);
    const steps = params.steps ?? preset.steps;
    const guidanceScale = params.guidanceScale || getImageGuidance(activeImageModel, settings.imageGuidanceScale);
    // Native SDXL defaults differ from compressed, low-resolution mobile models.
    const imageWidth = preset.width;
    const imageHeight = preset.height;

    const enhancedPrompt = await this._enhancePrompt(params, steps, requestEpoch);
    logger.log('[ImageGen] enhanceImagePrompts setting:', settings.enhanceImagePrompts);
    if (requestEpoch !== this.requestEpoch || this.cancelRequested) return null;

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

    // Choose a model-specific accelerator before loading multi-gigabyte weights.
    // sd.cpp needs Vulkan; MNN uses OpenCL; QNN needs NPU. No CPU fallback.
    let imageBackend;
    try {
      imageBackend = await selectImageAccelerator(
        activeImageModel.backend || 'mnn', imageComputeMode(settings), {
          vulkan: () => onnxImageGeneratorService.getNativeImageGpuDiagnostics(),
          sdOpencl: () => onnxImageGeneratorService.getNativeImageGpuDiagnostics('opencl'),
          opencl: () => hardwareService.getOpenCLCapability(),
          npu: async () => (await hardwareService.getSoCInfo()).hasNPU,
        },
        { allowCpuFallback: settings.imageAllowCpuFallback === true },
      );
    } catch (error: any) {
      if (!this._isRequestCurrent(requestEpoch)) return null;
      return this._fail('Image accelerator unavailable: ' + (error?.message || String(error)));
    }
    if (!this._isRequestCurrent(requestEpoch)) return null;
    // iOS delegates Core ML scheduling to the OS; this restriction is Android-only. Only imported
    // (sd.cpp) checkpoints are gated: their CPU runs take very long, MNN CPU models are made for it.
    const allowSlowCpu = Platform.OS !== 'android' || activeImageModel.backend !== 'sdcpp'
      || settings.imageAllowCpuFallback === true || imageComputeMode(settings) === 'cpu';
    if (imageBackend.selected === 'cpu' && !allowSlowCpu) {
      return this._fail('No usable Vulkan/OpenCL image accelerator found. Enable "Allow slow CPU fallback" in Advanced Image Settings if you want to continue on CPU.');
    }
    // Never silently start a potentially hours-long CPU image job without opting in.
    const allowedFallbacks = allowSlowCpu ? imageBackend.fallbacks : imageBackend.fallbacks?.filter(option => option.selected !== 'cpu');
    this.updateState({ status: 'Selected ' + imageBackend.selected.toUpperCase() + ': ' + imageBackend.note });
    const loaded = await this._ensureImageModelLoaded(activeImageModelId, activeImageModel, { desiredThreads: settings.imageThreads ?? 4, override: opts?.override, requestEpoch });
    if (!loaded) return null;
    if (requestEpoch !== this.requestEpoch) return null;
    if (this.cancelRequested) { this.resetState(); return null; }

    return this._runGenerationAndSave(
      { params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL: imageBackend.useOpenCL,
        computeBackend: imageBackend.computeBackend, fallbacks: allowedFallbacks },
      requestEpoch,
    );
  }

  async cancelGeneration(): Promise<void> {
    if (!isInFlight(this.state.phase)) return;
    const phase = this.state.phase;
    this.cancelRequested = true;
    // Invalidate every async continuation belonging to the cancelled request.
    // A new request may start immediately without allowing the old one to mutate it.
    this.requestEpoch += 1;
    if (phase === 'enhancing') {
      try { await stopStandaloneGeneration(); } catch { /* best-effort */ }
    }
    try { await onnxImageGeneratorService.cancelGeneration(); } catch { /* Ignore */ }
    // The engine takes a moment to wind down. A request sent straight after a cancel would otherwise hit
    // "Image generation already in progress" and show a failure for a request that was fine.
    for (let waited = 0; waited < 4000 && await onnxImageGeneratorService.isGenerating(); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
