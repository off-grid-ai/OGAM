import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addSampleToProfile,
  createProfile,
  type SpeakerEmbedding,
  type SpeakerProfile,
} from '../services/ambient/speakerModel';

export interface SpeakerProfilesState {
  /** Enrolled voiceprints, keyed by id. Persisted on-device only — a voiceprint never leaves the phone. */
  profiles: Record<string, SpeakerProfile>;
  /** Enroll a new speaker from the sentence-reading samples, tagged with the embedding model used. Returns the new id. */
  enroll(
    name: string,
    modelId: string,
    enrollmentEmbeddings: SpeakerEmbedding[],
    opts?: { personId?: string; enrollmentClips?: string[] },
  ): string;
  /** Fold a confirmed correction ("this was Priya") back into a profile — active learning. */
  addSample(id: string, embedding: SpeakerEmbedding): void;
  rename(id: string, name: string): void;
  /** Forget a voiceprint entirely (privacy control). */
  remove(id: string): void;
  /** Forget every enrolled voice (used when wiping the Day, if the user opts in). */
  clear(): void;
  /** Profiles built with a given embedding model — the only ones comparable to its vectors. */
  profilesForModel(modelId: string): SpeakerProfile[];
}

/** Monotonic-ish id without Date/Math.random dependence at module load: derived from existing keys. */
function nextId(existing: Record<string, SpeakerProfile>): string {
  let n = Object.keys(existing).length + 1;
  while (existing[`spk_${n}`]) n += 1;
  return `spk_${n}`;
}

export const useSpeakerProfilesStore = create<SpeakerProfilesState>()(
  persist(
    (set, get) => ({
      profiles: {},
      enroll: (name, modelId, enrollmentEmbeddings, opts) => {
        const id = nextId(get().profiles);
        const profile = createProfile(id, name, modelId, enrollmentEmbeddings, opts);
        set(state => ({ profiles: { ...state.profiles, [id]: profile } }));
        return id;
      },
      addSample: (id, embedding) =>
        set(state => {
          const p = state.profiles[id];
          if (!p) return state;
          return { profiles: { ...state.profiles, [id]: addSampleToProfile(p, embedding) } };
        }),
      rename: (id, name) =>
        set(state => {
          const p = state.profiles[id];
          if (!p) return state;
          return { profiles: { ...state.profiles, [id]: { ...p, name } } };
        }),
      remove: id =>
        set(state => {
          const next = { ...state.profiles };
          delete next[id];
          return { profiles: next };
        }),
      clear: () => set({ profiles: {} }),
      profilesForModel: modelId =>
        Object.values(get().profiles).filter(p => p.modelId === modelId),
    }),
    {
      name: 'offgrid-speaker-profiles',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ profiles: state.profiles }),
    },
  ),
);
