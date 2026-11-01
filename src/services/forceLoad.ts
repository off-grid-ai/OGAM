/**
 * "Force load": the next model load frees every other loaded model first and then loads with the memory safeguards
 * overridden. One switch, read by loadModelWithOverride (the single funnel every screen loads a model through), so
 * any place that offers to load a model can force it the same way.
 */
import { create } from 'zustand';

interface ForceLoadState { armed: boolean; set: (on: boolean) => void }

export const useForceLoad = create<ForceLoadState>((set) => ({ armed: false, set: (armed) => set({ armed }) }));

/** True once, then disarms: a forced load applies to the one load it was switched on for. */
export function takeForceLoad(): boolean {
  const { armed, set } = useForceLoad.getState();
  if (armed) set(false);
  return armed;
}
