import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SPEAKER_EMBEDDING_MODEL_ID,
  resolveSpeakerEmbeddingModel,
  DEFAULT_DIARIZATION_MODEL_ID,
  resolveDiarizationModel,
  type SpeakerEmbeddingCatalogModel,
  type DiarizationModel,
} from '@offgrid/models';
import { DEFAULT_MATCH_THRESHOLD } from '../services/ambient/speakerModel';

export interface SpeakerModelState {
  /** Catalog id of the active voiceprint model. Swappable, like the whisper model selection. */
  selectedModelId: string;
  /** Which model ids have their .pte downloaded and ready on-device. */
  downloaded: Record<string, boolean>;
  /** Cosine match threshold — higher = stricter (fewer false matches, more 'unknown'). */
  matchThreshold: number;
  /** Active diarization bundle (segmentation + embedding) for on-device 'who spoke when'. */
  diarizationModelId: string;
  setSelectedModel(id: string): void;
  markDownloaded(id: string, value: boolean): void;
  setMatchThreshold(value: number): void;
  setDiarizationModel(id: string): void;
  /** The resolved active catalog model (falls back to the recommended default). */
  activeModel(): SpeakerEmbeddingCatalogModel;
  /** The resolved active diarization bundle. */
  activeDiarizationModel(): DiarizationModel;
}

export const useSpeakerModelStore = create<SpeakerModelState>()(
  persist(
    (set, get) => ({
      selectedModelId: DEFAULT_SPEAKER_EMBEDDING_MODEL_ID,
      downloaded: {},
      matchThreshold: DEFAULT_MATCH_THRESHOLD,
      diarizationModelId: DEFAULT_DIARIZATION_MODEL_ID,
      setSelectedModel: id => set({ selectedModelId: id }),
      markDownloaded: (id, value) =>
        set(state => ({ downloaded: { ...state.downloaded, [id]: value } })),
      setMatchThreshold: value => set({ matchThreshold: value }),
      setDiarizationModel: id => set({ diarizationModelId: id }),
      activeModel: () => resolveSpeakerEmbeddingModel(get().selectedModelId),
      activeDiarizationModel: () => resolveDiarizationModel(get().diarizationModelId),
    }),
    {
      name: 'offgrid-speaker-model',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        selectedModelId: state.selectedModelId,
        downloaded: state.downloaded,
        matchThreshold: state.matchThreshold,
        diarizationModelId: state.diarizationModelId,
      }),
    },
  ),
);
