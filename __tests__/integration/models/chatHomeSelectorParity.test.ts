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
 * These tests drive the REAL activeModelService + REAL modelResidencyManager +
 * REAL store, mocking ONLY the native boundaries (llm/hardware). They assert the
 * OUTCOME a user feels: does the model actually load (native loadModel called,
 * store activeModelId set), and is the residency manager's verdict — not the
 * predictive estimate — what gates it.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { llmService } from '../../../src/services/llm';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { hardwareService } from '../../../src/services/hardware';
import { isOverridableMemoryError } from '../../../src/services/modelLoadErrors';
import { resetStores, getAppState } from '../../utils/testHelpers';
import { createDownloadedModel, createONNXImageModel, createDeviceInfo } from '../../utils/factories';

// Import the REAL chat + Home selection entry points (only their alert/UI setters mocked).
import { handleModelSelectFn } from '../../../src/screens/ChatScreen/useChatModelActions';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/hardware');
jest.mock('../../../src/utils/imageModelIntegrity', () => ({
  validateImageModelDir: jest.fn(async () => ({ complete: true, missing: [] })),
  ensureImageExtractionComplete: jest.fn(async () => {}),
}));

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockHardwareService = hardwareService as jest.Mocked<typeof hardwareService>;

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

function setOD3Device() {
  mockHardwareService.getDeviceInfo.mockResolvedValue(
    createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
  );
  mockHardwareService.refreshMemoryInfo.mockResolvedValue({
    totalMemory: 12 * 1024 * 1024 * 1024,
    usedMemory: 2 * 1024 * 1024 * 1024,
    availableMemory: 10 * 1024 * 1024 * 1024,
  } as any);
  mockHardwareService.getTotalMemoryGB.mockReturnValue(12);
  // Plenty of REAL free RAM so the measured GGUF load (bounded by the physical
  // cap for clean mmap weights) fits once the image model is evicted.
  mockHardwareService.getAvailableMemoryGB.mockReturnValue(10);
  mockHardwareService.estimateImageModelRam.mockImplementation(
    (m: any) => (m?.size || 0) * 2.5,
  );
  mockHardwareService.preferGpuForImageGen.mockReturnValue(false);
  mockHardwareService.getSoCInfo.mockResolvedValue({ hasNPU: false } as any);
}

/** Load an image model so it's genuinely resident (the co-resident the pre-check counts). */
async function makeImageResident(id = 'img-resident') {
  const imageModel = createONNXImageModel({ id, size: IMAGE_SIZE_BYTES });
  useAppStore.setState({
    downloadedImageModels: [imageModel],
    settings: { imageThreads: 4 } as any,
  });
  mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
  mockLocalDreamService.loadModel.mockResolvedValue(true);
  mockLocalDreamService.unloadModel.mockResolvedValue(true);
  await activeModelService.loadImageModel(id);
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
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();
    modelResidencyManager.setLoadPolicy('balanced');

    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockLlmService.loadModel.mockResolvedValue(undefined);
    mockLlmService.unloadModel.mockResolvedValue(undefined);
    mockLlmService.getMultimodalSupport.mockReturnValue(null as any);

    mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

    mockHardwareService.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * mult,
    );
    mockHardwareService.getModelTotalSize.mockImplementation(
      (m: any) => (m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0),
    );
    setOD3Device();

    await activeModelService.syncWithNativeState();
  });

  /** Sanity: with the image model co-resident, the predictive pre-check REJECTS
   *  the text model (the divergence exists). */
  it('the predictive checkMemoryForModel rejects the text model while an image model is resident (the divergence)', async () => {
    await makeImageResident();
    const text = createDownloadedModel({ id: 'txt', engine: 'llama' as any, fileSize: TEXT_FILE_BYTES });
    useAppStore.setState({
      ...useAppStore.getState(),
      downloadedModels: [text],
    });

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
    const text = createDownloadedModel({ id: 'txt', engine: 'llama' as any, fileSize: TEXT_FILE_BYTES });
    useAppStore.setState({ ...useAppStore.getState(), downloadedModels: [text] });
    mockLlmService.isModelLoaded.mockReturnValue(true);

    await activeModelService.loadTextModel('txt');

    expect(mockLlmService.loadModel).toHaveBeenCalled();
    expect(getAppState().activeModelId).toBe('txt');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    // The image model was evicted to make room (evict-then-measure).
    expect(modelResidencyManager.isResident('image')).toBe(false);
    expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
  });

  /**
   * CHAT path (the bug): selecting the SAME model in chat must ALSO load it — not
   * dead-end behind the predictive "Insufficient Memory" gate. Assert the OUTCOME:
   * the native loadModel ran and the model is resident, identical to Home.
   */
  it('CHAT: selecting the same text model loads it too — no divergent predictive block (OD3)', async () => {
    await makeImageResident();
    const text = createDownloadedModel({ id: 'txt', engine: 'llama' as any, fileSize: TEXT_FILE_BYTES });
    useAppStore.setState({ ...useAppStore.getState(), downloadedModels: [text] });
    mockLlmService.isModelLoaded.mockReturnValue(true);
    const deps = makeChatDeps(text);

    await handleModelSelectFn(deps, text);
    // handleModelSelectFn dispatches the load behind waitForRenderFrame; flush it.
    await new Promise(resolve => setTimeout(resolve, 400));

    // The load actually happened — same outcome as Home.
    expect(mockLlmService.loadModel).toHaveBeenCalled();
    expect(getAppState().activeModelId).toBe('txt');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    // And it was NOT blocked by a hard "Insufficient Memory" gate before loading.
    const blocked = deps.setAlertState.mock.calls.find(
      (c: any) => c[0]?.title === 'Insufficient Memory',
    );
    expect(blocked).toBeUndefined();
  });

  /**
   * FALSE branch — a genuinely-too-big model. Even the MEASURED loader can't fit
   * it (its estimate exceeds the physical-cap budget), so it must be refused with
   * the SAME overridable "Load Anyway" affordance, not silently loaded.
   */
  it('FALSE branch: a model too big even for the measured loader is refused (overridable) — not loaded', async () => {
    // 8GB file -> ~12GB estimated (x1.5) > the 8601MB budget. Refused even alone.
    const model = createDownloadedModel({ id: 'too-big', engine: 'llama' as any, fileSize: 8 * 1024 * 1024 * 1024 });
    useAppStore.setState({ downloadedModels: [model] });

    // Measured loader refuses with an OverridableMemoryError, and the native load
    // never runs (assert the CONSEQUENCE of the verdict, not that a gate was called).
    let caught: unknown;
    await activeModelService.loadTextModel('too-big').catch((e: unknown) => { caught = e; });
    expect(isOverridableMemoryError(caught)).toBe(true);
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('text')).toBe(false);
  });

  /**
   * Already-loaded fast path — re-selecting the loaded model must NOT reload it
   * from chat (the immediate no-op close).
   */
  it('already-loaded fast path: re-selecting the loaded model does not reload it', async () => {
    const model = createDownloadedModel({ id: 'loaded', engine: 'llama' as any, filePath: '/loaded.gguf', fileSize: TEXT_FILE_BYTES });
    useAppStore.setState({ downloadedModels: [model] });
    mockLlmService.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel('loaded');
    mockLlmService.loadModel.mockClear();

    // Chat: the model whose filePath is already the loaded path → immediate no-op.
    mockLlmService.getLoadedModelPath.mockReturnValue('/loaded.gguf');
    const deps = makeChatDeps(model);
    await handleModelSelectFn(deps, model);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    expect(deps.setShowModelSelector).toHaveBeenCalledWith(false);
  });

  /**
   * Override parity: when the measured loader refuses the too-big model, loading
   * again with { override: true } forces past the refusal and the model loads —
   * the same affordance both surfaces offer via the shared override helper.
   */
  it('override parity: Load Anyway retries with override and the model loads', async () => {
    const model = createDownloadedModel({ id: 'force', engine: 'llama' as any, fileSize: 8 * 1024 * 1024 * 1024 });
    useAppStore.setState({ downloadedModels: [model] });
    mockLlmService.isModelLoaded.mockReturnValue(true);

    // First attempt: refused, overridable, native load NOT called.
    let caught: unknown;
    await activeModelService.loadTextModel('force').catch((e: unknown) => { caught = e; });
    expect(isOverridableMemoryError(caught)).toBe(true);
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();

    // Load Anyway → override forces past the refusal (10GB real free RAM stays
    // above the survival floor).
    await activeModelService.loadTextModel('force', undefined, { override: true });
    expect(mockLlmService.loadModel).toHaveBeenCalled();
    expect(getAppState().activeModelId).toBe('force');
  });
});
