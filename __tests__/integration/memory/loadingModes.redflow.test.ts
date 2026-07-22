/**
 * RED-FLOW (integration) — the 3-mode model-loading policy, per the agreed spec.
 *
 * Drives the REAL modelResidencyManager over the deviceMemory harness (the only faked
 * leaf is the RAM sensor). Asserts the resident-set invariant (getResidents/isResident)
 * — the documented service-layer exception for a gesture-less memory invariant; the UI
 * that SELECTS the mode is covered separately (ModelSettingsScreen: model-loading-mode).
 *
 * Spec (device-grounded, user-confirmed):
 *  - conservative: ONE model at a time — loading any model evicts every other, even when
 *    both would fit the budget.
 *  - balanced: co-reside while the budget holds; swap (evict) when the incoming doesn't fit.
 *  - aggressive: co-reside like balanced (NOT single-model) — the current bug is that
 *    aggressive behaves single-model.
 *  - Load Anyway (override): evicts everything else and bypasses the cautious budget,
 *    while the hard device-survival floor remains authoritative.
 *
 * Budget note: on a 12GB device the balanced budget is ~8GB, so 2000+2000 co-reside. A CLEAN
 * model always co-resides beside a dirty one (it pages — see M1/budgetRedflow), so a genuine
 * balanced SWAP is dirty-vs-dirty on tight real free: two dirty heavies (4000+5000=9000) can't
 * both fit ~4GB free, so the resident is evicted.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => {
  resetDeviceMemory();
  modelResidencyManager.setLoadPolicy('balanced');
  modelResidencyManager._reset();
});

const roomy = () => setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(8000) });

describe('model-loading modes — conservative / balanced / aggressive (red-flow)', () => {
  it('conservative: loading an image evicts the resident text even when both fit', async () => {
    roomy();
    modelResidencyManager.setLoadPolicy('conservative');
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 2000, dirtyMemory: false });

    const { evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2000, dirtyMemory: true,
    });

    expect(evicted).toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });

  it('balanced: text + image CO-RESIDE when they both fit the budget', async () => {
    roomy();
    modelResidencyManager.setLoadPolicy('balanced');
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 2000, dirtyMemory: false });

    const { evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2000, dirtyMemory: true,
    });

    expect(evicted).not.toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(true);
  });

  it('balanced: SWAP (evict the resident dirty model) when two dirty heavies cannot co-reside', async () => {
    // A CLEAN resident would just page and co-reside (M1), so a genuine swap is dirty-vs-dirty on
    // tight real free: ~4GB free can't hold a resident dirty 4000 + an incoming dirty 5000 (=9000),
    // so balanced evicts the resident to fit the incoming.
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(4000) });
    modelResidencyManager.setLoadPolicy('balanced');
    makeResident({ key: 'image', type: 'image', modelId: 'sd', sizeMB: 4000, dirtyMemory: true });

    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'big', sizeMB: 5000, dirtyMemory: true,
    });

    expect(evicted).toContain('image'); // 4000 + 5000 > real free → evict the resident dirty model
    expect(fits).toBe(true);
    expect(modelResidencyManager.isResident('image')).toBe(false);
  });

  it('aggressive: text + image CO-RESIDE (not single-model) when they fit', async () => {
    roomy();
    modelResidencyManager.setLoadPolicy('aggressive');
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 2000, dirtyMemory: false });

    const { evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2000, dirtyMemory: true,
    });

    // Aggressive is a bigger budget, NOT one-at-a-time — both stay resident.
    expect(evicted).not.toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(true);
  });

  it('Load Anyway (override): evicts everything to give an admitted load maximum room', async () => {
    roomy();
    modelResidencyManager.setLoadPolicy('balanced');
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 2000, dirtyMemory: false });

    const { fits, evicted } = await modelResidencyManager.makeRoomFor(
      { key: 'image', type: 'image', modelId: 'sd', sizeMB: 2000, dirtyMemory: true },
      { override: true },
    );

    expect(fits).toBe(true);
    expect(evicted).toContain('text'); // evicts everything to free maximum RAM
  });
});
