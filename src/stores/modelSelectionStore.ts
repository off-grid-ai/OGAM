/**
 * THE persisted model selection on this device: one entry per modality, written only by the shared
 * selection application through the projection port. Nothing else writes here; readers go through
 * the workspace's active route, not this store.
 */
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ModelModality, SelectionProjectionWrite } from '@offgrid/application';

export type PersistedSelectionEntry = SelectionProjectionWrite;

interface ModelSelectionState {
  entries: Partial<Record<ModelModality, PersistedSelectionEntry>>;
  setEntry(modality: ModelModality, entry: PersistedSelectionEntry): void;
}

let persistenceTail = Promise.resolve();

const durableModelSelectionStorage: StateStorage = {
  getItem: name => AsyncStorage.getItem(name),
  setItem: (name, value) => {
    const write = persistenceTail
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem(name, value));
    persistenceTail = write;
    return write;
  },
  removeItem: name => {
    const removal = persistenceTail
      .catch(() => undefined)
      .then(() => AsyncStorage.removeItem(name));
    persistenceTail = removal;
    return removal;
  },
};

/** A selection command is complete only when its canonical persisted record is durable. */
export const awaitModelSelectionPersistence = (): Promise<void> =>
  persistenceTail;

export const useModelSelectionStore = create<ModelSelectionState>()(
  persist(
    set => ({
      entries: {},
      setEntry: (modality, entry) =>
        set(state => ({ entries: { ...state.entries, [modality]: entry } })),
    }),
    {
      name: 'model-selection',
      version: 1,
      storage: createJSONStorage(() => durableModelSelectionStorage),
      partialize: state => ({ entries: state.entries }),
    },
  ),
);
