import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from 'zustand/middleware';
import logger from './logger';
import { mergeSessionIntoSaved } from './mergeSessionIntoSaved';

/** Waits between read attempts after a failed load. The first write made meanwhile tries at once. */
const LOAD_RETRY_DELAYS_MS = [250, 1000, 4000, 15000, 60000];

/** The parts of a persisted zustand store the gate drives. */
interface GatedStore {
  getState(): object;
  setState(partial: object): void;
  persist: { rehydrate(): Promise<void> | void };
}

type Merge<T> = (persisted: unknown, current: T) => T;

export interface HydrationGatedStorage<S> {
  storage: PersistStorage<S>;
  markHydrated(): void;
  /**
   * The persist `onRehydrateStorage` option. A good read opens the gate. A failed read keeps writes
   * blocked, so the saved state is never replaced by launch defaults, and retries the read: at once on
   * the first write, then with backoff. Whether the read is slow or retried, what the user changed before
   * it landed is merged with the saved state (see `merge`), and that is saved.
   */
  onRehydrateStorage(): () => (state: unknown, error: unknown) => void;
  /**
   * Hand the created store to the gate. Call right after create: the gate notes the store as it is at
   * launch (to tell the user's changes from launch defaults) and retries a failed read on it.
   */
  attach(store: GatedStore): void;
  /**
   * The persist `merge` option: `savedOverCurrent` (default: saved over current) builds the saved state.
   * When the read lands after the session has changed the store (a slow read, or a retry after a failed
   * one), the session's changes are kept on top of the saved state, and `keepCurrent` keys follow the
   * session. A store the session never touched takes the saved state as is.
   */
  merge<T extends object>(savedOverCurrent?: Merge<T>, keepCurrent?: readonly string[]): Merge<T>;
  isHydrated(): boolean;
  waitForWrites(): Promise<void>;
}

/** Prevent boot-time defaults from replacing saved state before Zustand finishes hydration. */
export function createHydrationGatedStorage<S>(
  base: StateStorage = AsyncStorage,
  unchanged?: (previous: S, next: S) => boolean,
): HydrationGatedStorage<S> {
  let hydrated = false;
  let attached: GatedStore | null = null;
  let loadFailed = false;
  let recovery: GatedStore | null = null;
  // The store as it was at launch, before hydration: what the user had before changing anything.
  let atLaunch: object | null = null;
  // The read that just landed was merged with this session's changes, so the result must be saved.
  let sessionMerged = false;
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

  const startRecovery = () => {
    if (hydrated || recovery || !attached) return;
    recovery = attached;
    logger.warn('[STORAGE-SM] saved state unreadable at launch; retrying the read');
    scheduleRetry();
  };

  const tryRecover = async (): Promise<void> => {
    if (hydrated || retrying || !recovery) return;
    retrying = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    try {
      await recovery.persist.rehydrate();
    } finally {
      retrying = false;
    }
    if (hydrated) {
      recovery = null;
      logger.log('[STORAGE-SM] saved state read on retry');
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
      atLaunch = null;
    },
    onRehydrateStorage: () => () => (_state, error) => {
      if (!error) {
        hydrated = true;
        atLaunch = null;
        if (sessionMerged && attached) {
          sessionMerged = false;
          logger.log('[STORAGE-SM] saved state merged with this session; saving');
          // The writes made before the read landed were held back: save the merged state now.
          attached.setState({});
        }
        return;
      }
      loadFailed = true;
      startRecovery();
    },
    attach: store => {
      attached = store;
      if (!hydrated) atLaunch = store.getState();
      if (loadFailed) startRecovery();
    },
    merge: <T extends object>(
      savedOverCurrent: Merge<T> = (persisted, current) => ({ ...current, ...(persisted as Partial<T>) }),
      keepCurrent: readonly string[] = [],
    ): Merge<T> => (persisted, current) => {
      const saved = savedOverCurrent(persisted, current);
      // A read landing after hydration, or on a store the session has not changed, takes the saved state.
      if (hydrated || !atLaunch || current === atLaunch) return saved;
      // The session changed the store while its writes were held back: they must be saved now, also
      // when there was nothing saved before (a first launch).
      sessionMerged = true;
      if (!persisted) return saved;
      return mergeSessionIntoSaved(saved, current, atLaunch as T, Object.keys(persisted), keepCurrent);
    },
    isHydrated: () => hydrated,
    waitForWrites: async () => {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
    },
  };
}
