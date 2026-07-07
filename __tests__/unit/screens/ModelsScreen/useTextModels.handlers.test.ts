/**
 * useTextModels.handlers.test.ts
 *
 * Unit tests for handler functions in useTextModels that are not covered by
 * the trending-selection or ModelsScreen integration tests:
 * - handleCancelDownload
 * - handleDeleteModel (model-not-found and active-model paths)
 * - runSearch error path
 * - runSearch with code type and no query (CODE_FALLBACK_QUERY)
 */

import { renderHook, act } from '@testing-library/react-native';
import { useTextModels } from '../../../../src/screens/ModelsScreen/useTextModels';

// ── Navigation ────────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useFocusEffect: jest.fn((cb: () => () => void) => { cb(); }),
}));

// ── Acceleration predicate (deterministic per-id verdict for the resort test) ──
// Keep the real module's other exports; only make modelSupportsNpuGpu controllable
// so we can assert the "float accelerable models to the top" ordering deterministically.
jest.mock('../../../../src/utils/acceleration', () => ({
  ...jest.requireActual('../../../../src/utils/acceleration'),
  modelSupportsNpuGpu: (m: { id?: string }) => ((m?.id?.charCodeAt(0) ?? 1) % 2 === 0),
}));

// ── App store ─────────────────────────────────────────────────────────
const mockAddDownloadedModel = jest.fn();
const mockRemoveDownloadedModel = jest.fn();
const mockSetDownloadedModels = jest.fn();
const mockDownloads: Record<string, any> = {};

const mockStoreState: any = {
  downloadedModels: [],
  setDownloadedModels: mockSetDownloadedModels,
  addDownloadedModel: mockAddDownloadedModel,
  removeDownloadedModel: mockRemoveDownloadedModel,
  activeModelId: null,
};

jest.mock('../../../../src/stores', () => ({
  useAppStore: jest.fn(() => mockStoreState),
}));

jest.mock('../../../../src/stores/downloadStore', () => ({
  useDownloadStore: Object.assign(
    jest.fn((selector?: any) => selector ? selector({ downloads: mockDownloads }) : { downloads: mockDownloads }),
    {
      getState: () => ({
        downloads: mockDownloads,
        // startModelDownload publishes a queued 'pending' row up-front; mirror the real
        // store's add (refuses a duplicate modelKey) so the shared download action runs.
        add: (entry: any) => { if (!mockDownloads[entry.modelKey]) mockDownloads[entry.modelKey] = entry; },
        remove: (modelKey: string) => { delete mockDownloads[modelKey]; },
        setStatus: jest.fn(),
      }),
    },
  ),
  isActiveStatus: (status: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(status),
}));

// ── Services ──────────────────────────────────────────────────────────
const mockSearchModels = jest.fn((_query: string, _opts?: any) => Promise.resolve([]));
const mockCancelBackgroundDownload = jest.fn((_id: number) => Promise.resolve());
const mockDeleteModel = jest.fn((_id: string) => Promise.resolve());
const mockUnloadTextModel = jest.fn(() => Promise.resolve());
const mockGetDownloadedModels = jest.fn(() => Promise.resolve([]));

jest.mock('../../../../src/services', () => ({
  huggingFaceService: {
    searchModels: (query: string, opts?: any) => mockSearchModels(query, opts),
    getModelDetails: jest.fn(() => Promise.reject(new Error('not found'))),
    getModelFiles: jest.fn(() => Promise.resolve([])),
  },
  modelManager: {
    getDownloadedModels: () => mockGetDownloadedModels(),
    downloadModelBackground: jest.fn(),
    watchDownload: jest.fn(),
    cancelBackgroundDownload: (id: number) => mockCancelBackgroundDownload(id),
    repairMmProj: jest.fn(),
    deleteModel: (id: string) => mockDeleteModel(id),
  },
  hardwareService: {
    getTotalMemoryGB: jest.fn(() => 8),
    getModelRecommendation: jest.fn(() => ({ maxParameters: 8 })),
  },
  activeModelService: {
    unloadTextModel: () => mockUnloadTextModel(),
  },
}));

// ── Alert ─────────────────────────────────────────────────────────────
const mockShowAlert = jest.fn((title: string, message: string) => ({ title, message, visible: true }));
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: (title: string, message: string) => mockShowAlert(title, message),
  initialAlertState: { title: '', message: '', visible: false },
}));

// ─────────────────────────────────────────────────────────────────────

const setAlertState = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.downloadedModels = [];
  mockStoreState.activeModelId = null;
  Object.keys(mockDownloads).forEach(k => delete mockDownloads[k]);
  const { useAppStore } = jest.requireMock('../../../../src/stores') as any;
  useAppStore.getState = () => mockStoreState;
});

// ── handleCancelDownload ──────────────────────────────────────────────

describe('handleCancelDownload', () => {
  it('calls cancelBackgroundDownload when a downloadId exists for the key', async () => {
    const { result } = renderHook(() => useTextModels(setAlertState));

    // Seed a download in progress by calling handleDownload first (mock resolves immediately)
    const mockFile = { name: 'model.gguf', size: 1000, quantization: 'Q4_K_M', downloadUrl: 'http://x' };
    const mockModel = { id: 'org/repo', name: 'Test', author: 'org', description: '', downloads: 0, likes: 0, tags: [], lastModified: '', files: [] };

    const { modelManager: mm } = jest.requireMock('../../../../src/services');
    mm.downloadModelBackground.mockResolvedValueOnce({ downloadId: 99 });

    await act(async () => {
      await result.current.handleDownload(mockModel as any, mockFile as any);
    });

    mockDownloads['org/repo/model.gguf'] = {
      downloadId: 99,
      modelKey: 'org/repo/model.gguf',
      status: 'running',
    };

    await act(async () => {
      await result.current.handleCancelDownload('org/repo/model.gguf');
    });

    expect(mockCancelBackgroundDownload).toHaveBeenCalledWith(99);
  });

  it('clears downloadProgress without calling cancelBackgroundDownload when no downloadId', async () => {
    const { result } = renderHook(() => useTextModels(setAlertState));

    // Call cancel for a key that was never started
    await act(async () => {
      await result.current.handleCancelDownload('nonexistent/key.gguf');
    });

    expect(mockCancelBackgroundDownload).not.toHaveBeenCalled();
  });
});

// ── handleDeleteModel ─────────────────────────────────────────────────

describe('handleDeleteModel', () => {
  it('does nothing when model is not in downloadedModels', async () => {
    mockStoreState.downloadedModels = [];

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleDeleteModel('org/missing-model');
    });

    expect(mockDeleteModel).not.toHaveBeenCalled();
    expect(mockUnloadTextModel).not.toHaveBeenCalled();
  });

  it('unloads the active model before deleting when it is active', async () => {
    const model = { id: 'org/active-model', name: 'Active', fileName: 'active.gguf', filePath: '/path', fileSize: 1000, quantization: 'Q4_K_M', downloadedAt: '' };
    mockStoreState.downloadedModels = [model];
    mockStoreState.activeModelId = 'org/active-model';

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleDeleteModel('org/active-model');
    });

    expect(mockUnloadTextModel).toHaveBeenCalled();
    expect(mockDeleteModel).toHaveBeenCalledWith('org/active-model');
  });

  it('deletes without unloading when model is not active', async () => {
    const model = { id: 'org/inactive-model', name: 'Inactive', fileName: 'inactive.gguf', filePath: '/path', fileSize: 1000, quantization: 'Q4_K_M', downloadedAt: '' };
    mockStoreState.downloadedModels = [model];
    mockStoreState.activeModelId = 'org/some-other-model';

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleDeleteModel('org/inactive-model');
    });

    expect(mockUnloadTextModel).not.toHaveBeenCalled();
    expect(mockDeleteModel).toHaveBeenCalledWith('org/inactive-model');
  });
});

// ── runSearch error path ──────────────────────────────────────────────

describe('runSearch', () => {
  it('shows a Search Error alert when searchModels rejects', async () => {
    mockSearchModels.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      await result.current.handleSearch();
      // handleSearch calls runSearch directly — but needs a non-empty query
      // Set query first so runSearch doesn't short-circuit
    });

    // handleSearch with empty query returns early — trigger search via handleSelectModel-like path
    // Instead, call handleSearch after setting query
    await act(async () => {
      result.current.setSearchQuery('llama');
    });

    // Wait for debounce (500ms) + async resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 600));
    });

    expect(setAlertState).toHaveBeenCalled();
    expect(mockShowAlert).toHaveBeenCalledWith('Search Error', expect.stringContaining('Failed to search'));
  });

  it('uses CODE_FALLBACK_QUERY when type=code and query is empty', async () => {
    mockSearchModels.mockResolvedValue([]);

    const { result } = renderHook(() => useTextModels(setAlertState));

    await act(async () => {
      result.current.setTypeFilter('code');
      await new Promise(r => setTimeout(r, 100));
    });

    expect(mockSearchModels).toHaveBeenCalledWith(
      'coder',
      expect.objectContaining({}),
    );
  });
});

// ── handleSelectModel ────────────────────────────────────────────────

describe('handleSelectModel', () => {
  it('short-circuits HF fetch when model id is in the offgrid/ namespace and ships files', async () => {
    const { huggingFaceService } = jest.requireMock('../../../../src/services');
    const getModelFilesSpy = jest.spyOn(huggingFaceService, 'getModelFiles');
    const { result } = renderHook(() => useTextModels(setAlertState));

    const curatedFile = { name: 'gemma-4-E2B-it.litertlm', size: 1000, quantization: 'mixed', downloadUrl: 'https://hf/x' };
    const curatedModel: any = {
      id: 'offgrid/litert-recommended',
      name: 'Gemma 4 LiteRT',
      author: 'google',
      description: '',
      downloads: 0, likes: 0, tags: ['litert'], lastModified: '',
      files: [curatedFile],
    };

    await act(async () => {
      await result.current.handleSelectModel(curatedModel);
    });

    expect(getModelFilesSpy).not.toHaveBeenCalled();
    expect(result.current.modelFiles).toEqual([curatedFile]);
    expect(result.current.selectedModel).toBe(curatedModel);
  });

  it('falls through to HF fetch for non-offgrid models even when factories pre-populate files', async () => {
    const { huggingFaceService } = jest.requireMock('../../../../src/services');
    const fetched = [{ name: 'q4.gguf', size: 2000, quantization: 'Q4_K_M', downloadUrl: 'https://hf/q4' }];
    huggingFaceService.getModelFiles.mockResolvedValueOnce(fetched);

    const { result } = renderHook(() => useTextModels(setAlertState));

    // Factory-style model with prepopulated files — must NOT short-circuit
    const hfModel: any = {
      id: 'test-org/test-model',
      name: 'Test Model',
      author: 'test-org',
      description: '',
      downloads: 1000, likes: 100, tags: [], lastModified: '',
      files: [{ name: 'model-q4_k_m.gguf', size: 100, quantization: 'Q4_K_M', downloadUrl: '' }],
    };

    await act(async () => {
      await result.current.handleSelectModel(hfModel);
    });

    expect(huggingFaceService.getModelFiles).toHaveBeenCalledWith('test-org/test-model');
    expect(result.current.modelFiles).toEqual(fetched);
  });
});

// ── downloaded-file resolution (recovered / catch-up id schemes) ──────────
describe('isModelDownloaded / getDownloadedModel resolve by file, not composite id', () => {
  const REPO = 'unsloth/gemma-4-E2B-it-GGUF';

  it('resolves a quant registered under the composite download id', () => {
    mockStoreState.downloadedModels = [
      { id: `${REPO}/gemma-4-E2B-it-Q4_K_M.gguf`, fileName: 'gemma-4-E2B-it-Q4_K_M.gguf', quantization: 'Q4_K_M', engine: 'llama' },
    ];
    const { result } = renderHook(() => useTextModels(setAlertState));
    expect(result.current.isModelDownloaded(REPO, 'gemma-4-E2B-it-Q4_K_M.gguf')).toBe(true);
    expect(result.current.getDownloadedModel(REPO, 'gemma-4-E2B-it-Q4_K_M.gguf')?.quantization).toBe('Q4_K_M');
  });

  it('resolves a quant recovered under a DIFFERENT id (catch-up/recovery) by its fileName', () => {
    // The Q4_0 finished after an app kill and was re-registered by the recovery scan
    // under a `recovered_…` id — the composite-id lookup would miss it and fall back to
    // the sibling Q4_K_M. Matching by fileName finds the real Q4_0 entry.
    mockStoreState.downloadedModels = [
      { id: `${REPO}/gemma-4-E2B-it-Q4_K_M.gguf`, fileName: 'gemma-4-E2B-it-Q4_K_M.gguf', quantization: 'Q4_K_M', engine: 'llama' },
      { id: 'recovered_gemma-4-E2B-it-Q4_0.gguf_1783000000000', fileName: 'gemma-4-E2B-it-Q4_0.gguf', quantization: 'Q4_0', engine: 'llama' },
    ];
    const { result } = renderHook(() => useTextModels(setAlertState));
    expect(result.current.isModelDownloaded(REPO, 'gemma-4-E2B-it-Q4_0.gguf')).toBe(true);
    const resolved = result.current.getDownloadedModel(REPO, 'gemma-4-E2B-it-Q4_0.gguf');
    expect(resolved?.quantization).toBe('Q4_0');
    expect(resolved?.id).toBe('recovered_gemma-4-E2B-it-Q4_0.gguf_1783000000000');
  });
});

// ── Recommended-list NPU/GPU prioritization (the resort at useTextModels.ts:329) ──
// Guards the user-visible behavior CodeRabbit flagged: on the 'recommended' sort,
// NPU/GPU-accelerable models float to the top; explicit sorts are honored (no resort).
describe('recommendedAsModelInfo — NPU/GPU prioritization', () => {
  const accel = (m: { id?: string }) => ((m?.id?.charCodeAt(0) ?? 1) % 2 === 0); // matches the mock

  it("floats accelerable models ahead of non-accelerable ones on the 'recommended' sort", () => {
    const { result } = renderHook(() => useTextModels(setAlertState));
    const list = result.current.recommendedAsModelInfo;
    expect(list.length).toBeGreaterThan(0);

    // Partition invariant: once a non-accelerable model appears, no accelerable model
    // may appear after it. Deleting the resort line lets a non-accelerable precede an
    // accelerable one → this fails.
    let sawNonAccel = false;
    for (const m of list) {
      if (!accel(m)) sawNonAccel = true;
      else if (sawNonAccel) throw new Error(`accelerable model ${m.id} appears after a non-accelerable one`);
    }
    // And the resort must be meaningful for this dataset (both groups present),
    // otherwise the invariant is vacuous.
    expect(list.some(accel)).toBe(true);
    expect(list.some(m => !accel(m))).toBe(true);
  });

  it("honors an explicit sort (size) — does NOT reprioritize by accelerability", () => {
    const { result } = renderHook(() => useTextModels(setAlertState));
    act(() => result.current.setSortOption('size'));

    const list = result.current.recommendedAsModelInfo;
    // 'size' sorts by paramCount ascending (applySort). The accel resort is skipped,
    // so the list stays param-ordered rather than accelerable-first.
    const params = list.map(m => m.paramCount ?? 0);
    for (let i = 1; i < params.length; i++) {
      expect(params[i]).toBeGreaterThanOrEqual(params[i - 1]);
    }
  });
});
