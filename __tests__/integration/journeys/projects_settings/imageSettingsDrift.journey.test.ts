/**
 * Journey (cluster C): settings-in-flow — IMAGE settings the user sets in Model
 * Settings / the in-chat modal vs the value the ACTUAL native generate call consumes.
 *
 * These GUARD the *current* behaviour (green = documents what ships today). Where the
 * current behaviour is a KNOWN bug (Q1/Q7/Q13), the assertion is written against the
 * ACTUAL consumed value and a comment marks it as a bug guard — flip the expectation
 * the moment the seam is fixed.
 *
 * Real stores (useAppStore), real imageGenerationService; only the native image
 * generator (localDreamGenerator) and the model-load boundary are mocked. The
 * assertion is always the ARG the native generateImage() consumed (width/height/
 * guidanceScale/steps) — never "was called".
 */

import { useAppStore } from '../../../../src/stores/appStore';
import { imageGenerationService } from '../../../../src/services/imageGenerationService';
import { localDreamGeneratorService } from '../../../../src/services/localDreamGenerator';
import { activeModelService } from '../../../../src/services/activeModelService';
import { llmService } from '../../../../src/services/llm';
import { resetStores } from '../../../utils/testHelpers';
import { createONNXImageModel } from '../../../utils/factories';

jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/activeModelService');
jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert', () => ({
  liteRTService: {
    isModelLoaded: jest.fn(() => false),
    generateRaw: jest.fn(() => Promise.resolve('')),
    stopGeneration: jest.fn(() => Promise.resolve()),
  },
}));

const mockDream = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;
const mockLlm = llmService as jest.Mocked<typeof llmService>;

/** The single arg object the native generator consumed on the last run. */
function lastNativeGenerateArgs() {
  const calls = mockDream.generateImage.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as {
    prompt: string; steps: number; guidanceScale: number; width: number; height: number;
  };
}

describe('Journey C — image settings drift (shown value vs consumed value)', () => {
  const IMG_ID = 'img-model-1';

  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    mockDream.isModelLoaded.mockResolvedValue(true);
    mockDream.getLoadedModelPath.mockResolvedValue('/mock/image-model');
    mockDream.getLoadedThreads.mockReturnValue(4);
    mockDream.isAvailable.mockReturnValue(true);
    mockDream.hasKernelCache.mockResolvedValue(true);
    mockDream.generateImage.mockResolvedValue({
      id: 'g1', prompt: 'x', imagePath: '/out.png', width: 256, height: 256,
      steps: 8, seed: 1, modelId: IMG_ID, createdAt: new Date().toISOString(),
    });
    mockActive.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: false, isLoading: false },
      image: { model: createONNXImageModel({ id: IMG_ID }), isLoaded: true, isLoading: false },
    });
    mockActive.loadImageModel.mockResolvedValue();
    mockLlm.isModelLoaded.mockReturnValue(false);
    mockLlm.isCurrentlyGenerating.mockReturnValue(false);
    mockLlm.stopGeneration.mockResolvedValue();
    await imageGenerationService.cancelGeneration().catch(() => {});
  });

  const seedImageModel = (settings: Partial<Record<string, unknown>>) => {
    const model = createONNXImageModel({ id: IMG_ID, modelPath: '/mock/image-model' });
    useAppStore.setState({
      downloadedImageModels: [model],
      activeImageModelId: IMG_ID,
      warmedImageModels: [IMG_ID],
      generatedImages: [],
      settings: { ...useAppStore.getState().settings, ...settings } as any,
    });
    mockDream.getLoadedModelPath.mockResolvedValue(model.modelPath);
  };

  // ── Q1 (KNOWN, HIGH): Image Size you set ≠ size generated ────────────────────
  it('BUG GUARD Q1: a sub-256 imageWidth set in ModelSettings is FLOORED to 256 at generate — the shown 128 is never used', async () => {
    // ModelSettings' Image Size slider has min=128, so this value is reachable from the UI
    // and persists to the store. The native call must receive the floored 256, not 128.
    seedImageModel({ imageWidth: 128, imageHeight: 128 });

    await imageGenerationService.generateImage({ prompt: 'a fox' });

    const args = lastNativeGenerateArgs();
    // What the USER SET (and what the ModelSettings slider still renders): 128.
    const shownInModelSettings = useAppStore.getState().settings.imageWidth;
    expect(shownInModelSettings).toBe(128); // rendered value diverges from consumed value
    // What the native generator ACTUALLY consumed: 256 (SWEET_SPOT floor). This is the bug.
    expect(args.width).toBe(256);
    expect(args.height).toBe(256);
    expect(args.width).not.toBe(shownInModelSettings); // proves divergence, not agreement
  });

  it('a 512 image size the user set IS honoured end-to-end (no drift above the floor)', async () => {
    seedImageModel({ imageWidth: 512, imageHeight: 512 });
    await imageGenerationService.generateImage({ prompt: 'a fox' });
    const args = lastNativeGenerateArgs();
    expect(args.width).toBe(512);
    expect(args.height).toBe(512);
  });

  // ── Q7 (KNOWN, MED): guidance-scale drifts to 2.0 when stale/zero ────────────
  it('BUG GUARD Q7: a 0/stale imageGuidanceScale generates at 2.0 while every slider defaults/renders 7.5', async () => {
    // The store default + both sliders show 7.5 (`imageGuidanceScale || 7.5`). If the persisted
    // value is ever 0 (or undefined), the SERVICE falls back to 2.0 (`|| 2.0`) — a third literal
    // for one setting. Assert the consumed value is the divergent 2.0.
    seedImageModel({ imageGuidanceScale: 0 });

    await imageGenerationService.generateImage({ prompt: 'a fox' });

    const args = lastNativeGenerateArgs();
    expect(args.guidanceScale).toBe(2.0); // BUG: service fallback, not the 7.5 the UI shows
    // What the UI would render for a 0/stale value: `settings.imageGuidanceScale || 7.5` = 7.5.
    const shownGuidance = useAppStore.getState().settings.imageGuidanceScale || 7.5;
    expect(shownGuidance).toBe(7.5);
    expect(args.guidanceScale).not.toBe(shownGuidance); // 2.0 !== 7.5 → drift
  });

  it('a normal imageGuidanceScale (7.5) is consumed as-is', async () => {
    seedImageModel({ imageGuidanceScale: 7.5 });
    await imageGenerationService.generateImage({ prompt: 'a fox' });
    expect(lastNativeGenerateArgs().guidanceScale).toBe(7.5);
  });

  // ── imageSteps: the honest, non-drifting control (contrast case) ─────────────
  it('imageSteps set by the user reaches the native call unchanged', async () => {
    seedImageModel({ imageSteps: 30 });
    await imageGenerationService.generateImage({ prompt: 'a fox' });
    expect(lastNativeGenerateArgs().steps).toBe(30);
  });

  // ── Q13 (KNOWN, LOW): sub-256 size persists (the ModelSettings slider allows it) ─
  it('BUG GUARD Q13: ModelSettings can persist imageWidth below the modal min — the two sliders disagree', async () => {
    // Simulate the ModelSettings Image Size slider (min=128) writing 192.
    useAppStore.getState().updateSettings({ imageWidth: 192, imageHeight: 192 });
    // The persisted value is below the modal's min (SWEET_SPOT_SIZE=256): the modal slider
    // would never let the user reach it, and it clamps its own display to 256. This asymmetry
    // is the DRY root of Q1/Q13 — one setting, two slider contracts.
    expect(useAppStore.getState().settings.imageWidth).toBe(192);
    expect(192).toBeLessThan(256); // below the modal min → cross-surface disagreement
  });
});
