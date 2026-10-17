import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from 'zustand/middleware';
import logger from './logger';

/** Waits between read attempts after a failed load. The first write made meanwhile tries at once. */
const LOAD_RETRY_DELAYS_MS = [250, 1000, 4000, 15000, 60000];

export interface HydrationGatedStorage<S> {
  storage: PersistStorage<S>;
  markHydrated(): void;
  /**
   * The saved state could not be read. Writes stay blocked, so the saved history is never replaced, but
   * the read is tried again: `rehydrate` reads and merges the saved state with what was made since, and
   * once it succeeds `save` writes that merge, so the session's new work is kept too.
   */
  retryAfterFailedLoad(recovery: { rehydrate: () => Promise<void>; save: () => void }): void;
  isHydrated(): boolean;
  waitForWrites(): Promise<void>;
}

/** Prevent boot-time defaults from replacing saved state before Zustand finishes hydration. */
export function createHydrationGatedStorage<S>(
  base: StateStorage = AsyncStorage,
  unchanged?: (previous: S, next: S) => boolean,
): HydrationGatedStorage<S> {
  let hydrated = false;
  let recovery: { rehydrate: () => Promise<void>; save: () => void } | null = null;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retrying = false;
  let triedOnWrite = false;

  const scheduleRetry = () => {
    const delay = LOAD_RETRY_DELAYS_MS[retryCount++];
    if (delay === undefined) {
      logger.warn('[STORAGE-SM] saved state still unreadable; writes stay blocked to protect it');
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      tryRecover().catch(() => {});
    }, delay);
  };

  const tryRecover = async (): Promise<void> => {
    if (hydrated || retrying || !recovery) return;
    retrying = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    try {
      await recovery.rehydrate();
    } finally {
      retrying = false;
    }
    if (hydrated) {
      const { save } = recovery;
      recovery = null;
      logger.log('[STORAGE-SM] saved state read on retry; merged with this session and saving');
      save();
      return;
    }
    scheduleRetry();
  };
  // Last snapshot known to be stored: read at hydration or confirmed by a resolved write.
  let lastSaved: S | undefined;
  // Newest snapshot handed to storage whose write has not settled yet.
  let lastIssued: { state: S } | undefined;
  const pendingWrites = new Set<Promise<void>>();
  const json = createJSONStorage<S>(() => base);
  if (!json) throw new Error('JSON storage is unavailable');

  return {
    storage: {
      getItem: async name => {
        const value = await json.getItem(name);
        lastSaved = value?.state;
        return value;
      },
      setItem: (name, value) => {
        if (!hydrated) {
          if (recovery && !triedOnWrite) {
            // Something new is waiting to be saved: read again now instead of at the next retry.
            triedOnWrite = true;
            tryRecover().catch(() => {});
          }
          return undefined;
        }
        const previous = lastIssued ? lastIssued.state : lastSaved;
        if (previous !== undefined && unchanged?.(previous, value.state)) {
          return undefined;
        }
        const issued = { state: value.state };
        lastIssued = issued;
        const settle = () => {
          if (lastIssued === issued) lastIssued = undefined;
        };
        const result = json.setItem(name, value);
        if (!result) {
          settle();
          lastSaved = value.state;
          return undefined;
        }
        const write = Promise.resolve(result).then(
          () => {
            settle();
            lastSaved = value.state;
          },
          error => {
            // Only a committed snapshot counts as saved, so the same content is written again later.
            settle();
            throw error;
          },
        );
        pendingWrites.add(write);
        return write.finally(() => pendingWrites.delete(write));
      },
      removeItem: name => {
        if (!hydrated) return undefined;
        lastIssued = undefined;
        lastSaved = undefined;
        return json.removeItem(name);
      },
    },
    markHydrated: () => {
      hydrated = true;
    },
    retryAfterFailedLoad: next => {
      if (hydrated || recovery) return;
      recovery = next;
      logger.warn('[STORAGE-SM] saved state unreadable at launch; retrying the read');
      scheduleRetry();
    },
    isHydrated: () => hydrated,
    waitForWrites: async () => {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
    },
  };
}
