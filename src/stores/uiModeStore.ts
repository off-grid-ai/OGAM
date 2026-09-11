import { create } from 'zustand';

interface UiModeState {
  /** Short active-voice label (e.g. "Kokoro TTS · Warm"), or null when no voice
   *  model is set up. Mirrored from pro so core (the home Models summary) can
   *  reactively show whether a voice is active without importing pro. */
  voiceSummary: string | null;
  setVoiceSummary: (summary: string | null) => void;
}

export const useUiModeStore = create<UiModeState>(set => ({
  voiceSummary: null,
  setVoiceSummary: voiceSummary => set({ voiceSummary }),
}));
