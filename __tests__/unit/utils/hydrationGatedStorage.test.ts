import type { StateStorage } from 'zustand/middleware';
import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { createHydrationGatedStorage } from '../../../src/utils/hydrationGatedStorage';

function memoryStorage(initial: Record<string, string> = {}): StateStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async name => values.get(name) ?? null,
    setItem: async (name, value) => {
      values.set(name, value);
    },
    removeItem: async name => {
      values.delete(name);
    },
  };
}

describe('hydration-gated storage', () => {
  it('preserves saved state from writes and removal before hydration', async () => {
    const saved = JSON.stringify({ state: { selected: 'saved' }, version: 0 });
    const base = memoryStorage({ settings: saved });
    const gated = createHydrationGatedStorage<{ selected: string }>(base);

    await gated.storage.setItem('settings', {
      state: { selected: 'default' },
      version: 0,
    });
    await gated.storage.removeItem('settings');

    expect(await gated.storage.getItem('settings')).toEqual({
      state: { selected: 'saved' },
      version: 0,
    });
  });

  it('persists changes after hydration completes', async () => {
    const base = memoryStorage();
    const gated = createHydrationGatedStorage<{ selected: string }>(base);

    gated.markHydrated();
    expect(gated.isHydrated()).toBe(true);
    await gated.storage.setItem('settings', {
      state: { selected: 'next' },
      version: 0,
    });
    expect(await gated.storage.getItem('settings')).toEqual({
      state: { selected: 'next' },
      version: 0,
    });
    await gated.storage.removeItem('settings');
    expect(await gated.storage.getItem('settings')).toBeNull();
  });

  it('keeps saved state through a delayed hydration and the next store restart', async () => {
    let releaseRead = () => {};
    const readBlocked = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    const base = memoryStorage({
      settings: JSON.stringify({ state: { selected: 'saved' }, version: 0 }),
    });
    const delayedBase: StateStorage = {
      ...base,
      getItem: async name => {
        await readBlocked;
        return base.getItem(name);
      },
    };

    const first = createPersistedSelection(delayedBase);
    first.store.setState({ selected: 'boot-default' });
    first.store.persist.clearStorage();
    releaseRead();
    // Zustand cancels the pending hydration when clearStorage is called. Read
    // again to verify that the gate kept the saved value through that request.
    await first.store.persist.rehydrate();
    await waitForHydration(first.store);

    expect(first.store.getState().selected).toBe('saved');
    first.store.setState({ selected: 'after-hydration' });

    const restarted = createPersistedSelection(base);
    await waitForHydration(restarted.store);
    expect(restarted.store.getState().selected).toBe('after-hydration');
  });
});

describe('hydration-gated storage on a first launch', () => {
  it('saves a change made before an empty read landed', async () => {
    let releaseRead = () => {};
    const readBlocked = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    const base = memoryStorage();
    const slowBase: StateStorage = {
      ...base,
      getItem: async name => {
        await readBlocked;
        return base.getItem(name);
      },
    };
    // Wired as the app stores are: the gate owns hydration, merge and the held-back writes.
    const gate = createHydrationGatedStorage<Selection>(slowBase);
    const store = createStore<Selection>()(
      persist(() => ({ selected: 'default' }), {
        name: 'settings',
        storage: gate.storage,
        onRehydrateStorage: gate.onRehydrateStorage(),
        merge: gate.merge<Selection>(),
      }),
    );
    gate.attach(store);

    // The user acts before the (empty) saved state has been read: the write is held back.
    store.setState({ selected: 'made-before-load' });
    expect(base.values.has('settings')).toBe(false);

    releaseRead();
    await waitForHydration(store);
    await gate.waitForWrites();

    expect(store.getState().selected).toBe('made-before-load');
    expect(JSON.parse(base.values.get('settings') ?? 'null')?.state).toEqual({ selected: 'made-before-load' });
  });
});

type Selection = { selected: string };

function createPersistedSelection(base: StateStorage) {
  const gate = createHydrationGatedStorage<Selection>(
    base,
    (previous, next) => previous.selected === next.selected,
  );
  const store = createStore<Selection>()(
    persist(() => ({ selected: 'default' }), {
      name: 'settings',
      storage: gate.storage,
      // Same callback as the app stores: a failed read must not open the write gate.
      onRehydrateStorage: () => (_state, error) => {
        if (!error) gate.markHydrated();
      },
    }),
  );
  return { gate, store };
}

function waitForHydration(
  store: ReturnType<typeof createPersistedSelection>['store'],
): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise(resolve =>
    store.persist.onFinishHydration(() => resolve()),
  );
}

const stored = (state: Selection, version = 0) =>
  JSON.stringify({ state, version });

/**
 * AsyncStorage-contract fake for the device boundary: reads and writes can fail. It records how
 * many writes reached storage.
 */
function deviceStorage(initial: Record<string, string> = {}) {
  const memory = memoryStorage(initial);
  const device = {
    values: memory.values,
    writes: 0,
    failReads: false,
    failNextWrite: false,
    storage: {
      getItem: async (name: string) => {
        if (device.failReads) throw new Error('read failed');
        return memory.getItem(name);
      },
      setItem: async (name: string, value: string) => {
        if (device.failNextWrite) {
          device.failNextWrite = false;
          throw new Error('database or disk is full');
        }
        device.writes += 1;
        await memory.setItem(name, value);
      },
      removeItem: (name: string) => memory.removeItem(name),
    } satisfies StateStorage,
  };
  return device;
}

describe('hydration-gated storage load and write failures', () => {
  it('keeps writes blocked after a failed read so saved history survives', async () => {
    const device = deviceStorage({ settings: stored({ selected: 'saved' }) });
    device.failReads = true;
    const { gate, store } = createPersistedSelection(device.storage);
    await store.persist.rehydrate();

    store.setState({ selected: 'empty-after-failed-read' });
    await gate.waitForWrites();

    expect(store.persist.hasHydrated()).toBe(false);
    expect(device.writes).toBe(0);
    expect(device.values.get('settings')).toBe(stored({ selected: 'saved' }));
  });

  it('loads and then persists after a retried read succeeds', async () => {
    const device = deviceStorage({ settings: stored({ selected: 'saved' }) });
    device.failReads = true;
    const { gate, store } = createPersistedSelection(device.storage);
    await store.persist.rehydrate();

    device.failReads = false;
    await store.persist.rehydrate();
    expect(store.getState().selected).toBe('saved');

    store.setState({ selected: 'after-retry' });
    await gate.waitForWrites();
    expect(device.values.get('settings')).toBe(
      stored({ selected: 'after-retry' }),
    );
  });

  it('retries the same content after a failed write', async () => {
    const device = deviceStorage({ settings: stored({ selected: 'saved' }) });
    const gate = createHydrationGatedStorage<Selection>(
      device.storage,
      (previous, next) => previous.selected === next.selected,
    );
    await gate.storage.getItem('settings');
    gate.markHydrated();
    const next = { state: { selected: 'next' }, version: 0 };

    device.failNextWrite = true;
    await expect(gate.storage.setItem('settings', next)).rejects.toThrow(
      'database or disk is full',
    );
    expect(device.values.get('settings')).toBe(stored({ selected: 'saved' }));

    await gate.storage.setItem('settings', next);
    expect(device.values.get('settings')).toBe(stored({ selected: 'next' }));
  });

  it('reports a failed write to waiters', async () => {
    const device = deviceStorage();
    const { gate, store } = createPersistedSelection(device.storage);
    await waitForHydration(store);

    device.failNextWrite = true;
    const write = Promise.resolve(
      gate.storage.setItem('settings', {
        state: { selected: 'lost' },
        version: 0,
      }),
    ).then(
      () => 'stored',
      (error: Error) => error.message,
    );

    await expect(gate.waitForWrites()).rejects.toThrow(
      'database or disk is full',
    );
    expect(await write).toBe('database or disk is full');
  });
});

describe('hydration-gated storage format and restart', () => {
  it('loads the latest stored snapshot after a restart', async () => {
    const device = deviceStorage();
    const first = createPersistedSelection(device.storage);
    await waitForHydration(first.store);

    first.store.setState({ selected: 'draft' });
    first.store.setState({ selected: 'final' });
    await first.gate.waitForWrites();

    const restarted = createPersistedSelection(device.storage);
    await waitForHydration(restarted.store);
    expect(restarted.store.getState().selected).toBe('final');
  });

  it('keeps the stored format readable by both old and new builds', async () => {
    const device = deviceStorage({
      settings: stored({ selected: 'written-by-old-build' }),
    });
    const { gate, store } = createPersistedSelection(device.storage);
    await waitForHydration(store);
    expect(store.getState().selected).toBe('written-by-old-build');

    store.setState({ selected: 'written-by-new-build' });
    await gate.waitForWrites();
    expect(device.values.get('settings')).toBe(
      stored({ selected: 'written-by-new-build' }),
    );
  });
});
