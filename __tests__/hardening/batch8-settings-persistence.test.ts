/**
 * BATCH 8 — Settings persistence (hardening)
 *
 * Plan reference: mobile-test-plan.md Batch 8 case 3 — "you should see the
 * preference you just changed persisted after leaving and returning."
 *
 * The screen test (updateSettings merges) proves the in-memory mutation, but not
 * that the changed preference is written to durable storage so it survives leaving
 * and returning. That durability is owned by the appStore `persist` middleware +
 * its `partialize` projection (which must include `settings`). If `settings` were
 * ever dropped from partialize, the in-memory test would still pass but the user's
 * preference would silently reset on relaunch — a false green.
 *
 * These tests drive the REAL useAppStore action through the REAL persist middleware.
 * The only mock is the storage boundary (AsyncStorage, mocked in jest.setup as an
 * in-memory map). We assert on what actually landed in that storage — so removing
 * `settings` from partialize, or breaking updateSettings, fails these tests.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../../src/stores/appStore';
import { resetStores } from '../utils/testHelpers';

const STORAGE_KEY = 'local-llm-app-storage';

/**
 * The persist middleware writes asynchronously (microtask) after a set(). Read back
 * the persisted blob once it has been flushed to the (in-memory) AsyncStorage mock.
 */
async function readPersistedState(): Promise<Record<string, unknown>> {
  // Allow the persist middleware's write-back microtask/promise to flush.
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error(`nothing persisted under ${STORAGE_KEY}`);
  const parsed = JSON.parse(raw);
  // zustand persist wraps under { state, version }
  return (parsed.state ?? parsed) as Record<string, unknown>;
}

describe('Batch 8 — settings persistence (case 3)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('persists a changed preference to durable storage (survives leave/return)', async () => {
    // Sanity: the value we will set is different from the default so a stale read
    // could not accidentally pass.
    expect(useAppStore.getState().settings.temperature).not.toBe(0.33);

    useAppStore.getState().updateSettings({ temperature: 0.33 });

    const persisted = await readPersistedState();
    const persistedSettings = persisted.settings as Record<string, unknown> | undefined;

    // The partialize projection MUST carry settings, and the new value must be in it.
    expect(persistedSettings).toBeDefined();
    expect(persistedSettings!.temperature).toBe(0.33);
  });

  it('persisted settings are the ones a fresh store would rehydrate (round-trip)', async () => {
    useAppStore.getState().updateSettings({ maxTokens: 4096, enableGpu: false });

    const persisted = await readPersistedState();
    const persistedSettings = persisted.settings as Record<string, unknown>;

    // Every changed field is present in the durable snapshot — this is exactly what
    // the middleware feeds back into the store on the next launch.
    expect(persistedSettings.maxTokens).toBe(4096);
    expect(persistedSettings.enableGpu).toBe(false);
  });

  it('a later partial update does not drop earlier persisted preferences', async () => {
    useAppStore.getState().updateSettings({ temperature: 0.42 });
    await readPersistedState(); // flush first write

    useAppStore.getState().updateSettings({ maxTokens: 2048 });
    const persisted = await readPersistedState();
    const persistedSettings = persisted.settings as Record<string, unknown>;

    // Both the earlier and later changes survive together (merge semantics carried
    // through to durable storage, not just in memory).
    expect(persistedSettings.temperature).toBe(0.42);
    expect(persistedSettings.maxTokens).toBe(2048);
  });
});
