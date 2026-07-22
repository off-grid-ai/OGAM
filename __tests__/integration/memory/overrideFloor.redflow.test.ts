/**
 * Load-Anyway survival contract (integration). Runs the REAL modelResidencyManager over the
 * RAM-sensor boundary. Overrides bypass cautious budgets when the post-eviction probe is safe,
 * while catastrophic dirty loads and critically low real RAM remain hard refusals.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('memory Load-Anyway override survival floor', () => {
  it('M4: an 8GB CLEAN GGUF at only 1200MB instantaneous free on 12GB iOS LOADS (clean weights page in, not real-free gated)', async () => {
    setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(1200) });
    // The complement of the dirty gate: a clean (mmap) model is bounded by physical RAM, NOT
    // by instantaneous free — its file-backed pages fault in on demand even when free is low.
    // If the clean branch wrongly gated on the 1200MB real free, an 8GB model would refuse.
    const { fits } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'big', sizeMB: 8192, dirtyMemory: false,
    });
    expect(fits).toBe(true);
  });

  it('M5: a 2GB dirty model at 3.1GB free on 12GB iOS LOADS (fits normally, and under override)', async () => {
    setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: gbOf(3100) });
    const { fits } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'small', sizeMB: 2048, dirtyMemory: true },
      { override: true },
    );
    expect(fits).toBe(true);
  });

  it('M6: a 9GB dirty model at 3GB free on 12GB aggressive stays refused under override', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(3000), policy: 'aggressive' });
    const spec = { key: 'text', type: 'text' as const, modelId: 'huge', sizeMB: 9216, dirtyMemory: true };

    const normal = await modelResidencyManager.makeRoomFor(spec);
    expect(normal.fits).toBe(false); // 9GB dirty > 3GB real free, nothing to evict → refused

    const override = await modelResidencyManager.makeRoomFor(spec, { override: true });
    expect(override.fits).toBe(false);
  });

  it('M3: Android reclaim credit cannot mask a critically low 665MB real-RAM reading', async () => {
    setDeviceMemory({ platform: 'android', totalGB: 12, availGB: gbOf(665) });
    const override = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'large', sizeMB: 7900, dirtyMemory: true },
      { override: true },
    );
    expect(override.fits).toBe(false);
  });
});
