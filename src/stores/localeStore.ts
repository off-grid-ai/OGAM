import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { replyLanguageDefault } from '@offgrid/i18n';

/**
 * The language the person picked in Settings → Language or on the first onboarding page. null means
 * "the phone's language". Its own store, not appStore (plan C: onboarding changes appStore).
 */
interface LocaleState {
  picked: string | null;
  setPicked: (code: string | null) => void;
  /** "Reply in my language": opt-in, off until the person turns it on (@offgrid/i18n replyLanguageDefault). */
  replyInLanguage: boolean;
  setReplyInLanguage: (on: boolean) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    set => ({
      picked: null,
      setPicked: picked => set({ picked }),
      replyInLanguage: replyLanguageDefault(''),
      setReplyInLanguage: replyInLanguage => set({ replyInLanguage }),
    }),
    { name: 'offgrid-app-language', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
