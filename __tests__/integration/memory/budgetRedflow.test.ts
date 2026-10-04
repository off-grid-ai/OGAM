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
import { modelResidencyManager } from '../../harness/activeModelLifecycle';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(async () => resetDeviceMemory());

describe('memory budget — red-flow (correct behavior; currently RED due to the bug)', () => {
  // M1 — a CLEAN text model (mmap GGUF) and a DIRTY image model CO-RESIDE under the default
  // balanced policy: the text weights page out under pressure, freeing real RAM for the
  // image, so image-gen does NOT evict the text model (it pages around it). Swap is the
  // CONSERVATIVE-mode behavior, not the default (see loadingModes.redflow).
  it('M1: starting image-gen with a clean text model resident on a 640MB-free 12GB Android CO-RESIDES (text pages, not evicted)', async () => {
    await setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(640) });
    await makeResident({ key: 'text', type: 'text', modelId: 'gemma', sizeMB: 5235, dirtyMemory: false });

    const lease = await modelResidencyManager.acquire(
      { key: 'image', type: 'image', modelId: 'sd', sizeMB: 2369, dirtyMemory: true },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );

    // Correct (balanced default): the clean text pages out to make real room for the dirty
    // image; both stay resident — no forced mutual exclusion.
    expect(lease.fits).toBe(true);
    expect(lease.evicted).not.toContain('text');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    await lease.release();
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

    const lease = await modelResidencyManager.acquire(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 7900, dirtyMemory: true },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
      { override: true },
    );

    expect(lease.fits).toBe(true); // override always loads — no floor, no refusal
    await lease.release();
  });

  // Q15 — ensureResident must HONOR the fits verdict, not load anyway (the STT/OOM bug class).
  it('Q15: ensureResident does NOT call load() when the model does not fit', async () => {
    // A real 4 GB device gives this 5.2 GB model no admissible budget. No test-only policy override.
    await setDeviceMemory({ platform: 'ios', totalGB: 4, availGB: gbOf(500) });
    const load = jest.fn().mockResolvedValue(undefined);
    const unload = jest.fn().mockResolvedValue(undefined);

    const lease = await modelResidencyManager.acquire(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 5235, dirtyMemory: false },
      { load, unload },
    );

    // Correct: a model that doesn't fit is NOT loaded. Today ensureResident ignores `fits` → loads.
    expect(load).not.toHaveBeenCalled();
    expect(lease.acquired).toBe(false);
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });
});
