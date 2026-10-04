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
  /**
   * The OWNER (the phone's user), by personId so it survives model switches and re-embeds — every
   * model-space variant of the owner shares this personId. Drives conversation relevance: "is the
   * owner actually in this conversation" (see services/ambient/conversationRelevance). Null until the
   * first voice is enrolled; the first human enrollment auto-becomes the owner, changeable via setOwner.
   */
  ownerPersonId: string | null;
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
  /** Designate (or clear) which enrolled person is the owner. */
  setOwner(personId: string | null): void;
  /** Profiles built with a given embedding model — the only ones comparable to its vectors. */
  profilesForModel(modelId: string): SpeakerProfile[];
  /**
   * The owner's speakerId IN a given model space — i.e. the profile id that identity-naming assigns to
   * the owner's cluster — or null if the owner has no profile in that space. This is exactly the
   * `ownerSpeakerId` the relevance scorer needs.
   */
  ownerSpeakerId(modelId: string): string | null;
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
      ownerPersonId: null,
      enroll: (name, modelId, enrollmentEmbeddings, opts) => {
        const id = nextId(get().profiles);
        const profile = createProfile(id, name, modelId, enrollmentEmbeddings, opts);
        // The first HUMAN enrollment (from the screen, which omits personId) auto-becomes the owner. A
        // re-embed backfill into another model space passes an existing personId, so it never hijacks
        // ownership. Single-user app: whoever first records their voice is the phone's owner.
        const claimOwner = get().ownerPersonId == null && !opts?.personId;
        set(state => ({
          profiles: { ...state.profiles, [id]: profile },
          ownerPersonId: claimOwner ? profile.personId : state.ownerPersonId,
        }));
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
          const removed = state.profiles[id];
          const next = { ...state.profiles };
          delete next[id];
          // If that was the owner's last remaining profile (no other model-space variant shares the
          // personId), the owner designation is now dangling — drop it.
          const ownerStillPresent =
            state.ownerPersonId != null &&
            Object.values(next).some(p => p.personId === state.ownerPersonId);
          return {
            profiles: next,
            ownerPersonId:
              removed && state.ownerPersonId != null && !ownerStillPresent ? null : state.ownerPersonId,
          };
        }),
      clear: () => set({ profiles: {}, ownerPersonId: null }),
      setOwner: personId => set({ ownerPersonId: personId }),
      profilesForModel: modelId =>
        Object.values(get().profiles).filter(p => p.modelId === modelId),
      ownerSpeakerId: modelId => {
        const { ownerPersonId, profiles } = get();
        if (ownerPersonId == null) return null;
        const owned = Object.values(profiles).find(
          p => p.personId === ownerPersonId && p.modelId === modelId,
        );
        return owned?.id ?? null;
      },
    }),
    {
      name: 'offgrid-speaker-profiles',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ profiles: state.profiles, ownerPersonId: state.ownerPersonId }),
    },
  ),
);
