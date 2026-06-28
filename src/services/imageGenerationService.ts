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

const SHARE_PROMPT_DELAY_MS = 2000;

export interface ImageGenerationState {
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
  private state: ImageGenerationState = {
    isGenerating: false, progress: null, status: null, previewPath: null,
    prompt: null, conversationId: null, error: null, result: null,
  };

  private readonly listeners: Set<ImageGenerationListener> = new Set();
  private cancelRequested: boolean = false;

  getState(): ImageGenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
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
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
    const appStore = useAppStore.getState();
    if ('isGenerating' in partial) appStore.setIsGeneratingImage(this.state.isGenerating);
    if ('progress' in partial) appStore.setImageGenerationProgress(this.state.progress);
    if ('status' in partial) appStore.setImageGenerationStatus(this.state.status);
    if ('previewPath' in partial) appStore.setImagePreviewPath(this.state.previewPath);
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
        return params.prompt;
      }
      this.updateState({
        isGenerating: true, prompt: params.prompt, conversationId: params.conversationId || null,
        status: 'Loading text model to enhance prompt...', previewPath: null,
        progress: { step: 0, totalSteps: steps }, error: null, result: null,
      });
      try {
        await activeModelService.loadTextModel(textModelId);
        isTextModelLoaded = llmService.isModelLoaded();
      } catch (err) {
        logger.warn('[ImageGen] Failed to load text model for enhancement, using original prompt:', err);
      }
      if (!isTextModelLoaded) {
        logger.warn('[ImageGen] Text model still not loaded after on-demand load, skipping enhancement');
        return params.prompt;
      }
    }
    this.updateState({
      isGenerating: true, prompt: params.prompt, conversationId: params.conversationId || null,
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
      this.updateState({ error: 'No image model selected', isGenerating: false });
      return false;
    }
    try {
      this.updateState({ status: `Loading ${activeImageModel.name}...` });
      await activeModelService.loadImageModel(activeImageModelId);
      return true;
    } catch (error: any) {
      this.updateState({ isGenerating: false, progress: null, status: null, error: `Failed to load image model: ${error?.message || 'Unknown error'}` });
      return false;
    }
  }

  private _saveResult(result: any, opts: { params: GenerateImageParams; activeImageModel: any; meta: { steps: number; guidanceScale: number; useOpenCL: boolean; startTime: number } }): GeneratedImage {
    const { params, activeImageModel, meta } = opts;
    result.modelId = activeImageModel.id;
    if (params.conversationId) result.conversationId = params.conversationId;
    useAppStore.getState().addGeneratedImage(result);
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
    this.updateState({ isGenerating: false, progress: null, status: null, previewPath: null, result, error: null });
    return result;
  }

  private async _runGenerationAndSave(opts: RunGenerationOptions): Promise<GeneratedImage | null> {
    const { params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL } = opts;

    // Check if this is the first GPU run (no OpenCL kernel cache yet)
    let isFirstGpuRun = false;
    if (useOpenCL) {
      try {
        const hasCache = await onnxImageGeneratorService.hasKernelCache(activeImageModel.modelPath);
        isFirstGpuRun = !hasCache;
      } catch (e) {
        // If check fails, assume cache exists to avoid false positives
        logger.warn('[ImageGen] Failed to check for OpenCL kernel cache:', e);
      }
    }

    this.updateState({
      status: isFirstGpuRun
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
          if (isFirstGpuRun) {
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

        this.updateState({ isGenerating: false, progress: null, status: null, previewPath: null, error: userMessage });
      }
      return null;
    }
  }

  /**
   * Generate an image. Runs independently of UI lifecycle.
   * If conversationId is provided, the result will be added as a chat message.
   */
  async generateImage(params: GenerateImageParams): Promise<GeneratedImage | null> {
    if (this.state.isGenerating) {
      logger.log('[ImageGenerationService] Already generating, ignoring request');
      return null;
    }
    const { settings, activeImageModelId, downloadedImageModels } = useAppStore.getState();
    const activeImageModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeImageModel) { this.updateState({ error: 'No image model selected' }); return null; }

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
      isGenerating: true, prompt: params.prompt, conversationId: params.conversationId || null,
      status: 'Preparing image generation...', previewPath: null,
      progress: { step: 0, totalSteps: steps }, error: null, result: null,
    });

    const loaded = await this._ensureImageModelLoaded(activeImageModelId, activeImageModel, settings.imageThreads ?? 4);
    if (!loaded) return null;
    if (this.cancelRequested) { this.resetState(); return null; }

    return this._runGenerationAndSave({ params, enhancedPrompt, activeImageModel, steps, guidanceScale, imageWidth, imageHeight, useOpenCL: settings.imageUseOpenCL ?? true });
  }

  async cancelGeneration(): Promise<void> {
    if (!this.state.isGenerating) return;
    this.cancelRequested = true;
    try { await onnxImageGeneratorService.cancelGeneration(); } catch { /* Ignore */ }
    this.resetState();
  }

  private resetState(): void {
    this.updateState({
      isGenerating: false, progress: null, status: null, previewPath: null,
      prompt: null, conversationId: null, error: null,
      // Keep result so the last generated image is still accessible
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
