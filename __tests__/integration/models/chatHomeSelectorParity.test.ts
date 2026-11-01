/**
 * Integration Test: Chat and Home text-model selection PARITY (bug OD3).
 *
 * The bug: chat ran a PREDICTIVE pre-check (`checkMemoryForModel`, estimate =
 * fileSize x 1.5) as a HARD gate and blocked a model behind "Insufficient
 * Memory" BEFORE the measured residency loader ever ran. The Home picker loads
 * straight through the MEASURED residency path (`makeRoomFor`, evict-then-measure
 * against real free RAM), which succeeds. Net: the SAME model was blocked in chat
 * but loaded fine from Home.
 *
 * The fix: both surfaces dispatch to ONE decision — select + load through the
 * measured loader (`activeModelService.loadTextModel`), with the shared
 * "Load Anyway" override affordance (`loadModelWithOverride` / the chat's
 * override retry). The predictive check is no longer a divergent hard gate.
 *
 * These tests drive the REAL activeModelService, llmService, localDreamGenerator,
 * hardwareService, imageModelIntegrity, modelResidencyManager and stores. Only the phone is
 * faked (installNativeBoundary: llama.rn, the image-generation native module, the disk, the
 * RAM sensor). They assert the OUTCOME a user feels: does the model actually load (llama.rn
 * asked to open it, store activeModelId set), and is the residency manager's verdict — not
 * the predictive estimate — what gates it.
 */

import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { createDownloadedModel } from '../../utils/factories';

// waitForRenderFrame uses InteractionManager + setTimeout(350). Flush it fast.
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => { cb(0); return 0; };

/**
 * The OD3 divergence, reproduced deterministically on a 12GB Android device
 * (balanced budget = min(0.70 x 12288, 12288 - 1500) = 8601MB):
 *
 *  - TEXT model: 5GB GGUF -> ~7.5GB estimated (x1.5). ALONE it fits the 8601MB
 *    budget.
 *  - An IMAGE model (3GB) is already resident. The PREDICTIVE pre-check
 *    (`checkMemoryForModel`) adds the image model's memory (getOtherLoadedMemoryGB)
 *    to the text estimate -> total ~7.5 + ~7.5 > 8.6GB -> critical / canLoad:false.
 *    It does NOT evict; it just sums and rejects.
 *  - The MEASURED residency loader (`makeRoomFor`) EVICTS the image model first,
 *    then measures 7.5GB text alone against the budget -> fits. The load succeeds.
 *
 * Same model, blocked by the predictive gate but loaded by the measured loader:
 * the exact OD3 bug.
 */
const TEXT_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const IMAGE_SIZE_BYTES = 3 * 1024 * 1024 * 1024;

let boundary: NativeBoundary;
let activeModelService: any;
let residency: any;
let useAppStore: any;
let handleModelSelectFn: any;
let isOverridableMemoryError: (e: unknown) => boolean;

const appState = () => useAppStore.getState();
/** How many times llama.rn was asked to open a text model. */
const textLoads = () => boundary.llama!.calls.initLlama.filter(p => !p.embedding).length;

/** A downloaded text model: its file on disk and its record added, as a finished download leaves it. */
function addTextModel(id: string, fileSize: number) {
  const filePath = `${boundary.fs!.DocumentDirectoryPath}/models/${id}.gguf`;
  boundary.fs!.seedFile(filePath, fileSize);
  const model = createDownloadedModel({ id, engine: 'llama' as any, filePath, fileName: `${id}.gguf`, fileSize });
  appState().addDownloadedModel(model);
  return model;
}

/** Load an image model so it's genuinely resident (the co-resident the pre-check counts). */
async function makeImageResident(id = 'img-resident') {
  const { modelManager } = require('../../../src/services/modelManager');
  const modelPath = `${modelManager.getImageModelsDirectory()}/${id}`;
  for (const name of SD_MNN_PACKAGE_FILES) boundary.fs!.seedFile(`${modelPath}/${name}`, 1024 * 1024);
  const imageModel = { id, name: 'Resident Image', description: '', size: IMAGE_SIZE_BYTES, modelPath, backend: 'mnn' };
  await modelManager.addDownloadedImageModel(imageModel);
  appState().addDownloadedImageModel(imageModel);
  appState().updateSettings({ imageThreads: 4 } as never);
  await activeModelService.loadImageModel(id);
  expect(residency.isResident('image')).toBe(true);
  return imageModel;
}

function makeChatDeps(model: any, overrides: Record<string, unknown> = {}) {
  return {
    activeModel: model,
    activeModelId: model.id,
    activeConversationId: 'conv-1',
    isStreaming: false,
    settings: { showGenerationDetails: false },
    clearStreamingMessage: jest.fn(),
    createConversation: jest.fn(() => 'new-conv'),
    addMessage: jest.fn(),
    setIsModelLoading: jest.fn(),
    setLoadingModel: jest.fn(),
    setSupportsVision: jest.fn(),
    setShowModelSelector: jest.fn(),
    setAlertState: jest.fn(),
    modelLoadStartTimeRef: { current: null as number | null },
    ...overrides,
  } as any;
}

describe('Chat <-> Home text-model selection parity (OD3)', () => {
  beforeEach(async () => {
    // A 12GB Android phone with plenty of REAL free RAM, so the measured GGUF load (bounded by the
    // physical cap for clean mmap weights) fits once the image model is evicted.
    boundary = installNativeBoundary({
      llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 10 * GB },
    });
    ({ activeModelService } = require('../../../src/services/activeModelService'));
    ({ modelResidencyManager: residency } = require('../../../src/services/modelResidency'));
    ({ useAppStore } = require('../../../src/stores'));
    ({ handleModelSelectFn } = require('../../../src/screens/ChatScreen/useChatModelActions'));
    ({ isOverridableMemoryError } = require('../../../src/services/modelLoadErrors'));
    await require('../../../src/services/hardware').hardwareService.refreshMemoryInfo();
    residency.setLoadPolicy('balanced');
  });

  /** Sanity: with the image model co-resident, the predictive pre-check REJECTS
   *  the text model (the divergence exists). */
  it('the predictive checkMemoryForModel rejects the text model while an image model is resident (the divergence)', async () => {
    await makeImageResident();
    addTextModel('txt', TEXT_FILE_BYTES);

    const check = await activeModelService.checkMemoryForModel('txt', 'text');
    expect(check.canLoad).toBe(false);
    expect(check.severity).toBe('critical');
    // It counted the resident image model — that's why it over-counts and blocks.
    expect(check.currentlyLoadedMemoryGB).toBeGreaterThan(0);
  });

  /**
   * HOME path: selecting on Home only MARKS the model active; the load is deferred
   * to the first chat message and goes straight through the MEASURED loader. The
   * measured loader EVICTS the image model, then fits the text model — succeeding
   * for the exact model the pre-check rejected.
   */
  it('HOME: the measured loader evicts the image model and loads the text model the pre-check rejected', async () => {
    await makeImageResident();
    addTextModel('txt', TEXT_FILE_BYTES);

    await activeModelService.loadTextModel('txt');

    expect(textLoads()).toBe(1);
    expect(appState().activeModelId).toBe('txt');
    expect(residency.isResident('text')).toBe(true);
    // The image model was evicted to make room (evict-then-measure): the image engine unloaded it.
    expect(residency.isResident('image')).toBe(false);
    expect(boundary.diffusion.module.unloadModel).toHaveBeenCalled();
  });

  /**
   * CHAT selection stays cheap. The first turn then uses the same measured
   * residency loader as every other path.
   */
  it('CHAT: selection waits for first use before loading and evicting another model', async () => {
    await makeImageResident();
    const text = addTextModel('txt', TEXT_FILE_BYTES);
    const deps = makeChatDeps(text);

    await handleModelSelectFn(deps, text);
    expect(appState().activeModelId).toBe('txt');
    expect(textLoads()).toBe(0);
    expect(residency.isResident('image')).toBe(true);

    await activeModelService.loadTextModel('txt');
    expect(textLoads()).toBe(1);
    expect(residency.isResident('text')).toBe(true);
    expect(residency.isResident('image')).toBe(false);
  });

  /**
   * FALSE branch — a genuinely-too-big model. Even the MEASURED loader can't fit
   * it (its estimate exceeds the physical-cap budget), so it must be refused with
   * the SAME overridable "Load Anyway" affordance, not silently loaded.
   */
  it('FALSE branch: a model too big even for the measured loader is refused (overridable) — not loaded', async () => {
    // 8GB file -> ~12GB estimated (x1.5) > the 8601MB budget. Refused even alone.
    addTextModel('too-big', 8 * GB);

    // Measured loader refuses with an OverridableMemoryError, and the native load
    // never runs (assert the CONSEQUENCE of the verdict, not that a gate was called).
    let caught: unknown;
    await activeModelService.loadTextModel('too-big').catch((e: unknown) => { caught = e; });
    expect(isOverridableMemoryError(caught)).toBe(true);
    expect(textLoads()).toBe(0);
    expect(residency.isResident('text')).toBe(false);
  });

  /**
   * Already-loaded fast path — re-selecting the loaded model must NOT reload it
   * from chat (the immediate no-op close).
   */
  it('already-loaded fast path: re-selecting the loaded model does not reload it', async () => {
    const model = addTextModel('loaded', TEXT_FILE_BYTES);
    await activeModelService.loadTextModel('loaded');
    expect(textLoads()).toBe(1);

    // Chat: the model whose filePath is already the loaded path → immediate no-op.
    const deps = makeChatDeps(model);
    await handleModelSelectFn(deps, model);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(textLoads()).toBe(1);
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  /**
   * Override parity: when the measured loader refuses the too-big model, loading
   * again with { override: true } forces past the refusal and the model loads —
   * the same affordance both surfaces offer via the shared override helper.
   */
  it('override parity: Load Anyway retries with override and the model loads', async () => {
    addTextModel('force', 8 * GB);

    // First attempt: refused, overridable, native load NOT called.
    let caught: unknown;
    await activeModelService.loadTextModel('force').catch((e: unknown) => { caught = e; });
    expect(isOverridableMemoryError(caught)).toBe(true);
    expect(textLoads()).toBe(0);

    // Load Anyway → override forces past the refusal (10GB real free RAM stays
    // above the survival floor).
    await activeModelService.loadTextModel('force', undefined, { override: true });
    expect(textLoads()).toBe(1);
    expect(appState().activeModelId).toBe('force');
  });
});
