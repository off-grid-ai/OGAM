/**
 * G3 (docs/RELEASE_571_GAP_FINDINGS.md): the Load-Anyway survival probe reads real free RAM
 * IMMEDIATELY after eviction, with no awaitMemoryReclaim barrier between the native release() and
 * the read (that barrier exists and is used on the load side, llm.ts). On iOS os_proc_available
 * lags unload by hundreds of ms, so the probe sees the stale PRE-reclaim value and refuses a load
 * the device can actually do — the exact false refusal Load Anyway exists to defeat.
 *
 * Runs the REAL modelResidencyManager over the RAM-sensor boundary (deviceMemory harness), with a
 * reclaim-lag model: free RAM is 650MB until the footprint drop is observed, then 3.6GB.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory, makeResident, gbOf } from '../../harness/deviceMemory';

afterEach(() => resetDeviceMemory());

describe('memory Load-Anyway survival probe vs reclaim lag', () => {
  it('G3: Load Anyway loads after the eviction is actually reclaimed, not refused on the pre-reclaim reading', async () => {
    // 6GB iPhone: a dirty image model is resident; instantaneous free is only 650MB (below the 700MB
    // survival floor) BUT once the image's pages are reclaimed after eviction, free rises to ~3.6GB.
    setDeviceMemory({
      platform: 'ios',
      totalGB: 6,
      availGB: gbOf(650),
      reclaim: {
        footprintBeforeMB: 4000,
        footprintAfterMB: 1000,
        availAfterGB: gbOf(3600),
      },
    });
    makeResident({ key: 'image', type: 'image', modelId: 'sd', sizeMB: 3000, dirtyMemory: true });

    // User taps Load Anyway on a 2GB text model. It cannot fit at 650MB free, so the override evicts
    // the image; the post-reclaim survival read (3.6GB - 2GB = 1.6GB) is well above the floor.
    const { fits } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'big', sizeMB: 2048, dirtyMemory: true },
      { override: true },
    );

    expect(fits).toBe(true);
  });
});
