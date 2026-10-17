/**
 * The physical-RAM budget for resident models on this device: a fraction of total RAM, set by
 * the load policy in the single memory-budget owner. The residency rules themselves (what fits,
 * what is evicted first) are the shared policy in @offgrid/models.
 */
import { modelMemoryBudgetMB, LoadPolicy } from '../memoryBudget';

export function computeBudgetMB(totalRamMB: number, opts?: { policy?: LoadPolicy }): number {
  return modelMemoryBudgetMB(totalRamMB, undefined, opts?.policy);
}
