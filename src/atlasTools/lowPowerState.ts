import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offGridOn } from './offGridState';

/**
 * Atlas low-battery mode. Below the threshold (and not charging):
 *  - switch to a small model (if chosen),
 *  - keep answers short (token cap + a one-line instruction),
 *  - turn off hands-free listening.
 * When charging or back above threshold + 5%, the previous model is restored.
 */
interface LowPowerState {
  enabled: boolean;
  threshold: number;
  modelId: string;
  maxTokens: number;
  active: boolean;
  prevModelId: string;
  /** model low-battery mode switched to (to switch back later) */
  switchedTo: string;
  battery: number | null;
  charging: boolean;
  set: (p: Partial<LowPowerState>) => void;
}

export const useLowPower = create<LowPowerState>()(
  persist(
    (set) => ({
      enabled: false, threshold: 20, modelId: '', maxTokens: 256,
      active: false, prevModelId: '', switchedTo: '', battery: null, charging: false,
      set: (p) => set(p),
    }),
    {
      name: 'atlas-low-power',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabled: s.enabled, threshold: s.threshold, modelId: s.modelId, maxTokens: s.maxTokens }),
    },
  ),
);

/** On when switched on, and always in off-grid (emergency) mode. */
export const lowPowerEnabled = (): boolean => useLowPower.getState().enabled || offGridOn();
export const lowPowerActive = (): boolean => lowPowerEnabled() && useLowPower.getState().active;

export const LOW_POWER_NOTE = 'The phone battery is low: answer in a few short sentences, most important step first.';
