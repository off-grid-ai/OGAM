/**
 * RED-FLOW (integration) — PR#454 (audit A2): a failed eviction unload must not be counted as freed.
 *
 * makeRoomFor evicts victims via `await reg.unload().catch(log); this.residents.delete(key)` and returns
 * fits from the pre-unload plan (modelResidency/index.ts:386-424). A victim whose native unload REJECTS
 * (still holding RAM) is deleted from the budget map and counted as freed → the caller (which honors
 * `fits`) loads the incoming model on top → OOM. Runs the REAL modelResidencyManager over the RAM-sensor
 * stub; the only faked boundary is the native unload (made to reject).
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('PR#454 — failed eviction unload over-commits memory (red-flow)', () => {
  it('keeps the victim resident and reports fits=false when its unload rejects', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(4000) });
    // A normal SWAP: a resident text model must be evicted to fit a large incoming image they can't
    // co-reside with (5000 + 6500 = 11500 > the ~8600 budget) — but the text's native unload FAILS.
    const unload = makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5000, dirtyMemory: false });
    unload.mockRejectedValue(new Error('native unload failed — bridge torn down'));

    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 6500, dirtyMemory: true,
    });

    // Correct: the text's unload failed, so its RAM was NOT freed — refuse rather than over-commit,
    // and keep the victim (text) resident. The bug would delete text + count it as evicted and report
    // fits=true → the image loads on top → OOM.
    expect(fits).toBe(false);
    expect(evicted).not.toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(true);
  });
});
