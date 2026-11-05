import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Off-grid mode: one switch for "no internet, save battery, emergency first".
 *  - Atlas agent becomes active
 *  - internet tools (web search, read web page) are not offered to the model
 *  - low-battery mode is switched on
 *  - the emergency screens use a red-on-black night palette (protects night vision, saves OLED battery)
 */
interface OffGridState {
  on: boolean;
  nightRed: boolean;
  setOn: (v: boolean) => void;
  setNightRed: (v: boolean) => void;
}

export const useOffGrid = create<OffGridState>()(
  persist(
    (set) => ({
      on: false,
      nightRed: false,
      setOn: (on) => {
        set({ on });
        if (on) {
          try { require('../stores/agentStore').useAgentStore.getState().setActiveAgent('atlas'); } catch { /* ignore */ }
          try { require('./lowPower').useLowPower.getState().set({ enabled: true }); } catch { /* ignore */ }
        }
      },
      setNightRed: (nightRed) => set({ nightRed }),
    }),
    { name: 'atlas-off-grid', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const NETWORK_TOOLS = ['web_search', 'read_url', 'find_image'];
export const offGridOn = (): boolean => useOffGrid.getState().on;

export const NIGHT_COLORS: any = {
  background: '#000000', surface: '#160303', surfaceLight: '#220505', text: '#FF5A5A', textSecondary: '#D24848',
  textMuted: '#9E3434', border: '#3A0A0A', primary: '#FF3B3B', error: '#FF3B3B',
};

/** Colors for the emergency screens: red night palette when switched on. */
export function useEmergencyColors(base: any): any {
  const night = useOffGrid((s) => s.nightRed);
  return night ? { ...base, ...NIGHT_COLORS } : base;
}
