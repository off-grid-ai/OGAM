/**
 * Memory budget — the SINGLE source of truth for "how much RAM this process may
 * safely commit to on-device models" on THIS device + platform.
 *
 * Both consumers read it so they can never disagree (one saying a model fits while
 * the other rejects it):
 *  - the residency manager (capacity planning + eviction), and
 *  - the pre-load memory check (checkMemoryForModel).
 *
 * The safe fraction is device + platform aware (NOT flat) because the fixed OS+app
 * baseline is a big slice of 4GB but a small slice of 12GB, and on iOS we hold
 * com.apple.developer.kernel.increased-memory-limit which raises the per-process
 * cap well above the default:
 *  - ≤4GB: 0.50 (≈2GB on a 4GB device — safe in practice; the dynamic real-free-RAM
 *    guard tightens further under real pressure),
 *  - 6-8GB: 0.60,
 *  - 12GB+: 0.78 iOS / 0.70 Android (so a 12GB iPhone runs a 7GB model a flat 60%
 *    wrongly rejected).
 * This fraction is the absolute PHYSICAL ceiling; the residency manager's dynamic
 * budget (real free RAM right now) is the actual protection against loading into swap.
 *
 * Previously two places computed this independently (a 0.6 in the residency policy
 * AND a separate device-tiered fraction in the model-load check); unifying it here
 * is the fix.
 */
import { Platform } from 'react-native';

/** Never commit the last ~1.5GB — OS + app baseline must always have headroom. */
export const MEMORY_RESERVE_MB = 1500;

type Plat = 'ios' | 'android' | string;

/** Safe fraction of total RAM this process may commit to models, by device tier. */
export function modelBudgetFraction(totalRamGB: number, platform: Plat = Platform.OS): number {
  if (totalRamGB <= 4) return 0.50; // ~2GB on 4GB — safe; dynamic guard tightens under pressure
  if (totalRamGB <= 8) return 0.60; // 6-8GB
  return platform === 'ios' ? 0.78 : 0.70; // 12GB+: iOS holds the increased-memory entitlement
}

/** Fraction at which we WARN (load allowed, perf may suffer). Below the budget. */
export function modelWarningFraction(totalRamGB: number, platform: Plat = Platform.OS): number {
  if (totalRamGB <= 4) return 0.40;
  if (totalRamGB <= 8) return 0.50;
  return platform === 'ios' ? 0.66 : 0.60;
}

/** Hard budget in MB: the smaller of the fraction-of-RAM and (RAM minus reserve). */
export function modelMemoryBudgetMB(totalRamMB: number, platform: Plat = Platform.OS): number {
  const totalRamGB = totalRamMB / 1024;
  const byFraction = totalRamMB * modelBudgetFraction(totalRamGB, platform);
  const byReserve = totalRamMB - MEMORY_RESERVE_MB;
  return Math.max(0, Math.min(byFraction, byReserve));
}

/** Warning threshold in MB (always ≤ the hard budget). */
export function modelWarningThresholdMB(totalRamMB: number, platform: Plat = Platform.OS): number {
  const totalRamGB = totalRamMB / 1024;
  const byFraction = totalRamMB * modelWarningFraction(totalRamGB, platform);
  return Math.min(byFraction, modelMemoryBudgetMB(totalRamMB, platform));
}
