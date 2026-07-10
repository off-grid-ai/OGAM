/**
 * SETTINGS lifecycle guards: persist-across-relaunch + model-switch-must-not-stomp.
 *
 * Bug classes from the brief:
 *  - "a value not persisted across relaunch"
 *  - "a model-switch effect that overwrites a user-set value"
 *
 * We drive the REAL appStore. For persistence we exercise the store's own
 * persist middleware (partialize + merge/migrate) by serialising through the
 * partialize projection and rehydrating via the migrate merge — the exact code
 * that runs on relaunch — then assert the user's values survive. For model
 * switch we flip activeModelId (the store action) and assert generation-relevant
 * settings are byte-identical afterwards (no store action stomps them).
 *
 * Only AsyncStorage (native) is mocked. Store logic runs for real; deleting
 * partialize/migrate or adding a stomp to setActiveModelId fails these tests.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

import { useAppStore } from '../../../src/stores/appStore';
import type { DownloadedModel } from '../../../src/types';

// The persist options the store was created with — the real partialize + merge.
const persistOpts = (useAppStore as unknown as {
  persist: { getOptions: () => { partialize: (s: any) => any; merge: (persisted: any, current: any) => any } };
}).persist.getOptions();

/** Simulate a relaunch: project current state through partialize (what actually
 *  gets written to disk), then merge it back through the store's migrate on a
 *  fresh default state — exactly what zustand does on rehydrate. */
function relaunchWith(state: any): any {
  const persisted = persistOpts.partialize(state);
  // Round-trip through JSON like AsyncStorage would.
  const onDisk = JSON.parse(JSON.stringify(persisted));
  return persistOpts.merge(onDisk, useAppStore.getInitialState());
}

const LITERT_MODEL = { id: 'gemma-litert', engine: 'litert' } as unknown as DownloadedModel;
const LLAMA_MODEL = { id: 'qwen-gguf', engine: 'llama' } as unknown as DownloadedModel;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
});

describe('settings survive a relaunch (persist round-trip)', () => {
  it('every user-tuned text/image generation value is restored, not reset to default', () => {
    useAppStore.getState().updateSettings({
      temperature: 1.35,
      maxTokens: 3072,
      topP: 0.55,
      repeatPenalty: 1.4,
      contextLength: 8192,
      imageSteps: 42,
      imageGuidanceScale: 11.5,
      imageThreads: 7,
      imageWidth: 384,
      imageHeight: 384,
      liteRTTemperature: 0.3,
      liteRTMaxTokens: 8192,
      systemPrompt: 'You are a terse pirate.',
    });

    const rehydrated = relaunchWith(useAppStore.getState());

    // Terminal: the value that would be live after relaunch.
    expect(rehydrated.settings.temperature).toBe(1.35);
    expect(rehydrated.settings.maxTokens).toBe(3072);
    expect(rehydrated.settings.topP).toBe(0.55);
    expect(rehydrated.settings.repeatPenalty).toBe(1.4);
    expect(rehydrated.settings.contextLength).toBe(8192);
    expect(rehydrated.settings.imageSteps).toBe(42);
    expect(rehydrated.settings.imageGuidanceScale).toBe(11.5);
    expect(rehydrated.settings.imageThreads).toBe(7);
    expect(rehydrated.settings.imageWidth).toBe(384);
    expect(rehydrated.settings.imageHeight).toBe(384);
    expect(rehydrated.settings.liteRTTemperature).toBe(0.3);
    expect(rehydrated.settings.liteRTMaxTokens).toBe(8192);
    expect(rehydrated.settings.systemPrompt).toBe('You are a terse pirate.');
  });

  it('the active model selection is restored across relaunch', () => {
    useAppStore.setState({ activeModelId: 'qwen-gguf', lastTextModelId: 'qwen-gguf' });

    const rehydrated = relaunchWith(useAppStore.getState());

    expect(rehydrated.activeModelId).toBe('qwen-gguf');
    expect(rehydrated.lastTextModelId).toBe('qwen-gguf');
  });

  it('the one-time MCP-boost migration only resets the EXACT boost values, never a legit large context', () => {
    // A user who legitimately chose a large context above the default must NOT be
    // clobbered by the migration; only the exact boost ceiling (32768) is reset.
    useAppStore.getState().updateSettings({ contextLength: 16384, maxTokens: 4096 });

    const rehydrated = relaunchWith(useAppStore.getState());

    expect(rehydrated.settings.contextLength).toBe(16384); // untouched
    expect(rehydrated.settings.maxTokens).toBe(4096);
  });
});

describe('switching the active model must NOT stomp user-set generation values', () => {
  it('temperature/maxTokens/context are byte-identical after an activeModelId change', () => {
    useAppStore.setState({ downloadedModels: [LLAMA_MODEL, LITERT_MODEL] });
    useAppStore.getState().updateSettings({ temperature: 1.9, maxTokens: 2048, contextLength: 6144 });
    useAppStore.getState().setActiveModelId('qwen-gguf');

    const before = { ...useAppStore.getState().settings };

    // Switch to the LiteRT model — a switch that flips selectIsLiteRT and swaps
    // which settings the UI renders. It must not mutate the stored values.
    useAppStore.getState().setActiveModelId('gemma-litert');

    const after = useAppStore.getState().settings;
    expect(after.temperature).toBe(before.temperature);
    expect(after.maxTokens).toBe(before.maxTokens);
    expect(after.contextLength).toBe(before.contextLength);
    expect(after.temperature).toBe(1.9);
  });

  it('switching back and forth repeatedly never drifts the value', () => {
    useAppStore.setState({ downloadedModels: [LLAMA_MODEL, LITERT_MODEL] });
    useAppStore.getState().updateSettings({ liteRTTemperature: 0.15 });

    for (let i = 0; i < 5; i++) {
      useAppStore.getState().setActiveModelId(i % 2 === 0 ? 'gemma-litert' : 'qwen-gguf');
    }

    expect(useAppStore.getState().settings.liteRTTemperature).toBe(0.15);
  });
});
