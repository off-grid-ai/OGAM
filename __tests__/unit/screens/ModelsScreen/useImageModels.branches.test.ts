/**
 * useImageModels.branches.test.ts
 *
 * Branch coverage for the conditional paths in useImageModels that the
 * processing-resume test does not exercise:
 * - loadHFModels iOS (CoreML) vs Android (HF) paths + error fallback (?? 'Failed to fetch models')
 * - hardware recommendation effect: qnn / mnn / all backend selection + userChangedBackendFilter guard
 * - isRecommendedModel guards (no rec, backend mismatch, qnnVariant, recommendedModels, default true)
 * - filteredHFModels filters (recommended-only, backend, style, sd version, downloaded, query)
 * - handleCancelImageDownload: missing entry, no downloadId, synthetic multi, native cancel
 * - loadDownloadedImageModels
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useImageModels } from '../../../../src/screens/ModelsScreen/useImageModels';

const mockUseAppStore = jest.fn();
const mockUseDownloadStore = jest.fn();
const mockGetDownloadedImageModels = jest.fn();
const mockSetDownloadedImageModels = jest.fn();
const mockResumeImageDownload = jest.fn();
const mockCancelDownload = jest.fn();
const mockGetSoCInfo = jest.fn();
const mockGetImageModelRecommendation = jest.fn();
const mockFetchAvailableModels = jest.fn();
const mockFetchAvailableCoreMLModels = jest.fn();
const mockGuessStyle = jest.fn();
const mockMatchesSdVersionFilter = jest.fn();
const mockCancelSynthetic = jest.fn();
const mockStoreRemove = jest.fn();
const mockStoreGetState = jest.fn();

jest.mock('../../../../src/stores', () => ({
  useAppStore: (selector?: any) => mockUseAppStore(selector),
}));

jest.mock('../../../../src/stores/downloadStore', () => {
  const useDownloadStore = (selector?: any) => mockUseDownloadStore(selector);
  (useDownloadStore as any).getState = () => mockStoreGetState();
  return { useDownloadStore };
});

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getDownloadedImageModels: (...args: any[]) => mockGetDownloadedImageModels(...args),
  },
  hardwareService: {
    getSoCInfo: (...a: any[]) => mockGetSoCInfo(...a),
    getImageModelRecommendation: (...a: any[]) => mockGetImageModelRecommendation(...a),
  },
  backgroundDownloadService: {
    cancelDownload: (...a: any[]) => mockCancelDownload(...a),
  },
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadResume', () => ({
  resumeImageDownload: (...args: any[]) => mockResumeImageDownload(...args),
}));

jest.mock('../../../../src/services/huggingFaceModelBrowser', () => ({
  fetchAvailableModels: (...a: any[]) => mockFetchAvailableModels(...a),
  guessStyle: (...a: any[]) => mockGuessStyle(...a),
}));

jest.mock('../../../../src/services/coreMLModelBrowser', () => ({
  fetchAvailableCoreMLModels: (...a: any[]) => mockFetchAvailableCoreMLModels(...a),
}));

jest.mock('../../../../src/screens/ModelsScreen/utils', () => ({
  matchesSdVersionFilter: (...a: any[]) => mockMatchesSdVersionFilter(...a),
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadActions', () => ({
  handleDownloadImageModel: jest.fn(),
  cancelSyntheticImageDownload: (...a: any[]) => mockCancelSynthetic(...a),
}));

const setAlertState = jest.fn();
const addDownloadedImageModel = jest.fn();
const setActiveImageModelId = jest.fn();

let appState: any;
let downloadStoreState: any;

function setDownloads(downloads: Record<string, any>) {
  downloadStoreState = { downloads, remove: mockStoreRemove };
  mockStoreGetState.mockReturnValue(downloadStoreState);
  mockUseDownloadStore.mockImplementation((selector?: any) =>
    selector ? selector(downloadStoreState) : downloadStoreState,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'android';
  mockGetDownloadedImageModels.mockResolvedValue([]);
  mockResumeImageDownload.mockResolvedValue(undefined);
  mockCancelDownload.mockResolvedValue(undefined);
  mockCancelSynthetic.mockResolvedValue(undefined);
  mockGetSoCInfo.mockResolvedValue({ hasNPU: true });
  mockGetImageModelRecommendation.mockResolvedValue({
    recommendedBackend: 'all',
    bannerText: 'banner ok',
  });
  mockFetchAvailableModels.mockResolvedValue([]);
  mockFetchAvailableCoreMLModels.mockResolvedValue([]);
  mockGuessStyle.mockReturnValue('all');
  mockMatchesSdVersionFilter.mockReturnValue(true);

  appState = {
    downloadedImageModels: [],
    setDownloadedImageModels: mockSetDownloadedImageModels,
    addDownloadedImageModel,
    activeImageModelId: null,
    setActiveImageModelId,
    onboardingChecklist: { triedImageGen: true },
  };
  mockUseAppStore.mockImplementation((selector?: any) =>
    selector ? selector(appState) : appState,
  );

  setDownloads({});
});

// ── loadHFModels ──────────────────────────────────────────────────────

describe('loadHFModels', () => {
  it('fetches CoreML models and maps them on iOS', async () => {
    (Platform as any).OS = 'ios';
    mockFetchAvailableCoreMLModels.mockResolvedValueOnce([
      {
        id: 'cm-1', name: 'CM', displayName: 'CoreML Model', fileName: 'a.mlmodelc',
        downloadUrl: 'http://x', size: 100, repo: 'org/repo',
        files: ['f1'], attentionVariant: 'split',
      },
    ]);

    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.loadHFModels(); });

    expect(mockFetchAvailableCoreMLModels).toHaveBeenCalledWith(false);
    expect(result.current.availableHFModels[0]).toMatchObject({
      id: 'cm-1', backend: 'coreml', _coreml: true,
      _coremlFiles: ['f1'], _coremlAttentionVariant: 'split',
    });
    expect(result.current.hfModelsLoading).toBe(false);
  });

  it('fetches HF models on Android passing skipQnn from SoC NPU flag', async () => {
    mockGetSoCInfo.mockResolvedValueOnce({ hasNPU: false });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.loadHFModels(true); });

    expect(mockFetchAvailableModels).toHaveBeenCalledWith(true, { skipQnn: true });
    expect(result.current.hfModelsError).toBeNull();
  });

  it('captures error.message into hfModelsError', async () => {
    mockGetSoCInfo.mockRejectedValueOnce(new Error('soc failed'));
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.loadHFModels(); });
    expect(result.current.hfModelsError).toBe('soc failed');
  });

  it('falls back to default error string when error has no message', async () => {
    mockGetSoCInfo.mockRejectedValueOnce({});
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.loadHFModels(); });
    expect(result.current.hfModelsError).toBe('Failed to fetch models');
  });
});

// ── hardware recommendation effect ────────────────────────────────────

describe('recommendation effect → backendFilter', () => {
  it('sets backendFilter to qnn when recommendedBackend is qnn', async () => {
    mockGetImageModelRecommendation.mockResolvedValue({ recommendedBackend: 'qnn', bannerText: 'b' });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await waitFor(() => expect(result.current.backendFilter).toBe('qnn'));
  });

  it('sets backendFilter to mnn when recommendedBackend is mnn', async () => {
    mockGetImageModelRecommendation.mockResolvedValue({ recommendedBackend: 'mnn', bannerText: 'b' });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await waitFor(() => expect(result.current.backendFilter).toBe('mnn'));
  });

  it('leaves backendFilter at all when recommendedBackend is neither qnn nor mnn', async () => {
    mockGetImageModelRecommendation.mockResolvedValue({ recommendedBackend: 'all', bannerText: 'b' });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.backendFilter).toBe('all');
  });

  it('does not auto-set backendFilter on iOS', async () => {
    (Platform as any).OS = 'ios';
    mockGetImageModelRecommendation.mockResolvedValue({ recommendedBackend: 'qnn', bannerText: 'b' });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.backendFilter).toBe('all');
  });

  it('updates imageRecommendation banner text from rec, with loading fallback before resolve', async () => {
    let resolveRec!: (v: any) => void;
    mockGetImageModelRecommendation.mockReturnValue(new Promise(r => { resolveRec = r; }));
    const { result } = renderHook(() => useImageModels(setAlertState));
    expect(result.current.imageRecommendation).toBe('Loading recommendation...');
    await act(async () => { resolveRec({ recommendedBackend: 'all', bannerText: 'Recommended X' }); });
    await waitFor(() => expect(result.current.imageRecommendation).toBe('Recommended X'));
  });
});

// ── isRecommendedModel ────────────────────────────────────────────────

describe('isRecommendedModel', () => {
  function hookWithRec(rec: any) {
    mockGetImageModelRecommendation.mockResolvedValue(rec);
    return renderHook(() => useImageModels(setAlertState));
  }

  it('returns false when there is no recommendation yet', () => {
    // synchronous read before the async rec resolves
    mockGetImageModelRecommendation.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useImageModels(setAlertState));
    expect(result.current.isRecommendedModel({ backend: 'qnn' } as any)).toBe(false);
  });

  it('returns false when backend differs and rec is not "all"', async () => {
    const { result } = hookWithRec({ recommendedBackend: 'qnn', bannerText: 'b' });
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.isRecommendedModel({ backend: 'mnn', name: 'x', repo: 'r', id: 'i' } as any)).toBe(false);
  });

  it('matches on qnnVariant when present in the model variant', async () => {
    const { result } = hookWithRec({ recommendedBackend: 'qnn', qnnVariant: 'v2', bannerText: 'b' });
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.isRecommendedModel({ backend: 'qnn', variant: 'model-v2-fast' } as any)).toBe(true);
    expect(result.current.isRecommendedModel({ backend: 'qnn', variant: 'model-v1' } as any)).toBe(false);
  });

  it('matches against recommendedModels list by name/repo/id substrings', async () => {
    const { result } = hookWithRec({ recommendedBackend: 'all', recommendedModels: ['turbo'], bannerText: 'b' });
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.isRecommendedModel({ backend: 'mnn', name: 'SD Turbo', repo: 'org/x', id: 'id1' } as any)).toBe(true);
    expect(result.current.isRecommendedModel({ backend: 'mnn', name: 'Plain', repo: 'org/y', id: 'id2' } as any)).toBe(false);
  });

  it('returns true by default when rec matches and no qnnVariant/recommendedModels', async () => {
    const { result } = hookWithRec({ recommendedBackend: 'all', bannerText: 'b' });
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    expect(result.current.isRecommendedModel({ backend: 'mnn', name: 'x', repo: 'r', id: 'i' } as any)).toBe(true);
  });
});

// ── filteredHFModels ──────────────────────────────────────────────────

describe('filteredHFModels', () => {
  const models = [
    { id: 'a', name: 'Alpha', displayName: 'Alpha SD', backend: 'mnn', repo: 'org/a' },
    { id: 'b', name: 'Beta', displayName: 'Beta SD', backend: 'qnn', repo: 'org/b' },
  ];

  async function seed(result: any) {
    mockFetchAvailableModels.mockResolvedValue(models);
    await act(async () => { await result.current.loadHFModels(); });
  }

  it('hides non-recommended models when showRecommendedOnly is on', async () => {
    mockGetImageModelRecommendation.mockResolvedValue({ recommendedBackend: 'qnn', bannerText: 'b' });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await waitFor(() => expect(result.current.imageRec).not.toBeNull());
    await seed(result);
    // only the qnn model is recommended
    await waitFor(() => {
      expect(result.current.filteredHFModels.map((m: any) => m.id)).toEqual(['b']);
    });
  });

  it('applies backend, downloaded, and query filters and sorts when not recommended-only', async () => {
    appState.downloadedImageModels = [{ id: 'a' }];
    const { result } = renderHook(() => useImageModels(setAlertState));
    await seed(result);
    act(() => { result.current.setShowRecommendedOnly(false); });
    act(() => { result.current.setBackendFilter('qnn'); });
    // 'a' is downloaded so filtered out; 'b' is qnn and passes
    await waitFor(() => {
      expect(result.current.filteredHFModels.map((m: any) => m.id)).toEqual(['b']);
    });
    // query that matches nothing
    act(() => { result.current.setImageSearchQuery('zzz'); });
    await waitFor(() => expect(result.current.filteredHFModels).toHaveLength(0));
  });

  it('filters out by style and sd version', async () => {
    mockGuessStyle.mockReturnValue('anime');
    mockMatchesSdVersionFilter.mockReturnValue(false);
    const { result } = renderHook(() => useImageModels(setAlertState));
    await seed(result);
    act(() => { result.current.setShowRecommendedOnly(false); });
    act(() => { result.current.setStyleFilter('realistic'); });
    await waitFor(() => expect(result.current.filteredHFModels).toHaveLength(0));
  });
});

// ── handleCancelImageDownload ─────────────────────────────────────────

describe('handleCancelImageDownload', () => {
  it('returns early when there is no store entry', async () => {
    setDownloads({});
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.handleCancelImageDownload('m1'); });
    expect(mockStoreRemove).not.toHaveBeenCalled();
    expect(mockCancelDownload).not.toHaveBeenCalled();
  });

  it('removes entry but skips native cancel when entry has no downloadId', async () => {
    setDownloads({ 'image:m1': { downloadId: '', modelKey: 'image:m1' } });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.handleCancelImageDownload('m1'); });
    expect(mockStoreRemove).toHaveBeenCalledWith('image:m1');
    expect(mockCancelDownload).not.toHaveBeenCalled();
    expect(mockCancelSynthetic).not.toHaveBeenCalled();
  });

  it('cancels synthetic multi-file downloads without calling native cancel', async () => {
    setDownloads({ 'image:m1': { downloadId: 'image-multi:m1', modelKey: 'image:m1' } });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.handleCancelImageDownload('m1'); });
    expect(mockCancelSynthetic).toHaveBeenCalledWith('m1');
    expect(mockCancelDownload).not.toHaveBeenCalled();
  });

  it('calls native cancelDownload for a normal downloadId', async () => {
    setDownloads({ 'image:m1': { downloadId: 'native-7', modelKey: 'image:m1' } });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.handleCancelImageDownload('m1'); });
    expect(mockCancelDownload).toHaveBeenCalledWith('native-7');
  });

  it('swallows native cancel rejection', async () => {
    mockCancelDownload.mockRejectedValueOnce(new Error('boom'));
    setDownloads({ 'image:m1': { downloadId: 'native-7', modelKey: 'image:m1' } });
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => {
      await expect(result.current.handleCancelImageDownload('m1')).resolves.toBeUndefined();
    });
  });
});

// ── loadDownloadedImageModels + clearImageFilters ─────────────────────

describe('loadDownloadedImageModels / clearImageFilters', () => {
  it('loads downloaded image models into the store', async () => {
    mockGetDownloadedImageModels.mockResolvedValue([{ id: 'x' }]);
    const { result } = renderHook(() => useImageModels(setAlertState));
    await act(async () => { await result.current.loadDownloadedImageModels(); });
    expect(mockSetDownloadedImageModels).toHaveBeenCalledWith([{ id: 'x' }]);
  });

  it('clearImageFilters resets all filters and marks backend user-changed', async () => {
    const { result } = renderHook(() => useImageModels(setAlertState));
    act(() => { result.current.setBackendFilter('qnn'); });
    act(() => { result.current.clearImageFilters(); });
    expect(result.current.backendFilter).toBe('all');
    expect(result.current.styleFilter).toBe('all');
    expect(result.current.sdVersionFilter).toBe('all');
    expect(result.current.hasActiveImageFilters).toBe(false);
  });
});
