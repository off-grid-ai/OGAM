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

import { modelMemoryBudgetMB, LoadPolicy } from '../memoryBudget';

export type ResidentType = 'text' | 'image' | 'whisper' | 'tts' | 'classifier' | 'embedding';

export interface Resident {
  /** Unique model id. */
  key: string;
  type: ResidentType;
  /** Approximate resident memory cost in MB. */
  sizeMB: number;
  /** Pinned residents are never evicted (e.g. the classifier). */
  pinned?: boolean;
  /** True for dirty-memory models (CoreML/ONNX image): their working set can't be
   *  paged out like clean mmap weights, so their presence triggers the live os_proc
   *  gate on other loads. */
  dirtyMemory?: boolean;
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

// Speech (whisper), TTS, and the RAG/MCP embedding model are small sidecars.
const SIDECAR_TYPES = new Set<ResidentType>(['whisper', 'tts', 'embedding']);

// Priority (what to KEEP): text is highest, then image, then the STT/TTS/embedding
// sidecars (equal, lowest), then pinned helpers. Eviction takes the lowest first.
const PRIORITY: Record<ResidentType, number> = {
  text: 3, image: 2, whisper: 1, tts: 1, embedding: 1, classifier: 0,
};

/**
 * The SINGLE rule for "which resident to evict next" — lowest priority, then
 * least-recently-used, honoring pinned + the sidecar restriction. Used by both the
 * pure budget planner (planEviction) and the manager's measure-after-evict loop, so
 * the two can never disagree on eviction order. Returns undefined when nothing is
 * evictable (caller stops and reports fits=false).
 */
export function selectEvictionVictim(
  current: Resident[],
  incoming: IncomingModel,
  isEvicted: (r: Resident) => boolean,
): Resident | undefined {
  const incomingIsSidecar = SIDECAR_TYPES.has(incoming.type);
  return current
    .filter(r =>
      !r.pinned && r.key !== incoming.key && !isEvicted(r) &&
      // A sidecar incoming may only reclaim from peer sidecars (never a
      // generation model); a generation incoming may evict anything non-pinned.
      (!incomingIsSidecar || SIDECAR_TYPES.has(r.type)),
    )
    .sort((a, b) => {
      const pa = PRIORITY[a.type] ?? 0;
      const pb = PRIORITY[b.type] ?? 0;
      if (pa !== pb) return pa - pb;        // lowest priority evicted first
      return a.lastUsedAt - b.lastUsedAt;   // then least-recently-used
    })[0];
}

/**
 * Compute a RAM budget for resident models from total device RAM, leaving
 * headroom for the OS and the rest of the app.
 */
export function computeBudgetMB(
  totalRamMB: number,
  opts?: { reserveMB?: number; fraction?: number; policy?: LoadPolicy },
): number {
  // Explicit overrides keep the old escape hatch; otherwise defer to the single
  // device + platform aware budget owner (so residency and the pre-load memory
  // check can never disagree, and high-RAM/iOS-entitled devices get their larger
  // safe fraction instead of a flat 60%). The load policy ('aggressive') tunes the
  // fraction + reserve in that one owner — never branched on here.
  if (opts?.fraction != null || opts?.reserveMB != null) {
    const fraction = opts?.fraction ?? 0.6;
    const reserveMB = opts?.reserveMB ?? 1500;
    return Math.max(0, Math.min(totalRamMB * fraction, totalRamMB - reserveMB));
  }
  return modelMemoryBudgetMB(totalRamMB, undefined, opts?.policy);
}

/**
 * Plan which residents to evict so `incoming` fits within `budgetMB`.
 * Never evicts pinned residents or the incoming model itself.
 *
 * `opts.singleModel` (aggressive / "Load Anyway" mode): keep ONE model at a time —
 * evict EVERY evictable resident (still honoring pinned + in-use veto) rather than
 * co-residing whatever fits. This is the extreme-mode intent: give the one model the
 * maximum RAM instead of sharing it, so a big model has the best chance to load/run.
 *
 * (max-params disabled below: four clear positional inputs — residents, incoming,
 * budget, options — reads clearer than an options-object wrapper on this hot pure fn.)
 */
// eslint-disable-next-line max-params
export function planEviction(
  current: Resident[],
  incoming: IncomingModel,
  budgetMB: number,
  opts?: { singleModel?: boolean },
): EvictionPlan {
  const evict: Resident[] = [];
  const isEvicted = (r: Resident) => evict.some(e => e.key === r.key);
  const alreadyResident = current.some(r => r.key === incoming.key);

  const usedMB = () =>
    current
      .filter(r => r.key !== incoming.key && !isEvicted(r))
      .reduce((sum, r) => sum + r.sizeMB, 0);
  const incomingCostMB = alreadyResident ? 0 : incoming.sizeMB;

  if (opts?.singleModel) {
    // Extreme mode: evict everything evictable (no co-residency). selectEvictionVictim
    // still skips pinned + in-use (canEvict veto) residents, so the classifier and a
    // playing TTS survive; every other model is unloaded to free the most RAM.
    for (let victim = selectEvictionVictim(current, incoming, isEvicted);
      victim;
      victim = selectEvictionVictim(current, incoming, isEvicted)) {
      evict.push(victim);
    }
    return {
      evict,
      fits: usedMB() + incomingCostMB <= budgetMB,
      freedMB: evict.reduce((sum, r) => sum + r.sizeMB, 0),
    };
  }

  // Smart routing (balanced): KEEP as many models co-resident as the budget allows;
  // only when the incoming model doesn't fit do we evict — ONE AT A TIME, lowest
  // priority (then least-recently-used) first (selectEvictionVictim, shared with
  // the manager's measure-after-evict loop).
  //   - Text + image co-reside when they fit (e.g. image-gen with prompt
  //     enhancement keeps both warm) — no forced mutual exclusion.
  //   - A 4th model that needs room swaps out a single lowest-priority/LRU victim,
  //     never a blanket clear.
  //   - A sidecar load (mic/speaker) never evicts a heavier generation model —
  //     that would break an in-flight answer — so it may only reclaim from peer
  //     sidecars; if that's not enough it reports fits=false and the caller bails.
  while (usedMB() + incomingCostMB > budgetMB) {
    const victim = selectEvictionVictim(current, incoming, isEvicted);
    if (!victim) break; // nothing evictable left → fits stays false, caller bails
    evict.push(victim);
  }

  return {
    evict,
    fits: usedMB() + incomingCostMB <= budgetMB,
    freedMB: evict.reduce((sum, r) => sum + r.sizeMB, 0),
  };
}
