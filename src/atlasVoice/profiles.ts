import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';

/**
 * Named voice profiles kept on this device: a voice ('' = phone voice), a speaker inside
 * multi-voice models (Kokoro, KittenTTS) and a speed. Agents can be given a profile so
 * their replies are read in their own voice.
 */
export interface VoiceProfile {
  id: string;
  name: string;
  voiceId: string;
  sid: number;
  rate: number;
  createdAt: string;
}

interface VoiceProfilesState {
  profiles: VoiceProfile[];
  addProfile: (p: Omit<VoiceProfile, 'id' | 'createdAt'>) => VoiceProfile;
  renameProfile: (id: string, name: string) => void;
  removeProfile: (id: string) => void;
  /** Adds the ready-made profiles not saved yet (same voice and speaker). Returns how many were added. */
  addPresets: (presets: Omit<VoiceProfile, 'id' | 'createdAt'>[]) => number;
}

/** Ready-made profiles that are not saved yet. */
export const missingPresets = <T extends Pick<VoiceProfile, 'voiceId' | 'sid'>>(profiles: VoiceProfile[], presets: T[]): T[] =>
  presets.filter((p) => !profiles.some((x) => x.voiceId === p.voiceId && x.sid === p.sid));

export const useVoiceProfiles = create<VoiceProfilesState>()(persist((set, get) => ({
  profiles: [],
  addProfile: (p) => {
    const profile: VoiceProfile = { ...p, name: p.name.trim() || 'Voice', id: generateId(), createdAt: new Date().toISOString() };
    set((s) => ({ profiles: [...s.profiles, profile] }));
    return profile;
  },
  renameProfile: (id, name) => set((s) => ({
    profiles: s.profiles.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim() } : p)),
  })),
  removeProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
  addPresets: (presets) => {
    const add = missingPresets(get().profiles, presets);
    add.forEach((p) => get().addProfile(p));
    return add.length;
  },
}), {
  name: 'atlas-voice-profiles',
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s) => ({ profiles: s.profiles }),
}));

/** The voice profile of the agent answering in this conversation, if it has one. */
export function profileForConversation(conversationId: string | null | undefined): VoiceProfile | null {
  if (!conversationId) return null;
  const { useChatStore } = require('../stores/chatStore');
  const { useAgentStore } = require('../stores/agentStore');
  const conv = useChatStore.getState().conversations.find((c: any) => c.id === conversationId);
  const agent = conv?.agentId ? useAgentStore.getState().getAgent(conv.agentId) : null;
  if (!agent?.voiceProfileId) return null;
  return useVoiceProfiles.getState().profiles.find((p) => p.id === agent.voiceProfileId) ?? null;
}

/** Same as profileForConversation, starting from a message id. */
export function profileForMessage(messageId: string | null | undefined): VoiceProfile | null {
  if (!messageId) return null;
  const { useChatStore } = require('../stores/chatStore');
  const conv = useChatStore.getState().conversations.find((c: any) => c.messages?.some((m: any) => m.id === messageId));
  return profileForConversation(conv?.id);
}
