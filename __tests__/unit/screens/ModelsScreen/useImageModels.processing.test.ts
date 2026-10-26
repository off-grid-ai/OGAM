import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useImageModels } from '../../../../src/screens/ModelsScreen/useImageModels';

const mockUseAppStore = jest.fn();
const mockUseDownloadStore = jest.fn();
const mockGetDownloadedImageModels = jest.fn();
const mockSetDownloadedImageModels = jest.fn();
const mockResumeImageDownload = jest.fn();

jest.mock('../../../../src/stores', () => ({
  useAppStore: (selector?: any) => mockUseAppStore(selector),
}));

jest.mock('../../../../src/stores/downloadStore', () => {
  const useDownloadStore = (selector?: any) => mockUseDownloadStore(selector);
  (useDownloadStore as any).getState = () => (mockUseDownloadStore as any).state;
  return { useDownloadStore };
});

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getDownloadedImageModels: (...args: any[]) => mockGetDownloadedImageModels(...args),
  },
  hardwareService: {
    getSoCInfo: jest.fn().mockResolvedValue({ hasNPU: true }),
    // The phone's memory picks which sd.cpp models are recommended (9061db452).
    getTotalMemoryGB: () => 8,
    getImageModelRecommendation: jest.fn().mockResolvedValue({
      recommendedBackend: 'all',
      bannerText: 'ok',
      compatibleBackends: ['mnn', 'qnn', 'coreml'],
    }),
  },
  backgroundDownloadService: {
    cancelDownload: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadResume', () => ({
  resumeImageDownload: (...args: any[]) => mockResumeImageDownload(...args),
}));

jest.mock('../../../../src/services/huggingFaceModelBrowser', () => ({
  fetchAvailableModels: jest.fn().mockResolvedValue([]),
  guessStyle: jest.fn(() => 'all'),
  // No sd.cpp catalog models in this suite (9061db452 reads the recommended ones).
  getRecommendedSDImageModels: jest.fn(() => []),
}));

jest.mock('../../../../src/services/coreMLModelBrowser', () => ({
  fetchAvailableCoreMLModels: jest.fn().mockResolvedValue([]),
}));

describe('useImageModels processing resume', () => {
  const setAlertState = jest.fn();
  const addDownloadedImageModel = jest.fn();
  const setActiveImageModelId = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDownloadedImageModels.mockResolvedValue([]);
    mockResumeImageDownload.mockResolvedValue(undefined);

    const appState = {
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

    const storeState = {
      downloads: {},
      remove: jest.fn(),
    };
    (mockUseDownloadStore as any).state = storeState;
    mockUseDownloadStore.mockImplementation((selector?: any) =>
      selector ? selector(storeState) : storeState,
    );
  });

  it('resumes image downloads that enter processing after mount', async () => {
    const { rerender } = renderHook(({ _tick }: { _tick: number }) => useImageModels(setAlertState), {
      initialProps: { _tick: 0 },
    });

    await waitFor(() => {
      expect(mockSetDownloadedImageModels).toHaveBeenCalled();
    });
    expect(mockResumeImageDownload).not.toHaveBeenCalled();

    const processingEntry = {
      modelKey: 'image:test-image',
      downloadId: 'dl-1',
      modelId: 'image:test-image',
      fileName: 'test-image.zip',
      quantization: '',
      modelType: 'image',
      status: 'processing',
      bytesDownloaded: 10,
      totalBytes: 10,
      combinedTotalBytes: 10,
      progress: 1,
      createdAt: Date.now(),
    };

    const storeState = {
      downloads: { [processingEntry.modelKey]: processingEntry },
      remove: jest.fn(),
    };
    (mockUseDownloadStore as any).state = storeState;
    mockUseDownloadStore.mockImplementation((selector?: any) =>
      selector ? selector(storeState) : storeState,
    );
    rerender({ _tick: 1 });

    await waitFor(() => {
      expect(mockResumeImageDownload).toHaveBeenCalledWith(
        processingEntry,
        expect.objectContaining({
          addDownloadedImageModel,
          activeImageModelId: null,
          setActiveImageModelId,
          setAlertState,
          triedImageGen: true,
        }),
      );
    });
  });

  it('does not resume the same processing entry twice while a resume is in flight', async () => {
    let resolveResume!: () => void;
    mockResumeImageDownload.mockImplementation(
      () => new Promise<void>(resolve => { resolveResume = resolve; }),
    );

    const processingEntry = {
      modelKey: 'image:test-image',
      downloadId: 'dl-1',
      modelId: 'image:test-image',
      fileName: 'test-image.zip',
      quantization: '',
      modelType: 'image',
      status: 'processing',
      bytesDownloaded: 10,
      totalBytes: 10,
      combinedTotalBytes: 10,
      progress: 1,
      createdAt: Date.now(),
    };

    const storeState = {
      downloads: { [processingEntry.modelKey]: processingEntry },
      remove: jest.fn(),
    };
    (mockUseDownloadStore as any).state = storeState;
    mockUseDownloadStore.mockImplementation((selector?: any) =>
      selector ? selector(storeState) : storeState,
    );
    const { rerender } = renderHook(({ _tick }: { _tick: number }) => useImageModels(setAlertState), {
      initialProps: { _tick: 0 },
    });

    await waitFor(() => {
      expect(mockResumeImageDownload).toHaveBeenCalledTimes(1);
    });

    rerender({ _tick: 1 });
    expect(mockResumeImageDownload).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResume();
      await Promise.resolve();
    });
  });
});
