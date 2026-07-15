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

/**
 * How the residency manager handles multiple models:
 *  - 'conservative': ONE model at a time — loading any model evicts every other
 *    (no co-residency), the safest on tight devices.
 *  - 'balanced' (default): co-reside models while the RAM budget holds; evict
 *    lowest-priority/LRU when a new model doesn't fit.
 *  - 'aggressive': balanced co-residency but commits a larger share of RAM (smaller
 *    OS reserve) so bigger models load before the gate refuses.
 * (A per-load "Load Anyway" override is separate and works in every mode.)
 */
export type LoadPolicy = 'conservative' | 'balanced' | 'aggressive';

/** Never commit the last ~1.5GB — OS + app baseline must always have headroom. */
export const MEMORY_RESERVE_MB = 1500;
/** Aggressive mode still keeps a floor alive (lenient, not absent). */
export const AGGRESSIVE_RESERVE_MB = 800;
// (Removed the override survival-floor cluster — OVERRIDE_SURVIVAL_FLOOR_MB /
// ANDROID_OVERRIDE_SURVIVAL_FLOOR_MB / overrideSurvivalFloorMB.) It was defined but never wired to
// any caller, so it enforced nothing, and the product decision is that "Load Anyway" gives the user
// FULL control — they accept the OOM risk, the app does not impose a hard floor they can't cross.

type Plat = 'ios' | 'android' | string;

/**
 * Effective physical RAM a FOREGROUND process may commit right now, in MB — the SINGLE
 * owner of "reclaimable-aware availability".
 *
 * `realAvailMB` is the raw os_proc available snapshot. On Android it UNDER-counts what a
 * foreground app can actually get: the low-memory killer evicts background/cached apps and
 * hands their (real, physical) pages to the foreground app, so the true ceiling is the
 * physical model budget (modelMemoryBudgetMB), not the instantaneous snapshot. That
 * reclaimed RAM is REAL physical memory a dirty/GPU model can occupy — unlike zram swap,
 * which dirty pages cannot use (the reverted Fix-A mistake that OOM'd). On iOS there is no
 * such reclaim (jetsam kills US, not background apps), so the raw snapshot stands.
 *
 * Both the residency FIT check (budgetForSpec's dirty branch) and the override survival
 * floor read this, so they can never disagree. The legacy split — a reclaimable-aware
 * override path but a raw-availMem fit check — is exactly what refused a 5.2GB dirty model
 * on a 12GB Android phone that the override then loaded fine (image-prompt enhancement, and
 * chat, both hit it).
 */
export function effectiveAvailableMB(
  realAvailMB: number,
  totalRamMB: number,
  opts: { platform?: Plat; policy?: LoadPolicy } = {},
): number {
  const { platform = Platform.OS, policy = 'balanced' } = opts;
  return platform === 'android'
    ? Math.max(realAvailMB, modelMemoryBudgetMB(totalRamMB, platform, policy))
    : realAvailMB;
}

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
function modelWarningFraction(totalRamGB: number, platform: Plat = Platform.OS): number {
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

const BYTES_PER_GB = 1024 ** 3;

/**
 * Does a model file's on-disk size exceed this device's safe RAM budget
 * (`totalRamGB * modelBudgetFraction`)? The SINGLE device-aware fit primitive that
 * every download-warning decision and the detail-list compatibility filter compute
 * from — a static per-model flag was device-blind and fired on every device. Zero-IO
 * so it is unit-testable; callers pass the RAM read from the device boundary
 * (hardwareService.getTotalMemoryGB).
 */
export function fileExceedsBudget(sizeBytes: number, ramGB: number): boolean {
  return sizeBytes / BYTES_PER_GB >= ramGB * modelBudgetFraction(ramGB);
}

export type FitTier = 'easy' | 'fits' | 'tight' | 'wontFit';

/**
 * A device-fit TIER for a model file — a short chip label, NOT the load gate. The load path can
 * attempt anything up to the aggressive ceiling (Android reclaim credit + Load Anyway), so browse
 * no longer HIDES loadable models or says "Too large"; it shows how snug the fit is, and reserves an
 * honest "Won't fit" only for models past even the aggressive ceiling (e.g. a 30B on a phone).
 * Two thresholds, both from the SAME owned budgets — no new magic numbers:
 *   soft = ramGB * modelBudgetFraction(balanced)   (recommended stays within this — see fileExceedsBudget)
 *   ceil = ramGB * modelBudgetFraction(aggressive) (the most Load-Anyway/aggressive can hold)
 *   size < 0.6*soft → 'easy' · < soft → 'fits' · < ceil → 'tight' · else → 'wontFit'
 * Zero-IO; callers pass ramGB + platform from the device boundary (hardwareService).
 */
export function fitTier(sizeBytes: number, ramGB: number, platform: Plat = Platform.OS): FitTier {
  const sizeGB = sizeBytes / BYTES_PER_GB;
  const soft = ramGB * modelBudgetFraction(ramGB, platform, 'balanced');
  const ceil = ramGB * modelBudgetFraction(ramGB, platform, 'aggressive');
  if (sizeGB < 0.6 * soft) return 'easy';
  if (sizeGB < soft) return 'fits';
  if (sizeGB < ceil) return 'tight';
  return 'wontFit';
}

/** The chip label for a fit tier. One source for the copy so every surface reads the same words. */
export function fitTierLabel(tier: FitTier): string {
  switch (tier) {
    case 'easy': return 'Easy';
    case 'fits': return 'Fits';
    case 'tight': return 'Tight';
    case 'wontFit': return "Won't fit";
  }
}

/**
 * Block until a just-released native model's memory is reclaimed (process footprint drops by
 * ~minDropMB) or a bounded timeout — so the NEXT model load never allocates on top of the outgoing
 * model. The native context.release() returns before the OS frees the weights + GPU/HTP buffers;
 * without this barrier a reload stacked BOTH models' memory at once and OOM'd under pressure
 * (device 2026-07-14: a reload with ~2GB free ground to 0 tok/s then the process was killed).
 * Zero-IO over an injected memory reader so it is unit-testable; best-effort — if the RAM sensor is
 * unavailable or the footprint never settles, wait a short fixed beat and proceed.
 */
export async function awaitMemoryReclaim(
  getProcessMemory: () => Promise<{ footprintMB: number } | null>,
  opts: { timeoutMs?: number; minDropMB?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const { timeoutMs = 2500, minDropMB = 200, intervalMs = 120 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const before = await getProcessMemory();
  if (!before) { await sleep(250); return; }
  let waited = 0;
  while (waited < timeoutMs) {
    await sleep(intervalMs);
    waited += intervalMs;
    const now = await getProcessMemory();
    if (!now) return;
    if (before.footprintMB - now.footprintMB >= minDropMB) return;
  }
}
