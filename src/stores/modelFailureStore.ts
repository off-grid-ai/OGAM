import { create } from 'zustand';

/**
 * One uniform, dismissible surface for EVERY model failure (text / image / tts /
 * stt / embedding) — so failures never appear as flat chat messages, ad-hoc
 * alerts, or silent swallows. The model-failure handler is the only writer
 * (reportModelFailure); the ModelFailureCard is the only reader. Severity decides
 * the look: 'error' (a load/generation was blocked) vs 'warning' (a soft, non-
 * blocking degradation like enhancement skipped).
 */
export type ModelFailureType = 'text' | 'image' | 'tts' | 'stt' | 'embedding';
export type ModelFailureSeverity = 'error' | 'warning';

export interface ModelFailure {
  id: string;
  modelType: ModelFailureType;
  severity: ModelFailureSeverity;
  title: string;
  message: string;
  /** When set, the card shows a Retry button that runs this. */
  onRetry?: () => void;
  /** Insufficient-memory failure → the card adds "close other apps to free RAM". */
  memoryPressure?: boolean;
  /** The failure came from the OVERRIDABLE memory gate (OverridableMemoryError) —
   *  the same discriminant the text path uses to offer "Load Anyway". Derived once
   *  in reportModelFailure from the error type, never re-sniffed from the message. */
  overridable?: boolean;
  /** When set (and `overridable`), the card shows a "Load Anyway" button that runs
   *  this — re-attempts the load forcing past the budget ({ override: true }). */
  onLoadAnyway?: () => void;
}

interface ModelFailureState {
  failures: ModelFailure[];
  /** Push a failure (replaces any existing one of the same modelType so the card
   *  never stacks duplicates for one subsystem). */
  report: (failure: ModelFailure) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useModelFailureStore = create<ModelFailureState>((set) => ({
  failures: [],
  report: (failure) =>
    set((s) => ({ failures: [...s.failures.filter((f) => f.modelType !== failure.modelType), failure] })),
  dismiss: (id) => set((s) => ({ failures: s.failures.filter((f) => f.id !== id) })),
  clear: () => set({ failures: [] }),
}));
