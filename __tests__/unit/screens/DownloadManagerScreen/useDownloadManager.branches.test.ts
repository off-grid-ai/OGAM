/**
 * useDownloadManager.branches.test.ts
 *
 * Branch coverage for useDownloadManager handlers and helper functions:
 * - handleRetryDownload: android / ios-image / ios-text branches, image
 *   finalization (processing / hasAllBytes / native completed), mmproj retry
 *   success+failure, error catch path
 * - executeRemoveDownload (via handleRemoveDownload alert button): synthetic
 *   multi-file cancel, mmProj cancel, error catch
 * - handleDeleteItem: tts/stt, image (found / not found), text (found / not found)
 * - handleRepairVision: invalid modelId guard, no-mmProj-file path, repair success,
 *   repair failure (catch)
 * - entryToActiveItem mapping via activeItems (image vs text, metadata parse fail)
 */

import { renderHook, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useDownloadManager } from '../../../../src/screens/DownloadManagerScreen/useDownloadManager';

// ── mocks ─────────────────────────────────────────────────────────────
const mockUseAppStore = jest.fn();
const mockUseDownloadStore = jest.fn();
const mockDownloadStoreGetState = jest.fn();

const mockModelManager = {
  watchDownload: jest.fn(),
  getDownloadedModels: jest.fn(),
  resetMmProjForRetry: jest.fn(),
  cancelBackgroundDownload: jest.fn(),
  downloadModelBackground: jest.fn(),
  deleteModel: jest.fn(),
  deleteImageModel: jest.fn(),
  repairMmProj: jest.fn(),
  getModelFiles: jest.fn(),
};
const mockActiveModelService = { unloadImageModel: jest.fn() };
const mockHardwareService = { getModelTotalSize: jest.fn(() => 1000) };
const mockHuggingFaceService = { getDownloadUrl: jest.fn(() => 'http://dl'), getModelFiles: jest.fn() };
const mockBackgroundDownloadService = {
  retryDownload: jest.fn(),
  cancelDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  startProgressPolling: jest.fn(),
};

const mockProceedWithDownload = jest.fn();
const mockCancelSynthetic = jest.fn();
const mockResumeImageDownload = jest.fn();

const mockSetStatus = jest.fn();
const mockRemove = jest.fn();
const mockSetRepairingVision = jest.fn();

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

// NB: jest hoists jest.mock above the const declarations, so the factory must
// not capture the mock objects directly (they are still undefined at eval time).
// Lazy getters read them when the property is actually accessed at call time.
jest.mock('../../../../src/services', () => ({
  get modelManager() { return mockModelManager; },
  get activeModelService() { return mockActiveModelService; },
  get hardwareService() { return mockHardwareService; },
  get huggingFaceService() { return mockHuggingFaceService; },
  get backgroundDownloadService() { return mockBackgroundDownloadService; },
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadActions', () => ({
  cancelSyntheticImageDownload: (...a: any[]) => mockCancelSynthetic(...a),
  proceedWithDownload: (...a: any[]) => mockProceedWithDownload(...a),
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadResume', () => ({
  resumeImageDownload: (...a: any[]) => mockResumeImageDownload(...a),
}));

const mockBuildVoiceDeleteAlert = jest.fn((item: any) => ({ visible: true, title: 'voice', _item: item }));
jest.mock('../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems', () => ({
  useVoiceDownloadItems: () => ({
    voiceItems: [],
    refreshVoiceItems: jest.fn(),
    buildDeleteAlert: mockBuildVoiceDeleteAlert,
  }),
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Wrap showAlert so we can assert on every alert raised (not just the final
// one persisted in state). hideAlert/initialAlertState stay real.
const shownAlertTitles: string[] = [];
jest.mock('../../../../src/components/CustomAlert', () => {
  const actual = jest.requireActual('../../../../src/components/CustomAlert');
  return {
    ...actual,
    showAlert: (title: string, message?: string, buttons?: any) => {
      shownAlertTitles.push(title);
      return actual.showAlert(title, message, buttons);
    },
  };
});

// ── shared state ──────────────────────────────────────────────────────
let appState: any;
let downloads: Record<string, any>;
const setDownloadedModels = jest.fn();
const removeDownloadedModel = jest.fn();
const removeDownloadedImageModel = jest.fn();

function configureStores() {
  appState = {
    downloadedModels: [],
    setDownloadedModels,
    removeDownloadedModel,
    downloadedImageModels: [],
    removeDownloadedImageModel,
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    onboardingChecklist: { triedImageGen: false },
  };
  (mockUseAppStore as any).appState = appState;
  mockUseAppStore.mockImplementation((selector?: any) =>
    selector ? selector(appState) : appState,
  );

  const downloadStoreState = {
    downloads,
    repairingVisionIds: {},
    setRepairingVision: mockSetRepairingVision,
    remove: mockRemove,
    setStatus: mockSetStatus,
    downloadIdIndex: {},
  };
  mockDownloadStoreGetState.mockReturnValue(downloadStoreState);
  mockUseDownloadStore.mockImplementation((selector?: any) =>
    selector ? selector(downloadStoreState) : downloadStoreState,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  shownAlertTitles.length = 0;
  (Platform as any).OS = 'android';
  downloads = {};
  mockModelManager.getDownloadedModels.mockResolvedValue([]);
  mockModelManager.cancelBackgroundDownload.mockResolvedValue(undefined);
  mockModelManager.downloadModelBackground.mockResolvedValue({ downloadId: 'new-id' });
  mockModelManager.deleteModel.mockResolvedValue(undefined);
  mockModelManager.deleteImageModel.mockResolvedValue(undefined);
  mockModelManager.repairMmProj.mockResolvedValue(undefined);
  mockActiveModelService.unloadImageModel.mockResolvedValue(undefined);
  mockBackgroundDownloadService.retryDownload.mockResolvedValue(undefined);
  mockBackgroundDownloadService.cancelDownload.mockResolvedValue(undefined);
  mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([]);
  mockResumeImageDownload.mockResolvedValue(undefined);
  mockProceedWithDownload.mockResolvedValue(undefined);
  mockCancelSynthetic.mockResolvedValue(undefined);
  configureStores();
});

// pull the alert button onPress out of the current alert state.
// setAlertState is the real useState setter, so we read result.current.alertState.
function pressButton(result: { current: { alertState: any } }, label: string) {
  const btn = result.current.alertState.buttons.find((b: any) => b.text === label);
  return btn.onPress();
}

// ── handleRetryDownload ───────────────────────────────────────────────

describe('handleRetryDownload', () => {
  it('returns early with no downloadId', async () => {
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => { await result.current.handleRetryDownload({ modelType: 'text' } as any); });
    expect(mockBackgroundDownloadService.retryDownload).not.toHaveBeenCalled();
  });

  it('android text retry: retries, reattaches finalizer, retries mmproj sidecar', async () => {
    downloads['org/repo/model.gguf'] = {
      modelKey: 'org/repo/model.gguf', downloadId: 'dl-1', mmProjDownloadId: 'mm-1',
      mmProjStatus: 'failed', modelId: 'org/repo', modelType: 'text',
    };
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'org/repo/model.gguf',
        modelId: 'org/repo', fileName: 'model.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'pending');
    expect(mockBackgroundDownloadService.retryDownload).toHaveBeenCalledWith('dl-1');
    // mmproj failed → retried → reset
    expect(mockBackgroundDownloadService.retryDownload).toHaveBeenCalledWith('mm-1');
    expect(mockModelManager.resetMmProjForRetry).toHaveBeenCalledWith('dl-1');
    expect(mockModelManager.watchDownload).toHaveBeenCalled();
    expect(mockBackgroundDownloadService.startProgressPolling).toHaveBeenCalled();
  });

  it('android text retry: skips mmproj reset when sidecar is not failed', async () => {
    downloads.k = {
      modelKey: 'k', downloadId: 'dl-1', mmProjDownloadId: 'mm-1', mmProjStatus: 'completed',
      modelId: 'org/repo', modelType: 'text',
    };
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'k', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    expect(mockModelManager.resetMmProjForRetry).not.toHaveBeenCalled();
  });

  it('android text retry: mmproj retry failure sets status failed and returns false', async () => {
    mockBackgroundDownloadService.retryDownload
      .mockResolvedValueOnce(undefined) // main
      .mockRejectedValueOnce(new Error('mmproj boom')); // sidecar
    downloads.k = {
      modelKey: 'k', downloadId: 'dl-1', mmProjDownloadId: 'mm-1', mmProjStatus: 'failed',
      modelId: 'org/repo', modelType: 'text',
    };
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'k', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    expect(mockSetStatus).toHaveBeenCalledWith('mm-1', 'failed', { message: 'mmproj boom' });
    expect(mockModelManager.resetMmProjForRetry).not.toHaveBeenCalled();
  });

  it('image finalization runs when status is processing', async () => {
    const entry = { modelKey: 'image:m1', downloadId: 'image-multi:m1', modelId: 'image:m1', modelType: 'image' };
    downloads['image:m1'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'image', downloadId: 'image-multi:m1', modelKey: 'image:m1',
        modelId: 'm1', fileName: 'm1', fileSize: 0, bytesDownloaded: 0, status: 'processing',
      } as any);
    });
    expect(mockResumeImageDownload).toHaveBeenCalledWith(entry, expect.objectContaining({ setAlertState: expect.any(Function) }));
    expect(mockBackgroundDownloadService.retryDownload).not.toHaveBeenCalled();
  });

  it('image finalization runs when native row reports completed', async () => {
    mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([{ downloadId: 'dl-img', status: 'completed' }]);
    const entry = { modelKey: 'image:m1', downloadId: 'dl-img', modelId: 'image:m1', modelType: 'image' };
    downloads['image:m1'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'image', downloadId: 'dl-img', modelKey: 'image:m1', modelId: 'm1',
        fileName: 'm1', fileSize: 0, bytesDownloaded: 0, status: 'failed',
      } as any);
    });
    expect(mockResumeImageDownload).toHaveBeenCalled();
  });

  it('image retry on iOS calls retryIosImageDownload → proceedWithDownload', async () => {
    (Platform as any).OS = 'ios';
    const entry = {
      modelKey: 'image:m1', downloadId: 'dl-img', modelId: 'image:m1', modelType: 'image',
      metadataJson: JSON.stringify({ imageModelName: 'M1', imageModelDownloadUrl: 'http://z', imageDownloadType: 'zip' }),
    };
    downloads['image:m1'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'image', downloadId: 'dl-img', modelKey: 'image:m1', modelId: 'm1',
        fileName: 'm1', fileSize: 100, bytesDownloaded: 0, status: 'failed',
      } as any);
    });
    expect(mockBackgroundDownloadService.cancelDownload).toHaveBeenCalledWith('dl-img');
    expect(mockProceedWithDownload).toHaveBeenCalled();
  });

  it('iOS image retry aborts when zip metadata lacks a download url', async () => {
    (Platform as any).OS = 'ios';
    const entry = {
      modelKey: 'image:m1', downloadId: 'dl-img', modelId: 'image:m1', modelType: 'image',
      metadataJson: JSON.stringify({ imageModelName: 'M1', imageDownloadType: 'zip' }),
    };
    downloads['image:m1'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'image', downloadId: 'dl-img', modelKey: 'image:m1', modelId: 'm1',
        fileName: 'm1', fileSize: 100, bytesDownloaded: 0, status: 'failed',
      } as any);
    });
    expect(mockProceedWithDownload).not.toHaveBeenCalled();
  });

  it('iOS image retry returns when metadata fails to parse', async () => {
    (Platform as any).OS = 'ios';
    const entry = { modelKey: 'image:m1', downloadId: 'dl-img', modelId: 'image:m1', modelType: 'image', metadataJson: '{bad' };
    downloads['image:m1'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'image', downloadId: 'dl-img', modelKey: 'image:m1', modelId: 'm1',
        fileName: 'm1', fileSize: 100, bytesDownloaded: 0, status: 'failed',
      } as any);
    });
    expect(mockProceedWithDownload).not.toHaveBeenCalled();
  });

  it('iOS text retry downloads in background and reattaches with new id', async () => {
    (Platform as any).OS = 'ios';
    const entry = {
      modelKey: 'org/repo/m.gguf', downloadId: 'dl-1', modelId: 'org/repo', modelType: 'text',
      fileName: 'm.gguf', totalBytes: 100, quantization: 'Q4',
      mmProjFileName: 'mm.gguf', mmProjFileSize: 50,
      metadataJson: JSON.stringify({ mmProjDownloadUrl: 'http://mm' }),
    };
    downloads['org/repo/m.gguf'] = entry;
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'org/repo/m.gguf', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0, status: 'failed',
      } as any);
    });
    expect(mockModelManager.downloadModelBackground).toHaveBeenCalledWith(
      'org/repo',
      expect.objectContaining({ mmProjFile: { name: 'mm.gguf', size: 50, downloadUrl: 'http://mm' } }),
    );
    expect(mockModelManager.watchDownload).toHaveBeenCalledWith('new-id', expect.any(Function), expect.any(Function));
  });

  it('error in retry path sets the download status to failed with the error message', async () => {
    mockBackgroundDownloadService.retryDownload.mockRejectedValueOnce(new Error('retry exploded'));
    downloads.k = { modelKey: 'k', downloadId: 'dl-1', modelId: 'org/repo', modelType: 'text' };
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'k', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'failed', { message: 'retry exploded' });
  });

  it('error path falls back to default message when error has none', async () => {
    mockBackgroundDownloadService.retryDownload.mockRejectedValueOnce({});
    downloads.k = { modelKey: 'k', downloadId: 'dl-1', modelId: 'org/repo', modelType: 'text' };
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'k', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'failed', {
      message: 'Retry failed. Please remove and re-download.',
    });
  });
});

// ── reattachRetriedTextDownload callbacks ─────────────────────────────

describe('reattachRetriedTextDownload watch callbacks', () => {
  it('finalize callback refreshes models and removes the store entry', async () => {
    downloads.k = { modelKey: 'k', downloadId: 'dl-1', modelId: 'org/repo', modelType: 'text' };
    mockDownloadStoreGetState.mockReturnValue({
      downloads, remove: mockRemove, setStatus: mockSetStatus,
      repairingVisionIds: {}, setRepairingVision: mockSetRepairingVision,
      downloadIdIndex: { 'dl-1': 'k' },
    });
    mockModelManager.getDownloadedModels.mockResolvedValue([{ id: 'org/repo' }]);
    const { result } = renderHook(() => useDownloadManager());
    await act(async () => {
      await result.current.handleRetryDownload({
        modelType: 'text', downloadId: 'dl-1', modelKey: 'k', modelId: 'org/repo',
        fileName: 'm.gguf', fileSize: 100, bytesDownloaded: 0,
      } as any);
    });
    const onDone = mockModelManager.watchDownload.mock.calls[0][1];
    const onErr = mockModelManager.watchDownload.mock.calls[0][2];
    await act(async () => { await onDone(); });
    expect(setDownloadedModels).toHaveBeenCalledWith([{ id: 'org/repo' }]);
    expect(mockRemove).toHaveBeenCalledWith('k');
    // error callback marks failed
    onErr(new Error('finalize failed'));
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'failed', { message: 'finalize failed' });
  });
});

// ── handleRemoveDownload / executeRemoveDownload ──────────────────────

describe('executeRemoveDownload', () => {
  it('synthetic multi-file: cancels synthetic + native rows matching the image id', async () => {
    mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'r1', modelId: 'image:m1' },
      { downloadId: 'r2', modelId: 'image:other' },
    ]);
    downloads['image:m1'] = { modelKey: 'image:m1', downloadId: 'image-multi:m1', status: 'completed', modelType: 'image', modelId: 'image:m1' };
    const { result } = renderHook(() => useDownloadManager());
    act(() => {
      result.current.handleRemoveDownload({ modelType: 'image', modelId: 'm1', fileName: 'm1', modelKey: 'image:m1' } as any);
    });
    await act(async () => { await pressButton(result, 'Yes'); });
    expect(mockRemove).toHaveBeenCalledWith('image:m1');
    expect(mockCancelSynthetic).toHaveBeenCalledWith('m1');
    expect(mockBackgroundDownloadService.cancelDownload).toHaveBeenCalledWith('r1');
    expect(mockBackgroundDownloadService.cancelDownload).not.toHaveBeenCalledWith('r2');
  });

  it('text: cancels main + mmproj background downloads', async () => {
    downloads.k = { modelKey: 'k', downloadId: 'dl-1', mmProjDownloadId: 'mm-1', status: 'completed', modelType: 'text', modelId: 'org/repo' };
    const { result } = renderHook(() => useDownloadManager());
    act(() => {
      result.current.handleRemoveDownload({ modelType: 'text', modelId: 'org/repo', fileName: 'm.gguf', modelKey: 'k' } as any);
    });
    await act(async () => { await pressButton(result, 'Yes'); });
    expect(mockModelManager.cancelBackgroundDownload).toHaveBeenCalledWith('dl-1');
    expect(mockModelManager.cancelBackgroundDownload).toHaveBeenCalledWith('mm-1');
  });

  it('error during remove shows an error alert', async () => {
    downloads.k = { modelKey: 'k', downloadId: 'dl-1', status: 'completed', modelType: 'text', modelId: 'org/repo' };
    mockRemove.mockImplementationOnce(() => { throw new Error('remove boom'); });
    const { result } = renderHook(() => useDownloadManager());
    act(() => {
      result.current.handleRemoveDownload({ modelType: 'text', modelId: 'org/repo', fileName: 'm.gguf', modelKey: 'k' } as any);
    });
    await act(async () => { await pressButton(result, 'Yes'); });
    expect(shownAlertTitles).toContain('Error');
  });

  it('builds the modelKey from modelId/fileName when not provided', async () => {
    downloads['org/repo/m.gguf'] = { modelKey: 'org/repo/m.gguf', downloadId: 'dl-1', status: 'completed', modelType: 'text', modelId: 'org/repo' };
    const { result } = renderHook(() => useDownloadManager());
    act(() => {
      result.current.handleRemoveDownload({ modelType: 'text', modelId: 'org/repo', fileName: 'm.gguf' } as any);
    });
    await act(async () => { await pressButton(result, 'Yes'); });
    expect(mockRemove).toHaveBeenCalledWith('org/repo/m.gguf');
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

  it('image: shows delete alert and deletes + unloads on confirm', async () => {
    configureStores();
    appState.downloadedImageModels = [{ id: 'm1', name: 'Image M1', size: 2000, modelPath: '/p' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'image', modelId: 'm1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(mockActiveModelService.unloadImageModel).toHaveBeenCalled();
    expect(mockModelManager.deleteImageModel).toHaveBeenCalledWith('m1');
    expect(removeDownloadedImageModel).toHaveBeenCalledWith('m1');
  });

  it('image: delete failure shows error alert', async () => {
    mockModelManager.deleteImageModel.mockRejectedValueOnce(new Error('del boom'));
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

  it('text: shows delete alert and deletes model on confirm', async () => {
    configureStores();
    appState.downloadedModels = [{ id: 't1', fileName: 'm.gguf', author: 'a', quantization: 'Q4', engine: 'llama' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'text', modelId: 't1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(mockModelManager.deleteModel).toHaveBeenCalledWith('t1');
    expect(removeDownloadedModel).toHaveBeenCalledWith('t1');
  });

  it('text: delete failure shows error alert', async () => {
    mockModelManager.deleteModel.mockRejectedValueOnce(new Error('del boom'));
    configureStores();
    appState.downloadedModels = [{ id: 't1', fileName: 'm.gguf', author: 'a', quantization: 'Q4', engine: 'llama' }];
    const { result } = renderHook(() => useDownloadManager());
    act(() => { result.current.handleDeleteItem({ modelType: 'text', modelId: 't1' } as any); });
    await act(async () => { await pressButton(result, 'Delete'); });
    expect(shownAlertTitles).toContain('Error');
  });
});

// ── handleRepairVision ────────────────────────────────────────────────

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
    const titles = shownAlertTitles;
    expect(titles).toContain('No Vision File Available');
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
    const titles = shownAlertTitles;
    expect(titles).toContain('Vision Repaired');
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

  it('isRepairingVision reflects the store flag', () => {
    mockDownloadStoreGetState.mockReturnValue({
      downloads, remove: mockRemove, setStatus: mockSetStatus,
      repairingVisionIds: { 'org/repo/m.gguf': true }, setRepairingVision: mockSetRepairingVision, downloadIdIndex: {},
    });
    mockUseDownloadStore.mockImplementation((selector?: any) => {
      const s = { downloads, repairingVisionIds: { 'org/repo/m.gguf': true }, setRepairingVision: mockSetRepairingVision, remove: mockRemove };
      return selector ? selector(s) : s;
    });
    const { result } = renderHook(() => useDownloadManager());
    expect(result.current.isRepairingVision('org/repo/m.gguf')).toBe(true);
    expect(result.current.isRepairingVision('other')).toBe(false);
  });
});
