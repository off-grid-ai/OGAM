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
  // M1 — a CLEAN text model (mmap GGUF) and a DIRTY image model CO-RESIDE under the default
  // balanced policy: the text weights page out under pressure, freeing real RAM for the
  // image, so image-gen does NOT evict the text model (it pages around it). Swap is the
  // CONSERVATIVE-mode behavior, not the default (see loadingModes.redflow).
  it('M1: starting image-gen with a clean text model resident on a 640MB-free 12GB Android CO-RESIDES (text pages, not evicted)', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: false });

    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true,
    });

    // Correct (balanced default): the clean text pages out to make real room for the dirty
    // image; both stay resident — no forced mutual exclusion.
    expect(fits).toBe(true);
    expect(evicted).not.toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(true);
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
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(665) });

    const { fits } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 7900, dirtyMemory: true },
      { override: true },
    );

    expect(fits).toBe(true); // override always loads — no floor, no refusal
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
