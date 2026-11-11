import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AtlasVoiceState {
  /** Native utterance key currently speaking (null = silent). */
  speakingKey: string | null;
  /** Message id currently being spoken, for the per-message speaker button. */
  speakingMessageId: string | null;
  /** Increments every time a spoken reply finishes on its own (not when stopped). */
  doneTick: number;
  /** Hands-free "phone call" mode: after each spoken reply the mic re-opens by itself. */
  handsFree: boolean;
  /** Speech speed (1 = normal). */
  rate: number;
  /** Also read answers aloud in normal chat mode. */
  autoSpeakInChat: boolean;
  /** Natural voice in use (id of a downloaded voice) or '' for the phone's own voice. */
  neuralVoice: string;
  /** Speaker inside a multi-voice model (Kokoro). */
  neuralSid: number;
  setNeural: (id: string, sid?: number) => void;
  /** Voices for podcast and briefing hosts A, B and C (voice names; '' or missing = automatic). */
  podcastVoices: string[];
  setPodcastVoices: (v: string[]) => void;
  /** Voice mode plays through the earpiece (hold the phone to your ear) instead of the loudspeaker. */
  earpiece: boolean;
  setEarpiece: (v: boolean) => void;
  setSpeaking: (key: string | null, messageId?: string | null) => void;
  markDone: () => void;
  setHandsFree: (v: boolean) => void;
  setRate: (v: number) => void;
  setAutoSpeakInChat: (v: boolean) => void;
}

export const useAtlasVoiceStore = create<AtlasVoiceState>()(persist((set) => ({
  speakingKey: null,
  speakingMessageId: null,
  doneTick: 0,
  handsFree: true,
  rate: 1,
  autoSpeakInChat: false,
  neuralVoice: '',
  neuralSid: 0,
  earpiece: false,
  podcastVoices: [],
  setPodcastVoices: (podcastVoices) => set({ podcastVoices }),
  setEarpiece: (earpiece) => set({ earpiece }),
  setNeural: (neuralVoice, sid) => set((s) => ({ neuralVoice, neuralSid: sid ?? s.neuralSid })),
  setSpeaking: (key, messageId) =>
    set(key === null ? { speakingKey: null, speakingMessageId: null } : { speakingKey: key, ...(messageId !== undefined ? { speakingMessageId: messageId } : {}) }),
  markDone: () => set((s) => ({ doneTick: s.doneTick + 1 })),
  setHandsFree: (handsFree) => set({ handsFree }),
  setRate: (rate) => set({ rate }),
  setAutoSpeakInChat: (autoSpeakInChat) => set({ autoSpeakInChat }),
}), {
  name: 'atlas-voice-settings',
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ handsFree: s.handsFree, rate: s.rate, autoSpeakInChat: s.autoSpeakInChat, neuralVoice: s.neuralVoice, neuralSid: s.neuralSid, earpiece: s.earpiece, podcastVoices: s.podcastVoices }),
}));
