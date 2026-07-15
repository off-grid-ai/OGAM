/**
 * Integration — M11: resending a text turn after image-gen reloads the text model WITHOUT OOM.
 *
 * After image generation the image model is dirty-resident. Resending a text turn reloads the CLEAN
 * text model. Under the default balanced policy the two co-reside: the clean (mmap GGUF) text weights
 * page in around the dirty image's real RAM, so the image is NOT evicted (5235 + 2369 = 7604 < the
 * ~7908 budget). Swap is the CONSERVATIVE-mode behavior; genuine over-commit (a dirty model bigger
 * than real free) is still refused — see aggressiveDirtyOverCommit.rendered. Runs the REAL
 * modelResidencyManager over the RAM-sensor stub (deviceMemory harness) with the device repro.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('M11 — resend after image-gen (co-reside under balanced)', () => {
  it('reloads the clean text model alongside the resident image model (co-reside, no swap)', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    // Image gen just ran → the image model is dirty-resident.
    makeResident({ key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true });

    // User resends a text turn → the clean text model reloads.
    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: false,
    });

    // Correct (balanced default): the clean text pages in around the dirty image; both fit the
    // budget, so the image is NOT swapped out. If they exceeded the budget the planner would evict
    // (proven in loadingModes 'balanced swap') — here they fit, so they co-reside.
    expect(fits).toBe(true);
    expect(evicted).not.toContain('image');
    expect(modelResidencyManager.isResident('image')).toBe(true);
  });
});
