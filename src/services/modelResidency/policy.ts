/**
 * Model residency policy (pure functions).
 *
 * Decides which on-device models stay in RAM. A phone can't hold every model
 * at once, so before loading a model we evict others to fit a RAM budget:
 *  - text and image generation models are mutually exclusive — loading one
 *    evicts the other (each plus its working set is too heavy to keep both);
 *  - otherwise it's budget-driven: small models (whisper/tts/classifier)
 *    co-reside as long as they fit;
 *  - pinned models (e.g. the ~100MB SMOL classifier) are never evicted;
 *  - when the incoming model doesn't fit, evict least-recently-used until it
 *    does (so a constrained device naturally ends up with one model).
 *
 * See docs/design/MODEL_ROUTING.md §4–5.2. Pure + deterministic so the policy
 * can be unit-tested without touching native model loading.
 */

export type ResidentType = 'text' | 'image' | 'whisper' | 'tts' | 'classifier';

export interface Resident {
  /** Unique model id. */
  key: string;
  type: ResidentType;
  /** Approximate resident memory cost in MB. */
  sizeMB: number;
  /** Pinned residents are never evicted (e.g. the classifier). */
  pinned?: boolean;
  /** Epoch ms of last use, for LRU. */
  lastUsedAt: number;
}

export interface IncomingModel {
  key: string;
  type: ResidentType;
  sizeMB: number;
}

export interface EvictionPlan {
  /** Residents to unload, in eviction order. */
  evict: Resident[];
  /** Whether the incoming model fits the budget after eviction. */
  fits: boolean;
  freedMB: number;
}

/**
 * Compute a RAM budget for resident models from total device RAM, leaving
 * headroom for the OS and the rest of the app.
 */
export function computeBudgetMB(
  totalRamMB: number,
  opts?: { reserveMB?: number; fraction?: number },
): number {
  const fraction = opts?.fraction ?? 0.6;
  const reserveMB = opts?.reserveMB ?? 1500;
  return Math.max(0, Math.min(totalRamMB * fraction, totalRamMB - reserveMB));
}

/**
 * Plan which residents to evict so `incoming` fits within `budgetMB`.
 * Never evicts pinned residents or the incoming model itself.
 */
export function planEviction(
  current: Resident[],
  incoming: IncomingModel,
  budgetMB: number,
): EvictionPlan {
  const evict: Resident[] = [];
  const isEvicted = (r: Resident) => evict.some(e => e.key === r.key);
  const alreadyResident = current.some(r => r.key === incoming.key);

  const usedMB = () =>
    current
      .filter(r => r.key !== incoming.key && !isEvicted(r))
      .reduce((sum, r) => sum + r.sizeMB, 0);
  const incomingCostMB = alreadyResident ? 0 : incoming.sizeMB;

  // 1. Mutual exclusion for generation models: text and image never co-reside.
  // Each one (plus its runtime working set) is too heavy to keep both warm, so
  // loading one always evicts the other. Whisper/TTS/classifier are small and
  // unaffected. Pinned residents are still never evicted.
  const GENERATION_TYPES = new Set<ResidentType>(['text', 'image']);
  if (GENERATION_TYPES.has(incoming.type)) {
    for (const r of current) {
      if (r.pinned || r.key === incoming.key || isEvicted(r)) continue;
      if (GENERATION_TYPES.has(r.type) && r.type !== incoming.type) {
        evict.push(r);
      }
    }
  }

  // 2. Evict least-recently-used (non-pinned) until the incoming model fits.
  while (usedMB() + incomingCostMB > budgetMB) {
    const candidate = current
      .filter(r => !r.pinned && r.key !== incoming.key && !isEvicted(r))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!candidate) break; // nothing left to evict
    evict.push(candidate);
  }

  return {
    evict,
    fits: usedMB() + incomingCostMB <= budgetMB,
    freedMB: evict.reduce((sum, r) => sum + r.sizeMB, 0),
  };
}
