/**
 * JOURNEY: the pre-load memory CHECK and the residency GATE must agree on whether a model
 * fits — the user must not see "safe to load" and then hit a hard refusal (or vice versa).
 *
 * Cluster A. Crosses two owners that both claim (in-code) to read the SAME budget source:
 *   - checkMemoryForModel (src/services/activeModelService/memory.ts) — the advisory UI check
 *   - modelResidencyManager.makeRoomFor (src/services/modelResidency) — the authoritative gate
 *
 * Both share the BUDGET (modelMemoryBudgetMB), but they DO NOT share the model-size estimate:
 *   - pre-check image size  = size × IMAGE_MODEL_OVERHEAD_MULTIPLIER (1.5 iOS / 1.8 Android)
 *   - residency image size  = hardwareService.estimateImageModelRam = size × (1.8 iOS-ANE / 2.5 GPU+Android)
 * So for image models the two disagree by up to ~40%. This test drives BOTH real functions
 * with identical device numbers and asserts on the terminal verdict.
 *
 * The text path (both use ×1.5) is asserted to AGREE — that is the guard.
 * The image divergence is documented in DEVICE_TEST_LOG (bug Q14) and pinned below so any
 * future unification of the two estimates trips this change-detector and updates the ledger.
 */
import { Platform } from 'react-native';
import { hardwareService } from '../../../src/services/hardware';
import { checkMemoryForModel } from '../../../src/services/activeModelService/memory';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { createDownloadedModel, createONNXImageModel } from '../../utils/factories';
import { resetStores } from '../../utils/testHelpers';

const GB = 1024 * 1024 * 1024;

describe('JOURNEY: pre-load check vs residency gate agreement', () => {
  beforeEach(() => {
    resetStores();
    modelResidencyManager._reset();
    modelResidencyManager.setBudgetOverrideMB(null);
    jest.restoreAllMocks();
  });

  it('TEXT model: pre-check "safe" ⇒ residency gate also fits (shared ×1.5 estimate)', async () => {
    const total = 8 * GB;
    const model = createDownloadedModel({ id: 'txt', fileSize: 3 * GB });
    jest.spyOn(hardwareService, 'getDeviceInfo').mockResolvedValue({ totalMemory: total } as any);
    jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue({} as any);
    jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(8);
    jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(7);

    const check = await checkMemoryForModel({
      modelId: 'txt', modelType: 'text',
      ids: { loadedTextModelId: null, loadedImageModelId: null },
      lists: { downloadedModels: [model], downloadedImageModels: [] },
    });
    expect(check.canLoad).toBe(true); // pre-check: safe

    const resSizeMB = Math.round((hardwareService.estimateModelRam(model) || 0) / (1024 * 1024));
    const room = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'txt', sizeMB: resSizeMB,
    });
    // TERMINAL artifact: the two owners AGREE for text (both ×1.5). Guard against a future
    // change that lets the residency estimate drift away from the pre-check for text too.
    expect(room.fits).toBe(true);
  });

  it('IMAGE model (android, mid-RAM): pre-check says SAFE while the gate REFUSES — documented divergence (Q14)', async () => {
    // Device numbers chosen to land in the window where 1.5×size ≤ budget < 2.5×size.
    (Platform as any).OS = 'android';
    const total = 10 * GB;
    const img = createONNXImageModel({ id: 'sd', size: 3 * GB });

    jest.spyOn(hardwareService, 'getDeviceInfo').mockResolvedValue({ totalMemory: total } as any);
    jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue({} as any);
    jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(10);
    jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(9); // lots of real free RAM

    const check = await checkMemoryForModel({
      modelId: 'sd', modelType: 'image',
      ids: { loadedTextModelId: null, loadedImageModelId: null },
      lists: { downloadedModels: [], downloadedImageModels: [img] },
    });

    const resSizeMB = Math.round((hardwareService.estimateImageModelRam(img) || 0) / (1024 * 1024));
    const room = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: resSizeMB, dirtyMemory: true,
    });

    // The pre-check UI tells the user this is safe...
    expect(check.canLoad).toBe(true);
    // ...but the authoritative residency gate refuses it. THIS IS THE BUG (Q14): a user who
    // trusts the pre-check taps load and gets a hard "insufficient memory" error. Pinned so a
    // fix that unifies the size estimate flips room.fits→true and forces this test updated.
    expect(room.fits).toBe(false);
    // The estimates that produce the mismatch, pinned for the record.
    expect(resSizeMB).toBe(Math.round((3 * GB * 2.5) / (1024 * 1024))); // residency ×2.5
    expect(check.requiredMemoryGB).toBeLessThan(resSizeMB / 1024); // pre-check under-counts
  });
});
