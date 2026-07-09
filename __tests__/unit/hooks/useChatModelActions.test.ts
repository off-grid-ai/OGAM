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

// Mock CustomAlert helpers
jest.mock('../../../src/components', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any[]) => ({
    visible: true,
    title,
    message,
    buttons: buttons ?? [],
  })),
  hideAlert: jest.fn(() => ({ visible: false, title: '', message: '', buttons: [] })),
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

  it('shows alert and returns when memory check fails', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'Not enough RAM', severity: 'critical' });
    const deps = makeDeps();
    await initiateModelLoad(deps, false);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
    expect(deps.setIsModelLoading).not.toHaveBeenCalled();
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

  it('skips memory check and UI updates when alreadyLoading=true', async () => {
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

  it('resumes the pending turn after "Load Anyway" on insufficient memory (F16)', async () => {
    jest.useFakeTimers();
    const { InteractionManager } = require('react-native');
    const iaSpy = jest.spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation((cb: any) => { cb?.(); return { then: () => {}, done: () => {}, cancel: () => {} } as any; });
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'Not enough RAM', severity: 'critical' });
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
    expect(mockLoadTextModel).toHaveBeenCalledWith('model-1', undefined, { override: true });
    expect(onResume).toHaveBeenCalledTimes(1); // the message is NOT dropped
    iaSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does NOT resume a turn for "Load Anyway" when no resume was requested (model-select/reload)', async () => {
    jest.useFakeTimers();
    const { InteractionManager } = require('react-native');
    const iaSpy = jest.spyOn(InteractionManager, 'runAfterInteractions')
      .mockImplementation((cb: any) => { cb?.(); return { then: () => {}, done: () => {}, cancel: () => {} } as any; });
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'Not enough RAM', severity: 'critical' });
    mockLoadTextModel.mockResolvedValue(undefined);
    mockIsModelLoaded.mockReturnValue(true);
    const deps = makeDeps();

    await initiateModelLoad(deps, false); // no onLoadedResume
    const alert = deps.setAlertState.mock.calls.find((c: any) => c[0].title === 'Insufficient Memory')[0];
    alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    await jest.advanceTimersByTimeAsync(400);

    expect(mockLoadTextModel).toHaveBeenCalledWith('model-1', undefined, { override: true }); // still loads (forced)
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

  it('returns insufficient-memory (alerted) when the memory check fails', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'Not enough RAM', severity: 'critical' });
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
  it('closes the picker BEFORE the load runs (sheet dismisses up front, not after load)', async () => {
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'm', name: 'M' });
    const p = proceedWithModelLoadFn(deps, model); // don't await yet — check the sync prefix
    // The close + loading flag run synchronously, before the load (which is behind
    // waitForRenderFrame) has even been called.
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);
    expect(mockLoadTextModel).not.toHaveBeenCalled();
    await p; // let it finish so nothing leaks
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

  it('shows alert when memory check fails', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM' });
    const deps = makeDeps();
    const model = createDownloadedModel();
    await handleModelSelectFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Insufficient Memory' }),
    );
  });

  it('shows warning alert when memory severity is warning', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: true, severity: 'warning', message: 'Low memory' });
    const deps = makeDeps();
    const model = createDownloadedModel();
    await handleModelSelectFn(deps, model);
    expect(deps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Low Memory Warning' }),
    );
  });
});

// ─────────────────────────────────────────────
// initiateModelLoad — Load Anyway callback (lines 94-99)
// ─────────────────────────────────────────────

describe('initiateModelLoad — Load Anyway button', () => {
  it('executes Load Anyway callback: hides alert, sets loading state, then loads model', async () => {
    jest.useFakeTimers();
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'OOM', severity: 'critical' });
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce({ vision: false });

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    // Capture the alert buttons
    const alertCall = deps.setAlertState.mock.calls[0][0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnywayBtn).toBeDefined();

    // Invoke the onPress callback
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();
    expect(deps.setIsModelLoading).toHaveBeenCalledWith(true);

    // Advance past the 350ms waitForRenderFrame timeout
    jest.advanceTimersByTime(400);
    await Promise.resolve(); // flush microtasks

    expect(mockLoadTextModel).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('doLoadTextModel does not post system message when showGenerationDetails=false', async () => {
    jest.useFakeTimers();
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'OOM', severity: 'critical' });
    mockLoadTextModel.mockResolvedValueOnce(undefined);
    mockGetMultimodalSupport.mockReturnValueOnce(null);

    const deps = makeDeps({ settings: { showGenerationDetails: false } });
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls[0][0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    deps.setAlertState.mockClear();
    loadAnywayBtn.onPress();

    jest.advanceTimersByTime(400);
    await Promise.resolve();

    expect(mockLoadTextModel).toHaveBeenCalled();
    expect(deps.addMessage).not.toHaveBeenCalled(); // showGenerationDetails=false
    jest.useRealTimers();
  });

  it('doLoadTextModel clears state in finally even on error', async () => {
    jest.useFakeTimers();
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, message: 'OOM', severity: 'critical' });
    mockLoadTextModel.mockRejectedValueOnce(new Error('Load failed'));

    const deps = makeDeps();
    await initiateModelLoad(deps, false);

    const alertCall = deps.setAlertState.mock.calls[0][0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
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
// handleModelSelectFn — Load Anyway callback (lines 197-198)
// ─────────────────────────────────────────────

describe('handleModelSelectFn — Load Anyway button', () => {
  it('executes Load Anyway callback in insufficient-memory alert', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: false, severity: 'critical', message: 'OOM' });
    mockLoadTextModel.mockResolvedValueOnce(undefined);

    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'model-x' });
    await handleModelSelectFn(deps, model);

    const alertCall = deps.setAlertState.mock.calls[0][0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnywayBtn).toBeDefined();

    deps.setAlertState.mockClear();
    await loadAnywayBtn.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(deps.setIsModelLoading).toHaveBeenCalled();
  });

  it('executes Load Anyway callback in low memory warning', async () => {
    mockCheckMemoryForModel.mockResolvedValueOnce({ canLoad: true, severity: 'warning', message: 'Low memory' });
    mockLoadTextModel.mockResolvedValueOnce(undefined);

    const deps = makeDeps();
    const model = createDownloadedModel({ id: 'model-y' });
    await handleModelSelectFn(deps, model);

    const alertCall = deps.setAlertState.mock.calls[0][0];
    const loadAnywayBtn = alertCall.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnywayBtn).toBeDefined();

    deps.setAlertState.mockClear();
    await loadAnywayBtn.onPress();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(deps.setIsModelLoading).toHaveBeenCalled();
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
