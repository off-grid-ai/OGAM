/**
 * useChatModelActions — the chat screen's model actions: loading the chosen model (with the "Load Anyway"
 * memory override and its typed outcomes), making sure a model is ready before a turn, picking a model,
 * and unloading.
 *
 * Real: the actions, activeModelService (loads and unloads through the residency lock and its memory
 * budget), llmService, liteRTService, generationService, the chat and app stores, the alert builder.
 * Faked (device, harness/generationDevice): llama.rn, the LiteRT native module, the filesystem, RAM. The
 * setters are the screen's own state setters, passed in; the chat writes go to the real chat store.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { GB } from '../../harness/nativeBoundary';

let d: GenerationDevice;
let actions: typeof import('../../../src/screens/ChatScreen/useChatModelActions');

// waitForRenderFrame waits one animation frame and the interaction queue; the jest renderer has neither.
(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => { cb(0); return 0; };

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

async function phone(opts: Parameters<typeof launchGeneration>[0] = {}) {
  d = await launchGeneration(opts);
  // The interaction queue (react-native, not ours) runs its task at once, so the 350 ms frame wait is a timer.
  const { InteractionManager } = require('react-native');
  InteractionManager.runAfterInteractions = (cb: () => void) => {
    cb();
    return { then: (r?: () => void) => r?.(), done: () => {}, cancel: () => {} };
  };
  actions = require('../../../src/screens/ChatScreen/useChatModelActions');
}

/** The chat screen's state, as the actions set it, over the real chat store. */
function screen(overrides: Record<string, unknown> = {}) {
  const s = {
    loading: [] as boolean[], vision: [] as boolean[], alert: null as any, selectorOpen: 'unset' as unknown,
    loadingModel: [] as unknown[], streamCleared: 0,
  };
  const state = d.useAppStore.getState();
  const deps: any = {
    activeModel: state.downloadedModels.find((m: any) => m.id === state.activeModelId),
    activeModelId: state.activeModelId,
    activeConversationId: d.conversationId,
    isStreaming: false,
    settings: { showGenerationDetails: true },
    clearStreamingMessage: () => { s.streamCleared += 1; d.useChatStore.getState().clearStreamingMessage(); },
    createConversation: d.useChatStore.getState().createConversation,
    addMessage: d.useChatStore.getState().addMessage,
    setIsModelLoading: (v: boolean) => s.loading.push(v),
    setLoadingModel: (m: unknown) => s.loadingModel.push(m),
    setSupportsVision: (v: boolean) => s.vision.push(v),
    setShowModelSelector: (v: unknown) => { s.selectorOpen = v; },
    setAlertState: (a: any) => { s.alert = a; },
    modelLoadStartTimeRef: { current: null },
    ...overrides,
  };
  return { s, deps };
}

const systemInfo = () => d.thread().filter((m: any) => m.isSystemInfo).map((m: any) => m.content);
const opened = () => d.boundary.llama!.calls.initLlama.filter(p => !p.embedding);
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 450)); // the 350 ms frame wait, then the load
/** A 40 GB model on a 12 GB phone: the memory budget refuses it, and "Load Anyway" can force it. */
const tooBig = { load: false, modelFileSizeBytes: 40 * GB };

describe('initiateModelLoad', () => {
  it('reports no-model-selected and loads nothing without a chosen model', async () => {
    await phone({ load: false });
    const { deps } = screen({ activeModel: undefined, activeModelId: null });

    expect(await actions.initiateModelLoad(deps, false)).toEqual({ ok: false, reason: 'no-model-selected' });
    expect(opened()).toHaveLength(0);
  });

  it('loads the model, shows the loading state, and posts the load time in the chat', async () => {
    await phone({ load: false });
    const { s, deps } = screen();

    const outcome = await actions.initiateModelLoad(deps, false);

    expect(outcome).toEqual(expect.objectContaining({ ok: true }));
    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(s.loading[0]).toBe(true);
    expect(s.loading.at(-1)).toBe(false);
    expect(s.vision.at(-1)).toBe(false); // this model has no projector
    expect(systemInfo()).toEqual([expect.stringContaining('Test Model')]);
  });

  it('when already loading, loads without touching the loading state', async () => {
    await phone({ load: false });
    const { s, deps } = screen();

    await actions.initiateModelLoad(deps, true);

    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(s.loading).toEqual([]);
  });

  it('a memory refusal shows "Insufficient Memory" and reports insufficient-memory', async () => {
    await phone(tooBig);
    const { s, deps } = screen();

    const outcome = await actions.initiateModelLoad(deps, false);

    expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'insufficient-memory', alerted: true }));
    expect(s.alert).toEqual(expect.objectContaining({ visible: true, title: 'Insufficient Memory' }));
    expect(s.alert.buttons.map((b: any) => b.text)).toContain('Load Anyway');
    expect(opened()).toHaveLength(0);
  });

  it('"Load Anyway" forces the load past the budget and resumes the waiting turn (F16)', async () => {
    await phone(tooBig);
    const { s, deps } = screen();
    let resumed = 0;
    await actions.initiateModelLoad(deps, false, () => { resumed += 1; });

    s.alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    expect(s.loading.at(-1)).toBe(true);
    await settle();

    expect(d.llmService.isModelLoaded()).toBe(true); // "Load Anyway did nothing" was the bug
    expect(resumed).toBe(1); // the waiting message is not dropped
    expect(s.loading.at(-1)).toBe(false);
  });

  it('"Load Anyway" with no waiting turn still loads, and resumes nothing', async () => {
    await phone(tooBig);
    const { s, deps } = screen({ settings: { showGenerationDetails: false } });
    await actions.initiateModelLoad(deps, false);

    s.alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    await settle();

    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(systemInfo()).toEqual([]); // no load-time message with details off
  });

  it('clears the loading state when the forced load fails too', async () => {
    await phone(tooBig);
    const { s, deps } = screen();
    await actions.initiateModelLoad(deps, false);
    d.boundary.llama!.scriptInitFailure(true);

    s.alert.buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    await settle();

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(s.loading.at(-1)).toBe(false);
  });

  it('a native load failure shows "Error" and reports load-threw', async () => {
    await phone({ load: false });
    d.boundary.llama!.scriptInitFailure(true);
    const { s, deps } = screen();

    const outcome = await actions.initiateModelLoad(deps, false);

    expect(outcome).toEqual(expect.objectContaining({ ok: false, alerted: true, detail: expect.stringContaining('unsupported architecture') }));
    expect(s.alert).toEqual(expect.objectContaining({ title: 'Error', message: expect.stringContaining('Failed to load model') }));
    expect(d.llmService.isModelLoaded()).toBe(false);
  });

  it('when already loading, reports a failure without an alert (it used to vanish silently)', async () => {
    await phone({ load: false });
    d.boundary.llama!.scriptInitFailure(true);
    const { s, deps } = screen();

    const outcome = await actions.initiateModelLoad(deps, true);

    expect(outcome).toEqual(expect.objectContaining({ ok: false, alerted: false, detail: expect.stringContaining('unsupported architecture') }));
    expect(s.alert).toBeNull();
  });

  it('reports not-downloaded for a model that is no longer on the phone', async () => {
    await phone({ load: false });
    const ghost = { ...d.useAppStore.getState().downloadedModels[0], id: 'ghost' };
    const { deps } = screen({ activeModel: ghost, activeModelId: 'ghost' });

    expect(await actions.initiateModelLoad(deps, true)).toMatchObject({ ok: false, reason: 'not-downloaded' });
  });
});

describe('ensureModelLoadedFn', () => {
  it('reports no-model-selected without a chosen model', async () => {
    await phone({ load: false });
    const { deps } = screen({ activeModel: undefined, activeModelId: null });

    expect(await actions.ensureModelLoadedFn(deps)).toEqual({ ok: false, reason: 'no-model-selected' });
  });

  it('is ok at once when the chosen llama model is loaded', async () => {
    await phone();
    const { deps } = screen();

    expect(await actions.ensureModelLoadedFn(deps)).toEqual({ ok: true });
    expect(opened()).toHaveLength(1); // the launch load only
  });

  it('loads the chosen model when it is not loaded, and reports a native failure', async () => {
    await phone({ load: false });
    d.boundary.llama!.scriptInitFailure(true);
    const { deps } = screen();

    expect(await actions.ensureModelLoadedFn(deps)).toMatchObject({ ok: false, detail: expect.stringContaining('unsupported architecture') });
    expect(d.llmService.isModelLoaded()).toBe(false);
  });

  it('is ok at once when the chosen LiteRT model is loaded, with vision from its flag', async () => {
    await phone({ engine: 'litert', liteRTVision: true });
    const loads = d.boundary.litert.calls.loadModel.length;
    const { s, deps } = screen();

    expect(await actions.ensureModelLoadedFn(deps)).toEqual({ ok: true });
    expect(d.boundary.litert.calls.loadModel).toHaveLength(loads);
    expect(s.vision).toContain(true);
  });

  it('loads the chosen LiteRT model when it is not loaded', async () => {
    await phone({ engine: 'litert', load: false });
    const { deps } = screen();

    expect(await actions.ensureModelLoadedFn(deps)).toEqual(expect.objectContaining({ ok: true }));
    expect(d.boundary.litert.calls.loadModel).toHaveLength(1);
    expect(d.liteRTService.isModelLoaded()).toBe(true);
  });

  it('reloads a loaded model whose projector arrived after it loaded, so it comes back with vision (vision repair)', async () => {
    await phone(); // loaded text-only: no projector on the phone yet
    expect(d.llmService.getMultimodalSupport()?.vision ?? false).toBe(false);
    // The vision repair download lands the projector and links it to the model.
    const m = d.useAppStore.getState().downloadedModels[0];
    const projector = `${m.filePath.slice(0, m.filePath.lastIndexOf('/'))}/m-mmproj-f16.gguf`;
    d.boundary.fs!.seedFile(projector, 1024);
    d.useAppStore.getState().setDownloadedModels([{ ...m, mmProjPath: projector, mmProjFileName: 'm-mmproj-f16.gguf', isVisionModel: true }]);
    // This projector starts natively.
    d.nativeContext()!.initMultimodal.mockResolvedValue(true);
    d.nativeContext()!.getMultimodalSupport.mockResolvedValue({ vision: true, audio: false });
    const { s, deps } = screen();

    expect(await actions.ensureModelLoadedFn(deps)).toEqual({ ok: true });

    expect(opened()).toHaveLength(2); // reloaded, not stopped at "already loaded"
    expect(d.nativeContext()!.initMultimodal).toHaveBeenCalledWith(expect.objectContaining({ path: projector }));
    expect(d.llmService.getMultimodalSupport()?.vision).toBe(true);
    expect(s.vision.at(-1)).toBe(true);
  });
});

describe('handleModelSelectFn', () => {
  it('chooses the model and closes the picker without loading it', async () => {
    await phone({ load: false, extraModels: [{ id: 'sel-1', name: 'Other' }] });
    const { s, deps } = screen();

    await actions.handleModelSelectFn(deps, d.useAppStore.getState().downloadedModels.find((m: any) => m.id === 'sel-1'));

    expect(d.useAppStore.getState().activeModelId).toBe('sel-1');
    expect(s.selectorOpen).toBe(false);
    expect(opened()).toHaveLength(0);
  });
});

describe('handleUnloadModelFn', () => {
  it('stops a reply that is streaming, then unloads', async () => {
    await phone();
    d.boundary.llama!.scriptCompletion({ text: 'one two three', pauseAfter: 'one' });
    const reply = d.generationService.generateResponse(d.conversationId, d.ask('hi'));
    const deadline = Date.now() + 3000;
    while (d.useChatStore.getState().streamingMessage !== 'one') {
      if (Date.now() > deadline) throw new Error('the reply never streamed');
      await new Promise(r => setTimeout(r, 5));
    }
    const { s, deps } = screen({ isStreaming: true, settings: { showGenerationDetails: false } });

    await actions.handleUnloadModelFn(deps);
    await reply;

    expect(d.nativeContext()!.stopCompletion).toHaveBeenCalled();
    expect(s.streamCleared).toBe(1);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.llmService.isModelLoaded()).toBe(false);
  });

  it('unloads, says so in the chat, and leaves the loading state clear', async () => {
    await phone();
    const { s, deps } = screen();

    await actions.handleUnloadModelFn(deps);

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(d.useAppStore.getState().activeModelId).toBeNull();
    expect(systemInfo()).toEqual([expect.stringContaining('Model unloaded: Test Model')]);
    expect(s.vision.at(-1)).toBe(false);
    expect(s.loading).toEqual([true, false]);
    expect(s.selectorOpen).toBe(false);
    expect(s.alert).toBeNull();
  });
});
