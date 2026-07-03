/**
 * useDownloadManager.branches.test.ts
 *
 * The Download Manager hook is now a thin presentation layer: retry / cancel /
 * delete DELEGATE to ModelDownloadService (the single owner; the actual per-type
 * work is covered by the provider tests — sttDownloadProvider / textDownloadProvider
 * / imageDownloadProvider). So this suite asserts:
 * - handleRetryDownload → modelDownloadService.retry(`${type}:${modelId}`)
 * - handleRemoveDownload (confirm) → modelDownloadService.cancel(id)
 * - handleDeleteItem: tts/stt → voice alert; text/image (confirm) → service.remove(id)
 * - the image cancel/retry ops are injected into the provider (setImageDownloadOps)
 * - handleRepairVision + activeItems mapping (still owned by the hook) unchanged.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useDownloadManager } from '../../../../src/screens/DownloadManagerScreen/useDownloadManager';

// ── mocks ─────────────────────────────────────────────────────────────
const mockUseAppStore = jest.fn();
const mockUseDownloadStore = jest.fn();
const mockDownloadStoreGetState = jest.fn();

const mockModelManager = {
  getDownloadedModels: jest.fn(),
  repairMmProj: jest.fn(),
  getModelFiles: jest.fn(),
};
const mockHardwareService = { getModelTotalSize: jest.fn(() => 1000) };
const mockHuggingFaceService = { getModelFiles: jest.fn() };
const mockBackgroundDownloadService = { cancelDownload: jest.fn(), getActiveDownloads: jest.fn(), getQueuedItems: jest.fn(() => []), reconcileActiveIds: jest.fn().mockResolvedValue(undefined) };
const mockSubscribe = jest.fn((_fn?: any) => () => {});

const mockMDS = {
  retry: jest.fn(async (_id: string) => {}),
  cancel: jest.fn(async (_id: string) => {}),
  remove: jest.fn(async (_id: string) => {}),
};
const mockSetImageDownloadOps = jest.fn();

const mockSetRepairingVision = jest.fn();
const mockRemove = jest.fn();
const mockSetStatus = jest.fn();

jest.mock('../../../../src/stores', () => {
  const useAppStore = (selector?: any) => mockUseAppStore(selector);
  (useAppStore as any).getState = () => (mockUseAppStore as any).appState;
  return { useAppStore };
});
jest.mock('../../../../src/stores/downloadStore', () => {
  const useDownloadStore = (selector?: any) => mockUseDownloadStore(selector);
  (useDownloadStore as any).getState = () => mockDownloadStoreGetState();
  return { useDownloadStore };
});
jest.mock('../../../../src/services', () => ({
  get modelManager() { return mockModelManager; },
  get hardwareService() { return mockHardwareService; },
  get huggingFaceService() { return mockHuggingFaceService; },
  get backgroundDownloadService() { return mockBackgroundDownloadService; },
}));
jest.mock('../../../../src/services/modelDownloadService', () => ({
  get modelDownloadService() { return { retry: (id: string) => mockMDS.retry(id), cancel: (id: string) => mockMDS.cancel(id), remove: (id: string) => mockMDS.remove(id), subscribe: (fn: any) => mockSubscribe(fn) }; },
}));
jest.mock('../../../../src/services/modelDownloadService/providers/imageProvider', () => ({
  setImageDownloadOps: (...a: any[]) => mockSetImageDownloadOps(...a),
}));
jest.mock('../../../../src/screens/ModelsScreen/imageDownloadActions', () => ({
  cancelSyntheticImageDownload: jest.fn(),
}));
jest.mock('../../../../src/screens/DownloadManagerScreen/retryHandlers', () => ({
  parseEntryMetadata: (entry: any) => { try { return entry.metadataJson ? JSON.parse(entry.metadataJson) : null; } catch { return null; } },
  retryImageDownload: jest.fn(async () => {}),
}));

const mockBuildVoiceDeleteAlert = jest.fn((item: any) => ({ visible: true, title: 'voice', _item: item }));
let mockVoiceItems: any[] = [];
jest.mock('../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems', () => ({
  useVoiceDownloadItems: () => ({ voiceItems: mockVoiceItems, refreshVoiceItems: jest.fn(), buildDeleteAlert: mockBuildVoiceDeleteAlert }),
}));
jest.mock('../../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const shownAlertTitles: string[] = [];
jest.mock('../../../../src/components/CustomAlert', () => {
  const actual = jest.requireActual('../../../../src/components/CustomAlert');
  return { ...actual, showAlert: (title: string, message?: string, buttons?: any) => { shownAlertTitles.push(title); return actual.showAlert(title, message, buttons); } };
});

// ── shared state ──────────────────────────────────────────────────────
let appState: any;
let downloads: Record<string, any>;
const setDownloadedModels = jest.fn();

function configureStores() {
  appState = {
    downloadedModels: [], setDownloadedModels, downloadedImageModels: [],
    addDownloadedImageModel: jest.fn(), activeImageModelId: null, setActiveImageModelId: jest.fn(),
    onboardingChecklist: { triedImageGen: false },
  };
  (mockUseAppStore as any).appState = appState;
  mockUseAppStore.mockImplementation((selector?: any) => (selector ? selector(appState) : appState));

  const downloadStoreState = {
    downloads, repairingVisionIds: {}, setRepairingVision: mockSetRepairingVision,
    remove: mockRemove, setStatus: mockSetStatus, downloadIdIndex: {},
  };
  mockDownloadStoreGetState.mockReturnValue(downloadStoreState);
  mockUseDownloadStore.mockImplementation((selector?: any) => (selector ? selector(downloadStoreState) : downloadStoreState));
}

beforeEach(() => {
  jest.clearAllMocks();
  shownAlertTitles.length = 0;
  mockVoiceItems = [];
  downloads = {};
  mockModelManager.getDownloadedModels.mockResolvedValue([]);
  mockModelManager.repairMmProj.mockResolvedValue(undefined);
  mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([]);
  configureStores();
});

function pressButton(result: { current: { alertState: any } }, label: string) {
  const btn = result.current.alertState.buttons.find((b: any) => b.text === label);
  return btn.onPress();
}

// ── delegation to the single download service ─────────────────────────
describe('control ops delegate to ModelDownloadService', () => {
  it('handleRetryDownload → service.retry(`${type}:${modelId}`)', async () => {
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({ modelType: 'text', downloadId: 'dl-1', modelId: 'org/repo', fileName: 'm.gguf' } as any);
    });
    expect(mockMDS.retry).toHaveBeenCalledWith('text:org/repo');
  });

  it('handleRetryDownload routes stt by id even without a downloadId', async () => {
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({ modelType: 'stt', modelId: 'base.en', fileName: 'ggml-base.en.bin' } as any);
    });
    expect(mockMDS.retry).toHaveBeenCalledWith('stt:base.en');
  });

  it('handleRetryDownload routes by id even without a downloadId (no leaked id-scheme guard)', async () => {
    // The old STT-specific `if (!downloadId && type !== 'stt') return` guard is gone:
    // the service refuses a not-found id uniformly, so the UI always routes by id.
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => { await result.current.handleRetryDownload({ modelType: 'image', modelId: 'x' } as any); });
    expect(mockMDS.retry).toHaveBeenCalledWith('image:x');
  });

  it('handleRemoveDownload (confirm Yes) → service.cancel(id)', async () => {
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleRemoveDownload({ modelType: 'image', modelId: 'sdxl', fileName: 'SDXL' } as any); });
    await act(async () => { await pressButton(result, 'Yes'); });
    expect(mockMDS.cancel).toHaveBeenCalledWith('image:sdxl');
  });

  it('registers the image cancel/retry ops with the provider', () => {
    renderHook(() => useDownloadManager());
    expect(mockSetImageDownloadOps).toHaveBeenCalledWith(expect.objectContaining({ cancel: expect.any(Function), retry: expect.any(Function) }));
  });
});

// ── handleDeleteItem ──────────────────────────────────────────────────
describe('handleDeleteItem', () => {
  it('delegates to the voice delete alert for tts/stt', () => {
    const { result } = renderHook(() => useDownloadManager());
    const item = { modelType: 'tts', modelId: 'v1', fileName: 'voice' };
    act(() => { result.current.handleDeleteItem(item as any); });
    expect(mockBuildVoiceDeleteAlert).toHaveBeenCalledWith(item);
  });

  it('image: no-op when model not in downloadedImageModels', () => {
    const { result } = renderHook(() => useDownloadManager());
    const before = shownAlertTitles.length;
    act(() => { result.current.handleDeleteItem({ modelType: 'image', modelId: 'missing' } as any); });
    expect(shownAlertTitles.length).toBe(before);
  });

  it('image: confirm → service.remove(`image:id`)', async () => {
    configureStores();
    appState.downloadedImageModels = [{ id: 'm1', name: 'Image M1', size: 2000, modelPath: '/p' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'image', modelId: 'm1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(mockMDS.remove).toHaveBeenCalledWith('image:m1');
  });

  it('image: service.remove failure shows error alert', async () => {
    mockMDS.remove.mockRejectedValueOnce(new Error('del boom'));
    configureStores();
    appState.downloadedImageModels = [{ id: 'm1', name: 'Image M1', size: 2000, modelPath: '/p' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'image', modelId: 'm1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(shownAlertTitles).toContain('Error');
  });

  it('text: no-op when model not in downloadedModels', () => {
    const { result } = renderHook(() => useDownloadManager());
    const before = shownAlertTitles.length;
    act(() => { result.current.handleDeleteItem({ modelType: 'text', modelId: 'missing' } as any); });
    expect(shownAlertTitles.length).toBe(before);
  });

  it('text: confirm → service.remove(`text:id`)', async () => {
    configureStores();
    appState.downloadedModels = [{ id: 't1', fileName: 'm.gguf', author: 'a', quantization: 'Q4', engine: 'llama' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'text', modelId: 't1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(mockMDS.remove).toHaveBeenCalledWith('text:t1');
  });

  it('text: service.remove failure shows error alert', async () => {
    mockMDS.remove.mockRejectedValueOnce(new Error('del boom'));
    configureStores();
    appState.downloadedModels = [{ id: 't1', fileName: 'm.gguf', author: 'a', quantization: 'Q4', engine: 'llama' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'text', modelId: 't1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(shownAlertTitles).toContain('Error');
  });
});

// ── handleRepairVision (still owned by the hook) ──────────────────────
describe('handleRepairVision', () => {
  it('returns early when modelId has no slash', () => {
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleRepairVision({ modelId: 'noslash' } as any); });
    expect(mockSetRepairingVision).not.toHaveBeenCalled();
  });

  it('alerts when no separate vision file is published', async () => {
    mockHuggingFaceService.getModelFiles.mockResolvedValue([{ name: 'm.gguf' }]);
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      result.current.handleRepairVision({ modelId: 'org/repo/m.gguf', fileName: 'm.gguf' } as any);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(mockSetRepairingVision).toHaveBeenCalledWith('org/repo/m.gguf', true);
    expect(shownAlertTitles).toContain('No Vision File Available');
    expect(mockSetRepairingVision).toHaveBeenCalledWith('org/repo/m.gguf', false);
  });

  it('repairs and refreshes when a vision file exists', async () => {
    mockHuggingFaceService.getModelFiles.mockResolvedValue([{ name: 'm.gguf', mmProjFile: { name: 'mm.gguf' } }]);
    mockModelManager.getDownloadedModels.mockResolvedValue([{ id: 'x' }]);
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      result.current.handleRepairVision({ modelId: 'org/repo/m.gguf', fileName: 'm.gguf' } as any);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(mockModelManager.repairMmProj).toHaveBeenCalledWith('org/repo', { name: 'm.gguf', mmProjFile: { name: 'mm.gguf' } }, {});
    expect(setDownloadedModels).toHaveBeenCalledWith([{ id: 'x' }]);
    expect(shownAlertTitles).toContain('Vision Repaired');
  });

  it('shows Repair Failed when getModelFiles rejects', async () => {
    mockHuggingFaceService.getModelFiles.mockRejectedValue(new Error('hf down'));
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      result.current.handleRepairVision({ modelId: 'org/repo/m.gguf', fileName: 'm.gguf' } as any);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(shownAlertTitles).toContain('Repair Failed');
    expect(mockSetRepairingVision).toHaveBeenCalledWith('org/repo/m.gguf', false);
  });
});

// ── activeItems mapping (entryToActiveItem helpers) ───────────────────
describe('activeItems mapping', () => {
  it('maps an image entry: strips image: prefix, reads metadata name/backend/quant', () => {
    downloads['image:m1'] = {
      status: 'running', modelType: 'image', downloadId: 'dl', modelKey: 'image:m1',
      modelId: 'image:m1', fileName: 'fallback', progress: 0.5,
      bytesDownloaded: 5, totalBytes: 10, combinedTotalBytes: 10,
      metadataJson: JSON.stringify({ imageModelName: 'Pretty Name', imageModelBackend: 'coreml' }),
    };
    const { result } = renderHook(() => useDownloadManager());
    const item = result.current.activeItems[0];
    expect(item.modelId).toBe('m1');
    expect(item.fileName).toBe('Pretty Name');
    expect(item.author).toBe('Core ML');
    expect(item.quantization).toBe('Core ML');
  });

  it('maps a text entry: author from modelId prefix, falls back when metadata is bad json', () => {
    downloads['org/repo/m.gguf'] = {
      status: 'running', modelType: 'text', downloadId: 'dl', modelKey: 'org/repo/m.gguf',
      modelId: 'org/repo', fileName: 'm.gguf', quantization: 'Q4',
      progress: 0.1, bytesDownloaded: 1, totalBytes: 10, metadataJson: '{bad',
    };
    const { result } = renderHook(() => useDownloadManager());
    const item = result.current.activeItems[0];
    expect(item.author).toBe('org');
    expect(item.quantization).toBe('Q4');
  });

  it('excludes completed/cancelled entries from activeItems', () => {
    downloads.a = { status: 'completed', modelType: 'text', downloadId: 'd', modelKey: 'a', modelId: 'org/x', fileName: 'f', quantization: '', progress: 1, bytesDownloaded: 1, totalBytes: 1 };
    downloads.b = { status: 'cancelled', modelType: 'text', downloadId: 'd', modelKey: 'b', modelId: 'org/y', fileName: 'f', quantization: '', progress: 0, bytesDownloaded: 0, totalBytes: 1 };
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.activeItems).toHaveLength(0);
  });

  it('routes a DOWNLOADING voice item to activeItems, NOT completedItems (Kokoro shows downloading, not "downloaded 82MB")', () => {
    // Regression: useVoiceDownloadItems returns in-flight TTS rows as type:'active'.
    // The hook used to dump ALL voiceItems into completedItems, so a downloading
    // Kokoro rendered as a finished 82MB model under "Downloaded Models" regardless
    // of its real progress. Split by type: active → activeItems, completed → completedItems.
    mockVoiceItems = [
      { type: 'active', modelType: 'tts', modelId: 'kokoro', fileName: 'Kokoro TTS', author: 'Voice',
        quantization: '', fileSize: 85983232, bytesDownloaded: 2579469, progress: 0.03, status: 'downloading', name: 'Kokoro TTS' },
    ];
    const { result } = renderHook(() => useDownloadManager());
    // FAILS before the fix (it was in completedItems, absent from activeItems).
    expect(result.current.activeItems.some(i => i.modelType === 'tts' && i.modelId === 'kokoro')).toBe(true);
    expect(result.current.completedItems.some(i => i.modelType === 'tts' && i.modelId === 'kokoro')).toBe(false);
  });

  it('routes a COMPLETED voice item to completedItems, NOT activeItems', () => {
    mockVoiceItems = [
      { type: 'completed', modelType: 'tts', modelId: 'kokoro', fileName: 'Kokoro TTS', author: 'Voice',
        quantization: '', fileSize: 85983232, bytesDownloaded: 85983232, progress: 1, status: 'completed', name: 'Kokoro TTS' },
    ];
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.completedItems.some(i => i.modelType === 'tts' && i.modelId === 'kokoro')).toBe(true);
    expect(result.current.activeItems.some(i => i.modelType === 'tts' && i.modelId === 'kokoro')).toBe(false);
  });

  it('routes a FAILED voice item to activeItems (so ActiveDownloadCard shows Retry), NOT completedItems', () => {
    // useVoiceDownloadItems marks a failed Kokoro fetch type:'active' status:'failed'
    // (retryable). The type-split must send it to Active — a failed download in the
    // "Downloaded Models" section would be a lie (it isn't downloaded) and would hide
    // the Retry affordance.
    mockVoiceItems = [
      { type: 'active', modelType: 'tts', modelId: 'kokoro', fileName: 'Kokoro TTS', author: 'Voice',
        quantization: '', fileSize: 85983232, bytesDownloaded: 24000000, progress: 0.28, status: 'failed',
        name: 'Kokoro TTS', reason: 'Download interrupted' },
    ];
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.activeItems.some(i => i.modelType === 'tts' && i.status === 'failed')).toBe(true);
    expect(result.current.completedItems.some(i => i.modelType === 'tts')).toBe(false);
  });

  it('mixed real device state: STT downloaded + TTS downloading → STT in completed, TTS in active', () => {
    // The exact screen we saw on-device: whisper models finished, Kokoro mid-download.
    // The two must land in different sections, not be lumped together.
    mockVoiceItems = [
      { type: 'completed', modelType: 'stt', modelId: 'base.en', fileName: 'ggml-base.en.bin', author: 'Transcription',
        quantization: '', fileSize: 142000000, bytesDownloaded: 142000000, progress: 1, status: 'completed', name: 'base.en' },
      { type: 'active', modelType: 'tts', modelId: 'kokoro', fileName: 'Kokoro TTS', author: 'Voice',
        quantization: '', fileSize: 85983232, bytesDownloaded: 25794690, progress: 0.3, status: 'downloading', name: 'Kokoro TTS' },
    ];
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.completedItems.some(i => i.modelType === 'stt' && i.modelId === 'base.en')).toBe(true);
    expect(result.current.completedItems.some(i => i.modelType === 'tts')).toBe(false);
    expect(result.current.activeItems.some(i => i.modelType === 'tts' && i.status === 'downloading')).toBe(true);
    expect(result.current.activeItems.some(i => i.modelType === 'stt')).toBe(false);
  });

  it('isRepairingVision reflects the store flag', () => {
    mockUseDownloadStore.mockImplementation((selector?: any) => {
      const s = { downloads, repairingVisionIds: { 'org/repo/m.gguf': true }, setRepairingVision: mockSetRepairingVision, remove: mockRemove };
      return selector ? selector(s) : s;
    });
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.isRepairingVision('org/repo/m.gguf')).toBe(true);
    expect(result.current.isRepairingVision('other')).toBe(false);
  });
});

describe('queued-items subscription (F14 churn)', () => {
  it('subscribes to the download service once and does NOT re-subscribe when downloads change each tick', () => {
    const { rerender } = renderHook(() => useDownloadManager());
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Simulate progress ticks handing the selector a brand-new downloads object each
    // render. Under the old [downloads] dep this tore down + rebuilt the subscription
    // (and the 1s interval) every tick; with [] it must stay a single subscription.
    const entry = (progress: number) => ({ 'a/x/f.gguf': { modelId: 'a/x', modelKey: 'a/x/f.gguf', fileName: 'f.gguf', modelType: 'text', status: 'running', progress, bytesDownloaded: 1, totalBytes: 100, quantization: 'Q4' } });
    act(() => { downloads = entry(0.1); configureStores(); });
    rerender({});
    act(() => { downloads = entry(0.2); configureStores(); });
    rerender({});

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });
});
