import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * DEV-ONLY store for the chat grammar test harness.
 *
 * Lets a developer paste a GBNF grammar (plus optional temperature / assistant
 * prefill / word cap) and route it into the next chat completion, to see how
 * the real on-device model behaves under grammar + prefill before wiring GBNF
 * into a shipped feature. The only UI that can flip `enabled` is `__DEV__`-gated,
 * so it has no effect in production.
 *
 * Persisted (except the transient `lastError`) so a pasted grammar survives an
 * app kill / reload - you don't have to paste it again each session.
 */
interface DevInferenceState {
  enabled: boolean; // master toggle
  grammar: string; // raw GBNF pasted by the user
  temperature?: number; // e.g. 0 for deterministic; undefined = leave default
  assistantPrefix: string; // prefill, e.g. "TITLE: "
  maxWords?: number; // hard output cap; converted to n_predict. Guards runaway grammars.
  // LiteRT backend uses a different engine (LLGuidance) that takes JSON schema /
  // Lark grammar / regex, NOT GBNF. Kept separate from `grammar` since the two
  // backends can't share a format. Only used when the active model is LiteRT.
  litertConstraintType: 'json_schema' | 'lark' | 'regex';
  litertConstraintString: string;
  lastError?: string; // GBNF parse / apply error from the last run, shown in the modal
  setEnabled: (v: boolean) => void;
  setGrammar: (g: string) => void;
  setTemperature: (t?: number) => void;
  setAssistantPrefix: (p: string) => void;
  setMaxWords: (n?: number) => void;
  setLitertConstraintType: (t: 'json_schema' | 'lark' | 'regex') => void;
  setLitertConstraintString: (s: string) => void;
  setLastError: (e?: string) => void;
  clear: () => void;
}

const EMPTY = {
  enabled: false,
  grammar: '',
  temperature: undefined,
  assistantPrefix: '',
  maxWords: undefined,
  litertConstraintType: 'json_schema' as const,
  litertConstraintString: '',
  lastError: undefined,
} as const;

export const useDevInferenceStore = create<DevInferenceState>()(
  persist(
    (set) => ({
      ...EMPTY,
      setEnabled: (v) => set({ enabled: v }),
      setGrammar: (g) => set({ grammar: g }),
      setTemperature: (t) => set({ temperature: t }),
      setAssistantPrefix: (p) => set({ assistantPrefix: p }),
      setMaxWords: (n) => set({ maxWords: n }),
      setLitertConstraintType: (t) => set({ litertConstraintType: t }),
      setLitertConstraintString: (s) => set({ litertConstraintString: s }),
      setLastError: (e) => set({ lastError: e }),
      clear: () => set({ ...EMPTY }),
    }),
    {
      name: 'dev-inference-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // lastError is per-run state; don't carry it across restarts.
      partialize: (s) => ({
        enabled: s.enabled,
        grammar: s.grammar,
        temperature: s.temperature,
        assistantPrefix: s.assistantPrefix,
        maxWords: s.maxWords,
        litertConstraintType: s.litertConstraintType,
        litertConstraintString: s.litertConstraintString,
      }),
    },
  ),
);
