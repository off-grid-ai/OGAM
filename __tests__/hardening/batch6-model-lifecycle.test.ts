/**
 * BATCH 6 — Model Management hardening: selection / activation / unload.
 *
 * Drives the REAL activeModelService, llmService, liteRTService, residency manager and useAppStore.
 * Only the phone is faked (generationDevice: llama.rn and the LiteRT native module, the disk, RAM).
 * Deleting the activeModelService implementation MUST fail these tests — they assert the observable
 * store outcomes and what the native engines were asked to open and release.
 *
 * Plan cases exercised here:
 *  - #1/#3  active id reflects the loaded model (setActive updates active id)
 *  - #2/#22 switching models: loading B hands the llama swap to llama, activeModelId flips to B
 *  - #4     activating the already-active model is a no-op (fast path, no reload)
 *  - #13-15 user unload frees RAM AND deselects (keepSelection=false)
 *  - #19-20 unloadAll / ejectAll frees RAM but KEEPS the selection (eject != deselect)
 *  - LiteRT unload: a user unload of a LiteRT model frees the LiteRT engine.
 */
import { launchGeneration, type GenerationDevice } from '../harness/generationDevice';
import { GB } from '../harness/nativeBoundary';

let device: GenerationDevice;
/** Every llama context the app opened, in order, with the model file it was opened on. */
let contexts: Array<{ model: string; release: jest.Mock }>;

const appState = () => device.useAppStore.getState();
const residency = () => require('../../src/services/modelResidency').modelResidencyManager;
/** How many llama contexts are open: every open minus every release llama.rn was asked for. */
const openContexts = () => contexts.length - (contexts[0]?.release.mock.calls.length ?? 0);

beforeEach(async () => {
  // Two downloaded llama models (A and B) and a LiteRT one (L); nothing selected or loaded.
  device = await launchGeneration({
    localModel: false,
    extraModels: [
      { id: 'A', name: 'Model A', engine: 'llama', fileSizeBytes: 1 * GB },
      { id: 'B', name: 'Model B', engine: 'llama', fileSizeBytes: 1 * GB },
      { id: 'L', name: 'Model L', engine: 'litert', fileSizeBytes: 1 * GB },
    ],
    ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 12 * GB },
  });
  contexts = [];
  const initLlama = device.boundary.llama!.module.initLlama;
  const open = initLlama.getMockImplementation()!;
  initLlama.mockImplementation(async (params: { model: string; embedding?: boolean }) => {
    const context = await open(params);
    if (!params?.embedding) contexts.push({ model: params.model, release: context.release });
    return context;
  });
});

const pathOf = (id: string) => appState().downloadedModels.find((m: { id: string }) => m.id === id).filePath;

describe('BATCH 6 — model selection / activation / unload (real service + store)', () => {
  // ---- #1 / #3: setActive updates the active id ----------------------------
  it('activating a model sets activeModelId in the store (nothing active before)', async () => {
    expect(appState().activeModelId).toBeNull();

    await device.activeModelService.loadTextModel('A');

    expect(contexts.map(c => c.model)).toEqual([pathOf('A')]);
    expect(appState().activeModelId).toBe('A');
  });

  // ---- #2 / #22: switching models flips the active id and unloads the old ---
  it('switching from A to B flips activeModelId to B and hands the llama swap to llama (which checks fit before releasing A)', async () => {
    await device.activeModelService.loadTextModel('A');
    expect(appState().activeModelId).toBe('A');

    // llama -> llama: the service must NOT release A up front (a refused switch would leave no
    // model); llama swaps A for B itself.
    await device.activeModelService.loadTextModel('B');

    expect(contexts.map(c => c.model)).toEqual([pathOf('A'), pathOf('B')]);
    expect(openContexts()).toBe(1); // A was released by the swap; B is the one open
    expect(appState().activeModelId).toBe('B');
  });

  // ---- #4: re-activating the already-active model is a no-op ----------------
  it('re-activating the already-loaded model does NOT reload it (fast path)', async () => {
    await device.activeModelService.loadTextModel('A');

    // Tap activate again — the model is current, so nothing is opened again.
    await device.activeModelService.loadTextModel('A');

    expect(contexts).toHaveLength(1);
    expect(openContexts()).toBe(1);
    expect(appState().activeModelId).toBe('A');
  });

  // ---- #13-15: user-initiated unload frees RAM AND clears the selection -----
  it('unloadTextModel(false) unloads the native context AND deselects (activeModelId -> null)', async () => {
    await device.activeModelService.loadTextModel('A');
    expect(appState().activeModelId).toBe('A');
    expect(device.activeModelService.getLoadedModelIds().textModelId).toBe('A');

    await device.activeModelService.unloadTextModel(false);

    expect(openContexts()).toBe(0);
    expect(appState().activeModelId).toBeNull(); // deselected
    expect(device.activeModelService.getLoadedModelIds().textModelId).toBeNull();
    expect(residency().isResident('text')).toBe(false); // residency released
  });

  it('unloadTextModel is a no-op when nothing is loaded (does not touch the engine)', async () => {
    await device.activeModelService.unloadTextModel(false);
    expect(contexts).toHaveLength(0);
    expect(device.boundary.litert.module.unloadModel).not.toHaveBeenCalled();
  });

  // ---- #19-20: eject frees RAM but KEEPS the selection (eject != delete) -----
  it('ejectAll frees the model from RAM yet keeps it SELECTED (eject != deselect)', async () => {
    await device.activeModelService.loadTextModel('A');
    expect(appState().activeModelId).toBe('A');

    const { count } = await device.activeModelService.ejectAll();

    expect(count).toBe(1);
    expect(openContexts()).toBe(0); // RAM freed
    expect(appState().activeModelId).toBe('A'); // ...but still selected
    expect(device.activeModelService.getLoadedModelIds().textModelId).toBeNull();
  });

  it('ejectAll reports 0 when nothing is loaded', async () => {
    const { count } = await device.activeModelService.ejectAll();
    expect(count).toBe(0);
  });

  // ---- residency bookkeeping: a switch registers the new model as resident --
  it('after switching, the residency manager holds exactly the "text" resident for the loaded model', async () => {
    await device.activeModelService.loadTextModel('A');
    await device.activeModelService.loadTextModel('B');

    // Exactly one text resident (not two) — the switch replaced, not stacked.
    const textResidents = residency().getResidents().filter((r: { key: string }) => r.key === 'text');
    expect(textResidents).toHaveLength(1);
    expect(residency().isResident('text')).toBe(true);
  });

  // A user-initiated unload of a LiteRT text model must free the LiteRT engine's RAM, the way the
  // loader dispatches per engine.
  it('unloadTextModel(false) unloads a loaded LiteRT model from RAM', async () => {
    await device.activeModelService.loadTextModel('L');
    expect(device.liteRTService.isModelLoaded()).toBe(true);

    await device.activeModelService.unloadTextModel(false);

    // The LiteRT engine was told to unload, and the model is fully deselected.
    expect(device.boundary.litert.module.unloadModel).toHaveBeenCalled();
    expect(device.liteRTService.isModelLoaded()).toBe(false);
    expect(appState().activeModelId).toBeNull();
  });
});
