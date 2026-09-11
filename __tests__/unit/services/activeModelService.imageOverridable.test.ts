/**
 * Image hardware preflight after the shared residency migration.
 *
 * Memory admission and the unconditional Load Anyway contract belong to the
 * shared residency lifecycle. This native preflight now answers only whether
 * the selected image runtime can run on this hardware.
 */
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => false),
    getLoadedModelPath: jest.fn(() => null),
    getMultimodalSupport: jest.fn(() => null),
  },
}));

jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {
    isModelLoaded: jest.fn(async () => false),
  },
}));

const mockGetSoCInfo = jest.fn(async () => ({ hasNPU: true }));
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getSoCInfo: () => mockGetSoCInfo(),
  },
}));

import { checkImageHardwareSupport } from '../../../src/services/adapters/native/modelLoaders';

const check = (backend: string, override = false) =>
  checkImageHardwareSupport(
    'img-1',
    { id: 'img-1', name: 'Test Image Model', backend } as any,
    { override },
  );

describe('checkImageHardwareSupport — hardware-only preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSoCInfo.mockResolvedValue({ hasNPU: true });
  });

  it.each([false, true])(
    'leaves GPU memory admission to shared residency (override=%s)',
    async override => {
      await expect(check('gpu', override)).resolves.toEqual({ canLoad: true });
      expect(mockGetSoCInfo).not.toHaveBeenCalled();
    },
  );

  it('rejects QNN on a device without an NPU as non-overridable', async () => {
    mockGetSoCInfo.mockResolvedValue({ hasNPU: false });

    const result = await check('qnn', true);

    expect(result.canLoad).toBe(false);
    expect(result.overridable).toBeUndefined();
    expect(result.error).toContain('compatible NPU');
  });

  it('allows QNN when the device reports a compatible NPU', async () => {
    await expect(check('qnn')).resolves.toEqual({ canLoad: true });
  });
});
