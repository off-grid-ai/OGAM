/**
 * RED-FLOW tests for the memory-budget bugs (M1, M2, M3, Q15) — see docs/DEVICE_TEST_LOG.md.
 *
 * These assert the CORRECT behavior and are RED on current HEAD because the bug is live. They run the
 * REAL modelResidencyManager over the RAM-sensor stub (deviceMemory harness) — no mock of the budget
 * logic, so the failure is the real defect. Each is wrapped in `it.failing` as the CARRIER: it.failing
 * is GREEN while the assertion throws (bug live) and FLIPS RED the moment the fix makes the assertion
 * pass — forcing conversion to a normal `it()` when the fix lands. (This is NOT a "green-pins-the-bug"
 * guard: the assertion inside is the FIX spec, not the current buggy behavior. Delete `.failing` to see
 * the real red failure.)
 *
 * All numbers are the exact device/[MEM-SM]-log reproductions from the recon agents.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('memory budget — red-flow (correct behavior; currently RED due to the bug)', () => {
  // M1 — text + image must be MUTUALLY EXCLUSIVE (swap), not co-reside into near-OOM.
  it('M1: starting image-gen with a text model resident on a 640MB-free 12GB Android EVICTS the text model', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: false });

    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true,
    });

    // Correct: one heavy generation model at a time — the text model is swapped out.
    expect(fits).toBe(true);
    expect(evicted).toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });

  // M2 — a 2nd in-app dirty heavy must NOT co-load when real free RAM can't hold it; the reclaim
  // credit models BACKGROUND-app reclaim, not RAM already pinned by our own resident dirty model.
  it('M2: a 2nd dirty model is REFUSED when real free RAM is 640MB (Android reclaim credit must not cover an in-app dirty resident)', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    makeResident({ key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true, canEvict: () => false });

    const { fits } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: true,
    });

    expect(fits).toBe(false); // today: true — reclaim credit inflates avail past real physical free
  });

  // M3 — the override survival floor must measure against REAL free RAM, not the credited ceiling.
  it('M3: Load-Anyway a 7900MB dirty model with 665MB truly free on Android is REFUSED (floor vs real RAM, not credited ceiling)', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(665) });

    const { fits } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 7900, dirtyMemory: true },
      { override: true },
    );

    expect(fits).toBe(false); // today: true — postLoadFree = credited 8602 - 7900 = 702 >= 700 floor
  });

  // Q15 — ensureResident must HONOR the fits verdict, not load anyway (the STT/OOM bug class).
  it('Q15: ensureResident does NOT call load() when the model does not fit', async () => {
    setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(500) });
    modelResidencyManager.setBudgetOverrideMB(1000); // force a tiny budget → nothing big fits
    const load = jest.fn().mockResolvedValue(undefined);
    const unload = jest.fn().mockResolvedValue(undefined);

    await modelResidencyManager.ensureResident(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 5235, dirtyMemory: false },
      { load, unload },
    );

    // Correct: a model that doesn't fit is NOT loaded. Today ensureResident ignores `fits` → loads.
    expect(load).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });
});
