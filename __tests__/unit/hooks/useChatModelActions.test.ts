/**
 * Unit tests for useChatModelActions
 *
 * Tests the exported async functions directly, covering uncovered branches:
 * - addSystemMsg: no-op when activeConversationId missing or showGenerationDetails false
 * - initiateModelLoad: memory check failure path
 * - proceedWithModelLoadFn: success path with system message, createConversation path
 * - handleUnloadModelFn: success path with system message
 */

import {
  initiateModelLoad,
  ensureModelLoadedFn,
  proceedWithModelLoadFn,
  handleModelSelectFn,
  handleUnloadModelFn,
} from '../../../src/screens/ChatScreen/useChatModelActions';
import { createDownloadedModel } from '../../utils/factories';
import { OverridableMemoryError } from '../../../src/services/modelLoadErrors';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: jest.fn(),
    unloadTextModel: jest.fn(),
    selectTextModel: jest.fn(),
    checkMemoryForModel: jest.fn(),
    getActiveModels: jest.fn(),
  },
}));

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    getMultimodalSupport: jest.fn(),
    getLoadedModelPath: jest.fn(),
    stopGeneration: jest.fn(),
    isModelLoaded: jest.fn(),
    consumeBackendFallbackNotice: jest.fn(() => null),
    // engines.activeTextCapabilities (reached via loadedModelVision / state-sync) reads these too.
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
  },
}));

// LiteRT boundary mocked as a dumb flag reader so engines.isModelReady/deriveEngineCapabilities
// (which read this DIRECT module, not the barrel) resolve deterministically for the litert path.
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(() => false) },
}));

// Get mock references after hoisting
const {
  activeModelService,
} = require('../../../src/services/activeModelService');
const { llmService } = require('../../../src/services/llm');
const { liteRTService } = require('../../../src/services/litert');
const mockLiteRTLoaded = liteRTService.isModelLoaded as jest.Mock;

const mockLoadTextModel = activeModelService.loadTextModel as jest.Mock;
const mockUnloadTextModel = activeModelService.unloadTextModel as jest.Mock;
const mockSelectTextModel = activeModelService.selectTextModel as jest.Mock;
const mockCheckMemoryForModel =
  activeModelService.checkMemoryForModel as jest.Mock;
const mockGetActiveModels = activeModelService.getActiveModels as jest.Mock;
const mockGetMultimodalSupport = llmService.getMultimodalSupport as jest.Mock;
const mockGetLoadedModelPath = llmService.getLoadedModelPath as jest.Mock;
const mockStopGeneration = llmService.stopGeneration as jest.Mock;
const mockIsModelLoaded = llmService.isModelLoaded as jest.Mock;

// Mock CustomAlert helpers — both the barrel (used by useChatModelActions) and the
// concrete module (used by the shared loadModelWithOverride helper it now delegates to).
const showAlertMock = (title: string, message: string, buttons?: any[]) => ({
  visible: true,
  title,
  message,
  buttons: buttons ?? [],
});
const hideAlertMock = () => ({
  visible: false,
  title: '',
  message: '',
  buttons: [],
});
jest.mock('../../../src/components', () => ({
  showAlert: jest.fn(showAlertMock),
  hideAlert: jest.fn(hideAlertMock),
}));
jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn(showAlertMock),
  hideAlert: jest.fn(hideAlertMock),
}));

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** waitForRenderFrame in the module uses requestAnimationFrame + setTimeout.
 *  Stub it out globally so tests don't time out. */
(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => {
  cb(0);
  return 0;
};

beforeEach(() => {
  // Reset (not just re-default) the loader so a prior test's unconsumed
  // mockRejectedValueOnce/mockResolvedValueOnce queue can't leak into the next.
  mockLoadTextModel.mockReset().mockResolvedValue(undefined);
  mockUnloadTextModel.mockResolvedValue(undefined);
  mockSelectTextModel.mockReset();
  mockCheckMemoryForModel.mockResolvedValue({
    canLoad: true,
    severity: 'safe',
    message: '',
  });
  mockGetActiveModels.mockReturnValue({ text: { isLoading: false } });
  mockGetMultimodalSupport.mockReturnValue(null);
  mockGetLoadedModelPath.mockReturnValue(null);
  mockStopGeneration.mockResolvedValue(undefined);
  mockIsModelLoaded.mockReturnValue(true);
  mockLiteRTLoaded.mockReturnValue(false);
  // waitForRenderFrame() = InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350)).
  // The REAL InteractionManager does its own async scheduling that does NOT flush under
  // jest fake timers, so any test that force-loads through it hangs to the 10s timeout.
  // Stub it to invoke the callback synchronously for EVERY test → waitForRenderFrame
  // reduces to a plain setTimeout(350): real timers resolve it in 350ms, fake-timer tests
  // flush it with advanceTimersByTime(400). Deterministic, no interaction-queue pollution.
  const { InteractionManager } = require('react-native');
  jest
    .spyOn(InteractionManager, 'runAfterInteractions')
    .mockImplementation((cb: any) => {
      if (typeof cb === 'function') cb();
      return {
        then: (r: any) => r && r(),
        done: () => {},
        cancel: () => {},
      } as any;
    });
});

// Each test starts from a clean timer + spy state so the fake-timer tests below can't
// leak into the next test (the cause of the 10s-timeout cascade when run as a file).
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function makeRef<T>(value: T): React.MutableRefObject<T> {
  return { current: value } as React.MutableRefObject<T>;
}

/** Flush the fire-and-forget Load-Anyway chain (waitForRenderFrame's ~350ms real
 *  setTimeout, then the awaited loadTextModel + resume microtasks). Real timers. */
function flushRenderFrameChain(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 450));
}

function makeDeps(overrides: Partial<any> = {}) {
  const model = createDownloadedModel({
    id: 'model-1',
    name: 'Test Model',
    filePath: '/path/model.gguf',
  });
  return {
    activeModel: model,
    activeModelId: 'model-1',
    activeConversationId: 'conv-1',
    isStreaming: false,
    settings: { showGenerationDetails: true },
    clearStreamingMessage: jest.fn(),
    createConversation: jest.fn(() => 'new-conv-id'),
    addMessage: jest.fn(),
    setIsModelLoading: jest.fn(),
    setLoadingModel: jest.fn(),
    setSupportsVision: jest.fn(),
    setShowModelSelector: jest.fn(),
    setAlertState: jest.fn(),
    modelLoadStartTimeRef: makeRef<number | null>(null),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// initiateModelLoad
// ─────────────────────────────────────────────

describe('initiateModelLoad', () => {
  it('returns early when activeModel is undefined', async () => {
    const deps = makeDeps({ activeModel: undefined, activeModelId: null });
    await initiateModelLoad(deps, false);
    expect(mockLoadTextModel).not.toHaveBeenCalled();
  });

  it('shows the override alert when the MEASURED loader refuses (OverridableMemoryError)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(
      new OverridableMemoryError('Not enough RAM'),
    );
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
    // No predictive pre-check — the refusal comes from the authoritative loader.
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
  });

  it('loads model successfully when not already loading', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce({ vision: true });
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);
    expect(deps.setSupportsVision).toHaveBeenCalledWith(true);
    expect(deps.addMessage).toHaveBeenCalled(); // system msg with load time
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(false);
  });

  it('skips UI updates when alreadyLoading=true', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    await initiateModelLoad(deps, true);
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    expect(deps.setIsModelLoading).not.toHaveBeenCalled();
  });

  it('shows error alert when load throws and not already loading', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('Load failed'));
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });

  it('resumes the pending turn after "Load Anyway" on a measured-loader refusal (F16)', async () => {
    // Real timers: the OD3 refactor awaits waitForRenderFrame (a real 350ms setTimeout)
    // on the refusal path too, so faking timers here would hang the initial load before
    // any advance. The InteractionManager stub makes it a plain setTimeout; flush the
    // fire-and-forget onPress chain with a real wait past 350ms.
    // The initial load refuses (overridable); the forced retry succeeds.
    mockLoadTextModel.mockRejectedValueOnce(
      new OverridableMemoryError('Not enough RAM'),
    );
    mockLoadTextModel.mockResolvedValue(undefined);
    mockIsModelLoaded.mockReturnValue(true);
    const onResume = jest.fn();
    const deps = makeDeps();

    await initiateModelLoad(deps, false, onResume);
    const alert = deps.setAlertState.mock.calls.find(
      (c: any) => c[0].title === 'Insufficient Memory',
    )[0];
    const loadAnyway = alert.buttons.find((b: any) => b.text === 'Load Anyway');

    loadAnyway.onPress();
    await flushRenderFrameChain(); // waitForRenderFrame -> doLoadTextModel -> resume

    // Load Anyway must force the residency gate too (override:true), or the load
    // re-hits the budget and fails — the exact "Load Anyway did nothing" bug.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, {
      override: true,
    });
    expect(onResume).toHaveBeenCalledTimes(1); // the message is NOT dropped
  });

  it('does NOT resume a turn for "Load Anyway" when no resume was requested (model-select/reload)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(
      new OverridableMemoryError('Not enough RAM'),
    );
    mockLoadTextModel.mockResolvedValue(undefined);
    mockIsModelLoaded.mockReturnValue(true);
    const deps = makeDeps();

    await initiateModelLoad(deps, false); // no onLoadedResume
    const alert = deps.setAlertState.mock.calls.find(
      (c: any) => c[0].title === 'Insufficient Memory',
    )[0];
    alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    await flushRenderFrameChain();

    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, {
      override: true,
    }); // still loads (forced)
  });
});

// ─────────────────────────────────────────────
// initiateModelLoad — typed outcomes (the seam that makes failures catchable)
// ─────────────────────────────────────────────

describe('initiateModelLoad typed outcome', () => {
  it('returns no-model-selected when there is no active model', async () => {
    const deps = makeDeps({ activeModel: undefined, activeModelId: null });
    const outcome = await initiateModelLoad(deps, false);
    expect(outcome).toEqual({ ok: false, reason: 'no-model-selected' });
  });

  it('returns insufficient-memory (alerted) when the measured loader refuses (overridable)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(
      new OverridableMemoryError('Not enough RAM'),
    );
    const outcome = await initiateModelLoad(makeDeps(), false);
    expect(outcome).toEqual({
      ok: false,
      reason: 'insufficient-memory',
      detail: 'Not enough RAM',
      alerted: true,
    });
  });

  it('returns load-threw and alerts when the load throws (not already loading)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('boom'));
    const outcome = await initiateModelLoad(makeDeps(), false);
    expect(outcome).toEqual({
      ok: false,
      reason: 'load-threw',
      detail: 'boom',
      alerted: true,
    });
  });

  it('returns load-threw WITHOUT swallowing when alreadyLoading (the regression this fixes)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('stuck'));
    const deps = makeDeps();
    const outcome = await initiateModelLoad(deps, true);
    // Previously this path returned void and showed nothing — now it reports why.
    expect(outcome).toEqual({
      ok: false,
      reason: 'load-threw',
      detail: 'stuck',
      alerted: false,
    });
    expect(deps.setAlertState).not.toHaveBeenCalled();
  });

  it('maps a "not found" load error to not-downloaded', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('Model not found'));
    const outcome = await initiateModelLoad(makeDeps(), true);
    expect(outcome).toMatchObject({ ok: false, reason: 'not-downloaded' });
  });
});

// ─────────────────────────────────────────────
// ensureModelLoadedFn — typed outcomes
// ─────────────────────────────────────────────

describe('ensureModelLoadedFn typed outcome', () => {
  it('returns no-model-selected when no model is active', async () => {
    const deps = makeDeps({ activeModel: undefined, activeModelId: null });
    expect(await ensureModelLoadedFn(deps)).toEqual({
      ok: false,
      reason: 'no-model-selected',
    });
  });

  it('returns ok without loading when the model is already loaded', async () => {
    mockGetLoadedModelPath.mockReturnValue('/path/model.gguf');
    const outcome = await ensureModelLoadedFn(makeDeps());
    expect(outcome).toEqual({ ok: true });
    expect(mockLoadTextModel).not.toHaveBeenCalled();
  });

  it('propagates the loader outcome when a load is needed', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockRejectedValueOnce(new Error('disk gone'));
    const outcome = await ensureModelLoadedFn(makeDeps());
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'load-threw',
      detail: 'disk gone',
    });
  });

  // Desync guard: the path matches but the engine has NO model resident (isModelLoaded=false).
  // The old llama fast-path trusted the path alone and returned ok → generated against nothing.
  // isModelReady now also requires isModelLoaded(), so this must attempt a load, not short-circuit.

  // Load reports ok but the model is still not resident afterwards → post-verify catches the desync.
  it('returns load-threw when the load resolves but leaves no resident model', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockIsModelLoaded.mockReturnValue(false); // never becomes resident
    mockLoadTextModel.mockResolvedValueOnce(undefined); // load itself "succeeds"
    const outcome = await ensureModelLoadedFn(makeDeps());
    expect(outcome).toMatchObject({ ok: false, reason: 'load-threw' });
  });

  it('returns ok without loading when the LiteRT model is already resident', async () => {
    mockLiteRTLoaded.mockReturnValue(true);
    const deps = makeDeps({
      activeModel: createDownloadedModel({
        id: 'lr',
        engine: 'litert',
        liteRTVision: true,
      }),
    });
    const outcome = await ensureModelLoadedFn(deps);
    expect(outcome).toEqual({ ok: true });
    expect(mockLoadTextModel).not.toHaveBeenCalled();
    expect(deps.setSupportsVision).toHaveBeenCalledWith(true); // vision from the flag, pre-load
  });

  it('loads the LiteRT model when it is not yet resident', async () => {
    mockLiteRTLoaded.mockReturnValue(false);
    const deps = makeDeps({
      activeModel: createDownloadedModel({
        id: 'lr',
        engine: 'litert',
        liteRTVision: false,
      }),
    });
    // isModelReady stays false (mock never flips) → post-verify fails, but the load WAS attempted.
    await ensureModelLoadedFn(deps);
    expect(mockLoadTextModel).toHaveBeenCalled();
  });

  // Vision-repair: a vision model whose mmproj didn't load reports vision=false → force a reload
  // even though its path is resident, so it comes back multimodal.
  it('reloads a resident vision model whose mmproj did not load (vision repair)', async () => {
    mockGetLoadedModelPath.mockReturnValue('/path/vis.gguf');
    mockIsModelLoaded.mockReturnValue(true);
    mockGetMultimodalSupport.mockReturnValue({ vision: false }); // mmproj missing → reports no vision
    const deps = makeDeps({
      activeModel: createDownloadedModel({
        id: 'vis',
        filePath: '/path/vis.gguf',
        mmProjPath: '/path/mmproj.gguf',
      }),
    });
    await ensureModelLoadedFn(deps);
    expect(mockLoadTextModel).toHaveBeenCalled(); // did NOT short-circuit despite resident path
  });
});

// ─────────────────────────────────────────────
// proceedWithModelLoadFn
// ─────────────────────────────────────────────

describe('proceedWithModelLoadFn', () => {
  it('closes the picker up front and routes the load through the MEASURED loader', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'm', name: 'M' });
    const p = proceedWithModelLoadFn(deps, model); // don't await yet — check the sync prefix
    // The sheet dismisses synchronously, before the load resolves.
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);
    await p; // let it finish so nothing leaks
    // No predictive pre-check — the load went to the authoritative residency loader.
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    expect(mockLoadTextModel).toHaveBeenCalledWith('m', undefined, undefined);
  });

  it('offers the shared Load Anyway override when the MEASURED loader refuses (OverridableMemoryError)', async () => {
    // First (non-override) attempt refuses with the overridable error; the retry succeeds.
    mockLoadTextModel
      .mockRejectedValueOnce(
        new OverridableMemoryError(
          'Not enough free memory to load this model.',
        ),
      )
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'over-1', name: 'Big' });

    await proceedWithModelLoadFn(deps, model);

    const alert = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    )?.[0];
    expect(alert).toBeDefined();
    const loadAnyway = alert.buttons.find((b: any) => b.text === 'Load Anyway');
    loadAnyway.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    // The retry forces past the residency gate with { override: true } — same affordance
    // every other surface uses via the shared helper.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('over-1', undefined, {
      override: true,
    });
  });

  it('loads model and posts system message when showGenerationDetails=true', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce(null);
    const deps = makeDeps({
      activeConversationId: 'conv-1',
      settings: { showGenerationDetails: true },
    });
    deps.modelLoadStartTimeRef.current = Date.now() - 1000;
    const model = createDownloadedModel({ id: 'model-1', name: 'Fast Model' });
    await proceedWithModelLoadFn(deps, model);
    expect(deps.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ isSystemInfo: true }),
    );
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  it('does not create a conversation when no active conversation and showGenerationDetails=false', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps({
      activeConversationId: null,
      settings: { showGenerationDetails: false },
    });
    const model = createDownloadedModel({ id: 'model-2' });
    await proceedWithModelLoadFn(deps, model);
    expect(deps.createConversation).not.toHaveBeenCalled();
    expect(deps.addMessage).not.toHaveBeenCalled();
  });

  it('shows error alert when load throws', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('GGUF error'));
    const deps = makeDeps();
    const model = createDownloadedModel();
    await proceedWithModelLoadFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});

// ─────────────────────────────────────────────
// handleModelSelectFn
// ─────────────────────────────────────────────

describe('handleModelSelectFn', () => {
  it('closes selector immediately when same model is already loaded', async () => {
    const model = createDownloadedModel({ filePath: '/loaded/model.gguf' });
    mockGetLoadedModelPath.mockReturnValueOnce('/loaded/model.gguf');
    const deps = makeDeps();
    await handleModelSelectFn(deps, model);
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
    expect(mockLoadTextModel).not.toHaveBeenCalled();
  });

  it('loads through the MEASURED loader with NO predictive pre-check gate (OD3 parity)', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'sel-1' });

    await handleModelSelectFn(deps, model);

    // The divergent predictive gate is gone — selection goes straight to the loader,
    // exactly as Home does, so a model the estimate would block still loads.
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
    expect(mockLoadTextModel).toHaveBeenCalledWith(
      'sel-1',
      undefined,
      undefined,
    );
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  it('offers the shared Load Anyway override when the loader refuses (not a hard block)', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockRejectedValueOnce(
      new OverridableMemoryError('Not enough free memory.'),
    );
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'sel-2' });

    await handleModelSelectFn(deps, model);

    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
    expect(mockCheckMemoryForModel).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// initiateModelLoad — Load Anyway callback (lines 94-99)
// ─────────────────────────────────────────────

describe('initiateModelLoad — Load Anyway button (measured loader refusal, turn resume)', () => {
  it('executes Load Anyway callback: hides alert, sets loading state, then force-loads with override', async () => {
    // Real timers + flush (see F16 note): the refusal path now awaits a real 350ms frame.
    // The MEASURED loader refuses (overridable) on the initial attempt.
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));
    mockGetMultimodalSupport.mockReturnValueOnce({ vision: false });

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    // Capture the alert buttons
    const alertCall = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    )[0];
    const loadAnywayBtn = alertCall.buttons.find(
      (b: any) => b.text === 'Load Anyway',
    );
    expect(loadAnywayBtn).toBeDefined();

    // Invoke the onPress callback
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);

    await flushRenderFrameChain(); // past the 350ms waitForRenderFrame + microtasks

    // Retry forces past the residency gate with override:true.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, {
      override: true,
    });
  });

  it('does not post a system message on the forced load when showGenerationDetails=false', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));
    mockGetMultimodalSupport.mockReturnValueOnce(null);

    const deps = makeDeps({ settings: { showGenerationDetails: false } });
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    )[0];
    const loadAnywayBtn = alertCall.buttons.find(
      (b: any) => b.text === 'Load Anyway',
    );
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();

    await flushRenderFrameChain();

    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, {
      override: true,
    });
    expect(deps.addMessage).not.toHaveBeenCalled(); // showGenerationDetails=false
  });

  it('clears loading state in finally even when the forced load also fails', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    )[0];
    const loadAnywayBtn = alertCall.buttons.find(
      (b: any) => b.text === 'Load Anyway',
    );
    mockLoadTextModel.mockRejectedValueOnce(new Error('Load failed'));
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();

    await flushRenderFrameChain();

    // State cleaned up (setIsModelLoading(false) called in finally)
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true); // set by callback
  });
});

// ─────────────────────────────────────────────
// handleModelSelectFn — Load Anyway callback (measured-loader refusal)
// ─────────────────────────────────────────────

describe('handleModelSelectFn — Load Anyway button', () => {
  it('executes Load Anyway callback when the loader refuses (overridable)', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));

    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'model-x' });
    await handleModelSelectFn(deps, model);

    const alertCall = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    )[0];
    const loadAnywayBtn = alertCall.buttons.find(
      (b: any) => b.text === 'Load Anyway',
    );
    expect(loadAnywayBtn).toBeDefined();

    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    await loadAnywayBtn.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    // Retry forces past the gate with override.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-x', undefined, {
      override: true,
    });
  });

  it('shows a plain error (no override) when the loader fails with a non-memory error', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockRejectedValueOnce(new Error('GGUF corrupt'));

    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'model-y' });
    await handleModelSelectFn(deps, model);

    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});

// ─────────────────────────────────────────────
// handleUnloadModelFn
// ─────────────────────────────────────────────

describe('handleUnloadModelFn', () => {
  it('stops streaming before unloading when isStreaming=true', async () => {
    mockUnloadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps({
      isStreaming: true,
      settings: { showGenerationDetails: false },
    });
    await handleUnloadModelFn(deps);
    expect(mockStopGeneration).toHaveBeenCalled();
    expect(deps.clearStreamingMessage).toHaveBeenCalled();
    expect(mockUnloadTextModel).toHaveBeenCalled();
  });

  it('posts system message after unloading when showGenerationDetails=true', async () => {
    mockUnloadTextModel.mockResolvedValueOnce(undefined);
    const model = createDownloadedModel({ name: 'My Model' });
    const deps = makeDeps({
      activeModel: model,
      isStreaming: false,
      settings: { showGenerationDetails: true },
    });
    await handleUnloadModelFn(deps);
    expect(deps.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        content: expect.stringContaining('My Model'),
        isSystemInfo: true,
      }),
    );
  });

  it('shows error alert when unload throws', async () => {
    mockUnloadTextModel.mockRejectedValueOnce(new Error('Unload failed'));
    const deps = makeDeps({
      isStreaming: false,
      settings: { showGenerationDetails: false },
    });
    await handleUnloadModelFn(deps);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});
