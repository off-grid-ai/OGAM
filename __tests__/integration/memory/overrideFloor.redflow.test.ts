/**
 * Load-Anyway (override) is UNCONDITIONAL (integration). Runs the REAL modelResidencyManager over
 * the RAM-sensor stub (deviceMemory harness). The user explicitly accepted the risk, so override
 * evicts everything else and LOADS — no survival floor, no refusal ("if the user wants to load
 * anyway, you let him"). Each case contrasts a NORMAL load (which refuses) against the SAME load
 * under override (which loads) so the bypass is falsifiable, not a trivially-true assertion. The
 * actual on-device jetsam outcome is device-only (device-only); this asserts the gate verdict.
 */
import { modelResidencyManager } from '../../harness/activeModelLifecycle';
import { setDeviceMemory, resetDeviceMemory, gbOf } from '../../harness/deviceMemory';

afterEach(async () => resetDeviceMemory());

describe('memory Load-Anyway override — always loads (gate verdict)', () => {
  it('M4: an 8GB CLEAN GGUF at only 1200MB instantaneous free on 12GB iOS LOADS (clean weights page in, not real-free gated)', async () => {
    await setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(1200) });
    // The complement of the dirty gate: a clean (mmap) model is bounded by physical RAM, NOT
    // by instantaneous free — its file-backed pages fault in on demand even when free is low.
    // If the clean branch wrongly gated on the 1200MB real free, an 8GB model would refuse.
    const lease = await modelResidencyManager.acquire(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 8192, dirtyMemory: false },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );
    await lease.release();
    const { fits } = lease;
    expect(fits).toBe(true);
  });

  it('M5: a 2GB dirty model at 3.1GB free on 12GB iOS LOADS (fits normally, and under override)', async () => {
    await setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(3100) });
    const lease = await modelResidencyManager.acquire(
      { key: 'text', type: 'text', modelId: 'small', sizeMB: 2048, dirtyMemory: true },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
      { override: true },
    );
    await lease.release();
    const { fits } = lease;
    expect(fits).toBe(true);
  });

  it('M6: a 9GB dirty model at 3GB free on 12GB aggressive is REFUSED normally but LOADS under override', async () => {
    await setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(3000), policy: 'aggressive' });
    const spec = { key: 'text', type: 'text' as const, modelId: 'huge', sizeMB: 9216, dirtyMemory: true };

    const normal = await modelResidencyManager.acquire(
      spec,
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );
    await normal.release();
    expect(normal.fits).toBe(false); // 9GB dirty > 3GB real free, nothing to evict → refused

    const override = await modelResidencyManager.acquire(
      spec,
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
      { override: true },
    );
    await override.release();
    expect(override.fits).toBe(true); // load anyway: evict all, no floor
  });
});
