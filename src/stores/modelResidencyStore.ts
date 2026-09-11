/**
 * Residency facts projected for the UI: what text model is loaded in native memory, whether the
 * selected text model was evicted, and which image models have warmed once. Written only by the
 * native lifecycle adapter and the image pipeline; selection lives in modelSelectionStore.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ModelResidencyState {
  /** The text model ACTUALLY loaded in native memory (llama OR litert). Not persisted. */
  loadedTextModelId: string | null;
  /** The selected text model was evicted to free RAM while still selected. Not persisted. */
  textModelEvicted: boolean;
  /** Image models that completed one generation; the first run warms the backend (~120 s). */
  warmedImageModels: string[];
  setLoadedTextModelId(modelId: string | null): void;
  setTextModelEvicted(evicted: boolean): void;
  markImageModelWarmed(modelId: string): void;
}

export const useModelResidencyStore = create<ModelResidencyState>()(
  persist(
    set => ({
      loadedTextModelId: null,
      textModelEvicted: false,
      warmedImageModels: [],
      setLoadedTextModelId: modelId => set({ loadedTextModelId: modelId }),
      setTextModelEvicted: evicted => set({ textModelEvicted: evicted }),
      markImageModelWarmed: modelId =>
        set(state =>
          state.warmedImageModels.includes(modelId)
            ? state
            : { warmedImageModels: [...state.warmedImageModels, modelId] },
        ),
    }),
    {
      name: 'model-residency',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ warmedImageModels: state.warmedImageModels }),
    },
  ),
);
