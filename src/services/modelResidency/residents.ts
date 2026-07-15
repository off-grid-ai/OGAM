/**
 * Residency budget constants + resident types.
 *
 * Extracted from index.ts (behavior-neutral) so the manager file stays within the
 * max-lines budget. These are the top-level constants, interfaces, and the pure
 * `stripUnload` projection the manager uses; moving them here changes no values and
 * no behavior — the manager imports them back unchanged.
 */
import { Resident, ResidentType } from './policy';

export type UnloadFn = () => Promise<void>;

/** Hard floor so a small model can always load, even under memory pressure. */
export const MIN_BUDGET_MB = 1024;
/** For DIRTY-memory models (CoreML/ONNX image): keep this much real RAM free for the
 *  OS + other apps so a dirty load never spills into swap. (Not applied to mmap'd
 *  GGUF - their clean weights don't pressure this limit.) */
export const DIRTY_AVAILABILITY_HEADROOM_MB = 1024;
/** Aggressive-mode dirty headroom - leaner, still non-zero (lenient safeguard). */
export const AGGRESSIVE_DIRTY_HEADROOM_MB = 512;
/** Small, cheaply-reloadable models reclaimed first under memory pressure. */
export const SIDECAR_TYPES = new Set<ResidentType>(['whisper', 'tts', 'embedding']);

export interface RegisteredResident extends Resident {
  unload: UnloadFn;
  /** Owner's veto: returns false when the model is in use right now (e.g. TTS is
   *  playing) so residency never evicts it mid-use. Absent → always evictable. */
  canEvict?: () => boolean;
}

export interface ResidentSpec {
  key: string;
  type: ResidentType;
  /** The specific downloaded-model id - keys the per-model session override memory.
   *  (`key` is only the slot/type, e.g. 'text', so it can't distinguish models.) */
  modelId?: string;
  sizeMB: number;
  pinned?: boolean;
  /** Owner's veto: returns false while the model is in use (e.g. TTS playing) so
   *  residency never evicts it mid-use. Absent → always evictable. */
  canEvict?: () => boolean;
  /**
   * Whether the model's weights occupy DIRTY (anonymous, jetsam-counted) memory -
   * the gap modeled as DATA, not a Platform/type branch in the budget.
   *  - false (default): mmap-backed GGUF (llama text / whisper). Weights are CLEAN,
   *    file-backed pages the OS pages freely; they do NOT pressure os_proc_available.
   *    Bounded by PHYSICAL RAM only - so an 8GB GGUF loads on a 12GB phone.
   *  - true: CoreML/ONNX image weights load into dirty/GPU memory that DOES count
   *    against the jetsam limit → also bounded by real free RAM (os_proc_available)
   *    so it never loads into swap.
   */
  dirtyMemory?: boolean;
}

export interface EnsureResult {
  loaded: boolean;
  evicted: string[];
}

export const stripUnload = ({
  unload: _unload,
  ...rest
}: RegisteredResident): Resident => rest;
