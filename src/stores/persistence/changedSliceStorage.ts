import type { PersistStorage, StorageValue } from 'zustand/middleware';

/** The string key-value boundary zustand persists through (AsyncStorage, MMKV, ...). */
export interface StringStorageBackend {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
}

/**
 * A persist storage that writes only when the persisted slice actually changed.
 *
 * zustand's persist middleware calls `setItem` after EVERY `set`, and `createJSONStorage`
 * stringifies the whole partialized state each time. A store that mixes durable state (the
 * conversation history) with high-frequency ephemeral state (a streaming reply, one token per
 * update) therefore serialises the entire history and queues a storage write per token. On a
 * phone that starved the JS thread for the length of a long reply and piled copies of the history
 * into the write queue until the OS killed the process for memory.
 *
 * `unchanged` compares the previous and next persisted slices. Ephemeral updates leave every
 * persisted field referentially identical, so the compare is a few pointer checks per token and
 * the serialisation cost is paid only when durable state moves.
 */
export function changedSliceStorage<S>(
  backend: () => StringStorageBackend,
  unchanged: (previous: S, next: S) => boolean,
): PersistStorage<S> {
  let lastWritten: S | undefined;
  return {
    getItem: async name => {
      const raw = await backend().getItem(name);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as StorageValue<S>;
      lastWritten = parsed.state;
      return parsed;
    },
    setItem: async (name, value) => {
      if (lastWritten !== undefined && unchanged(lastWritten, value.state))
        return;
      lastWritten = value.state;
      await backend().setItem(name, JSON.stringify(value));
    },
    removeItem: async name => {
      lastWritten = undefined;
      await backend().removeItem(name);
    },
  };
}
