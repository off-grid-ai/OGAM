import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WhisperState {
  /** Upgrade input only. New selection writes go to the canonical model-selection store. */
  downloadedModelId: string | null;
  transcriptionLanguage: string;
  setTranscriptionLanguage(language: string): void;
}

/**
 * Transcription preferences only. Model selection, inventory, downloads, readiness, loading, and
 * failures live in the Models facade. `downloadedModelId` remains only until an old profile has
 * moved its value into the canonical selection store.
 */
export const useWhisperStore = create<WhisperState>()(
  persist(
    set => ({
      downloadedModelId: null,
      transcriptionLanguage: 'auto',
      setTranscriptionLanguage: transcriptionLanguage =>
        set({ transcriptionLanguage }),
    }),
    {
      name: 'local-llm-whisper-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        downloadedModelId: state.downloadedModelId,
        transcriptionLanguage: state.transcriptionLanguage,
      }),
    },
  ),
);
