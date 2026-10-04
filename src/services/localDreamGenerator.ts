import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
  projectNativeGeneratedImageResult,
  projectNativeImageGeneration,
  type NativeImageGenerationProjection,
} from '@offgrid/models';
import {
  ImageGenerationParams,
  ImageGenerationProgress,
  GeneratedImage,
} from '../types';
import { generateRandomSeed } from '../utils/generateId';
import logger from '../utils/logger';
import { shouldLogProgressStep } from './image/progressDiagnostics';
import {
  nativeImageDeleteFailure,
  projectNativeImageDeletePath,
  projectNativeImageDeleteOutcome,
  type NativeImageDeleteOutcome,
} from './image/nativeImageDeleteOutcome';

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
        // Sampled, not per step: logging every event is a write storm on the JS thread.
        if (shouldLogProgressStep(event.step, event.totalSteps)) {
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

  private buildNativeParams(params: ImageGenerationParams & { previewInterval?: number }): NativeImageGenerationProjection {
    const np = projectNativeImageGeneration({
      platform: Platform.OS,
      request: params,
      randomSeed: generateRandomSeed(),
    });
    logger.log(`[WIRE-IMAGE-PARAMS] ${JSON.stringify({ requested: { steps: params.steps, guidanceScale: params.guidanceScale, width: params.width, height: params.height }, native: { ...np, prompt: undefined } })}`); // [WIRE] settings→native image params
    return np;
  }

  private buildResult(params: NativeImageGenerationProjection, result: unknown): GeneratedImage {
    logger.log(`[WIRE-IMAGE] ${JSON.stringify(result)}`); // [WIRE] raw native generateImage result shape from-device
    const projected = projectNativeGeneratedImageResult({ value: result, request: params });
    if (!projected) throw new Error('Native image generation returned an invalid result');
    return projected;
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
    if (!(params.prompt || '').trim()) {
      throw new Error('Cannot generate image with an empty prompt');
    }

    this.generating = true;
    const progressSubscription = this.subscribeToProgress(onProgress, onPreview);

    try {
      const nativeParams = this.buildNativeParams(params);
      const result = await DiffusionModule.generateImage(nativeParams);
      // Native side releases the CoreML pipeline after generation to free
      // memory, so clear TS-side state so the next request triggers a reload.
      this.loadedThreads = null;
      return this.buildResult(nativeParams, result);
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

  /**
   * Ask the native store to release one generated image's bytes.
   *
   * Never throws: a rejected bridge call is a `failure` outcome, because the caller settles a
   * durable intent and needs the three-way answer (gone / already gone / still there) rather than
   * an exception it would have to re-classify.
   */
  async deleteGeneratedImage(
    imagePath: string,
    commitFence?: () => boolean,
  ): Promise<NativeImageDeleteOutcome> {
    const admitted = projectNativeImageDeletePath(
      imagePath,
      `${RNFS.DocumentDirectoryPath}/generated_images`,
    );
    if (!admitted.ok) return admitted.outcome;
    if (!this.isAvailable()) {
      return nativeImageDeleteFailure(
        'NATIVE_MODULE_UNAVAILABLE',
        'No native image store is available to delete generated image bytes.',
      );
    }
    // This is the last synchronous JavaScript boundary before native file I/O is admitted.
    // A stale remote workflow must not enqueue an irreversible unlink.
    if (commitFence && !commitFence()) return {status: 'fenced'};
    try {
      return projectNativeImageDeleteOutcome(
        await DiffusionModule.deleteGeneratedImage(admitted.path),
      );
    } catch (error) {
      return nativeImageDeleteFailure(
        typeof (error as { code?: unknown })?.code === 'string'
          ? String((error as { code: string }).code)
          : 'NATIVE_DELETE_REJECTED',
        error instanceof Error ? error.message : String(error),
      );
    }
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
    if (!this.isAvailable()) return null;
    const __c = DiffusionModule.getConstants();
    logger.log(`[WIRE-IMAGE-CONSTANTS] ${JSON.stringify(__c)}`); // [WIRE] raw native diffusion constants (steps/guidance/supported sizes)
    return __c;
  }
}

export const localDreamGeneratorService = new LocalDreamGeneratorService();
