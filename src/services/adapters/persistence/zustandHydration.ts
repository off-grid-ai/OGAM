export interface ZustandPersistApi {
  hasHydrated?: () => boolean;
  onFinishHydration?: (listener: () => void) => (() => void) | void;
  rehydrate?: () => Promise<void>;
}

const HYDRATION_TIMEOUT_MS = 10_000;

export interface PersistedStoreReadinessAdapter {
  isReady(): boolean;
  awaitReady(): Promise<void>;
  retryReady(): Promise<void>;
}

/** Adapt Zustand persistence mechanics without leaking them into an application consumer. */
export function createZustandReadinessAdapter(
  persist: () => ZustandPersistApi | undefined,
  owner: string,
): PersistedStoreReadinessAdapter {
  const awaitReady = (): Promise<void> => {
    const api = persist();
    if (!api || api.hasHydrated?.() !== false) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: (() => void) | void;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        unsubscribe?.();
        if (error) reject(error);
        else resolve();
      };
      unsubscribe = api.onFinishHydration?.(() => finish());
      if (api.hasHydrated?.()) {
        finish();
        return;
      }
      timeout = setTimeout(
        () => finish(new Error(`${owner} did not load within 10 seconds.`)),
        HYDRATION_TIMEOUT_MS,
      );
    });
  };

  return {
    isReady: () => persist()?.hasHydrated?.() ?? true,
    awaitReady,
    retryReady: async () => {
      const api = persist();
      if (!api?.rehydrate) throw new Error(`${owner} cannot retry loading.`);
      await api.rehydrate();
      await awaitReady();
    },
  };
}
