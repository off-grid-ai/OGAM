/**
 * Unit tests for the single device + platform aware memory budget owner.
 * The headline regression: a 12GB iPhone must NOT be capped like a 6GB one, so a
 * ~7GB model fits (the gemma-4-E4B case that wrongly failed under a flat 60%).
 */
import {
  modelBudgetFraction,
  modelMemoryBudgetMB,
  modelWarningThresholdMB,
  memoryReserveMB,
  effectiveAvailableMB,
  MEMORY_RESERVE_MB,
  AGGRESSIVE_RESERVE_MB,
  awaitMemoryReclaim,
} from '../../../src/services/memoryBudget';

const GB = 1024;

describe('effectiveAvailableMB — reclaimable-aware availability (single owner)', () => {
  const TOTAL_12GB = 11297; // real device figure from a 12GB phone

  it('Android: credits the physical budget when the raw availMem snapshot reads low', () => {
    // The exact device case: a 12GB Android phone reports ~4.6GB raw available (background
    // apps hold cached pages the LMK will reclaim for a foreground load). The effective
    // ceiling must be the physical budget (~7908MB = 0.70*11297), not the raw 4590.
    const eff = effectiveAvailableMB(4590, TOTAL_12GB, { platform: 'android' });
    expect(eff).toBe(modelMemoryBudgetMB(TOTAL_12GB, 'android'));
    expect(eff).toBeGreaterThan(4590);
  });

  it('Android: keeps the raw availMem when it already exceeds the physical budget', () => {
    // Never LOWER the ceiling — if the snapshot is already generous, use it.
    expect(effectiveAvailableMB(9000, TOTAL_12GB, { platform: 'android' })).toBe(9000);
  });

  it('iOS: returns the raw availMem unchanged (no background-reclaim — jetsam kills US)', () => {
    expect(effectiveAvailableMB(4590, TOTAL_12GB, { platform: 'ios' })).toBe(4590);
  });

  it('passes the load policy through (aggressive credits a larger ceiling than balanced)', () => {
    const balanced = effectiveAvailableMB(1000, TOTAL_12GB, { platform: 'android', policy: 'balanced' });
    const aggressive = effectiveAvailableMB(1000, TOTAL_12GB, { platform: 'android', policy: 'aggressive' });
    expect(aggressive).toBeGreaterThan(balanced);
  });
});

describe('modelBudgetFraction', () => {
  it('keeps low-RAM devices conservative (≈2GB on 4GB)', () => {
    expect(modelBudgetFraction(4, 'ios')).toBe(0.50);
    expect(modelBudgetFraction(4, 'android')).toBe(0.50);
  });

  it('keeps 6-8GB devices at the prior 0.60 (unchanged)', () => {
    expect(modelBudgetFraction(6, 'ios')).toBe(0.60);
    expect(modelBudgetFraction(8, 'android')).toBe(0.60);
  });

  it('raises the fraction for high-RAM devices, higher on iOS (entitlement)', () => {
    expect(modelBudgetFraction(12, 'ios')).toBeGreaterThan(0.60);
    expect(modelBudgetFraction(12, 'ios')).toBeGreaterThan(modelBudgetFraction(12, 'android'));
  });
});

describe('modelMemoryBudgetMB', () => {
  it('lets a ~7GB model fit on a 12GB iPhone (the E4B regression)', () => {
    const budget = modelMemoryBudgetMB(12 * GB, 'ios');
    expect(budget).toBeGreaterThan(7 * GB); // 7GB model now fits
  });

  it('caps the 4GB budget at ~2GB (0.50; jetsam-safe, dynamic guard tightens further)', () => {
    // 0.50 * 4096 = 2048; reserve cap (4096-1500=2596) is looser, so fraction binds.
    expect(modelMemoryBudgetMB(4 * GB, 'ios')).toBeCloseTo(0.50 * 4 * GB, 0);
  });

  it('never commits past the reserve floor', () => {
    const total = 12 * GB;
    expect(modelMemoryBudgetMB(total, 'ios')).toBeLessThanOrEqual(total - MEMORY_RESERVE_MB);
  });
});

describe('modelWarningThresholdMB', () => {
  it('is always at or below the hard budget', () => {
    for (const gb of [4, 6, 8, 12, 16]) {
      const total = gb * GB;
      expect(modelWarningThresholdMB(total, 'ios')).toBeLessThanOrEqual(modelMemoryBudgetMB(total, 'ios'));
    }
  });
});

describe('load policy — aggressive vs balanced', () => {
  it("defaults to balanced (behaviour-neutral) when policy omitted", () => {
    for (const gb of [4, 8, 12, 24]) {
      expect(modelBudgetFraction(gb, 'android')).toBe(modelBudgetFraction(gb, 'android', 'balanced'));
      expect(modelMemoryBudgetMB(gb * GB, 'android')).toBe(modelMemoryBudgetMB(gb * GB, 'android', 'balanced'));
    }
  });

  it('aggressive commits a strictly larger fraction at every tier', () => {
    for (const [gb, plat] of [[4, 'android'], [8, 'android'], [12, 'android'], [12, 'ios'], [24, 'android']] as const) {
      expect(modelBudgetFraction(gb, plat, 'aggressive')).toBeGreaterThan(modelBudgetFraction(gb, plat, 'balanced'));
    }
  });

  it('aggressive holds a smaller (but non-zero) OS reserve — the lenient safeguard', () => {
    expect(memoryReserveMB('aggressive')).toBe(AGGRESSIVE_RESERVE_MB);
    expect(memoryReserveMB('balanced')).toBe(MEMORY_RESERVE_MB);
    expect(AGGRESSIVE_RESERVE_MB).toBeGreaterThan(0);
    expect(AGGRESSIVE_RESERVE_MB).toBeLessThan(MEMORY_RESERVE_MB);
  });

  it('fails-before/passes-after: a 21GB model is rejected on a 24GB phone under balanced but fits under aggressive', () => {
    const total = 24 * GB;
    const model = 21 * GB;
    // Balanced: 24GB * 0.70 = 16.8GB budget → 21GB does NOT fit.
    expect(modelMemoryBudgetMB(total, 'android', 'balanced')).toBeLessThan(model);
    // Aggressive: pushes near the physical ceiling → 21GB fits (Nico's Qwen3 MoE case).
    expect(modelMemoryBudgetMB(total, 'android', 'aggressive')).toBeGreaterThanOrEqual(model);
  });

  it('aggressive still never commits past its own reserve floor', () => {
    const total = 24 * GB;
    expect(modelMemoryBudgetMB(total, 'android', 'aggressive')).toBeLessThanOrEqual(total - AGGRESSIVE_RESERVE_MB);
  });
});

describe('awaitMemoryReclaim — unload does not return until native memory is freed (device 2026-07-14)', () => {
  const noSleep = () => Promise.resolve(); // no real timers; drives the loop instantly

  it('returns as soon as the process footprint drops by the threshold', async () => {
    // footprint: 5000 (before) → 4900 → 4700 (dropped 300 ≥ 200) — the reclaim landed on the 2nd poll.
    const readings = [{ footprintMB: 5000 }, { footprintMB: 4900 }, { footprintMB: 4700 }, { footprintMB: 4700 }];
    let i = 0;
    const getProcessMemory = jest.fn(async () => readings[Math.min(i++, readings.length - 1)]);
    await awaitMemoryReclaim(getProcessMemory, { sleep: noSleep });
    // It polled the before + at least two more reads, and did NOT run to the full timeout.
    expect(getProcessMemory.mock.calls.length).toBeLessThanOrEqual(4);
    expect(getProcessMemory.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('waits the full bounded window when the footprint never settles (then proceeds)', async () => {
    const getProcessMemory = jest.fn(async () => ({ footprintMB: 5000 })); // never drops
    await awaitMemoryReclaim(getProcessMemory, { sleep: noSleep, timeoutMs: 600, intervalMs: 120 });
    // Polled before + one per interval across the window, then returned (never hangs).
    expect(getProcessMemory.mock.calls.length).toBe(1 + 600 / 120);
  });

  it('falls back to a fixed beat when the RAM sensor is unavailable', async () => {
    const sleep = jest.fn(async () => {});
    const getProcessMemory = jest.fn(async () => null); // no sensor
    await awaitMemoryReclaim(getProcessMemory, { sleep });
    expect(getProcessMemory).toHaveBeenCalledTimes(1); // read once, saw null, bailed to the fixed wait
    expect(sleep).toHaveBeenCalledWith(250);
  });
});
