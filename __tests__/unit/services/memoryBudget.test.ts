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
  MEMORY_RESERVE_MB,
  AGGRESSIVE_RESERVE_MB,
} from '../../../src/services/memoryBudget';

const GB = 1024;

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
