import { RECOMMENDED_MODELS, TRENDING_FAMILIES } from '../constants';

type RecommendedModel = (typeof RECOMMENDED_MODELS)[number];

/**
 * Fit score for a model on a device: ideal ≈ 40% of RAM, penalised above 75% (too
 * slow). Lower is better. Single source of truth — onboarding and the Models screen
 * both score the SAME way instead of each copying the formula.
 */
export function ramFitScore(minRamGB: number, deviceRamGB: number): number {
  const ratio = deviceRamGB > 0 ? minRamGB / deviceRamGB : Infinity;
  const penalty = ratio > 0.75 ? (ratio - 0.75) * 4 : 0;
  return Math.abs(ratio - 0.4) + penalty;
}

/** Whether a curated model fits this device's RAM (min ≤ ram ≤ max). */
function fitsDevice(m: RecommendedModel, deviceRamGB: number): boolean {
  return m.minRam <= deviceRamGB && (!m.maxRam || deviceRamGB <= m.maxRam);
}

/**
 * The curated recommended models that FIT this device, in editorial order. ONE place
 * both onboarding (which shows this filtered list) and the Models screen filter from —
 * no parallel RAM-filter implementations.
 */
export function recommendedModelsForDevice(deviceRamGB: number): RecommendedModel[] {
  return RECOMMENDED_MODELS.filter(m => fitsDevice(m, deviceRamGB));
}

/** One best-fit model id per trending family for this device (the "trending" pills). */
export function trendingModelIdsForDevice(deviceRamGB: number): Set<string> {
  const ids = new Set<string>();
  for (const familyIds of Object.values(TRENDING_FAMILIES)) {
    const best = RECOMMENDED_MODELS
      .filter(m => familyIds.includes(m.id) && fitsDevice(m, deviceRamGB))
      .sort((a, b) => ramFitScore(a.minRam, deviceRamGB) - ramFitScore(b.minRam, deviceRamGB))[0];
    if (best) ids.add(best.id);
  }
  return ids;
}
