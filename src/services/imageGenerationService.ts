/** ImageGenerationService - Handles image generation independently of UI lifecycle */
import { localDreamGeneratorService as onnxImageGeneratorService } from './localDreamGenerator';
import { activeModelService } from './activeModelService';
import { llmService } from './llm';
import { useAppStore, useChatStore } from '../stores';
import { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { shouldShowSharePrompt, emitSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForImage } from '../utils/proPrompt';
import { buildEnhancementMessages, getConversationContext, cleanEnhancedPrompt, buildImageGenMeta } from './imageGenerationHelpers';
import { reportModelFailure } from './modelFailureHandler';
import { reasonFromLoadError } from './modelFailureReasons';

const SHARE_PROMPT_DELAY_MS = 2000;

/**
 * Explicit lifecycle phase — the single source of truth for "what is image
 * generation doing right now". The UI projects this (it never assembles the
 * in-progress view from scattered flags), so the progress indicator can't flash
 * or desync: it's shown for exactly `enhancing | loading | generating | saving`
 * and hidden otherwise.
 */
export type ImageGenPhase =
  | 'idle'
  | 'enhancing'  // running the text model to enrich the prompt
  | 'loading'    // loading the image model into memory
  | 'generating' // diffusion steps running
  | 'saving'     // writing the result + adding the chat message
  | 'done'
  | 'error'
  | 'cancelled';

/** True while a generation is actively in flight (drives the progress indicator). */
export function isInFlight(phase: ImageGenPhase): boolean {
  return phase === 'enhancing' || phase === 'loading' || phase === 'generating' || phase === 'saving';
}

export interface ImageGenerationState {
  phase: ImageGenPhase;
  /** Derived from phase (isInFlight) — kept for back-compat with existing readers. */
  isGenerating: boolean;
  progress: { step: number; totalSteps: number } | null;
  status: string | null;
  previewPath: string | null;
  prompt: string | null;
  conversationId: string | null;
  error: string | null;
  result: GeneratedImage | null;
}

type ImageGenerationListener = (state: ImageGenerationState) => void;

interface GenerateImageParams {
  prompt: string;
  conversationId?: string;
  negativePrompt?: string;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  previewInterval?: number;
}

interface ActiveImageModel {
  id: string;
  name: string;
  modelPath: string;
  backend?: string;
}

interface RunGenerationOptions {
  params: GenerateImageParams;
  enhancedPrompt: string;
  activeImageModel: ActiveImageModel;
  steps: number;
  guidanceScale: number;
  imageWidth: number;
  imageHeight: number;
  useOpenCL: boolean;
}

interface UpdateEnhancementOptions {
  conversationId: string | undefined;
  tempMessageId: string | null;
  enhancedPrompt: string;
  originalPrompt: string;
}

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
   * error text and offers "Free memory & Retry" (re-runs the last request).
   * Returns null for `return this._fail(...)`.
   */
  private _fail(error: string, _conversationId: string | null = this.state.conversationId): null {
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
    reportModelFailure('image', error, { message: error, onRetry });
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
    if (!s.hasEngagedSharePrompt && shouldShowSharePrompt(count)) setTimeout(() => emitSharePrompt('image'), SHARE_PROMPT_DELAY_MS);
    checkProPromptForImage(SHARE_PROMPT_DELAY_MS);
  }

  private async _resetLlmAfterEnhancement(): Promise<void> {
    logger.log('[ImageGen] 🔄 Starting cleanup - generating:', llmService.isCurrentlyGenerating());
    try {
      await llmService.stopGeneration();
      logger.log('[ImageGen] ✓ stopGeneration() called');
      logger.log('[ImageGen] ✅ LLM service reset complete - generating:', llmService.isCurrentlyGenerating());
    } catch (resetError) {
      logger.error('[ImageGen] ❌ Failed to reset LLM service:', resetError);
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
    let isTextModelLoaded = llmService.isModelLoaded();
    const isLlmGenerating = llmService.isCurrentlyGenerating();
    logger.log('[ImageGen] 🎨 Starting prompt enhancement - Model loaded:', isTextModelLoaded, 'LLM generating:', isLlmGenerating);
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
        isTextModelLoaded = llmService.isModelLoaded();
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
      logger.log('[ImageGen] 📤 Calling llmService.generateResponse for enhancement...');
      let raw = await llmService.generateResponse(buildEnhancementMessages(params.prompt, contextMessages), (_data) => { });
      logger.log('[ImageGen] 📥 llmService.generateResponse returned');
      logger.log('[ImageGen] LLM state after enhancement - generating:', llmService.isCurrentlyGenerating());
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

  private async _ensureImageModelLoaded(activeImageModelId: string | null, activeImageModel: ActiveImageModel, desiredThreads: number): Promise<boolean> {
    const isImageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
    const loadedPath = await onnxImageGeneratorService.getLoadedModelPath();
    const loadedThreads = onnxImageGeneratorService.getLoadedThreads();
    const needsThreadReload = loadedThreads == null || loadedThreads !== desiredThreads;
    if (isImageModelLoaded && loadedPath === activeImageModel.modelPath && !needsThreadReload) return true;
    if (!activeImageModelId) {
      this._fail('No image model selected');
      return false;
    }
    try {
      this.updateState({ phase: 'loading', status: `Loading ${activeImageModel.name}...` });
      await activeModelService.loadImageModel(activeImageModelId);
      return true;
    } catch (error: any) {
      this._fail(`Failed to load image model: ${error?.message || 'Unknown error'}`);
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
          if (isFirstRun) {
            this.updateState({
              progress: { step: displayStep, totalSteps: steps },
              status: displayStep <= 1
                ? 'Optimizing GPU for your device (~120s, one-time)...'
                : `GPU optimization in progress... (${displayStep}/${steps})`,
            });
          } else {
            this.updateState({ progress: { step: displayStep, totalSteps: steps }, status: `Generating image (${displayStep}/${steps})...` });
          }
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
  async generateImage(params: GenerateImageParams): Promise<GeneratedImage | null> {
    if (isInFlight(this.state.phase)) {
      logger.log('[ImageGenerationService] Already generating, ignoring request');
      return null;
    }
    this._lastParams = params; // so a failure card's Retry can re-run this exact request
    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeImageModel) return this._fail('No image model selected', params.conversationId || null);

    const steps = params.steps || settings.imageSteps || 8;
    const guidanceScale = params.guidanceScale || settings.imageGuidanceScale || 2.0;
    const imageWidth = settings.imageWidth || 256;
    const imageHeight = settings.imageHeight || 256;

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

    const loaded = await this._ensureImageModelLoaded(activeImageModelId, activeImageModel, settings.imageThreads ?? 4);
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
