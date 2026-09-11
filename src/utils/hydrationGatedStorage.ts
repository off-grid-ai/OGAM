import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from 'zustand/middleware';

export interface HydrationGatedStorage<S> {
  storage: PersistStorage<S>;
  markHydrated(): void;
  isHydrated(): boolean;
}

/** Prevent boot-time defaults from replacing saved state before Zustand finishes hydration. */
export function createHydrationGatedStorage<S>(
  base: StateStorage = AsyncStorage,
): HydrationGatedStorage<S> {
  let hydrated = false;
  const json = createJSONStorage<S>(() => base);
  if (!json) throw new Error('JSON storage is unavailable');

  return {
    storage: {
      getItem: name => json.getItem(name),
      setItem: (name, value) =>
        hydrated ? json.setItem(name, value) : undefined,
      removeItem: name => (hydrated ? json.removeItem(name) : undefined),
    },
    markHydrated: () => {
      hydrated = true;
    },
    isHydrated: () => hydrated,
  };
}
