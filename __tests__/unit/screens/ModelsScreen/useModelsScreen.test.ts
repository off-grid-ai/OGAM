/**
 * useModelsScreen Hook Unit Tests
 *
 * Tests for the ModelsScreen orchestrator hook including:
 * - Tab switching
 * - Import flow
 * - Refresh handling
 */

import { renderHook, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { useModelsScreen } from '../../../../src/screens/ModelsScreen/useModelsScreen';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
}));

// Mock RNFS
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  readDir: jest.fn().mockResolvedValue([]),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

// Mock zip
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn().mockResolvedValue('/unzipped'),
}));

// Mock document picker
const mockPick = jest.fn();
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: any[]) => mockPick(...args),
  types: { allFiles: 'public.all-files' },
  isErrorWithCode: (error: any) => error?.code !== undefined,
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

// Mock CustomAlert
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title, message) => ({ title, message, visible: true })),
  initialAlertState: { title: '', message: '', visible: false },
}));

// Mock useFocusTrigger
jest.mock('../../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: jest.fn(() => ({ focused: true, trigger: jest.fn() })),
}));

// Mock useTextModels
jest.mock('../../../../src/screens/ModelsScreen/useTextModels', () => ({
  useTextModels: jest.fn(() => ({
    downloadedModels: [],
    searchQuery: '',
    setSearchQuery: jest.fn(),
    isLoading: false,
    isRefreshing: false,
    setIsRefreshing: jest.fn(),
    hasSearched: false,
    selectedModel: null,
    setSelectedModel: jest.fn(),
    modelFiles: [],
    setModelFiles: jest.fn(),
    isLoadingFiles: false,
    filterState: { orgs: [], type: 'all', source: 'all', size: 'all', quant: 'all', expandedDimension: null },
    setFilterState: jest.fn(),
    textFiltersVisible: false,
    setTextFiltersVisible: jest.fn(),
    downloadProgress: {},
    hasActiveFilters: false,
    ramGB: 8,
    deviceRecommendation: 'medium',
    filteredResults: [],
    recommendedAsModelInfo: null,
    trendingAsModelInfo: [],
    handleSearch: jest.fn(),
    handleSelectModel: jest.fn(),
    handleDownload: jest.fn(),
    handleRepairMmProj: jest.fn(),
    handleCancelDownload: jest.fn(),
    downloadIds: {},
    clearFilters: jest.fn(),
    toggleFilterDimension: jest.fn(),
    toggleOrg: jest.fn(),
    setTypeFilter: jest.fn(),
    setSourceFilter: jest.fn(),
    setSizeFilter: jest.fn(),
    setQuantFilter: jest.fn(),
    isModelDownloaded: jest.fn(),
    getDownloadedModel: jest.fn(),
    loadDownloadedModels: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock useImageModels
jest.mock('../../../../src/screens/ModelsScreen/useImageModels', () => ({
  useImageModels: jest.fn(() => ({
    downloadedImageModels: [],
    availableHFModels: [],
    hfModelsLoading: false,
    hfModelsError: null,
    backendFilter: 'all',
    setBackendFilter: jest.fn(),
    styleFilter: 'all',
    setStyleFilter: jest.fn(),
    sdVersionFilter: 'all',
    setSdVersionFilter: jest.fn(),
    imageFilterExpanded: null,
    setImageFilterExpanded: jest.fn(),
    imageSearchQuery: '',
    setImageSearchQuery: jest.fn(),
    imageFiltersVisible: false,
    setImageFiltersVisible: jest.fn(),
    imageRec: null,
    showRecommendedOnly: false,
    setShowRecommendedOnly: jest.fn(),
    showRecHint: false,
    setShowRecHint: jest.fn(),
    imageModelProgress: {},
    imageModelDownloading: null,
    hasActiveImageFilters: false,
    filteredHFModels: [],
    imageRecommendation: null,
    loadHFModels: jest.fn().mockResolvedValue(undefined),
    clearImageFilters: jest.fn(),
    isRecommendedModel: jest.fn(),
    handleDownloadImageModel: jest.fn(),
    setUserChangedBackendFilter: jest.fn(),
    loadDownloadedImageModels: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock useAppStore
jest.mock('../../../../src/stores', () => ({
  useAppStore: jest.fn(() => ({
    addDownloadedModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    addDownloadedImageModel: jest.fn(),
  })),
}));

const mockDownloads: Record<string, any> = {};
jest.mock('../../../../src/stores/downloadStore', () => ({
  useDownloadStore: jest.fn((selector?: any) =>
    selector ? selector({ downloads: mockDownloads }) : { downloads: mockDownloads }),
  isActiveStatus: (status: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(status),
}));

// Mock modelManager
jest.mock('../../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: jest.fn(() => '/models/images'),
    addDownloadedImageModel: jest.fn().mockResolvedValue(undefined),
    importLocalModel: jest.fn().mockResolvedValue({ id: 'model-1', name: 'Test Model' }),
  },
}));

// Mock utils
jest.mock('../../../../src/screens/ModelsScreen/utils', () => ({
  getDirectorySize: jest.fn().mockResolvedValue(1024),
}));

// Mock coreMLModelUtils
jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn().mockResolvedValue('/resolved/model'),
}));

describe('useModelsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDownloads).forEach(k => delete mockDownloads[k]);
  });

  describe('initial state', () => {
    it('returns default activeTab as text', () => {
      const { result } = renderHook(() => useModelsScreen());
      expect(result.current.activeTab).toBe('text');
    });

    it('returns isImporting as false initially', () => {
      const { result } = renderHook(() => useModelsScreen());
      expect(result.current.isImporting).toBe(false);
    });

    it('returns importProgress as null initially', () => {
      const { result } = renderHook(() => useModelsScreen());
      expect(result.current.importProgress).toBeNull();
    });
  });

  describe('setActiveTab', () => {
    it('changes active tab and resets filters', () => {
      const { result } = renderHook(() => useModelsScreen());

      act(() => {
        result.current.setActiveTab('image');
      });

      expect(result.current.activeTab).toBe('image');
    });
  });

  describe('handleImportLocalModel', () => {
    it('returns early when no file selected', async () => {
      mockPick.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(result.current.isImporting).toBe(false);
    });

    it('shows alert for invalid file type', async () => {
      mockPick.mockResolvedValueOnce([{ uri: 'file://test.pdf', name: 'test.pdf' }]);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(result.current.alertState.visible).toBe(true);
      expect(result.current.alertState.title).toBe('Invalid File');
    });

    it('handles OPERATION_CANCELED error gracefully', async () => {
      const canceledError = { code: 'OPERATION_CANCELED' };
      mockPick.mockRejectedValueOnce(canceledError);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      // Should not show alert for canceled operations
      expect(result.current.alertState.visible).toBe(false);
    });

    it('shows alert for other errors', async () => {
      mockPick.mockRejectedValueOnce(new Error('Pick failed'));
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(result.current.alertState.visible).toBe(true);
      expect(result.current.alertState.title).toBe('Import Failed');
    });
  });

  describe('handleRefresh', () => {
    it('calls refresh methods', async () => {
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');

      const mockLoadDownloadedModels = jest.fn().mockResolvedValue(undefined);
      const mockLoadDownloadedImageModels = jest.fn().mockResolvedValue(undefined);
      const mockLoadHFModels = jest.fn().mockResolvedValue(undefined);
      const mockSetIsRefreshing = jest.fn();

      useTextModels.mockReturnValue({
        downloadedModels: [],
        setIsRefreshing: mockSetIsRefreshing,
        loadDownloadedModels: mockLoadDownloadedModels,
        hasSearched: false,
        searchQuery: '',
        handleSearch: jest.fn(),
        downloadProgress: {},
      });

      useImageModels.mockReturnValue({
        downloadedImageModels: [],
        loadDownloadedImageModels: mockLoadDownloadedImageModels,
        loadHFModels: mockLoadHFModels,
        availableHFModels: [],
        hfModelsLoading: false,
      });

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleRefresh();
      });

      expect(mockLoadDownloadedModels).toHaveBeenCalled();
      expect(mockLoadDownloadedImageModels).toHaveBeenCalled();
      expect(mockSetIsRefreshing).toHaveBeenCalledWith(false);
    });
  });

  describe('totalModelCount', () => {
    it('calculates total from text and image models including in-progress downloads', () => {
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');

      useTextModels.mockReturnValue({
        downloadedModels: [{ id: '1' }, { id: '2' }],
      });

      useImageModels.mockReturnValue({
        downloadedImageModels: [{ id: '4' }],
      });

      mockDownloads['org/repo/file.gguf'] = { status: 'running' };

      const { result } = renderHook(() => useModelsScreen());

      // 2 text + 1 image + 1 in-progress = 4
      expect(result.current.totalModelCount).toBe(4);
    });
  });

  describe('handleImportLocalModel - GGUF success path', () => {
    it('imports single GGUF file successfully (object-arg signature)', async () => {
      const { modelManager } = require('../../../../src/services');
      const { useAppStore } = require('../../../../src/stores');

      mockPick.mockResolvedValueOnce([{ uri: 'file://test.gguf', name: 'test.gguf', size: 4000 }]);
      modelManager.importLocalModel.mockResolvedValueOnce({ id: 'gguf-1', name: 'Test GGUF Model' });
      useAppStore.mockReturnValue({
        addDownloadedModel: jest.fn(),
        activeImageModelId: null,
        setActiveImageModelId: jest.fn(),
        addDownloadedImageModel: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      // importLocalModel now takes an options object, not positional args
      expect(modelManager.importLocalModel).toHaveBeenCalledWith(expect.objectContaining({
        sourceUri: 'file://test.gguf',
        fileName: 'test.gguf',
        sourceSize: 4000,
        onProgress: expect.any(Function),
      }));
      expect(result.current.alertState.visible).toBe(true);
      expect(result.current.alertState.title).toBe('Success');
      expect(result.current.isImporting).toBe(false);
      expect(result.current.importProgress).toBeNull();
    });

    it('returns early without calling pick if isImporting is already true', async () => {
      const { modelManager } = require('../../../../src/services');
      const { result } = renderHook(() => useModelsScreen());

      // Make importLocalModel hang so isImporting stays true after pick returns
      let resolveImport!: (v: any) => void;
      const hangingImport = new Promise(r => { resolveImport = r; });
      mockPick.mockResolvedValueOnce([{ uri: 'file://test.gguf', name: 'test.gguf', size: 100 }]);
      modelManager.importLocalModel.mockReturnValueOnce(hangingImport);

      // Start first import — pick returns, isImporting becomes true, import hangs
      const firstImport = act(() => { result.current.handleImportLocalModel(); });

      // Give the first import time to set isImporting=true
      await act(async () => {});

      // Second call should bail early because isImporting is now true
      await act(async () => { await result.current.handleImportLocalModel(); });

      // pick should only have been called once
      expect(mockPick).toHaveBeenCalledTimes(1);

      // Resolve the hanging import to clean up
      act(() => { resolveImport({ id: 'x', name: 'X' }); });
      await firstImport;
    });

    it('shows "Invalid File" alert when a non-gguf/non-zip file is selected', async () => {
      mockPick.mockResolvedValueOnce([{ uri: 'file://doc.pdf', name: 'doc.pdf', size: 100 }]);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => { await result.current.handleImportLocalModel(); });

      expect(result.current.alertState.visible).toBe(true);
      expect(result.current.alertState.title).toBe('Invalid File');
      expect(result.current.isImporting).toBe(false);
    });

    it('shows "Invalid File" when multiple files include a non-gguf', async () => {
      mockPick.mockResolvedValueOnce([
        { uri: 'file://a.gguf', name: 'a.gguf', size: 4000 },
        { uri: 'file://b.pdf', name: 'b.pdf', size: 100 },
      ]);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => { await result.current.handleImportLocalModel(); });

      expect(result.current.alertState.title).toBe('Invalid File');
    });

    it('shows "Too Many Files" when more than 2 gguf files selected', async () => {
      mockPick.mockResolvedValueOnce([
        { uri: 'file://a.gguf', name: 'a.gguf', size: 4000 },
        { uri: 'file://b.gguf', name: 'b.gguf', size: 300 },
        { uri: 'file://c.gguf', name: 'c.gguf', size: 200 },
      ]);
      const { result } = renderHook(() => useModelsScreen());

      await act(async () => { await result.current.handleImportLocalModel(); });

      expect(result.current.alertState.title).toBe('Too Many Files');
      expect(result.current.isImporting).toBe(false);
    });
  });

  describe('handleImportImageModelZip', () => {
    it('imports image model zip successfully on iOS', async () => {
      const { modelManager } = require('../../../../src/services');
      const { useAppStore } = require('../../../../src/stores');
      const RNFS = require('react-native-fs');

      // Set Platform.OS to ios
      (Platform as any).OS = 'ios';

      mockPick.mockResolvedValueOnce([{ uri: 'file://test.zip', name: 'TestModel.zip', size: 0 }]);
      modelManager.addDownloadedImageModel.mockResolvedValueOnce(undefined);
      useAppStore.mockReturnValue({
        addDownloadedModel: jest.fn(),
        activeImageModelId: null,
        setActiveImageModelId: jest.fn(),
        addDownloadedImageModel: jest.fn(),
      });
      RNFS.readDir.mockResolvedValueOnce([{ name: 'model.mnn', isDirectory: () => false }]);

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(RNFS.moveFile).toHaveBeenCalled();
      expect(result.current.alertState.title).toBe('Success');
    });

    it('imports image model zip with CoreML mlmodelc', async () => {
      const { modelManager } = require('../../../../src/services');
      const { resolveCoreMLModelDir } = require('../../../../src/utils/coreMLModelUtils');
      const RNFS = require('react-native-fs');

      (Platform as any).OS = 'ios';
      mockPick.mockResolvedValueOnce([{ uri: 'file://coreml.zip', name: 'CoreMLModel.zip', size: 0 }]);
      RNFS.readDir.mockResolvedValueOnce([{ name: 'model.mlmodelc', isDirectory: () => true }]);
      resolveCoreMLModelDir.mockResolvedValueOnce('/resolved/coreml');
      modelManager.addDownloadedImageModel.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(resolveCoreMLModelDir).toHaveBeenCalled();
    });

    it('imports image model zip with nested mlmodelc directory', async () => {
      require('../../../../src/services');
      const { resolveCoreMLModelDir } = require('../../../../src/utils/coreMLModelUtils');
      const RNFS = require('react-native-fs');

      (Platform as any).OS = 'ios';
      mockPick.mockResolvedValueOnce([{ uri: 'file://nested.zip', name: 'NestedCoreML.zip' }]);
      // First check has no mlmodelc but has directory
      RNFS.readDir.mockResolvedValueOnce([
        { name: 'subdir', isDirectory: () => true },
      ]);
      resolveCoreMLModelDir.mockResolvedValueOnce('/resolved/nested');

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(resolveCoreMLModelDir).toHaveBeenCalled();
    });

    it('imports image model with QNN backend (bin files)', async () => {
      require('../../../../src/services');
      const RNFS = require('react-native-fs');

      (Platform as any).OS = 'android';
      mockPick.mockResolvedValueOnce([{ uri: 'file://qnn.zip', name: 'QNNModel.zip' }]);
      RNFS.readDir.mockResolvedValueOnce([
        { name: 'model.bin', isDirectory: () => false },
      ]);

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(RNFS.copyFile).toHaveBeenCalled();
    });

    it('sets active image model id when none is active', async () => {
      require('../../../../src/services');
      const { useAppStore } = require('../../../../src/stores');
      const RNFS = require('react-native-fs');

      const mockSetActiveImageModelId = jest.fn();
      mockPick.mockResolvedValueOnce([{ uri: 'file://test.zip', name: 'Test.zip' }]);
      useAppStore.mockReturnValue({
        addDownloadedModel: jest.fn(),
        activeImageModelId: null,
        setActiveImageModelId: mockSetActiveImageModelId,
        addDownloadedImageModel: jest.fn(),
      });
      RNFS.readDir.mockResolvedValueOnce([{ name: 'model.mnn', isDirectory: () => false }]);

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(mockSetActiveImageModelId).toHaveBeenCalled();
    });

    it('does not set active image model id when one is already active', async () => {
      require('../../../../src/services');
      const { useAppStore } = require('../../../../src/stores');
      const RNFS = require('react-native-fs');

      const mockSetActiveImageModelId = jest.fn();
      mockPick.mockResolvedValueOnce([{ uri: 'file://test.zip', name: 'Test.zip' }]);
      useAppStore.mockReturnValue({
        addDownloadedModel: jest.fn(),
        activeImageModelId: 'existing-model-id',
        setActiveImageModelId: mockSetActiveImageModelId,
        addDownloadedImageModel: jest.fn(),
      });
      RNFS.readDir.mockResolvedValueOnce([{ name: 'model.mnn', isDirectory: () => false }]);

      const { result } = renderHook(() => useModelsScreen());

      await act(async () => {
        await result.current.handleImportLocalModel();
      });

      expect(mockSetActiveImageModelId).not.toHaveBeenCalled();
    });
  });

  describe('handleDownload callback', () => {
    it('calls text.handleDownload directly with correct args', () => {
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const mockHandleDownload = jest.fn();

      useTextModels.mockReturnValue({
        downloadedModels: [],
        setIsRefreshing: jest.fn(),
        loadDownloadedModels: jest.fn().mockResolvedValue(undefined),
        hasSearched: false,
        searchQuery: '',
        handleSearch: jest.fn(),
        handleDownload: mockHandleDownload,
        downloadProgress: {},
        setFilterState: jest.fn(),
        setTextFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());
      const mockModel: any = { id: 'model-id', name: 'Test', author: 'Test', files: [] };
      const mockFile: any = { name: 'url', size: 100, quantization: 'Q4', downloadUrl: 'http://test' };

      act(() => {
        result.current.handleDownload(mockModel, mockFile);
      });

      expect(mockHandleDownload).toHaveBeenCalledWith(mockModel, mockFile);
    });

    it('starts a download even when 2+ are already active (no "Starting more can affect performance" gate)', () => {
      // The concurrency cap + FIFO queue in backgroundDownloadService owns this now,
      // so a 3rd+ start just queues. The old caller-side alert must be gone.
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const { showAlert } = require('../../../../src/components/CustomAlert');
      const mockHandleDownload = jest.fn();
      mockDownloads['a/x/a.gguf'] = { status: 'running' };
      mockDownloads['b/y/b.gguf'] = { status: 'running' };
      useTextModels.mockReturnValue({
        downloadedModels: [], setIsRefreshing: jest.fn(),
        loadDownloadedModels: jest.fn().mockResolvedValue(undefined),
        hasSearched: false, searchQuery: '', handleSearch: jest.fn(),
        handleDownload: mockHandleDownload, downloadProgress: {},
        setFilterState: jest.fn(), setTextFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());
      const mockModel: any = { id: 'model-id', name: 'Test', author: 'Test', files: [] };
      const mockFile: any = { name: 'url', size: 100, quantization: 'Q4', downloadUrl: 'http://test' };
      act(() => { result.current.handleDownload(mockModel, mockFile); });

      expect(mockHandleDownload).toHaveBeenCalledWith(mockModel, mockFile);
      expect(showAlert).not.toHaveBeenCalledWith('Downloads Already Active', expect.anything(), expect.anything());
    });
  });

  describe('handleDownloadImageModel callback', () => {
    it('calls image.handleDownloadImageModel directly with correct args', () => {
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');
      const mockHandleDownloadImageModel = jest.fn();

      useImageModels.mockReturnValue({
        downloadedImageModels: [],
        loadDownloadedImageModels: jest.fn().mockResolvedValue(undefined),
        loadHFModels: jest.fn().mockResolvedValue(undefined),
        availableHFModels: [],
        hfModelsLoading: false,
        handleDownloadImageModel: mockHandleDownloadImageModel,
        setImageFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());
      const mockImageModel: any = {
        id: 'img-model', name: 'Test Model', description: 'Test',
        downloadUrl: 'http://test', size: 100, style: 'default', backend: 'mnn',
      };

      act(() => {
        result.current.handleDownloadImageModel(mockImageModel);
      });

      expect(mockHandleDownloadImageModel).toHaveBeenCalledWith(mockImageModel);
    });
  });

  describe('useEffect - load HF models on image tab', () => {
    it('loads HF models when switching to image tab with empty models', () => {
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const mockLoadHFModels = jest.fn();

      useTextModels.mockReturnValue({
        downloadedModels: [],
        setFilterState: jest.fn(),
        setTextFiltersVisible: jest.fn(),
        downloadProgress: {},
      });

      useImageModels.mockReturnValue({
        downloadedImageModels: [],
        availableHFModels: [],
        hfModelsLoading: false,
        loadHFModels: mockLoadHFModels,
        setImageFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());

      // Default tab is 'text', no load should happen
      expect(mockLoadHFModels).not.toHaveBeenCalled();

      act(() => {
        result.current.setActiveTab('image');
      });

      // Should now load HF models
      expect(mockLoadHFModels).toHaveBeenCalled();
    });

    it('does not load HF models if already loading', () => {
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const mockLoadHFModels = jest.fn();

      useTextModels.mockReturnValue({
        downloadedModels: [],
        setFilterState: jest.fn(),
        setTextFiltersVisible: jest.fn(),
        downloadProgress: {},
      });

      useImageModels.mockReturnValue({
        downloadedImageModels: [],
        availableHFModels: [],
        hfModelsLoading: true,
        loadHFModels: mockLoadHFModels,
        setImageFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());

      act(() => {
        result.current.setActiveTab('image');
      });

      // Should not load since already loading
      expect(mockLoadHFModels).not.toHaveBeenCalled();
    });

    it('does not load HF models if models already exist', () => {
      const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');
      const { useTextModels } = require('../../../../src/screens/ModelsScreen/useTextModels');
      const mockLoadHFModels = jest.fn();

      useTextModels.mockReturnValue({
        downloadedModels: [],
        setFilterState: jest.fn(),
        setTextFiltersVisible: jest.fn(),
        downloadProgress: {},
      });

      useImageModels.mockReturnValue({
        downloadedImageModels: [],
        availableHFModels: [{ id: 'existing-model' }],
        hfModelsLoading: false,
        loadHFModels: mockLoadHFModels,
        setImageFiltersVisible: jest.fn(),
      });

      const { result } = renderHook(() => useModelsScreen());

      act(() => {
        result.current.setActiveTab('image');
      });

      // Should not load since models exist
      expect(mockLoadHFModels).not.toHaveBeenCalled();
    });
  });
});
