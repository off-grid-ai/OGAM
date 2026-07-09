/**
 * Unit tests for activeModelService/memory.ts
 * Focuses on LiteRT-only branches (liteRTService loaded, llmService not loaded).
 */

import { getCurrentlyLoadedMemoryGB, getOtherLoadedMemoryGB, checkMemoryForModel } from '../../../src/services/activeModelService/memory';

jest.mock('../../../src/services/llm', () => ({
  llmService: { isModelLoaded: jest.fn() },
}));

jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn() },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({ totalMemory: 8 * 1024 * 1024 * 1024 })),
  },
}));

import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';

const mockedLlm = llmService as jest.Mocked<typeof llmService>;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

const TEXT_MODEL = { id: 'model-1', name: 'Test Model', fileSize: 4 * 1024 * 1024 * 1024 } as any;
const IMAGE_MODEL = { id: 'img-1', name: 'Image Model', size: 2 * 1024 * 1024 * 1024 } as any;

const LISTS = {
  downloadedModels: [TEXT_MODEL],
  downloadedImageModels: [IMAGE_MODEL],
};

describe('getCurrentlyLoadedMemoryGB', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts text model memory when only liteRTService is loaded', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getCurrentlyLoadedMemoryGB(
      { loadedTextModelId: 'model-1', loadedImageModelId: null },
      LISTS,
    );

    // 4 GB * TEXT_MODEL_OVERHEAD_MULTIPLIER (1.5)
    expect(result).toBeCloseTo(6, 1);
  });

  it('returns 0 for text model when both services report not loaded', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getCurrentlyLoadedMemoryGB(
      { loadedTextModelId: 'model-1', loadedImageModelId: null },
      LISTS,
    );

    expect(result).toBe(0);
  });

  it('counts text model memory when only llmService is loaded', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(true);

    const result = getCurrentlyLoadedMemoryGB(
      { loadedTextModelId: 'model-1', loadedImageModelId: null },
      LISTS,
    );

    expect(result).toBeGreaterThan(0);
  });

  it('includes image model memory regardless of text model loaded state', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getCurrentlyLoadedMemoryGB(
      { loadedTextModelId: null, loadedImageModelId: 'img-1' },
      LISTS,
    );

    // 2 GB * IMAGE_MODEL_OVERHEAD_MULTIPLIER (1.5 on iOS, 1.8 on Android)
    expect(result).toBeGreaterThan(2.9);
  });

  it('sums both models when liteRT loaded and image model also loaded', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getCurrentlyLoadedMemoryGB(
      { loadedTextModelId: 'model-1', loadedImageModelId: 'img-1' },
      LISTS,
    );

    // text(6) + image(3 or 3.6) - just verify it's greater than text alone
    expect(result).toBeGreaterThan(6);
  });
});

describe('getOtherLoadedMemoryGB', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts text model memory (LiteRT only loaded) when loading an image model', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(true);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getOtherLoadedMemoryGB(
      'image',
      { loadedTextModelId: 'model-1', loadedImageModelId: null },
      LISTS,
    );

    // 4 GB * TEXT_MODEL_OVERHEAD_MULTIPLIER (1.5)
    expect(result).toBeCloseTo(6, 1);
  });

  it('returns 0 for image model loading when neither service is loaded', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getOtherLoadedMemoryGB(
      'image',
      { loadedTextModelId: 'model-1', loadedImageModelId: null },
      LISTS,
    );

    expect(result).toBe(0);
  });

  it('counts image model memory when loading a text model (no service check needed)', () => {
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(false);

    const result = getOtherLoadedMemoryGB(
      'text',
      { loadedTextModelId: null, loadedImageModelId: 'img-1' },
      LISTS,
    );

    // 2 GB * IMAGE_MODEL_OVERHEAD_MULTIPLIER
    expect(result).toBeGreaterThan(2.9);
  });
});

// The severity classification is what drives the memory warning / critical LOAD
// DIALOGS the user sees. The existing tests only covered the summation helpers, not
// this decision — so the ok/warning/critical/blocked branches were untested. Device is
// mocked at 8GB (see hardware mock above): budget = 0.60 → 4.8GB, warning = 0.50 → 4.0GB
// (both platform-independent at ≤8GB), text overhead ×1.5. Nothing else loaded, so
// totalRequired = fileSizeGB × 1.5. Sizes chosen to land cleanly in each band.
describe('checkMemoryForModel — severity classification (the load-dialog decision)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLiteRT.isModelLoaded.mockReturnValue(false);
    mockedLlm.isModelLoaded.mockReturnValue(false); // nothing else resident
  });

  const listsWith = (fileSizeBytes: number) => ({
    downloadedModels: [{ id: 'm', name: 'M', fileSize: fileSizeBytes } as any],
    downloadedImageModels: [] as any[],
  });
  const IDS = { loadedTextModelId: null, loadedImageModelId: null };

  it("'safe' + canLoad when the model fits under the warning threshold (2GB → 3.0GB ≤ 4.0)", async () => {
    const r = await checkMemoryForModel({ modelId: 'm', modelType: 'text', ids: IDS, lists: listsWith(2 * 1024 ** 3) });
    expect(r.severity).toBe('safe');
    expect(r.canLoad).toBe(true);
  });

  it("'warning' + canLoad when total is between the warning threshold and the budget (3GB → 4.5GB, 4.0<x≤4.8)", async () => {
    const r = await checkMemoryForModel({ modelId: 'm', modelType: 'text', ids: IDS, lists: listsWith(3 * 1024 ** 3) });
    expect(r.severity).toBe('warning');
    expect(r.canLoad).toBe(true); // load allowed, perf may suffer — 'Continue anyway?'
  });

  it("'critical' + NOT canLoad when total exceeds the budget (4GB → 6.0GB > 4.8)", async () => {
    const r = await checkMemoryForModel({ modelId: 'm', modelType: 'text', ids: IDS, lists: listsWith(4 * 1024 ** 3) });
    expect(r.severity).toBe('critical');
    expect(r.canLoad).toBe(false);
  });

  it("'blocked' + NOT canLoad when the model id is not in the list", async () => {
    const r = await checkMemoryForModel({ modelId: 'missing', modelType: 'text', ids: IDS, lists: listsWith(2 * 1024 ** 3) });
    expect(r.severity).toBe('blocked');
    expect(r.canLoad).toBe(false);
  });

  it('sessionOverride short-circuits the gate: a model that would be CRITICAL loads without a prompt', async () => {
    // Fails-before: 4GB model → 6.0GB > 4.8 budget → critical, blocked.
    const blocked = await checkMemoryForModel({ modelId: 'm', modelType: 'text', ids: IDS, lists: listsWith(4 * 1024 ** 3) });
    expect(blocked.canLoad).toBe(false);
    // Passes-after: same model with a session override → allowed, safe (no re-prompt).
    const approved = await checkMemoryForModel({ modelId: 'm', modelType: 'text', ids: IDS, lists: listsWith(4 * 1024 ** 3), sessionOverride: true });
    expect(approved.canLoad).toBe(true);
    expect(approved.severity).toBe('safe');
  });
});
