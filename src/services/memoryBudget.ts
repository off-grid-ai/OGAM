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
 *
 * ── Load policy ────────────────────────────────────────────────────────────────
 * The SAME functions are parameterised by a `LoadPolicy` so "aggressive mode" is a
 * single data-driven knob, NOT an `if (aggressive)` scattered through the load path:
 *  - 'balanced' (default): the conservative behaviour above. Every existing caller
 *    that omits the policy gets exactly this, so the default is behaviour-neutral.
 *  - 'aggressive': commit a larger fraction of RAM and hold a smaller OS reserve,
 *    so big models (e.g. a 21GB MoE on a 24GB phone, a 3GB LiteRT model whose dirty
 *    footprint the balanced dynamic guard rejects on a 12GB phone) are allowed to
 *    load. The reserve floor is reduced but NEVER removed — that is the "lenient
 *    safeguard": we still keep the OS + app baseline alive rather than guaranteeing
 *    an instant jetsam.
 *
 * "Load Anyway" (the per-load override that forces past the fit gate) is a separate,
 * ALWAYS-available escape hatch — not gated by this policy. Aggressive mode changes
 * the default budget so fewer loads need forcing; the override remains the explicit,
 * per-load, user-confirmed way to push past whatever budget is in effect.
 */
import { Platform } from 'react-native';

/** How hard we push RAM utilisation when loading a model. */
export type LoadPolicy = 'balanced' | 'aggressive';

/** Never commit the last ~1.5GB — OS + app baseline must always have headroom. */
export const MEMORY_RESERVE_MB = 1500;
/** Aggressive mode still keeps a floor alive (lenient, not absent). */
export const AGGRESSIVE_RESERVE_MB = 800;
/**
 * Absolute survival floor that even "Load Anyway" (override) will NOT cross: if forcing a
 * load would leave live free RAM below this, refuse it — the OS would jetsam-kill the app
 * mid-load anyway (an uncatchable SIGKILL), so a graceful "close some apps" beats a crash.
 * Override still bypasses the conservative budget; this only stops the guaranteed-OOM case
 * (e.g. many background apps have eaten the baseline).
 */
export const OVERRIDE_SURVIVAL_FLOOR_MB = 1200;

type Plat = 'ios' | 'android' | string;

/** OS/app reserve (MB) that is never committed to models, by policy. */
export function memoryReserveMB(policy: LoadPolicy = 'balanced'): number {
  return policy === 'aggressive' ? AGGRESSIVE_RESERVE_MB : MEMORY_RESERVE_MB;
}

/** Safe fraction of total RAM this process may commit to models, by device tier. */
export function modelBudgetFraction(
  totalRamGB: number,
  platform: Plat = Platform.OS,
  policy: LoadPolicy = 'balanced',
): number {
  if (policy === 'aggressive') {
    // Lenient: use more of RAM. Low-RAM tiers stay comparatively cautious (a 60%
    // slice of 4GB is already close to what the OS will tolerate), high-RAM/entitled
    // tiers push near the physical ceiling so a 21GB model fits a 24GB phone.
    if (totalRamGB <= 4) return 0.60;
    if (totalRamGB <= 8) return 0.75;
    return platform === 'ios' ? 0.92 : 0.88;
  }
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
export function modelMemoryBudgetMB(
  totalRamMB: number,
  platform: Plat = Platform.OS,
  policy: LoadPolicy = 'balanced',
): number {
  const totalRamGB = totalRamMB / 1024;
  const byFraction = totalRamMB * modelBudgetFraction(totalRamGB, platform, policy);
  const byReserve = totalRamMB - memoryReserveMB(policy);
  return Math.max(0, Math.min(byFraction, byReserve));
}

/** Warning threshold in MB (always ≤ the hard budget). */
export function modelWarningThresholdMB(totalRamMB: number, platform: Plat = Platform.OS): number {
  const totalRamGB = totalRamMB / 1024;
  const byFraction = totalRamMB * modelWarningFraction(totalRamGB, platform);
  return Math.min(byFraction, modelMemoryBudgetMB(totalRamMB, platform));
}
