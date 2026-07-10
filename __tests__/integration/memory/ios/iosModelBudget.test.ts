/**
 * iOS model-memory budgeting — integration guards.
 *
 * iOS physics (why these differ from Android):
 *  - NO usable swap. Exceeding os_proc_available_memory is an UNCATCHABLE jetsam
 *    SIGKILL of OUR app (not a background app). So real free RAM (rawAvail) is the
 *    whole ceiling — effectiveAvailableMB(iOS) returns rawAvail UNCHANGED (no
 *    background reclaim, unlike Android's LMK).
 *  - The increased-memory entitlement raises the per-process cap, so the 12GB+ tier
 *    uses fraction 0.78 (iOS) vs 0.70 (Android): a 12GB iPhone must run a 7-8GB model.
 *
 * These tests drive the REAL modelResidencyManager + REAL memoryBudget math with
 * Platform.OS='ios' and deterministic device numbers (mock getTotal/getAvailable only).
 * They assert the OUTCOME (fits / refuse), never that a gate was called.
 *
 * Two kinds of guard below, clearly labelled:
 *   [CORRECT]  pins behaviour the code gets right (regression guard).
 *   [DEFECT]   pins the CURRENT (wrong) behaviour so the fix has a fails-before target.
 *              The accompanying comment states expected-vs-actual. See the bug report.
 */
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { hardwareService } from '../../../../src/services/hardware';

const RN = require('react-native');
const originalOS = RN.Platform.OS;

/** Pin iOS device RAM deterministically (GB). Mocks only the native boundary. */
const iosDevice = (totalGB: number, availGB: number): void => {
  jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(totalGB);
  jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(availGB);
  jest
    .spyOn(hardwareService, 'refreshMemoryInfo')
    .mockResolvedValue(undefined as never);
};

/** Drive the real fit gate for one model on a fresh manager. */
const fit = async (
  spec: { sizeMB: number; dirtyMemory?: boolean; modelId?: string },
  opts?: { override?: boolean; policy?: 'balanced' | 'aggressive' },
): Promise<boolean> => {
  modelResidencyManager._reset();
  modelResidencyManager.setBudgetOverrideMB(null);
  modelResidencyManager.setLoadPolicy(opts?.policy ?? 'balanced');
  const r = await modelResidencyManager.makeRoomFor(
    { key: 'text', type: 'text', modelId: spec.modelId ?? 'm', sizeMB: spec.sizeMB, dirtyMemory: spec.dirtyMemory },
    opts?.override ? { override: true } : undefined,
  );
  modelResidencyManager.setLoadPolicy('balanced');
  return r.fits;
};

beforeEach(() => {
  RN.Platform.OS = 'ios';
  modelResidencyManager._reset();
});
afterEach(() => {
  jest.restoreAllMocks();
  RN.Platform.OS = originalOS;
  modelResidencyManager._reset();
});

// ───────────────────────────────────────────────────────────────────────────
// The E4B/E2B-on-12GB class: a big CLEAN GGUF must load on a 12GB iPhone.
// ───────────────────────────────────────────────────────────────────────────
describe('[CORRECT] clean GGUF on a 12GB iPhone (0.78 entitlement)', () => {
  it('a 7GB clean GGUF loads with low instantaneous free RAM (mmap weights are file-backed)', async () => {
    iosDevice(12, 2); // rawAvail only 2GB, but clean weights page in
    expect(await fit({ sizeMB: 7000 })).toBe(true);
  });

  it('an 8GB clean GGUF loads (0.78*12 ≈ 9585MB budget)', async () => {
    iosDevice(12, 2);
    expect(await fit({ sizeMB: 8000 })).toBe(true);
  });

  it('at the tier budget boundary: 9585MB fits, 9600MB does not', async () => {
    iosDevice(12, 2);
    expect(await fit({ sizeMB: 9585 })).toBe(true);
    expect(await fit({ sizeMB: 9600 })).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG A (OVER-COMMIT → jetsam): clean-model "Load Anyway" survival floor is blind
// to model size. incomingDirtyMB=0 for a GGUF, so postLoadFreeMB = rawAvail - 0,
// i.e. the floor pretends loading an 8GB model consumes ZERO of the free RAM. On
// iOS (no swap) faulting the model's working set into ~1.2GB of headroom jetsams.
// EXPECTED: refuse an 8GB forced load when only ~1.2GB is really free.
// ACTUAL (pinned here): it is ALLOWED. seam: modelResidency/index.ts:408-414.
// ───────────────────────────────────────────────────────────────────────────
describe('[DEFECT] BUG A — clean Load-Anyway ignores incoming size in the survival floor', () => {
  it('forces an 8GB clean GGUF through with only ~1200MB really free (would jetsam on iOS)', async () => {
    iosDevice(12, 1200 / 1024); // 1200MB free — exactly the floor
    // EXPECTED: false (8GB into 1.2GB free = OOM). ACTUAL: true, because
    // postLoadFreeMB = 1200 - 0(dirty) = 1200 >= 1200 floor.
    expect(await fit({ sizeMB: 8000 }, { override: true })).toBe(true);
  });

  it('the floor only bites clean loads at absurdly low free RAM (<1200MB), not by model size', async () => {
    iosDevice(12, 1199 / 1024);
    // 1199 < 1200 → refused, but this is independent of the 8GB size — a 1GB model
    // would be refused here too and a 20GB model allowed at 1200MB. The guard does
    // not scale with the load.
    expect(await fit({ sizeMB: 8000 }, { override: true })).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG B (UNDER-COMMIT → false refusal): the 1200 iOS floor over-refuses a legit
// dirty Load-Anyway on a 12GB phone with 3-4GB free. A 2GB dirty model at 3.2GB
// free leaves 1.2GB — plenty — yet 3199MB free → 3199-2000=1199 < 1200 → refused.
// EXPECTED: allow (12GB phone, 3.2GB free, 2GB model). ACTUAL: refused just below
// 3200MB free. seam: memoryBudget.ts:59 (OVERRIDE_SURVIVAL_FLOOR_MB=1200) +
// modelResidency/index.ts:414.
// ───────────────────────────────────────────────────────────────────────────
describe('[DEFECT] BUG B — iOS 1200 floor over-refuses dirty Load-Anyway with 3-4GB free', () => {
  it('a 2GB dirty model is REFUSED at 3199MB free on a 12GB iPhone (off by the floor)', async () => {
    iosDevice(12, 3199 / 1024);
    // EXPECTED true (2GB into 3.1GB free is safe). ACTUAL false.
    expect(await fit({ sizeMB: 2000, dirtyMemory: true }, { override: true })).toBe(false);
  });

  it('it only passes once free RAM ≥ size+1200 (3200MB), so the floor is the binding limit', async () => {
    iosDevice(12, 3200 / 1024);
    expect(await fit({ sizeMB: 2000, dirtyMemory: true }, { override: true })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG C (OVER-COMMIT): a CLEAN load with no override has NO real-free-RAM ceiling.
// budgetForSpec's !dirtyPressure branch returns physicalCap and never reads
// rawAvail, so a 9GB (balanced) / 11GB (aggressive) GGUF loads on a 12GB phone
// with only 500MB actually free. On iOS (no swap) that OOMs on first inference.
// EXPECTED: gate on rawAvail for clean loads too (or warn), since iOS has no swap
// and even mmap pages must be resident to run. ACTUAL: allowed. seam:
// modelResidency/index.ts:244-248 (no-dirty-pressure branch).
// ───────────────────────────────────────────────────────────────────────────
describe('[DEFECT] BUG C — clean loads bypass the live-free-RAM ceiling on iOS', () => {
  it('balanced: a 9GB clean GGUF loads at 500MB free on a 12GB iPhone', async () => {
    iosDevice(12, 500 / 1024);
    expect(await fit({ sizeMB: 9000 })).toBe(true);
  });

  it('aggressive: an 11GB clean GGUF loads at 500MB free (0.92 fraction, still no rawAvail check)', async () => {
    iosDevice(12, 500 / 1024);
    expect(await fit({ sizeMB: 11000 }, { policy: 'aggressive' })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Dirty (LiteRT / CoreML) balanced path — the E4B-on-12GB dirty refuse loop.
// On iOS there is no background reclaim, so effectiveAvail = rawAvail. A 4GB dirty
// litertlm at 4590MB free: 4590 - 1024 headroom = 3566 < 4000 → refused (no override).
// This is BY DESIGN on iOS (documented) but note it means iOS users of the dirty
// engine hit the refuse loop the Android fix does NOT hit — flagged as an asymmetry.
// ───────────────────────────────────────────────────────────────────────────
describe('[CORRECT-by-design/ASYMMETRY] dirty balanced load on iOS uses raw free RAM only', () => {
  it('a 4GB dirty litertlm is refused at 4590MB free on 12GB iOS (no LMK reclaim), unlike Android', async () => {
    iosDevice(12, 4590 / 1024);
    expect(await fit({ sizeMB: 4000, dirtyMemory: true })).toBe(false);
  });

  it('aggressive mode (512 headroom) lets the same 4GB dirty model through: 4590-512=4078 ≥ 4000', async () => {
    iosDevice(12, 4590 / 1024);
    expect(await fit({ sizeMB: 4000, dirtyMemory: true }, { policy: 'aggressive' })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Dirty image + CoreML compile spike (over-commit probe). During the compile the
// rawAvail crashes to ~300MB. A fresh 5GB dirty image load must be refused, not
// stacked onto the spike (would jetsam). CORRECT on both policies.
// ───────────────────────────────────────────────────────────────────────────
describe('[CORRECT] dirty image load is refused during a compile-spike RAM crash', () => {
  it('balanced: a 5GB dirty image is refused at 300MB free on 12GB iOS', async () => {
    iosDevice(12, 300 / 1024);
    expect(await fit({ sizeMB: 5000, dirtyMemory: true })).toBe(false);
  });

  it('aggressive: still refused (leaner 512 headroom cannot conjure RAM that is not there)', async () => {
    iosDevice(12, 300 / 1024);
    expect(await fit({ sizeMB: 5000, dirtyMemory: true }, { policy: 'aggressive' })).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tier sweep — the fraction ladder is what it claims on iOS (4/6/8/12/16 GB).
// Pins the exact budget boundary per tier for clean loads (physical-cap only).
// ───────────────────────────────────────────────────────────────────────────
describe('[CORRECT] iOS budget ladder per RAM tier (clean load boundary)', () => {
  it.each([
    { totalGB: 4, fitMB: 2048, refuseMB: 2100 }, // 0.50*4096=2048
    { totalGB: 6, fitMB: 3686, refuseMB: 3800 }, // 0.60*6144=3686
    { totalGB: 8, fitMB: 4915, refuseMB: 5000 }, // 0.60*8192=4915
    { totalGB: 12, fitMB: 9585, refuseMB: 9700 }, // 0.78*12288=9585
    { totalGB: 16, fitMB: 12780, refuseMB: 12900 }, // 0.78*16384=12779.5→12780
  ])(
    '$totalGB GB iOS: $fitMB MB fits, $refuseMB MB refused',
    async ({ totalGB, fitMB, refuseMB }) => {
      iosDevice(totalGB, totalGB); // plenty of rawAvail so physical cap is the binding limit
      expect(await fit({ sizeMB: fitMB })).toBe(true);
      expect(await fit({ sizeMB: refuseMB })).toBe(false);
    },
  );
});
