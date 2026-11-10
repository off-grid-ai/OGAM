/**
 * A chat model that killed the app while loading as a copy starts in low-memory mode from then on,
 * so nobody crashes twice on it. Two launches share one disk (AsyncStorage, the device boundary);
 * each launch is a fresh module graph, as after a real restart.
 */
export {};
const storage = require('@react-native-async-storage/async-storage');

function launch(): typeof import('../../../src/services/lowMemoryLoads') {
  let mod: typeof import('../../../src/services/lowMemoryLoads') | undefined;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => storage);
    mod = require('../../../src/services/lowMemoryLoads');
  });
  return mod!;
}

const MODEL = '/docs/models/k2-horizon-3.7b-q4_k_m.gguf';

beforeEach(async () => {
  await storage.clear();
});

describe('a copy load the app died in', () => {
  it('makes that model start in low-memory mode on every later launch', async () => {
    const first = launch();
    expect(await first.startsInLowMemory(MODEL)).toBe(false);
    await first.copiedLoadStarted(MODEL);
    // The app dies here: native init never returns.

    const second = launch();
    expect(await second.startsInLowMemory(MODEL)).toBe(true);
    expect(await second.startsInLowMemory('/docs/models/other.gguf')).toBe(false);
    // It dies loading that model again: still listed once.
    await second.copiedLoadStarted(MODEL);
    expect(await launch().startsInLowMemory(MODEL)).toBe(true);
    expect(JSON.parse(await storage.getItem('offgrid.llm.lowMemoryModels'))).toEqual([MODEL]);
  });

  it('a copy load that returned leaves nothing behind', async () => {
    const first = launch();
    await first.copiedLoadStarted(MODEL);
    await first.copiedLoadEnded();

    expect(await launch().startsInLowMemory(MODEL)).toBe(false);
  });

  it('a load still running in this launch is not a death', async () => {
    const only = launch();
    await only.copiedLoadStarted(MODEL);
    expect(await only.startsInLowMemory(MODEL)).toBe(false);
  });

  it('a crash it cannot save yet stays marked, so every later check in that launch still sees it', async () => {
    await launch().copiedLoadStarted(MODEL);
    const second = launch();
    jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('POSIX 28: no space left'));
    expect(await second.startsInLowMemory(MODEL)).toBe(true);
    // The residency check asked first; the loader asks again and must get the same answer.
    expect(await second.startsInLowMemory(MODEL)).toBe(true);
  });

  it('a full disk or an unreadable marker never fails a load', async () => {
    const first = launch();
    jest.spyOn(storage, 'setItem').mockRejectedValueOnce(new Error('POSIX 28: no space left'));
    await expect(first.copiedLoadStarted(MODEL)).resolves.toBeUndefined();

    await storage.setItem('offgrid.llm.copiedLoadInFlight', '{not json');
    expect(await launch().startsInLowMemory(MODEL)).toBe(false);
  });
});
