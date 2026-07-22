/**
 * G4 (docs/RELEASE_571_GAP_FINDINGS.md): makeRoomFor's dirty-ceiling arm double-counts an
 * already-resident model of the SAME key. keptDirtyMB sums dirty residents that are not evicted —
 * which includes the incoming model's own resident entry on a thread reload — then adds spec.sizeMB
 * on top, so dirtyFootprintMB = 2x the model. planEviction guards this (alreadyResident -> 0 cost);
 * the dirty-ceiling arm does not. Result: a hard "not enough memory" refusal for an image model that
 * is already sitting in RAM, when the user just changes image threads and regenerates.
 *
 * Runs the REAL modelResidencyManager over the RAM-sensor boundary (deviceMemory harness).
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('memory image thread-reload dirty double-count', () => {
  it('G4: reloading an already-resident image model (thread change) is not refused for memory', async () => {
    // 8GB device with plenty of free RAM; a 4GB dirty image model is already resident.
    setDeviceMemory({ platform: 'android', totalGB: 8, availGB: gbOf(7000) });
    makeResident({ key: 'image', type: 'image', modelId: 'sd', sizeMB: 4000, dirtyMemory: true });

    // Changing image threads reloads the SAME model (same key + id) while it is still registered.
    // Its footprint must be counted once, not twice — it already occupies that RAM.
    const { fits } = await modelResidencyManager.makeRoomFor({
      key: 'image',
      type: 'image',
      modelId: 'sd',
      sizeMB: 4000,
      dirtyMemory: true,
    });

    expect(fits).toBe(true);
  });
});
