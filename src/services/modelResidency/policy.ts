/**
 * Model residency policy (pure functions).
 *
 * Decides which on-device models stay in RAM. A phone can't hold every model
 * at once, so before loading a model we evict others to fit a RAM budget:
 *  - text and image generation models are mutually exclusive — loading one
 *    evicts the other (each plus its working set is too heavy to keep both);
 *  - speech (whisper) and TTS are small co-resident sidecars: they stay warm
 *    alongside whichever generation model is loaded and loading one never evicts
 *    anything; they're evicted only as a last resort when a heavy generation
 *    model can't otherwise fit (only text↔image are mutually exclusive);
 *  - pinned models (e.g. the ~100MB SMOL classifier) are never evicted;
 *  - when an incoming generation model doesn't fit, evict least-recently-used
 *    (non-sidecar, non-pinned) residents until it does.
 *
 * See docs/design/MODEL_ROUTING.md §4–5.2. Pure + deterministic so the policy
 * can be unit-tested without touching native model loading.
 */

export type ResidentType = 'text' | 'image' | 'whisper' | 'tts' | 'classifier' | 'embedding';

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

  // Speech (whisper), TTS, and the RAG/MCP embedding model are small always-resident
  // sidecars: never evicted for capacity, and they never trigger eviction of the
  // active generation model. Only text and image are heavy enough to swap.
  const SIDECAR_TYPES = new Set<ResidentType>(['whisper', 'tts', 'embedding']);

  // 1. Mutual exclusion for generation models: text and image never co-reside.
  // Each one (plus its runtime working set) is too heavy to keep both warm, so
  // loading one always evicts the other. Sidecars/classifier are small and
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

  // 2. Fit a heavy (generation) incoming model within budget. Evict
  // least-recently-used non-pinned residents, but prefer non-sidecars and treat
  // the STT/TTS sidecars as a LAST RESORT: on a roomy device they stay warm
  // alongside the generation model, yet a big model can still reclaim their RAM
  // (they're cheap to reload) instead of overshooting the budget and risking an
  // OOM. Loading a sidecar itself never evicts the active generation model — it
  // just coexists. Pinned residents are never evicted.
  if (GENERATION_TYPES.has(incoming.type)) {
    while (usedMB() + incomingCostMB > budgetMB) {
      const candidate = current
        .filter(r => !r.pinned && r.key !== incoming.key && !isEvicted(r))
        .sort((a, b) => {
          const aSidecar = SIDECAR_TYPES.has(a.type) ? 1 : 0;
          const bSidecar = SIDECAR_TYPES.has(b.type) ? 1 : 0;
          if (aSidecar !== bSidecar) return aSidecar - bSidecar; // non-sidecars first
          return a.lastUsedAt - b.lastUsedAt;                    // then least-recently-used
        })[0];
      if (!candidate) break; // nothing left to evict
      evict.push(candidate);
    }
  }

  return {
    evict,
    fits: usedMB() + incomingCostMB <= budgetMB,
    freedMB: evict.reduce((sum, r) => sum + r.sizeMB, 0),
  };
}
