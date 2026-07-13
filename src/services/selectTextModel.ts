import type { DownloadedModel } from '../types';

/** Does an estimated footprint (MB) fit the budget (MB)? */
export function fitsBudget(footprintMB: number, budgetMB: number): boolean {
  return footprintMB <= budgetMB;
}

/**
 * Pick which downloaded text model to AUTO-LOAD when none is resident.
 *
 * Only for the no-model auto-load path. If a model is already loaded (or a
 * remote is active) the caller uses that as-is and never calls this.
 *
 * `footprintMB(model)` is the estimated resident RAM in MB. Pass the canonical
 * estimator (`hardwareService.estimateModelRam`) so weights + the vision mmproj
 * clip + runtime overhead are all counted the same way the loader budgets them
 * - do not re-derive footprint here.
 *
 * Rule, in order:
 *  1. the user's active model, IF it fits the budget (respect an explicit choice);
 *  2. otherwise the LARGEST that fits (best quality the device can run);
 *  3. otherwise the SMALLEST (run something rather than pick an OOM).
 *
 * Returns null only when there are no models to choose from.
 */
export function selectTextModelToLoad(
  models: DownloadedModel[],
  budgetMB: number,
  opts: { activeId: string | null; footprintMB: (m: DownloadedModel) => number },
): DownloadedModel | null {
  const { activeId, footprintMB } = opts;
  if (models.length === 0) return null;

  const active = activeId ? models.find((m) => m.id === activeId) ?? null : null;
  if (active && fitsBudget(footprintMB(active), budgetMB)) return active;

  // Largest footprint first, so the first fitting one is the biggest that fits.
  const bySizeDesc = [...models].sort((a, b) => footprintMB(b) - footprintMB(a));
  const largestFit = bySizeDesc.find((m) => fitsBudget(footprintMB(m), budgetMB));
  if (largestFit) return largestFit;

  // Nothing fits — the smallest is the least-bad option (better than an OOM pick).
  return bySizeDesc[bySizeDesc.length - 1];
}
