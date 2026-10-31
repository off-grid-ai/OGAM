/**
 * Memory-budget regression scenarios (M1, M3, Q15) — see docs/DEVICE_TEST_LOG.md.
 *
 * They exercise the real residency manager over the native RAM-sensor boundary,
 * preserving both normal admission and the explicit user override behavior.
 *
 * All numbers are the exact device/[MEM-SM]-log reproductions from the recon agents.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('memory budget — red-flow (correct behavior; currently RED due to the bug)', () => {
  // M1 — with only 640MB free, a DIRTY image load must first evict the clean
  // text model. Co-residency is safe only when live RAM supports the allocation.
  it('M1: image generation evicts text before allocating dirty memory at 640MB free', async () => {
    await setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: false });

    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true,
    });

    // The old physical-budget credit kept both resident and exposed the app to LMK.
    expect(fits).toBe(true);
    expect(evicted).toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });

  // M2 (the "2nd in-app dirty heavy piled onto a PINNED dirty resident is refused") scenario was
  // DROPPED from the model: there is no UI to start a second heavy load while one is mid-generation
  // (you stop the current one first), so a heavy is never pinned against a competing heavy load. The
  // only real concurrency is text streaming + TTS speaking, and TTS is an exempt sidecar. See the
  // residency matrix (residencyMatrix.modes) for the co-reside/swap cases that DO occur.

  // M3 — Load-Anyway (override) is UNCONDITIONAL: the user explicitly accepted the risk, so
  // we evict everything else and load, with NO survival floor and NO refusal. The UI frames
  // it as "not recommended, but you can try" — if the user wants to load anyway, we let them.
  it('M3: Load-Anyway a 7900MB dirty model with 665MB truly free on Android LOADS (override never refuses)', async () => {
    await setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(665) });

    const { fits } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 7900, dirtyMemory: true },
      { override: true },
    );

    expect(fits).toBe(true); // override always loads — no floor, no refusal
  });

  // Q15 — ensureResident must HONOR the fits verdict, not load anyway (the STT/OOM bug class).
  it('Q15: ensureResident does NOT call load() when the model does not fit', async () => {
    await setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(500) });
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
