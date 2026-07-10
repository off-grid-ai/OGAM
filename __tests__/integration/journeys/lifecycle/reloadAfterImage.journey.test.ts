/**
 * JOURNEY — return to chat and resend after an image generation (cluster A).
 *
 * Flow: chat (text model resident) → generate an image (image model resident, text
 * evicted) → go BACK to chat and resend → the evicted text model must RELOAD.
 *
 * The seam under test is budgetForSpec's dirty-pressure gate
 * (src/services/modelResidency/index.ts:230-275). `dirtyPressure` is computed from
 * the residents present BEFORE any eviction. So when a CLEAN (mmap GGUF) text model
 * reloads while a DIRTY image model is still resident, the text load is gated on the
 * SHRUNKEN dirty dynamic budget (real free RAM + residents − 1024) even though the
 * image model will be evicted first and the text model's clean weights are bounded
 * only by physical RAM. planEviction evicts the image, but by then the budget has
 * already been fixed at the dirty value, so a text model that fits physical RAM fine
 * is REFUSED with an OverridableMemoryError — the user's resend dead-ends.
 *
 * Real device numbers: iOS 12GB, physical balanced budget ~9584MB. A 5235MB text
 * model fits that with 4GB to spare. After an image gen the image (2369MB, dirty) is
 * resident and ~3GB is free. Reloading the text model refuses, because the dirty
 * budget = 3000 + 2369 − 1024 = 4345MB and text(5235) > 4345 even after the image is
 * evicted (used=5235 still > 4345, since the budget never recomputed post-eviction).
 *
 * Drives the REAL activeModelService + modelResidencyManager; only native engines
 * and the RAM sensor are mocked. Asserts the TERMINAL artifact: text resident, no
 * throw. GREEN once the dirty-pressure budget recomputes after eviction (or the
 * incoming clean model is not gated on a soon-to-be-evicted dirty resident).
 */

import { Platform } from 'react-native';
import { useAppStore } from '../../../../src/stores/appStore';
import { activeModelService } from '../../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { llmService } from '../../../../src/services/llm';
import { hardwareService } from '../../../../src/services/hardware';
import { localDreamGeneratorService } from '../../../../src/services/localDreamGenerator';
import { resetStores, flushPromises } from '../../../utils/testHelpers';
import { createDownloadedModel, createDeviceInfo } from '../../../utils/factories';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');
jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/hardware');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockHw = hardwareService as jest.Mocked<typeof hardwareService>;
const mockDream = localDreamGeneratorService as jest.Mocked<
  typeof localDreamGeneratorService
>;

const TEXT_RAM_MB = 5235;
const IMAGE_RAM_MB = 2369;
const TEXT_FILE_BYTES = Math.round((TEXT_RAM_MB / 1.5) * 1024 * 1024);

const textModel = () =>
  createDownloadedModel({
    id: 'text-1',
    engine: 'llama' as any,
    fileName: 'text.gguf',
    filePath: '/text.gguf',
    fileSize: TEXT_FILE_BYTES,
  });

const originalOS = Platform.OS;

/** Register a DIRTY image model as activeModelService would after an image gen. */
function registerResidentImage() {
  let unloaded = false;
  const unload = jest.fn(async () => {
    unloaded = true;
  });
  modelResidencyManager.register(
    { key: 'image', type: 'image', modelId: 'img-1', sizeMB: IMAGE_RAM_MB, dirtyMemory: true },
    unload,
  );
  return { unload, wasUnloaded: () => unloaded };
}

describe('JOURNEY: resend after image gen must reload the evicted text model', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();

    let llmLoaded = false;
    mockLlm.isModelLoaded.mockImplementation(() => llmLoaded);
    mockLlm.getLoadedModelPath.mockImplementation(() =>
      llmLoaded ? '/text.gguf' : null,
    );
    mockLlm.loadModel.mockImplementation(async () => {
      llmLoaded = true;
    });
    mockLlm.unloadModel.mockImplementation(async () => {
      llmLoaded = false;
    });
    mockLlm.getMultimodalSupport.mockReturnValue({ vision: false } as any);

    mockDream.isModelLoaded.mockResolvedValue(false);
    mockDream.unloadModel.mockResolvedValue(true);

    // iOS 12GB, ~3GB free (a normal post-image-gen state — NOT starved).
    mockHw.getDeviceInfo.mockResolvedValue(
      createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
    );
    mockHw.refreshMemoryInfo.mockResolvedValue({} as any);
    mockHw.getTotalMemoryGB.mockReturnValue(12);
    mockHw.getAvailableMemoryGB.mockReturnValue(3000 / 1024); // 3GB free
    mockHw.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => (m?.fileSize || m?.size || 0) * mult,
    );
    mockHw.getModelTotalSize.mockImplementation(
      (m: any) => m?.fileSize || m?.size || 0,
    );

    useAppStore.setState({
      downloadedModels: [textModel()],
      activeModelId: 'text-1',
    });
    modelResidencyManager.setBudgetOverrideMB(null);
    modelResidencyManager.setLoadPolicy('balanced');
    Platform.OS = 'ios' as typeof Platform.OS;
    await activeModelService.syncWithNativeState();
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
    Platform.OS = originalOS;
  });

  it('sanity: with NOTHING resident, the 5235MB text model loads on a 12GB device (fits physical RAM)', async () => {
    await activeModelService.loadTextModel('text-1');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(mockLlm.isModelLoaded()).toBe(true);
  });

  // it.failing: asserts the CORRECT resend behavior (text reloads after the dirty
  // image is evicted). RED on HEAD — budgetForSpec fixes the dirty budget from the
  // PRE-eviction residents, so the clean text model is refused although it fits
  // physical RAM once the image is gone. See BUG #2. Flips red-→-green-under-test
  // the instant the budget recomputes post-eviction; keep the assertion as-is.
  it.failing('resend after image gen: the evicted text model reloads by evicting the dirty image (fits physical RAM)', async () => {
    // Post-image-gen device state: the dirty image model is resident, text was evicted.
    const img = registerResidentImage();
    expect(modelResidencyManager.isResident('image')).toBe(true);

    // User goes back to chat and resends → text model must reload.
    await activeModelService.loadTextModel('text-1');
    await flushPromises();

    // TERMINAL ARTIFACT: text resident, image evicted (mutually exclusive), no throw.
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(mockLlm.isModelLoaded()).toBe(true);
    expect(img.wasUnloaded()).toBe(true);
    expect(modelResidencyManager.isResident('image')).toBe(false);
  });

  it('DOCUMENTS BUG #2 (current behavior): resend is refused with OverridableMemoryError because the dirty budget is fixed pre-eviction', async () => {
    registerResidentImage();

    await expect(activeModelService.loadTextModel('text-1')).rejects.toThrow(
      /Not enough free memory/,
    );
    // The buggy outcome: text NOT resident, native never loaded — the resend dead-ends
    // even though the 5235MB text model fits the 9584MB physical budget once the
    // 2369MB image is evicted.
    expect(modelResidencyManager.isResident('text')).toBe(false);
    expect(mockLlm.isModelLoaded()).toBe(false);
  });
});
