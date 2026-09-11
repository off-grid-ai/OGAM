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
    await waitForHydration(first.store);

    expect(first.store.getState().selected).toBe('saved');
    first.store.setState({ selected: 'after-hydration' });

    const restarted = createPersistedSelection(base);
    await waitForHydration(restarted.store);
    expect(restarted.store.getState().selected).toBe('after-hydration');
  });
});

type Selection = { selected: string };

function createPersistedSelection(base: StateStorage) {
  const gate = createHydrationGatedStorage<Selection>(base);
  const store = createStore<Selection>()(
    persist(() => ({ selected: 'default' }), {
      name: 'settings',
      storage: gate.storage,
      onRehydrateStorage: () => () => gate.markHydrated(),
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
