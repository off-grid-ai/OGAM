/**
 * checkImageModelCanLoad — overridability of a memory-gate refusal.
 *
 * Guards the reliability fix: a first refusal is OVERRIDABLE (offer "Load Anyway"),
 * but a refusal that PERSISTS under override hit the residency survival floor — a hard
 * limit forcing can't cross — so it must be reported NON-overridable, or the failure
 * surface would re-offer "Load Anyway" forever as a no-op (the caller re-runs the same
 * request). This is the exact false branch qodo flagged.
 */
jest.mock('../../../src/services/llm', () => ({
  llmService: { loadModel: jest.fn(), unloadModel: jest.fn(), isModelLoaded: jest.fn(() => false), getLoadedModelPath: jest.fn(() => null), getMultimodalSupport: jest.fn(() => null) },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: { loadModel: jest.fn(), unloadModel: jest.fn(), isModelLoaded: jest.fn(async () => false) },
}));
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getSoCInfo: jest.fn(async () => ({ hasNPU: true })),
    // 4.5GB estimated runtime footprint — the number is irrelevant here; makeRoomFor's
    // verdict is what's mocked. Kept realistic for a Stable-Diffusion-class model.
    estimateImageModelRam: jest.fn(() => 4_500 * 1024 * 1024),
  },
}));
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { makeRoomFor: jest.fn(), runExclusive: jest.fn((_k: string, fn: () => any) => fn()) },
}));

import { checkImageModelCanLoad } from '../../../src/services/activeModelService/loaders';
import { modelResidencyManager } from '../../../src/services/modelResidency';

const makeRoomFor = modelResidencyManager.makeRoomFor as jest.Mock;
const model = { id: 'img-1', name: 'Test Image Model', backend: 'gpu' } as any;
const check = (opts?: { override?: boolean }) =>
  checkImageModelCanLoad('img-1', model, opts) as Promise<{ canLoad: boolean; overridable?: boolean; error?: string }>;

describe('checkImageModelCanLoad — survival-floor overridability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows the load when the gate fits', async () => {
    makeRoomFor.mockResolvedValue({ fits: true, evicted: [] });
    const res = await check({ override: false });
    expect(res.canLoad).toBe(true);
  });

  it('a FIRST refusal is overridable (offer Load Anyway)', async () => {
    makeRoomFor.mockResolvedValue({ fits: false, evicted: [] });
    const res = await check({ override: false });
    expect(res.canLoad).toBe(false);
    expect(res.overridable).toBe(true);
  });

  it('a refusal UNDER override is NOT overridable (stop re-offering the no-op)', async () => {
    makeRoomFor.mockResolvedValue({ fits: false, evicted: [] });
    const res = await check({ override: true });
    expect(res.canLoad).toBe(false);
    expect(res.overridable).toBe(false);
    // The copy must acknowledge freeing was already attempted.
    expect(res.error).toContain('even after freeing');
  });
});
