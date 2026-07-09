/**
 * Unit tests for useChatModelActions
 *
 * Tests the exported async functions directly, covering uncovered branches:
 * - addSystemMsg: no-op when activeConversationId missing or showGenerationDetails false
 * - initiateModelLoad: memory check failure path
 * - proceedWithModelLoadFn: success path with system message, createConversation path
 * - handleUnloadModelFn: success path with system message
 */

import { initiateModelLoad, ensureModelLoadedFn, proceedWithModelLoadFn, handleModelSelectFn, handleUnloadModelFn } from '../../../src/screens/ChatScreen/useChatModelActions';
import { createDownloadedModel } from '../../utils/factories';
import { OverridableMemoryError } from '../../../src/services/modelLoadErrors';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────

jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: jest.fn(),
    unloadTextModel: jest.fn(),
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
  },
}));

// Get mock references after hoisting
const { activeModelService } = require('../../../src/services/activeModelService');
const { llmService } = require('../../../src/services/llm');

const mockLoadTextModel = activeModelService.loadTextModel as jest.Mock;
const mockUnloadTextModel = activeModelService.unloadTextModel as jest.Mock;
const mockCheckMemoryForModel = activeModelService.checkMemoryForModel as jest.Mock;
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
const hideAlertMock = () => ({ visible: false, title: '', message: '', buttons: [] });
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
  mockLoadTextModel.mockResolvedValue(undefined);
  mockUnloadTextModel.mockResolvedValue(undefined);
  mockCheckMemoryForModel.mockResolvedValue({ canLoad: true, severity: 'safe', message: '' });
  mockGetActiveModels.mockReturnValue({ text: { isLoading: false } });
  mockGetMultimodalSupport.mockReturnValue(null);
  mockGetLoadedModelPath.mockReturnValue(null);
  mockStopGeneration.mockResolvedValue(undefined);
  mockIsModelLoaded.mockReturnValue(true);
});

function makeRef<T>(value: T): React.MutableRefObject<T> {
  return { current: value } as React.MutableRefObject<T>;
}

function makeDeps(overrides: Partial<any> = {}) {
  const model = createDownloadedModel({ id: 'model-1', name: 'Test Model', filePath: '/path/model.gguf' });
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
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('Not enough RAM'));
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
    jest.useFakeTimers();
    const { InteractionManager } = require('react-native');
    const iaSpy = jest.spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation((cb: any) => { cb?.(); return { then: () => {}, done: () => {}, cancel: () => {} } as any; });
    // The initial load refuses (overridable); the forced retry succeeds.
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('Not enough RAM'));
    mockLoadTextModel.mockResolvedValue(undefined);
    mockIsModelLoaded.mockReturnValue(true);
    const onResume = jest.fn();
    const deps = makeDeps();

    await initiateModelLoad(deps, false, onResume);
    const alert = deps.setAlertState.mock.calls.find((c: any) => c[0].title === 'Insufficient Memory')[0];
    const loadAnyway = alert.buttons.find((b: any) => b.text === 'Load Anyway');

    loadAnyway.onPress();
    await jest.advanceTimersByTimeAsync(400); // flush waitForRenderFrame -> doLoadTextModel -> resume

    // Load Anyway must force the residency gate too (override:true), or the load
    // re-hits the budget and fails — the exact "Load Anyway did nothing" bug.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, { override: true });
    expect(onResume).toHaveBeenCalledTimes(1); // the message is NOT dropped
    iaSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does NOT resume a turn for "Load Anyway" when no resume was requested (model-select/reload)', async () => {
    jest.useFakeTimers();
    const { InteractionManager } = require('react-native');
    const iaSpy = jest.spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation((cb: any) => { cb?.(); return { then: () => {}, done: () => {}, cancel: () => {} } as any; });
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('Not enough RAM'));
    mockLoadTextModel.mockResolvedValue(undefined);
    mockIsModelLoaded.mockReturnValue(true);
    const deps = makeDeps();

    await initiateModelLoad(deps, false); // no onLoadedResume
    const alert = deps.setAlertState.mock.calls.find((c: any) => c[0].title === 'Insufficient Memory')[0];
    alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    await jest.advanceTimersByTimeAsync(400);

    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, { override: true }); // still loads (forced)
    iaSpy.mockRestore();
    jest.useRealTimers();
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
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('Not enough RAM'));
    const outcome = await initiateModelLoad(makeDeps(), false);
    expect(outcome).toEqual({ ok: false, reason: 'insufficient-memory', detail: 'Not enough RAM', alerted: true });
  });

  it('returns ok when the load succeeds', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    expect(await initiateModelLoad(makeDeps(), false)).toEqual({ ok: true });
  });

  it('returns load-threw and alerts when the load throws (not already loading)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('boom'));
    const outcome = await initiateModelLoad(makeDeps(), false);
    expect(outcome).toEqual({ ok: false, reason: 'load-threw', detail: 'boom', alerted: true });
  });

  it('returns load-threw WITHOUT swallowing when alreadyLoading (the regression this fixes)', async () => {
    mockLoadTextModel.mockRejectedValueOnce(new Error('stuck'));
    const deps = makeDeps();
    const outcome = await initiateModelLoad(deps, true);
    // Previously this path returned void and showed nothing — now it reports why.
    expect(outcome).toEqual({ ok: false, reason: 'load-threw', detail: 'stuck', alerted: false });
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
    expect(await ensureModelLoadedFn(deps)).toEqual({ ok: false, reason: 'no-model-selected' });
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
    expect(outcome).toMatchObject({ ok: false, reason: 'load-threw', detail: 'disk gone' });
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
      .mockRejectedValueOnce(new OverridableMemoryError('Not enough free memory to load this model.'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'over-1', name: 'Big' });

    await proceedWithModelLoadFn(deps, model);

    const alert = deps.setAlertState.mock.calls.find((c: any) => c[0]?.title === 'Insufficient Memory')?.[0];
    expect(alert).toBeDefined();
    const loadAnyway = alert.buttons.find((b: any) => b.text === 'Load Anyway');
    loadAnyway.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    // The retry forces past the residency gate with { override: true } — same affordance
    // every other surface uses via the shared helper.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('over-1', undefined, { override: true });
  });

  it('loads model and posts system message when showGenerationDetails=true', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce(null);
    const deps = makeDeps({ activeConversationId: 'conv-1', settings: { showGenerationDetails: true } });
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
    const deps = makeDeps({ activeConversationId: null, settings: { showGenerationDetails: false } });
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
    expect(mockLoadTextModel).toHaveBeenCalledWith('sel-1', undefined, undefined);
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  it('offers the shared Load Anyway override when the loader refuses (not a hard block)', async () => {
    mockGetLoadedModelPath.mockReturnValue(null);
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('Not enough free memory.'));
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
    jest.useFakeTimers();
    // The MEASURED loader refuses (overridable) on the initial attempt.
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));
    mockGetMultimodalSupport.mockReturnValueOnce({ vision: false });

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    // Capture the alert buttons
    const alertCall = deps.setAlertState.mock.calls.find((c: any) => c[0]?.title === 'Insufficient Memory')[0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnywayBtn).toBeDefined();

    // Invoke the onPress callback
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);

    // Advance past the 350ms waitForRenderFrame timeout
    jest.advanceTimersByTime(400);
    await Promise.resolve(); // flush microtasks

    // Retry forces past the residency gate with override:true.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, { override: true });
    jest.useRealTimers();
  });

  it('does not post a system message on the forced load when showGenerationDetails=false', async () => {
    jest.useFakeTimers();
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));
    mockGetMultimodalSupport.mockReturnValueOnce(null);

    const deps = makeDeps({ settings: { showGenerationDetails: false } });
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls.find((c: any) => c[0]?.title === 'Insufficient Memory')[0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();

    jest.advanceTimersByTime(400);
    await Promise.resolve();

    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-1', undefined, { override: true });
    expect(deps.addMessage).not.toHaveBeenCalled(); // showGenerationDetails=false
    jest.useRealTimers();
  });

  it('clears loading state in finally even when the forced load also fails', async () => {
    jest.useFakeTimers();
    mockLoadTextModel.mockRejectedValueOnce(new OverridableMemoryError('OOM'));

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls.find((c: any) => c[0]?.title === 'Insufficient Memory')[0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    mockLoadTextModel.mockRejectedValueOnce(new Error('Load failed'));
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();

    jest.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve(); // extra flush for rejection

    // State cleaned up (setIsModelLoading(false) called in finally)
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true); // set by callback
    jest.useRealTimers();
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

    const alertCall = deps.setAlertState.mock.calls.find((c: any) => c[0]?.title === 'Insufficient Memory')[0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnywayBtn).toBeDefined();

    mockLoadTextModel.mockResolvedValueOnce(undefined);
    deps.setAlertState.mockClear();
    await loadAnywayBtn.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    // Retry forces past the gate with override.
    expect(mockLoadTextModel).toHaveBeenLastCalledWith('model-x', undefined, { override: true });
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
    const deps = makeDeps({ isStreaming: true, settings: { showGenerationDetails: false } });
    await handleUnloadModelFn(deps);
    expect(mockStopGeneration).toHaveBeenCalled();
    expect(deps.clearStreamingMessage).toHaveBeenCalled();
    expect(mockUnloadTextModel).toHaveBeenCalled();
  });

  it('posts system message after unloading when showGenerationDetails=true', async () => {
    mockUnloadTextModel.mockResolvedValueOnce(undefined);
    const model = createDownloadedModel({ name: 'My Model' });
    const deps = makeDeps({ activeModel: model, isStreaming: false, settings: { showGenerationDetails: true } });
    await handleUnloadModelFn(deps);
    expect(deps.addMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ content: expect.stringContaining('My Model'), isSystemInfo: true }),
    );
  });

  it('shows error alert when unload throws', async () => {
    mockUnloadTextModel.mockRejectedValueOnce(new Error('Unload failed'));
    const deps = makeDeps({ isStreaming: false, settings: { showGenerationDetails: false } });
    await handleUnloadModelFn(deps);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });
});
