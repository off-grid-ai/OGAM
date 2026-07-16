import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  ImageGenerationParams,
  ImageGenerationProgress,
  GeneratedImage,
} from '../types';
import { generateRandomSeed } from '../utils/generateId';
import logger from '../utils/logger';

const { LocalDreamModule, CoreMLDiffusionModule } = NativeModules;

// Pick the right native module per platform
const DiffusionModule = Platform.select({
  ios: CoreMLDiffusionModule,
  android: LocalDreamModule,
  default: null,
});

type ProgressCallback = (progress: ImageGenerationProgress) => void;
type PreviewCallback = (preview: { previewPath: string; step: number; totalSteps: number }) => void;

/**
 * LocalDream-based image generator service.
 * Replaces ONNX Runtime with local-dream's subprocess HTTP server.
 *
 * The native module (LocalDreamModule) manages:
 * - Server process lifecycle (spawn/kill)
 * - HTTP POST + SSE parsing for image generation
 * - RGB→PNG conversion and file management
 *
 * Progress events are emitted via NativeEventEmitter from the native side.
 */
class LocalDreamGeneratorService {
  private loadedThreads: number | null = null;
  private generating = false;
  private eventEmitter: NativeEventEmitter | null = null;

  private getEmitter(): NativeEventEmitter {
    if (!this.eventEmitter) {
      this.eventEmitter = new NativeEventEmitter(DiffusionModule);
    }
    return this.eventEmitter;
  }

  isAvailable(): boolean {
    return DiffusionModule != null;
  }

  async isModelLoaded(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return await DiffusionModule.isModelLoaded();
    } catch {
      return false;
    }
  }

  async getLoadedModelPath(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      return await DiffusionModule.getLoadedModelPath();
    } catch {
      return null;
    }
  }

  async loadModel(modelPath: string, threads?: number, opts: { backend?: 'mnn' | 'qnn' | 'auto'; cpuOnly?: boolean; attentionVariant?: 'split_einsum' | 'original'; preferGpu?: boolean } = {}): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('LocalDream image generation is not available on this platform');
    }

    const backend = opts.backend ?? 'auto';
    const params: { modelPath: string; threads?: number; backend: string; cpuOnly?: boolean; attentionVariant?: string; preferGpu?: boolean } = {
      modelPath,
      backend,
    };
    if (typeof threads === 'number') {
      params.threads = threads;
    }
    if (opts.cpuOnly) {
      params.cpuOnly = true;
    }
    if (opts.attentionVariant) {
      params.attentionVariant = opts.attentionVariant;
    }
    // iOS Core ML only: select the compute path (GPU vs Neural Engine) the
    // residency estimate was sized for, so the native load matches the budget.
    if (typeof opts.preferGpu === 'boolean') {
      params.preferGpu = opts.preferGpu;
    }

    const result = await DiffusionModule.loadModel(params);
    this.loadedThreads = typeof threads === 'number' ? threads : this.loadedThreads;
    return result;
  }

  getLoadedThreads(): number | null {
    return this.loadedThreads;
  }

  async unloadModel(): Promise<boolean> {
    if (!this.isAvailable()) return true;
    try {
      const result = await DiffusionModule.unloadModel();
      this.loadedThreads = null;
      return result;
    } catch (e) {
      logger.log('[LocalDream] unloadModel failed (bridge may be torn down):', e);
      this.loadedThreads = null;
      return false;
    }
  }

  private subscribeToProgress(onProgress?: ProgressCallback, onPreview?: PreviewCallback): any {
    return this.getEmitter().addListener(
      'LocalDreamProgress',
      (event: { step: number; totalSteps: number; progress: number; previewPath?: string }) => {
        logger.log(`[WIRE-IMAGE-PROGRESS] ${JSON.stringify(event)}`); // [WIRE] raw LocalDreamProgress event shape
        onProgress?.({
          step: event.step,
          totalSteps: event.totalSteps,
          progress: event.progress,
        });
        if (event.previewPath && onPreview) {
          onPreview({ previewPath: event.previewPath, step: event.step, totalSteps: event.totalSteps });
        }
      },
    );
  }

  private buildNativeParams(params: ImageGenerationParams & { previewInterval?: number }, prompt: string) {
    const np = {
      prompt,
      negativePrompt: params.negativePrompt || '',
      steps: params.steps || 8,
      guidanceScale: params.guidanceScale || 7.5,
      seed: params.seed ?? generateRandomSeed(),
      width: params.width || 512,
      height: params.height || 512,
      previewInterval: params.previewInterval ?? 2,
      useOpenCL: params.useOpenCL ?? true,
    };
    logger.log(`[WIRE-IMAGE-PARAMS] ${JSON.stringify({ requested: { steps: params.steps, guidanceScale: params.guidanceScale, width: params.width, height: params.height }, native: { ...np, prompt: undefined } })}`); // [WIRE] settings→native image params
    return np;
  }

  private buildResult(params: ImageGenerationParams, result: any): GeneratedImage {
    logger.log(`[WIRE-IMAGE] ${JSON.stringify(result)}`); // [WIRE] raw native generateImage result shape from-device
    return {
      id: result.id,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      imagePath: result.imagePath,
      width: result.width,
      height: result.height,
      steps: params.steps || 8,
      seed: result.seed,
      modelId: '',
      createdAt: Date.now().toString(),
    };
  }

  async generateImage(
    params: ImageGenerationParams & { previewInterval?: number },
    onProgress?: ProgressCallback,
    onPreview?: PreviewCallback,
  ): Promise<GeneratedImage> {
    if (!this.isAvailable()) {
      throw new Error('LocalDream image generation is not available on this platform');
    }
    if (this.generating) {
      throw new Error('Image generation already in progress');
    }
    const trimmedPrompt = (params.prompt || '').trim();
    if (!trimmedPrompt) {
      throw new Error('Cannot generate image with an empty prompt');
    }

    this.generating = true;
    const progressSubscription = this.subscribeToProgress(onProgress, onPreview);

    try {
      const result = await DiffusionModule.generateImage(this.buildNativeParams(params, trimmedPrompt));
      // Native side releases the CoreML pipeline after generation to free
      // memory, so clear TS-side state so the next request triggers a reload.
      this.loadedThreads = null;
      return this.buildResult(params, result);
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('ERR_NO_MODEL') || msg.includes('unloaded') || msg.includes('Pipeline failed')) {
        this.loadedThreads = null;
      }
      throw error;
    } finally {
      this.generating = false;
      progressSubscription?.remove();
    }
  }

  async cancelGeneration(): Promise<boolean> {
    if (!this.isAvailable()) return true;
    this.generating = false;
    return await DiffusionModule.cancelGeneration();
  }

  async isGenerating(): Promise<boolean> {
    return this.generating;
  }

  async getGeneratedImages(): Promise<GeneratedImage[]> {
    if (!this.isAvailable()) return [];
    try {
      const images = await DiffusionModule.getGeneratedImages();
      return images.map((img: any) => ({
        id: img.id,
        prompt: img.prompt || '',
        imagePath: img.imagePath,
        width: img.width || 512,
        height: img.height || 512,
        steps: img.steps || 20,
        seed: img.seed || 0,
        modelId: img.modelId || '',
        createdAt: img.createdAt,
      }));
    } catch {
      return [];
    }
  }

  async deleteGeneratedImage(imageId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return await DiffusionModule.deleteGeneratedImage(imageId);
  }

  async clearOpenCLCache(modelPath: string): Promise<number> {
    if (Platform.OS !== 'android' || !this.isAvailable()) return 0;
    return await DiffusionModule.clearOpenCLCache(modelPath);
  }

  async hasKernelCache(modelPath: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.isAvailable()) return true;
    return await DiffusionModule.hasOpenCLCache(modelPath);
  }

  getConstants() {
    if (!this.isAvailable()) {
      return {
        DEFAULT_STEPS: 20,
        DEFAULT_GUIDANCE_SCALE: 7.5,
        DEFAULT_WIDTH: 512,
        DEFAULT_HEIGHT: 512,
        SUPPORTED_WIDTHS: [128, 192, 256, 320, 384, 448, 512],
        SUPPORTED_HEIGHTS: [128, 192, 256, 320, 384, 448, 512],
      };
    }
    const __c = DiffusionModule.getConstants();
    logger.log(`[WIRE-IMAGE-CONSTANTS] ${JSON.stringify(__c)}`); // [WIRE] raw native diffusion constants (steps/guidance/supported sizes)
    return __c;
  }
}

export const localDreamGeneratorService = new LocalDreamGeneratorService();
