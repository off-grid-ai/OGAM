import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
  ImageGenerationParams,
  ImageGenerationProgress,
  GeneratedImage,
} from '../types';
import { resolveSDImagePack } from './huggingFaceModelBrowser';
import { validateImageModelDir } from '../utils/imageModelIntegrity';
import { generateId, generateRandomSeed } from '../utils/generateId';
import logger from '../utils/logger';
import { resolveOwnedDocumentPath } from '../utils/resolveDocumentPath';

const { LocalDreamModule, CoreMLDiffusionModule, VideoGenerationModule: SDModule } = NativeModules;
const PROGRESS_LOG_SAMPLE_STEPS = 5;

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
  private usingSD = false;
  private loadedThreads: number | null = null;
  private generating = false;
  private eventEmitter: NativeEventEmitter | null = null;

  private getEmitter(): NativeEventEmitter {
    if (!this.eventEmitter) {
      this.eventEmitter = new NativeEventEmitter(this.usingSD ? SDModule : DiffusionModule);
    }
    return this.eventEmitter;
  }

  isAvailable(): boolean {
    return DiffusionModule != null || SDModule?.generateImage != null;
  }

  async isModelLoaded(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      if (SDModule?.getLoadedImagePath && await SDModule.getLoadedImagePath()) { this.usingSD = true; return true; }
      return await DiffusionModule?.isModelLoaded() ?? false;
    } catch {
      return false;
    }
  }

  async getLoadedModelPath(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      const sdPath = await SDModule?.getLoadedImagePath?.();
      if (sdPath) { this.usingSD = true; return sdPath; }
      return await DiffusionModule?.getLoadedModelPath() ?? null;
    } catch {
      return null;
    }
  }

  async loadModel(modelPath: string, threads?: number, opts: { backend?: 'mnn' | 'qnn' | 'auto' | 'sd'; modelId?: string; cpuOnly?: boolean; attentionVariant?: 'split_einsum' | 'original'; preferGpu?: boolean } = {}): Promise<boolean> {
    if (!this.isAvailable()) {
      throw new Error('LocalDream image generation is not available on this platform');
    }

    const backend = opts.backend ?? 'auto';
    if (this.generating) throw new Error('Image generation is running.');
    if (backend === 'sd') {
      if (!SDModule?.loadImageModel) throw new Error('This build does not include the SD image runtime.');
      const integrity = await validateImageModelDir(modelPath, 'sd');
      if (!integrity.complete) throw new Error(`The image model pack is incomplete: ${integrity.missing.join(', ')}`);
      const pack = await resolveSDImagePack(opts.modelId ?? modelPath.split('/').pop() ?? '', modelPath);
      if (await DiffusionModule?.isModelLoaded()) await DiffusionModule.unloadModel();
      const diagnostics = new NativeEventEmitter(SDModule).addListener('SDImageProgress', (event: { diagnostic?: string }) => {
        if (event.diagnostic) logger.log(`[SD-IMAGE-NATIVE] ${event.diagnostic}`);
      });
      try {
        await SDModule.loadImageModel({ modelPath, ...pack, threads: threads ?? 4, cpuOnly: opts.cpuOnly ?? false });
      } finally { diagnostics.remove(); }
      this.usingSD = true; this.eventEmitter = null; this.loadedThreads = threads ?? 4;
      return true;
    }
    if (SDModule?.getLoadedImagePath && await SDModule.getLoadedImagePath()) await SDModule.unloadImageModel();
    this.usingSD = false; this.eventEmitter = null;
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
      if (SDModule?.getLoadedImagePath && await SDModule.getLoadedImagePath()) await SDModule.unloadImageModel();
      const result = await DiffusionModule?.unloadModel() ?? true;
      this.usingSD = false; this.eventEmitter = null;
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
      this.usingSD ? 'SDImageProgress' : 'LocalDreamProgress',
      (event: { step: number; totalSteps: number; progress: number; previewPath?: string; diagnostic?: string }) => {
        if (event.diagnostic) {
          logger.log(`[SD-IMAGE-NATIVE] ${event.diagnostic}`);
          return;
        }
        if (
          !Number.isInteger(event.step) ||
          event.step < 1 ||
          event.step === 1 ||
          event.step === event.totalSteps ||
          event.step % PROGRESS_LOG_SAMPLE_STEPS === 0
        ) {
          logger.log(`[WIRE-IMAGE-PROGRESS] ${JSON.stringify(event)}`); // [WIRE] raw LocalDreamProgress event shape
        }
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
      // ISO-8601, the one form every consumer of this field can read - the gallery's date, and the
      // sync descriptor that a peer validates with Date.parse. Epoch milliseconds as text passes the
      // `string` type and fails every reader.
      createdAt: new Date().toISOString(),
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
    let lastStep = -1;
    const progressSubscription = this.subscribeToProgress(progress => {
      if (this.usingSD) {
        if (progress.totalSteps !== (params.steps || 8) || progress.step <= lastStep || progress.step > progress.totalSteps) return;
        lastStep = progress.step;
      }
      onProgress?.(progress);
    }, onPreview);

    try {
      const nativeParams = this.buildNativeParams(params, trimmedPrompt);
      let result;
      if (this.usingSD) {
        const id = generateId();
        const directory = `${RNFS.DocumentDirectoryPath}/generated_images`;
        await RNFS.mkdir(directory);
        result = await SDModule.generateImage({ ...nativeParams, id, outputPath: `${directory}/${id}.png` });
      } else {
        result = await DiffusionModule.generateImage(nativeParams);
      }
      // Native side releases the CoreML pipeline after generation to free
      // memory, so clear TS-side state so the next request triggers a reload.
      if (!this.usingSD) this.loadedThreads = null;
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
    if (this.usingSD) { await SDModule.cancel(); return true; }
    return await DiffusionModule.cancelGeneration();
  }

  isGenerating(): boolean {
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

  async deleteGeneratedImage(imageId: string, storedImagePath?: string): Promise<boolean> {
    if (!this.isAvailable()) return false;

    if (storedImagePath !== undefined) {
      const generatedImageDirectory = `${RNFS.DocumentDirectoryPath}/generated_images`;
      const resolvedPath = resolveOwnedDocumentPath(
        storedImagePath,
        generatedImageDirectory,
      );
      const expectedPath = `${generatedImageDirectory}/${imageId}.png`;
      if (
        !resolvedPath ||
        resolvedPath !== expectedPath ||
        !imageId ||
        imageId.includes('/') ||
        imageId.includes('\0')
      ) {
        return false;
      }

      try {
        if (!(await RNFS.exists(resolvedPath))) return true;
      } catch {
        // Let the native store decide when the filesystem check is unavailable.
      }
    }

    return await DiffusionModule.deleteGeneratedImage(imageId);
  }

  async clearOpenCLCache(modelPath: string): Promise<number> {
    if (this.usingSD || Platform.OS !== 'android' || !this.isAvailable()) return 0;
    return await DiffusionModule.clearOpenCLCache(modelPath);
  }

  async hasKernelCache(modelPath: string): Promise<boolean> {
    if (this.usingSD || Platform.OS !== 'android' || !this.isAvailable()) return true;
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
