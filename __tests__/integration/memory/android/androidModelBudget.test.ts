/**
 * Android model-memory budgeting — device-accurate guard tests.
 *
 * These drive the REAL modelResidencyManager + REAL memoryBudget/policy math with
 * Platform.OS='android', pinned device RAM (setBudgetOverrideMB(null) so the real
 * device-tier fraction is used), and the exact model sizes from the device logs. They
 * assert the OUTCOME (fits / evicted / resident set / post-evict-vs-floor), never
 * `toHaveBeenCalled` — deleting the budget logic flips these.
 *
 * ⚠️ HARNESS NOTE (see the bug report): jest.config.js `testPathIgnorePatterns`
 * includes the bare token `/android/`, intended for the native `android/` build dir.
 * It ALSO matches THIS path (`__tests__/integration/memory/android/`), so jest silently
 * skips this file. It was verified green by shadow-running an identical copy under a
 * NON-ignored sibling dir. The fix is to anchor that ignore to `<rootDir>/android/`.
 *
 * Ground-truth balanced Android budgets (modelMemoryBudgetMB, MB):
 *   4GB→2048  6GB→3686  8GB→4915  12GB→8602  16GB→11469  24GB→17203
 * Android override survival floor = 700MB; DIRTY_AVAILABILITY_HEADROOM = 1024 (bal) / 512 (agg).
 */
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { hardwareService } from '../../../../src/services/hardware';

const RN = require('react-native');
const originalOS = RN.Platform.OS;

/** Pin the device: android, real RAM totals, live free-RAM snapshot. */
function android(totalGB: number, availGB: number): void {
  RN.Platform.OS = 'android';
  modelResidencyManager._reset();
  modelResidencyManager.setBudgetOverrideMB(null); // use the real device-tier fraction
  jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(totalGB);
  jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(availGB);
  jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
}

afterEach(() => {
  RN.Platform.OS = originalOS;
  modelResidencyManager.setLoadPolicy('balanced');
  jest.restoreAllMocks();
});

describe('Android: clean mmap GGUF is bounded by physical RAM only (no false refusal / no over-commit)', () => {
  it('a 4900MB clean GGUF FITS an 8GB phone even when live free RAM is only ~512MB (clean pages page in)', async () => {
    android(8, 0.5);
    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', sizeMB: 4900, dirtyMemory: false,
    });
    // physical cap 8GB = 4915; 4900 ≤ 4915 → fits, and no dirty pressure so live availMem is ignored.
    expect(fits).toBe(true);
    expect(evicted).toEqual([]);
  });

  it('a 5000MB clean GGUF is correctly REFUSED on an 8GB phone (over the 4915 physical cap)', async () => {
    android(8, 0.5);
    const { fits } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', sizeMB: 5000, dirtyMemory: false,
    });
    expect(fits).toBe(false); // bounded by physical cap, not falsely refused earlier
  });
});

describe('Android: a SINGLE dirty model is gated by the reclaimable-aware ceiling', () => {
  it('a 5000MB dirty LiteRT model is REFUSED on an 8GB phone (dynamic 4915-1024=3891 < 5000)', async () => {
    android(8, 2);
    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', sizeMB: 5000, dirtyMemory: true,
    });
    expect(fits).toBe(false);
    expect(evicted).toEqual([]);
  });

  it('a 5235MB dirty E4B FITS an empty 12GB phone with NO override (the reclaim-aware fix)', async () => {
    android(12, 4.5);
    const { fits, evicted } = await modelResidencyManager.makeRoomFor({
      key: 'text', type: 'text', modelId: 'gemma-4-E4B', sizeMB: 5235, dirtyMemory: true,
    });
    expect(fits).toBe(true);
    expect(evicted).toEqual([]);
  });
});

describe('Android: override survival floor (700) refuses a guaranteed-OOM force-load', () => {
  it('REFUSES a 8000MB dirty override on a 12GB phone in a ~640MB-free OOM state (602 < 700 floor)', async () => {
    android(12, 0.65);
    const { fits, evicted } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', sizeMB: 8000, dirtyMemory: true },
      { override: true },
    );
    // effectiveAvail 8602 - 8000 = 602 < 700 → refuse (graceful "close some apps" beats a crash).
    expect(fits).toBe(false);
    expect(evicted).toEqual([]);
  });
});
