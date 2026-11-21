import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The language the person picked in Settings → Language or on the first onboarding page. null means
 * "the phone's language". Its own store, not appStore (plan C: onboarding changes appStore).
 */
interface LocaleState {
  picked: string | null;
  setPicked: (code: string | null) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    set => ({
      picked: null,
      setPicked: picked => set({ picked }),
    }),
    { name: 'offgrid-app-language', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
