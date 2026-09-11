import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

/**
 * A persisted store must never write to storage from state that has not been hydrated yet.
 *
 * zustand's persist middleware writes on every `set`, including the ones that fire during boot
 * before the async read from AsyncStorage has landed. That write carries the in-memory defaults
 * and races the hydration write; when it lands last, the saved settings are gone. The voice
 * store lost "model downloaded" and the chosen voice on every launch this way.
 *
 * Writes are dropped until `markHydrated()` runs from `onRehydrateStorage`; the in-memory state
 * still merges normally, and every write after hydration persists as usual.
 */
export function createHydrationGatedStorage<S>(
  base: StateStorage = AsyncStorage,
): { storage: PersistStorage<S>; markHydrated: () => void; isHydrated: () => boolean } {
  let hydrated = false;
  const json = createJSONStorage<S>(() => base);
  if (!json) throw new Error('JSON storage is unavailable');
  return {
    storage: {
      getItem: name => json.getItem(name),
      removeItem: name => json.removeItem(name),
      setItem: (name, value) => (hydrated ? json.setItem(name, value) : undefined),
    },
    markHydrated: () => {
      hydrated = true;
    },
    isHydrated: () => hydrated,
  };
}
