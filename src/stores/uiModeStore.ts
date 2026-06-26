import { create } from 'zustand';

/**
 * Public, reactive UI-mode flag. The chat surface (input row, message list,
 * scroll behaviour) renders differently in voice/audio mode vs text mode. The
 * audio feature lives in the private pro package, but core needs to react to
 * the mode without importing pro — so pro mirrors its interface mode into this
 * tiny core store, and core components subscribe here.
 *
 * Free builds (no pro) leave this at the default 'chat' forever.
 */
export type InterfaceMode = 'chat' | 'audio';

interface UiModeState {
  interfaceMode: InterfaceMode;
  setInterfaceMode: (mode: InterfaceMode) => void;
  /** Short active-voice label (e.g. "Kokoro TTS · Warm"), or null when no voice
   *  model is set up. Mirrored from pro so core (the home Models summary) can
   *  reactively show whether a voice is active without importing pro. */
  voiceSummary: string | null;
  setVoiceSummary: (summary: string | null) => void;
}

export const useUiModeStore = create<UiModeState>((set) => ({
  interfaceMode: 'chat',
  setInterfaceMode: (interfaceMode) => set({ interfaceMode }),
  voiceSummary: null,
  setVoiceSummary: (voiceSummary) => set({ voiceSummary }),
}));
