import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Pin {
  /** The id of the message that was pinned. */
  id: string;
  text: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  conversationId: string | null;
  conversationTitle: string;
  pinnedAt: number;
}

interface PinsState {
  pins: Pin[];
  add: (pin: Omit<Pin, 'pinnedAt'>) => void;
  remove: (id: string) => void;
}

/** Answers (or any message) kept from any chat, in one place. On this phone and in backups; not synced. */
export const usePins = create<PinsState>()(persist((set) => ({
  pins: [],
  add: (pin) => set((s) => (s.pins.some((p) => p.id === pin.id) ? s : { pins: [{ ...pin, pinnedAt: Date.now() }, ...s.pins].slice(0, 500) })),
  remove: (id) => set((s) => ({ pins: s.pins.filter((p) => p.id !== id) })),
}), { name: 'atlas-pins', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ pins: s.pins }) }));
