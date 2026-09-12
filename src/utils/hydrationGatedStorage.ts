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
  unchanged?: (previous: S, next: S) => boolean,
): HydrationGatedStorage<S> {
  let hydrated = false;
  let lastWritten: S | undefined;
  const json = createJSONStorage<S>(() => base);
  if (!json) throw new Error('JSON storage is unavailable');

  return {
    storage: {
      getItem: async name => {
        const value = await json.getItem(name);
        lastWritten = value?.state;
        return value;
      },
      setItem: (name, value) => {
        if (!hydrated) return undefined;
        if (lastWritten !== undefined && unchanged?.(lastWritten, value.state))
          return undefined;
        const previous = lastWritten;
        lastWritten = value.state;
        const write = json.setItem(name, value);
        if (!(write instanceof Promise)) return write;
        return write.catch(error => {
          if (lastWritten === value.state) lastWritten = previous;
          throw error;
        });
      },
      removeItem: name => {
        if (!hydrated) return undefined;
        lastWritten = undefined;
        return json.removeItem(name);
      },
    },
    markHydrated: () => {
      hydrated = true;
    },
    isHydrated: () => hydrated,
  };
}
