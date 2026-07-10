/**
 * SETTINGS ↔ IMAGE-GENERATION integration guards.
 *
 * These prove what value the image-generation ACTION actually consumes vs. what
 * the settings store holds — the exact "the control shows one value while the
 * generate call uses another" bug class from CLAUDE.md §"State and data MUST NOT
 * live in the presentation layer".
 *
 * We drive the REAL imageGenerationService + REAL appStore. Only the native
 * boundary (the on-device diffusion generator `localDreamGenerator`, the model
 * loader, and the pro-prompt/share side-effects) is mocked — as flag/spy shims,
 * never the logic under assertion. Deleting/inverting the width/height clamp or
 * the steps/guidance plumbing in imageGenerationService fails these tests.
 *
 * Terminal assertion: the arg object handed to the native generator
 * (`localDreamGeneratorService.generateImage`) — i.e. the width/height/steps/
 * guidance the pipeline REALLY runs with.
 */

const mockNativeGenerate = jest.fn(async () => ({
  id: 'img-1',
  imagePath: '/tmp/out.png',
  width: 256,
  height: 256,
  prompt: 'p',
  timestamp: Date.now(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

// Native diffusion generator — the ONLY boundary. Everything above it is real.
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    isModelLoaded: jest.fn(async () => true),
    getLoadedModelPath: jest.fn(async () => '/models/sd.onnx'),
    getLoadedThreads: jest.fn(() => 4),
    hasKernelCache: jest.fn(async () => true),
    generateImage: (...args: unknown[]) => (mockNativeGenerate as (...a: unknown[]) => unknown)(...args),
    cancelGeneration: jest.fn(async () => {}),
  },
}));

// Model loader (native) — assume the active image model is already resident.
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: { loadImageModel: jest.fn(async () => {}) },
}));

// Pro upsell + share side-effects are irrelevant to the param plumbing.
jest.mock('../../../src/utils/proPrompt', () => ({ checkProPromptForImage: jest.fn() }));
jest.mock('../../../src/utils/sharePrompt', () => ({
  shouldShowSharePrompt: jest.fn(() => false),
  emitSharePrompt: jest.fn(),
}));

import { imageGenerationService } from '../../../src/services/imageGenerationService';
import { useAppStore } from '../../../src/stores/appStore';
import { ONNXImageModel } from '../../../src/types';

const IMG_MODEL = {
  id: 'sd-1',
  name: 'Stable Diffusion',
  modelPath: '/models/sd.onnx',
  style: 'realistic',
} as unknown as ONNXImageModel;

function lastNativeCallOpts(): any {
  const calls = mockNativeGenerate.mock.calls as unknown as unknown[][];
  const call = calls[calls.length - 1];
  return call?.[0];
}

beforeEach(() => {
  mockNativeGenerate.mockClear();
  useAppStore.setState({
    downloadedImageModels: [IMG_MODEL],
    activeImageModelId: 'sd-1',
    warmedImageModels: ['sd-1'],
    generatedImages: [],
  });
  (imageGenerationService as unknown as { resetState?: () => void }).resetState?.();
});

describe('image size — value the pipeline runs with vs. the value settings hold', () => {
  it('a width the user CAN set in Model Settings (min=128) is silently forced up to 256 for the actual run', async () => {
    // The ModelSettingsScreen Image-Size slider has min=128, so 128 is a value the
    // user can select and will SEE rendered. The pipeline floors to SWEET_SPOT_SIZE.
    useAppStore.getState().updateSettings({ imageWidth: 128, imageHeight: 128 });

    await imageGenerationService.generateImage({ prompt: 'a cat' });

    const opts = lastNativeCallOpts();
    // Terminal proof of drift: the store (and the settings slider) say 128, the
    // real generation runs at 256. UI value !== consumed value.
    expect(opts.width).toBe(256);
    expect(opts.height).toBe(256);
    expect(useAppStore.getState().settings.imageWidth).toBe(128);
  });

  it('a legitimately-large width (512) is passed through unclamped', async () => {
    useAppStore.getState().updateSettings({ imageWidth: 512, imageHeight: 512 });

    await imageGenerationService.generateImage({ prompt: 'a dog' });

    const opts = lastNativeCallOpts();
    expect(opts.width).toBe(512);
    expect(opts.height).toBe(512);
  });

  it('a mid-range width the slider allows (384) is passed through as-is', async () => {
    useAppStore.getState().updateSettings({ imageWidth: 384, imageHeight: 384 });

    await imageGenerationService.generateImage({ prompt: 'a bird' });

    expect(lastNativeCallOpts().width).toBe(384);
  });
});

describe('image steps & guidance — the run consumes the persisted setting', () => {
  it('steps set in settings reach the generator verbatim', async () => {
    useAppStore.getState().updateSettings({ imageSteps: 30 });

    await imageGenerationService.generateImage({ prompt: 'x' });

    expect(lastNativeCallOpts().steps).toBe(30);
  });

  it('guidance scale set in settings reaches the generator verbatim', async () => {
    useAppStore.getState().updateSettings({ imageGuidanceScale: 9.5 });

    await imageGenerationService.generateImage({ prompt: 'x' });

    expect(lastNativeCallOpts().guidanceScale).toBe(9.5);
  });

  it('an explicit per-call steps/guidance override wins over the settings value', async () => {
    useAppStore.getState().updateSettings({ imageSteps: 8, imageGuidanceScale: 7.5 });

    await imageGenerationService.generateImage({ prompt: 'x', steps: 25, guidanceScale: 12 });

    const opts = lastNativeCallOpts();
    expect(opts.steps).toBe(25);
    expect(opts.guidanceScale).toBe(12);
  });

  it('DRIFT GUARD: when guidance is at the FALSY fallback path (0), the run uses 2.0 — NOT the 7.5 default shown elsewhere', async () => {
    // The service reads `params.guidanceScale || settings.imageGuidanceScale || 2.0`.
    // If a persisted/stale settings value is 0 (falsy), the run silently uses 2.0,
    // while appStore's DEFAULT and every UI slider fallback advertise 7.5. This locks
    // in the current fallback so a change to the constant is caught.
    useAppStore.getState().updateSettings({ imageGuidanceScale: 0 as unknown as number });

    await imageGenerationService.generateImage({ prompt: 'x' });

    expect(lastNativeCallOpts().guidanceScale).toBe(2.0);
  });
});
