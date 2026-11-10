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
      setOn: (on) => set({ on }),
      setNightRed: (nightRed) => set({ nightRed }),
    }),
    { name: 'atlas-off-grid', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const offGridOn = (): boolean => useOffGrid.getState().on;

/** Tools that need the internet; they are not offered to the model while off-grid mode is on. */
export const NETWORK_TOOLS = ['web_search', 'read_url', 'find_image'];
