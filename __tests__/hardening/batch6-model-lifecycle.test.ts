/**
 * BATCH 6 — Model Management hardening: selection / activation / unload.
 *
 * Drives the REAL activeModelService + REAL useAppStore. The only mocked things
 * are the native engine boundaries (llmService = llama.cpp, liteRTService =
 * LiteRT, localDreamGenerator = ONNX image, hardware = device RAM). Deleting the
 * activeModelService implementation MUST fail these tests — they assert the
 * observable store/engine outcomes of driving the real service, not mock echoes.
 *
 * Plan cases exercised here:
 *  - #1/#3  active id reflects the loaded model (setActive updates active id)
 *  - #2/#22 switching models: loading B unloads A's engine, activeModelId flips to B
 *  - #4     activating the already-active model is a no-op (fast path, no reload)
 *  - #13-15 user unload frees RAM AND deselects (keepSelection=false)
 *  - #19-20 unloadAll / ejectAll frees RAM but KEEPS the selection (eject != deselect)
 *  - LiteRT unload gap — see the BUG-FOUND .skip at the bottom.
 */

import { useAppStore } from '../../src/stores/appStore';
import { activeModelService } from '../../src/services/activeModelService';
import { modelResidencyManager } from '../../src/services/modelResidency';
import { llmService } from '../../src/services/llm';
import { liteRTService } from '../../src/services/litert';
import { localDreamGeneratorService } from '../../src/services/localDreamGenerator';
import { hardwareService } from '../../src/services/hardware';
import { resetStores, flushPromises, getAppState } from '../utils/testHelpers';
import { createDownloadedModel, createDeviceInfo } from '../utils/factories';

jest.mock('../../src/services/llm');
jest.mock('../../src/services/litert');
jest.mock('../../src/services/localDreamGenerator');
jest.mock('../../src/services/hardware');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockDream = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockHw = hardwareService as jest.Mocked<typeof hardwareService>;

describe('BATCH 6 — model selection / activation / unload (real service + store)', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();

    mockLlm.isModelLoaded.mockReturnValue(false);
    mockLlm.getLoadedModelPath.mockReturnValue(null);
    mockLlm.loadModel.mockResolvedValue(undefined);
    mockLlm.unloadModel.mockResolvedValue(undefined);
    mockLlm.getMultimodalSupport.mockReturnValue(null);

    mockLiteRT.isModelLoaded.mockReturnValue(false);
    mockLiteRT.loadModel.mockResolvedValue(undefined);
    mockLiteRT.unloadModel.mockResolvedValue(undefined);
    mockLiteRT.getActiveBackend.mockReturnValue('cpu');
    mockLiteRT.warmup.mockResolvedValue(undefined);
    mockLiteRT.supportsAudio.mockReturnValue(false);

    mockDream.isModelLoaded.mockResolvedValue(false);
    mockDream.loadModel.mockResolvedValue(true);
    mockDream.unloadModel.mockResolvedValue(true);

    mockHw.getDeviceInfo.mockResolvedValue(createDeviceInfo());
    mockHw.refreshMemoryInfo.mockResolvedValue({
      totalMemory: 8 * 1024 * 1024 * 1024,
      usedMemory: 2 * 1024 * 1024 * 1024,
      availableMemory: 6 * 1024 * 1024 * 1024,
    } as any);
    mockHw.estimateModelRam.mockImplementation((m: any, mult = 1.5) => (m?.fileSize ?? 0) * mult);
    mockHw.estimateImageModelRam.mockImplementation((m: any) => (m?.fileSize ?? 0) * 2.5);
    mockHw.getTotalMemoryGB.mockReturnValue(16);
    mockHw.getAvailableMemoryGB.mockReturnValue(16);

    await activeModelService.syncWithNativeState();
  });

  // ---- #1 / #3: setActive updates the active id ----------------------------
  it('activating a model sets activeModelId in the store (nothing active before)', async () => {
    const model = createDownloadedModel({ id: 'A', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [model] });
    expect(getAppState().activeModelId).toBeNull();

    mockLlm.isModelLoaded.mockReturnValue(true); // native reports loaded after loadModel
    await activeModelService.loadTextModel('A');

    expect(mockLlm.loadModel).toHaveBeenCalledWith(model.filePath, undefined, { override: false });
    expect(getAppState().activeModelId).toBe('A');
  });

  // ---- #2 / #22: switching models flips the active id and unloads the old ---
  it('switching from A to B flips activeModelId to B and unloads the previous engine context', async () => {
    const A = createDownloadedModel({ id: 'A', engine: 'llama', filePath: '/m/a.gguf' });
    const B = createDownloadedModel({ id: 'B', engine: 'llama', filePath: '/m/b.gguf' });
    useAppStore.setState({ downloadedModels: [A, B] });

    mockLlm.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('A');
    expect(getAppState().activeModelId).toBe('A');

    // Loading a DIFFERENT model must unload the previous llama context, then load B.
    await activeModelService.loadTextModel('B');
    expect(mockLlm.unloadModel).toHaveBeenCalled();
    expect(mockLlm.loadModel).toHaveBeenLastCalledWith(B.filePath, undefined, { override: false });
    expect(getAppState().activeModelId).toBe('B');
  });

  // ---- #4: re-activating the already-active model is a no-op ----------------
  it('re-activating the already-loaded model does NOT reload it (fast path)', async () => {
    const A = createDownloadedModel({ id: 'A', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [A] });

    mockLlm.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('A');
    const loadCallsAfterFirst = mockLlm.loadModel.mock.calls.length;

    // Tap activate again — model is current, so loadModel must not be called again.
    await activeModelService.loadTextModel('A');
    expect(mockLlm.loadModel.mock.calls.length).toBe(loadCallsAfterFirst);
    expect(getAppState().activeModelId).toBe('A');
  });

  // ---- #13-15: user-initiated unload frees RAM AND clears the selection -----
  it('unloadTextModel(false) unloads the native context AND deselects (activeModelId -> null)', async () => {
    const A = createDownloadedModel({ id: 'A', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [A] });

    mockLlm.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('A');
    expect(getAppState().activeModelId).toBe('A');
    expect(activeModelService.getLoadedModelIds().textModelId).toBe('A');

    await activeModelService.unloadTextModel(false);

    expect(mockLlm.unloadModel).toHaveBeenCalled();
    expect(getAppState().activeModelId).toBeNull(); // deselected
    expect(activeModelService.getLoadedModelIds().textModelId).toBeNull();
    expect(modelResidencyManager.isResident('text')).toBe(false); // residency released
  });

  it('unloadTextModel is a no-op when nothing is loaded (does not touch the engine)', async () => {
    mockLlm.isModelLoaded.mockReturnValue(false);
    await activeModelService.unloadTextModel(false);
    expect(mockLlm.unloadModel).not.toHaveBeenCalled();
  });

  // ---- #19-20: eject frees RAM but KEEPS the selection (eject != delete) -----
  it('ejectAll frees the model from RAM yet keeps it SELECTED (eject != deselect)', async () => {
    const A = createDownloadedModel({ id: 'A', engine: 'llama' });
    useAppStore.setState({ downloadedModels: [A] });

    mockLlm.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('A');
    expect(getAppState().activeModelId).toBe('A');

    const { count } = await activeModelService.ejectAll();

    expect(count).toBe(1);
    expect(mockLlm.unloadModel).toHaveBeenCalled(); // RAM freed
    expect(getAppState().activeModelId).toBe('A'); // ...but still selected
    expect(activeModelService.getLoadedModelIds().textModelId).toBeNull();
  });

  it('ejectAll reports 0 when nothing is loaded', async () => {
    const { count } = await activeModelService.ejectAll();
    expect(count).toBe(0);
  });

  // ---- residency bookkeeping: a switch registers the new model as resident --
  it('after switching, the residency manager holds exactly the "text" resident for the loaded model', async () => {
    const A = createDownloadedModel({ id: 'A', engine: 'llama', filePath: '/m/a.gguf' });
    const B = createDownloadedModel({ id: 'B', engine: 'llama', filePath: '/m/b.gguf' });
    useAppStore.setState({ downloadedModels: [A, B] });

    mockLlm.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('A');
    await activeModelService.loadTextModel('B');
    await flushPromises();

    // Exactly one text resident (not two) — the switch replaced, not stacked.
    const textResidents = modelResidencyManager.getResidents().filter(r => r.key === 'text');
    expect(textResidents).toHaveLength(1);
    expect(modelResidencyManager.isResident('text')).toBe(true);
  });

  // ==========================================================================
  // BUG-FOUND: user-initiated unload of a LiteRT text model does NOT free the
  // LiteRT engine's RAM.
  //
  // activeModelService.doUnloadTextModelLocked (src/services/activeModelService/
  // index.ts) gates the native unload on `llmService.isModelLoaded()` and only
  // calls `llmService.unloadModel()`. For a LiteRT model, llmService reports
  // NOT loaded, so NEITHER llmService.unloadModel() NOR liteRTService.unloadModel()
  // runs — the LiteRT weights stay resident. getActiveModels() is engine-aware
  // (checks liteRTService.isModelLoaded()), so the seam exists on the read side
  // but not the unload side. The unload path must dispatch per engine the same
  // way the loader (doLoadTextModel) does. Fix belongs in the service (do NOT
  // patch here). Skipped until src is fixed in its own PR.
  // ==========================================================================
  it.skip('[BUG] unloadTextModel(false) must unload a loaded LiteRT model from RAM', async () => {
    const lite = createDownloadedModel({
      id: 'L', engine: 'litert' as any, fileName: 'm.litertlm', filePath: '/m/m.litertlm',
    });
    useAppStore.setState({ downloadedModels: [lite] });

    // Native truth: LiteRT engine holds the model; llama holds nothing.
    mockLiteRT.isModelLoaded.mockReturnValue(true);
    mockLlm.isModelLoaded.mockReturnValue(false);
    await activeModelService.loadTextModel('L');

    await activeModelService.unloadTextModel(false);

    // EXPECTED once the seam is fixed: the LiteRT engine is told to unload.
    expect(mockLiteRT.unloadModel).toHaveBeenCalled();
    // And the model is fully deselected.
    expect(getAppState().activeModelId).toBeNull();
  });
});
