/**
 * BATCH 4 (Image Generation) — hardening.
 *
 * Provit cases 17, 18, 20, 22, 26 assert the OBSERVABLE image-generation
 * lifecycle: the in-progress card appears, its status transitions from an
 * enhancing phase to a generating phase, a second in-flight request is silently
 * ignored, cancel mid-flight tears the card down, and generation with
 * enhancement OFF never shows the enhancing phase.
 *
 * The existing integration suite asserts the DERIVED `isGenerating` boolean but
 * never the authoritative `phase` field itself — the single source of truth the
 * UI projects. This suite drives the REAL `imageGenerationService` (deleting it
 * would fail these tests) and asserts the ORDERED `phase` transitions directly.
 * Only genuine boundaries are mocked: the native ONNX generator, the model
 * loaders, and the LLM used for enhancement.
 */
import { useAppStore } from '../../src/stores/appStore';
import {
  imageGenerationService,
  isInFlight,
  type ImageGenPhase,
} from '../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../src/services/localDreamGenerator';
import { activeModelService } from '../../src/services/activeModelService';
import { llmService } from '../../src/services/llm';
import { resetStores, flushPromises } from '../utils/testHelpers';
import { createONNXImageModel } from '../utils/factories';

jest.mock('../../src/services/localDreamGenerator');
jest.mock('../../src/services/activeModelService');
jest.mock('../../src/services/llm');

const mockDream = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;
const mockLlm = llmService as jest.Mocked<typeof llmService>;

/** Record every distinct phase the service passes through, in order. */
function trackPhases(): { phases: ImageGenPhase[]; stop: () => void } {
  const phases: ImageGenPhase[] = [];
  const unsub = imageGenerationService.subscribe((s) => {
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
  });
  return { phases, stop: unsub };
}

const setupModel = () => {
  const model = createONNXImageModel({ id: 'img-1', modelPath: '/mock/img-model' });
  useAppStore.setState({
    downloadedImageModels: [model],
    activeImageModelId: 'img-1',
    generatedImages: [],
    warmedImageModels: ['img-1'], // pre-warmed so the ~120s notice path is out of scope here
    settings: { imageSteps: 8, imageGuidanceScale: 2, imageWidth: 256, imageHeight: 256, imageThreads: 4 } as any,
  });
  mockDream.getLoadedModelPath.mockResolvedValue(model.modelPath);
  return model;
};

const OK_RESULT = {
  id: 'r1', prompt: 'p', imagePath: '/mock/out.png', width: 256, height: 256,
  steps: 8, seed: 1, modelId: 'img-1', createdAt: new Date().toISOString(),
};

beforeEach(async () => {
  resetStores();
  jest.clearAllMocks();
  mockDream.isModelLoaded.mockResolvedValue(true);
  mockDream.getLoadedModelPath.mockResolvedValue('/mock/img-model');
  mockDream.getLoadedThreads.mockReturnValue(4);
  mockDream.isAvailable.mockReturnValue(true);
  mockDream.generateImage.mockResolvedValue(OK_RESULT as any);
  mockDream.cancelGeneration.mockResolvedValue(true);
  mockActive.loadImageModel.mockResolvedValue();
  mockActive.loadTextModel.mockResolvedValue();
  mockLlm.isModelLoaded.mockReturnValue(false);
  mockLlm.isCurrentlyGenerating.mockReturnValue(false);
  mockLlm.stopGeneration.mockResolvedValue();
  await imageGenerationService.cancelGeneration().catch(() => {});
});

describe('image-gen phase state machine — ordered transitions (cases 17, 18, 26)', () => {
  it('enhancement OFF: idle → loading → generating → done, never enters enhancing (case 26)', async () => {
    setupModel();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, enhanceImagePrompts: false } as any });

    const { phases, stop } = trackPhases();
    await imageGenerationService.generateImage({ prompt: 'a red apple' });
    stop();

    // Starts idle (initial snapshot), never shows the enhancing phase when OFF,
    // ends at the terminal done phase.
    expect(phases[0]).toBe('idle');
    expect(phases).not.toContain('enhancing');
    expect(phases).toContain('loading');
    expect(phases).toContain('generating');
    expect(phases[phases.length - 1]).toBe('done');
    // loading must precede generating (case 18 direction, without enhancement).
    expect(phases.indexOf('loading')).toBeLessThan(phases.indexOf('generating'));
  });

  it('enhancement ON: passes through enhancing BEFORE loading/generating (cases 17, 18)', async () => {
    setupModel();
    useAppStore.setState({
      activeModelId: 'text-1',
      settings: { ...useAppStore.getState().settings, enhanceImagePrompts: true } as any,
    });
    // Text model loads on demand then reports loaded.
    mockLlm.isModelLoaded.mockReturnValueOnce(false).mockReturnValue(true);
    mockLlm.generateResponse.mockResolvedValue('an enhanced red apple, studio lighting');

    const { phases, stop } = trackPhases();
    await imageGenerationService.generateImage({ prompt: 'a red apple' });
    stop();

    expect(phases).toContain('enhancing');
    expect(phases).toContain('generating');
    // enhancing must come strictly before generating (the status transition case 18).
    expect(phases.indexOf('enhancing')).toBeLessThan(phases.indexOf('generating'));
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('the generating status advances the step counter toward totalSteps (case 19)', async () => {
    setupModel();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, enhanceImagePrompts: false } as any });
    mockDream.generateImage.mockImplementation(async (_p, onProgress) => {
      onProgress?.({ step: 1, totalSteps: 8, progress: 0.125 } as any);
      onProgress?.({ step: 3, totalSteps: 8, progress: 0.375 } as any);
      return OK_RESULT as any;
    });

    const steps: number[] = [];
    const unsub = imageGenerationService.subscribe((s) => { if (s.progress) steps.push(s.progress.step); });
    await imageGenerationService.generateImage({ prompt: 'apple' });
    unsub();

    expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
    // monotonic non-decreasing during the run
    const generating = steps.filter(n => n > 0);
    for (let i = 1; i < generating.length; i++) expect(generating[i]).toBeGreaterThanOrEqual(generating[i - 1]);
  });
});

describe('illegal transition guard — a 2nd in-flight request is ignored (case 22)', () => {
  it('does not start a second generation and leaves the first phase/progress untouched', async () => {
    setupModel();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, enhanceImagePrompts: false } as any });

    let resolveFirst!: (v: any) => void;
    let calls = 0;
    mockDream.generateImage.mockImplementation(async (_p, onProgress) => {
      calls++;
      onProgress?.({ step: 2, totalSteps: 8, progress: 0.25 } as any);
      return new Promise((r) => { resolveFirst = r; });
    });

    const gen1 = imageGenerationService.generateImage({ prompt: 'first' });
    await flushPromises();

    const phaseDuring = imageGenerationService.getState().phase;
    const progressDuring = imageGenerationService.getState().progress;
    expect(isInFlight(phaseDuring)).toBe(true);

    // Second request while in-flight → returns null, native generator not called again.
    const gen2 = await imageGenerationService.generateImage({ prompt: 'second' });
    expect(gen2).toBeNull();
    expect(calls).toBe(1);
    // First generation's phase and progress are unchanged (no reset to step 0).
    expect(imageGenerationService.getState().phase).toBe(phaseDuring);
    expect(imageGenerationService.getState().progress).toEqual(progressDuring);

    resolveFirst(OK_RESULT);
    await gen1;
  });
});

describe('cancel mid-flight resets the machine to idle (case 20)', () => {
  it('transitions an in-flight generation back to idle and clears progress/prompt', async () => {
    setupModel();
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, enhanceImagePrompts: false } as any });

    let _resolve!: (v: any) => void;
    mockDream.generateImage.mockImplementation(async () => new Promise((r) => { _resolve = r; }));

    imageGenerationService.generateImage({ prompt: 'cancel me' });
    await flushPromises();
    expect(isInFlight(imageGenerationService.getState().phase)).toBe(true);

    await imageGenerationService.cancelGeneration();

    const s = imageGenerationService.getState();
    expect(s.phase).toBe('idle');
    expect(isInFlight(s.phase)).toBe(false);
    expect(s.progress).toBeNull();
    expect(s.prompt).toBeNull();
    expect(mockDream.cancelGeneration).toHaveBeenCalled();
  });
});

describe('no-model / load-failure surface an error phase, never a silent hang (cases 30, 38)', () => {
  it('no active image model → error phase with a clear message, generateImage returns null', async () => {
    useAppStore.setState({
      downloadedImageModels: [],
      activeImageModelId: null,
      settings: { imageSteps: 8, imageGuidanceScale: 2 } as any,
    });

    const result = await imageGenerationService.generateImage({ prompt: 'no model' });

    expect(result).toBeNull();
    const s = imageGenerationService.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('No image model');
    expect(isInFlight(s.phase)).toBe(false); // not hung in an in-flight phase
  });

  it('image model load failure → error phase, not stuck in loading (case 38)', async () => {
    setupModel();
    mockDream.isModelLoaded.mockResolvedValue(false); // force a load attempt
    mockActive.loadImageModel.mockRejectedValue(new Error('weights corrupted'));

    const result = await imageGenerationService.generateImage({ prompt: 'broken model' });

    expect(result).toBeNull();
    const s = imageGenerationService.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('Failed to load image model');
    expect(isInFlight(s.phase)).toBe(false);
  });
});
