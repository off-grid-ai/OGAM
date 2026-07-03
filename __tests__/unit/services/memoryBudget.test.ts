/**
 * Unit tests for the single device + platform aware memory budget owner.
 * The headline regression: a 12GB iPhone must NOT be capped like a 6GB one, so a
 * ~7GB model fits (the gemma-4-E4B case that wrongly failed under a flat 60%).
 */
import {
  modelBudgetFraction,
  modelMemoryBudgetMB,
  modelWarningThresholdMB,
  MEMORY_RESERVE_MB,
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
