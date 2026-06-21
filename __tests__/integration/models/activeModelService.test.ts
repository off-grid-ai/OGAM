/**
 * Integration Tests: ActiveModelService
 *
 * Tests the integration between:
 * - activeModelService ↔ llmService (text model loading/unloading)
 * - activeModelService ↔ localDreamGeneratorService (image model loading/unloading)
 * - activeModelService ↔ useAppStore (model state persistence)
 *
 * These tests verify the model lifecycle management works correctly
 * across service boundaries.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { llmService } from '../../../src/services/llm';
import { localDreamGeneratorService } from '../../../src/services/localDreamGenerator';
import { hardwareService } from '../../../src/services/hardware';
import {
  resetStores,
  flushPromises,
  getAppState,
} from '../../utils/testHelpers';
import { createDownloadedModel, createONNXImageModel, createDeviceInfo } from '../../utils/factories';

// Mock the services
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/hardware');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLocalDreamService = localDreamGeneratorService as jest.Mocked<typeof localDreamGeneratorService>;
const mockHardwareService = hardwareService as jest.Mocked<typeof hardwareService>;

function expectLoadedSettings(expected: Record<string, unknown>) {
  const loadedSettings = getAppState().loadedSettings;
  expect(loadedSettings).not.toBeNull();
  Object.entries(expected).forEach(([key, value]) => {
    expect((loadedSettings as any)?.[key]).toBe(value);
  });
}

describe('ActiveModelService Integration', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();

    // Default mock implementations
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockLlmService.loadModel.mockResolvedValue(undefined);
    mockLlmService.unloadModel.mockResolvedValue(undefined);

    mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
    mockLocalDreamService.loadModel.mockResolvedValue(true);
    mockLocalDreamService.unloadModel.mockResolvedValue(true);

    mockHardwareService.getDeviceInfo.mockResolvedValue(createDeviceInfo());
    mockHardwareService.refreshMemoryInfo.mockResolvedValue({
      totalMemory: 8 * 1024 * 1024 * 1024,
      usedMemory: 4 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
    } as any);
    // Real sizing math (the auto-mock returns undefined otherwise), so the
    // residency manager's budget/eviction has actual model sizes to work with.
    mockHardwareService.getModelTotalSize.mockImplementation(
      (m: any) => (m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0),
    );
    mockHardwareService.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * mult,
    );
    mockHardwareService.estimateImageModelRam.mockImplementation(
      (m: any) => ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * 2.5,
    );
    // Generous RAM by default so model-mechanics tests aren't blocked by the
    // budget; the budget-specific describes below set their own (4GB / 8GB).
    mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
    // Real available high by default so the dynamic budget cap doesn't bind and
    // the physical-RAM budget (the subject of these tests) is what's exercised.
    mockHardwareService.getAvailableMemoryGB.mockReturnValue(16);

    // Reset the activeModelService's internal state to match mock state
    await activeModelService.syncWithNativeState();
  });

  describe('Text Model Loading', () => {
    it('should load text model via llmService and update store', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify llmService was called correctly
      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        (model as any).mmProjPath
      );

      // Verify store was updated
      expect(getAppState().activeModelId).toBe('test-model-1');
    });

    it('should save loadedSettings when model is loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 8,
          enableGpu: true,
          gpuLayers: 50,
          contextLength: 4096,
          cacheType: 'f16',
        },
      });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify loadedSettings was saved with the correct values
      const loadedSettings = getAppState().loadedSettings;
      expect(loadedSettings).not.toBeNull();
      expect(loadedSettings?.nThreads).toBe(8);
      expect(loadedSettings?.enableGpu).toBe(true);
      expect(loadedSettings?.gpuLayers).toBe(50);
      expect(loadedSettings?.contextLength).toBe(4096);
      expect(loadedSettings?.cacheType).toBe('f16');
    });

    it('should save loadedSettings with flash attention enabled', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 6,
          nBatch: 256,
          contextLength: 4096,
          enableGpu: true,
          gpuLayers: 50,
          flashAttn: true,
          cacheType: 'f16',
        },
      });

      mockLlmService.loadModel.mockResolvedValue(undefined);
      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model-1');

      // Verify loadedSettings was saved with current settings
      expectLoadedSettings({ nThreads: 6, nBatch: 256, contextLength: 4096, enableGpu: true, gpuLayers: 50, flashAttn: true, cacheType: 'f16' });
    });

    it('should skip loading if model already loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({ downloadedModels: [model], activeModelId: 'test-model-1' });

      // First, simulate that the model is already loaded via a first call
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('test-model-1');

      // Clear the call count after initial setup
      mockLlmService.loadModel.mockClear();

      // Now try to load again - should be skipped since already loaded
      await activeModelService.loadTextModel('test-model-1');

      // Should not be called again since model is already loaded
      expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    });

    it('should unload previous model when loading different model', async () => {
      const model1 = createDownloadedModel({ id: 'model-1', filePath: '/path/model1.gguf' });
      const model2 = createDownloadedModel({ id: 'model-2', filePath: '/path/model2.gguf' });
      useAppStore.setState({ downloadedModels: [model1, model2] });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // Load first model
      await activeModelService.loadTextModel('model-1');

      // Load second model
      await activeModelService.loadTextModel('model-2');

      // Should have unloaded first model
      expect(mockLlmService.unloadModel).toHaveBeenCalled();

      // Should have loaded second model
      expect(mockLlmService.loadModel).toHaveBeenLastCalledWith(
        model2.filePath,
        (model2 as any).mmProjPath
      );
    });

    it('should throw error if model not found', async () => {
      useAppStore.setState({ downloadedModels: [] });

      await expect(
        activeModelService.loadTextModel('non-existent')
      ).rejects.toThrow('Model not found');
    });

    it('should notify listeners during loading state changes', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      const listener = jest.fn();
      const unsubscribe = activeModelService.subscribe(listener);

      // Create a deferred promise to control loading
      let resolveLoad: () => void;
      mockLlmService.loadModel.mockImplementation(() =>
        new Promise((resolve) => { resolveLoad = resolve; })
      );

      const loadPromise = activeModelService.loadTextModel('test-model');

      await flushPromises();

      // Should have been called with loading state
      expect(listener).toHaveBeenCalled();
      const loadingCall = listener.mock.calls.find(
        call => call[0].text.isLoading === true
      );
      expect(loadingCall).toBeDefined();

      // Complete loading
      resolveLoad!();
      await loadPromise;

      // Should have been called with loaded state
      const loadedCall = listener.mock.calls.find(
        call => call[0].text.isLoading === false
      );
      expect(loadedCall).toBeDefined();

      unsubscribe();
    });

    it('should save loadedSettings with q8_0 cache type', async () => {
      const model = createDownloadedModel({ id: 'test-model-1' });
      useAppStore.setState({
        downloadedModels: [model],
        settings: {
          ...useAppStore.getState().settings,
          nThreads: 6,
          nBatch: 256,
          contextLength: 4096,
          enableGpu: true,
          gpuLayers: 50,
          flashAttn: true,
          cacheType: 'q8_0',
        },
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('test-model-1');

      // Verify loadedSettings was saved with the correct values
      expectLoadedSettings({ nThreads: 6, nBatch: 256, contextLength: 4096, enableGpu: true, gpuLayers: 50, flashAttn: true, cacheType: 'q8_0' });
    });
  });

  describe('Text Model Unloading', () => {
    it('should unload text model and clear store', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: 'test-model',
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      // First load the model to set internal tracking
      await activeModelService.loadTextModel('test-model');

      // Then unload
      await activeModelService.unloadTextModel();

      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeModelId).toBe(null);
    });

    it('should skip unload if no model loaded', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(false);
      useAppStore.setState({ activeModelId: null });

      await activeModelService.unloadTextModel();

      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
    });
  });

  describe('Image Model Loading', () => {
    it('should load image model via localDreamGeneratorService', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model-1' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model-1');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );

      expect(getAppState().activeImageModelId).toBe('img-model-1');
    });

    it('should unload previous image model when loading different model', async () => {
      const imgModel1 = createONNXImageModel({ id: 'img-1' });
      const imgModel2 = createONNXImageModel({ id: 'img-2' });
      useAppStore.setState({
        downloadedImageModels: [imgModel1, imgModel2],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Load first model
      await activeModelService.loadImageModel('img-1');

      // Load second model
      await activeModelService.loadImageModel('img-2');

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.loadModel).toHaveBeenLastCalledWith(
        imgModel2.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );
    });
  });

  describe('Image Model Unloading', () => {
    it('should unload image model and clear store', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-model',
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // First load to set internal tracking
      await activeModelService.loadImageModel('img-model');

      // Then unload
      await activeModelService.unloadImageModel();

      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeImageModelId).toBe(null);
    });
  });

  // Helper: load both models without marking them active in the store
  async function loadBothModelsWithSizes(textId: string, imageId: string) {
    const textModel = createDownloadedModel({ id: textId, fileSize: 1 * 1024 * 1024 * 1024 });
    const imageModel = createONNXImageModel({ id: imageId, size: 512 * 1024 * 1024 });
    useAppStore.setState({
      downloadedModels: [textModel],
      downloadedImageModels: [imageModel],
      settings: { imageThreads: 4 } as any,
    });
    mockLlmService.isModelLoaded.mockReturnValue(true);
    await activeModelService.loadTextModel(textId);
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    mockLocalDreamService.loadModel.mockResolvedValue(true);
    await activeModelService.loadImageModel(imageId);
    return { textModel, imageModel };
  }

  // Helper: set up store and load both a text model and an image model
  async function setupAndLoadBothModels(textId = 'text-model', imageId = 'img-model') {
    const textModel = createDownloadedModel({ id: textId, fileSize: 1 * 1024 * 1024 * 1024 });
    const imageModel = createONNXImageModel({ id: imageId, size: 512 * 1024 * 1024 });
    useAppStore.setState({
      downloadedModels: [textModel],
      activeModelId: textId,
      downloadedImageModels: [imageModel],
      activeImageModelId: imageId,
      settings: { imageThreads: 4 } as any,
    });
    mockLlmService.isModelLoaded.mockReturnValue(true);
    mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
    await activeModelService.loadTextModel(textId);
    await activeModelService.loadImageModel(imageId);
    return { textModel, imageModel };
  }

  describe('Unload All Models', () => {
    it('should unload both text and image models', async () => {
      await setupAndLoadBothModels();

      // Unload all
      const result = await activeModelService.unloadAllModels();

      expect(result.textUnloaded).toBe(true);
      expect(result.imageUnloaded).toBe(true);
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
    });
  });

  describe('Memory Check', () => {
    it('should return safe for small models on high memory device', async () => {
      const model = createDownloadedModel({
        id: 'small-model',
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // High memory device (16GB)
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('small-model', 'text');

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('safe');
    });

    it('should return warning for models exceeding 50% of RAM', async () => {
      const model = createDownloadedModel({
        id: 'large-model',
        fileSize: 3 * 1024 * 1024 * 1024, // 3GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // 8GB device - 3GB * 1.5 (overhead) = 4.5GB
      // Warning threshold: 50% of 8GB = 4GB
      // Critical threshold: 60% of 8GB = 4.8GB
      // 4.5GB is between 4GB and 4.8GB, so should be warning
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('large-model', 'text');

      expect(result.canLoad).toBe(true);
      expect(result.severity).toBe('warning');
    });

    it('should return critical for models exceeding 60% of RAM', async () => {
      const model = createDownloadedModel({
        id: 'huge-model',
        fileSize: 8 * 1024 * 1024 * 1024, // 8GB
      });
      useAppStore.setState({ downloadedModels: [model] });

      // 8GB device - 8GB * 1.5 = 12GB > 4.8GB (60%)
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('huge-model', 'text');

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('critical');
    });

    it('should return blocked for non-existent model', async () => {
      useAppStore.setState({ downloadedModels: [] });

      const result = await activeModelService.checkMemoryForModel('non-existent', 'text');

      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('blocked');
      expect(result.message).toBe('Model not found');
    });
  });

  describe('Dual Model Memory Check', () => {
    it('should check combined memory for text and image models', async () => {
      const textModel = createDownloadedModel({
        id: 'text-model',
        fileSize: 4 * 1024 * 1024 * 1024, // 4GB
      });
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 16GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel(
        'text-model',
        'img-model'
      );

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryGB).toBeGreaterThan(0);
    });
  });

  describe('Sync With Native State', () => {
    it('should sync internal state with native module state', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({
        downloadedModels: [model],
        activeModelId: 'test-model',
      });

      // Native says model is loaded
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.getLoadedModelPath.mockReturnValue(model.filePath);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      // Internal tracking should now match
      const loadedIds = activeModelService.getLoadedModelIds();
      expect(loadedIds.textModelId).toBe('test-model');
    });

    it('should clear internal state if native reports no model loaded', async () => {
      // Native says no model loaded
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const loadedIds = activeModelService.getLoadedModelIds();
      expect(loadedIds.textModelId).toBe(null);
      expect(loadedIds.imageModelId).toBe(null);
    });
  });

  describe('Performance Stats', () => {
    it('should proxy performance stats from llmService', () => {
      const expectedStats = {
        lastTokensPerSecond: 20.5,
        lastDecodeTokensPerSecond: 25.0,
        lastTimeToFirstToken: 0.4,
        lastGenerationTime: 4.0,
        lastTokenCount: 80,
      };

      mockLlmService.getPerformanceStats.mockReturnValue(expectedStats);

      const stats = activeModelService.getPerformanceStats();

      expect(stats).toEqual(expectedStats);
      expect(mockLlmService.getPerformanceStats).toHaveBeenCalled();
    });
  });

  describe('Active Models Info', () => {
    it('should return correct info about the loaded model', async () => {
      // Text and image are mutually exclusive, so only one generation model is
      // resident at a time. Verify the info reflects the loaded image model.
      const imageModel = createONNXImageModel({ id: 'img-model', size: 512 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [imageModel], activeImageModelId: 'img-model', settings: { imageThreads: 4 } as any });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-model');

      const info = activeModelService.getActiveModels();
      expect(info.image.model?.id).toBe('img-model');
      expect(info.image.isLoaded).toBe(true);
    });

    it('should report no models when none loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const info = activeModelService.getActiveModels();

      expect(info.text.model).toBe(null);
      expect(info.text.isLoaded).toBe(false);
      expect(info.image.model).toBe(null);
      expect(info.image.isLoaded).toBe(false);
    });
  });

  describe('Has Any Model Loaded', () => {
    it('should return true when text model loaded', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.isModelLoaded.mockReturnValue(true);

      await activeModelService.loadTextModel('test-model');

      expect(activeModelService.hasAnyModelLoaded()).toBe(true);
    });

    it('should return true when image model loaded', async () => {
      const imageModel = createONNXImageModel({ id: 'img-model' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-model');

      expect(activeModelService.hasAnyModelLoaded()).toBe(true);
    });

    it('should return false when no models loaded', async () => {
      // Sync with native state to reset internal tracking
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      expect(activeModelService.hasAnyModelLoaded()).toBe(false);
    });
  });

  describe('Concurrent Load Prevention', () => {
    it('should wait for pending load to complete before starting new load', async () => {
      const model = createDownloadedModel({ id: 'test-model' });
      useAppStore.setState({ downloadedModels: [model] });

      let resolveFirst: () => void;
      let loadCount = 0;

      mockLlmService.loadModel.mockImplementation(() => {
        loadCount++;
        if (loadCount === 1) {
          return new Promise((resolve) => {
            resolveFirst = () => {
              // After first load completes, model is loaded
              mockLlmService.isModelLoaded.mockReturnValue(true);
              resolve();
            };
          });
        }
        return Promise.resolve();
      });

      // Start first load
      const load1 = activeModelService.loadTextModel('test-model');

      // Start second load immediately
      const load2 = activeModelService.loadTextModel('test-model');

      await flushPromises();

      // Only one actual load should have started
      expect(loadCount).toBe(1);

      // Complete first load
      resolveFirst!();
      await Promise.all([load1, load2]);

      // Still only one load because same model
      expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('unloadImageModel when no model loaded', () => {
    it('should skip unload when all sources say no model', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      useAppStore.setState({ activeImageModelId: null });

      await activeModelService.syncWithNativeState();

      await activeModelService.unloadImageModel();

      // Should not call native unload since nothing was loaded
      expect(mockLocalDreamService.unloadModel).not.toHaveBeenCalled();
    });
  });

  describe('unloadAllModels error handling', () => {
    it('should continue unloading image model when text unload fails', async () => {
      await setupAndLoadBothModels();

      // Make text unload fail
      mockLlmService.unloadModel.mockRejectedValueOnce(new Error('Text unload failed'));

      const result = await activeModelService.unloadAllModels();

      // Text unload failed, but image should still have been attempted
      expect(result.textUnloaded).toBe(false);
      expect(result.imageUnloaded).toBe(true);
    });
  });

  describe('getResourceUsage', () => {
    it('returns memory usage information', async () => {
      mockHardwareService.refreshMemoryInfo.mockResolvedValue({
        totalMemory: 8 * 1024 * 1024 * 1024,
        usedMemory: 3 * 1024 * 1024 * 1024,
        availableMemory: 5 * 1024 * 1024 * 1024,
      } as any);

      const usage = await activeModelService.getResourceUsage();

      expect(usage.memoryTotal).toBe(8 * 1024 * 1024 * 1024);
      expect(usage.memoryAvailable).toBe(5 * 1024 * 1024 * 1024);
      expect(usage.memoryUsagePercent).toBeCloseTo(37.5, 0);
      expect(usage.estimatedModelMemory).toBeDefined();
    });
  });

  describe('checkMemoryForModel with image type', () => {
    it('checks memory for image model with correct overhead', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-check',
        size: 2 * 1024 * 1024 * 1024, // 2GB
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('img-check', 'image');

      expect(result.canLoad).toBe(true);
      expect(result.requiredMemoryGB).toBeGreaterThan(0);
    });
  });

  describe('checkMemoryForDualModel with null IDs', () => {
    it('handles null text model ID', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-model',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [],
        downloadedImageModels: [imageModel],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel(null, 'img-model');

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryGB).toBeGreaterThan(0);
    });

    it('handles null image model ID', async () => {
      const textModel = createDownloadedModel({
        id: 'text-model',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [],
      });

      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel('text-model', null);

      expect(result).toBeDefined();
      expect(result.totalRequiredMemoryGB).toBeGreaterThan(0);
    });
  });

  describe('clearTextModelCache', () => {
    it('delegates to llmService.clearKVCache', async () => {
      const model = createDownloadedModel({ id: 'cache-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.clearKVCache = jest.fn().mockResolvedValue(undefined);

      await activeModelService.loadTextModel('cache-model');

      await activeModelService.clearTextModelCache();

      expect(mockLlmService.clearKVCache).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Additional branch coverage tests - round 2
  // ============================================================================

  describe('loadTextModel timeout', () => {
    it('should throw timeout error when loading takes too long', async () => {
      const model = createDownloadedModel({ id: 'slow-model' });
      useAppStore.setState({ downloadedModels: [model] });

      // Never-resolving promise to simulate timeout
      mockLlmService.loadModel.mockImplementation(() => new Promise(() => {}));

      await expect(
        activeModelService.loadTextModel('slow-model', 50) // 50ms timeout
      ).rejects.toThrow('timed out');
    });
  });

  describe('loadTextModel with vision model mmproj detection', () => {
    it('should detect mmproj file for vision model', async () => {
      jest.mock('react-native-fs', () => ({
        readDir: jest.fn(),
        exists: jest.fn(),
        DocumentDirectoryPath: '/mock/documents',
      }));
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-vl-model',
        name: 'Qwen3-VL-2B',
        filePath: '/models/qwen3-vl-2b.gguf',
      });
      // No mmProjPath set
      delete (model as any).mmProjPath;
      useAppStore.setState({ downloadedModels: [model] });

      // Mock RNFS.readDir to return a mmproj file
      RNFS.readDir = jest.fn().mockResolvedValue([
        { name: 'qwen3-vl-mmproj-f16.gguf', path: '/models/qwen3-vl-mmproj-f16.gguf', size: 500000000, isFile: () => true },
      ]);

      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.loadModel.mockResolvedValue(undefined);

      // Mock modelManager.saveModelWithMmproj
      const { modelManager } = require('../../../src/services/modelManager');
      if (modelManager.saveModelWithMmproj) {
        jest.spyOn(modelManager, 'saveModelWithMmproj').mockResolvedValue(undefined);
      }

      await activeModelService.loadTextModel('vision-vl-model');

      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        expect.any(String) // mmproj path should be found
      );
    });
  });

  describe('loadTextModel error resets state', () => {
    it('should clear loadedTextModelId on load failure', async () => {
      const model = createDownloadedModel({ id: 'fail-model' });
      useAppStore.setState({ downloadedModels: [model] });

      mockLlmService.loadModel.mockRejectedValue(new Error('Load failed'));

      await expect(
        activeModelService.loadTextModel('fail-model')
      ).rejects.toThrow('Load failed');

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.textModelId).toBeNull();
    });
  });

  describe('loadImageModel error resets state', () => {
    it('should clear loadedImageModelId on load failure', async () => {
      const imageModel = createONNXImageModel({ id: 'fail-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.loadModel.mockRejectedValue(new Error('Image load failed'));

      await expect(
        activeModelService.loadImageModel('fail-img')
      ).rejects.toThrow('Image load failed');

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.imageModelId).toBeNull();
    });
  });

  describe('loadImageModel not found', () => {
    it('should throw when image model not found', async () => {
      useAppStore.setState({
        downloadedImageModels: [],
        settings: { imageThreads: 4 } as any,
      });

      await expect(
        activeModelService.loadImageModel('nonexistent')
      ).rejects.toThrow('Model not found');
    });
  });

  describe('getEstimatedModelMemory branches', () => {
    it('includes text model memory when active', async () => {
      const textModel = createDownloadedModel({
        id: 'text-est',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        activeModelId: 'text-est',
      });

      const usage = await activeModelService.getResourceUsage();
      // estimatedModelMemory should include text model memory
      expect(usage.estimatedModelMemory).toBeGreaterThan(0);
    });

    it('includes image model memory when active', async () => {
      const imageModel = createONNXImageModel({
        id: 'img-est',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-est',
      });

      const usage = await activeModelService.getResourceUsage();
      expect(usage.estimatedModelMemory).toBeGreaterThan(0);
    });

    it('includes both text and image model memory', async () => {
      const textModel = createDownloadedModel({
        id: 'text-both',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-both',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        activeModelId: 'text-both',
        downloadedImageModels: [imageModel],
        activeImageModelId: 'img-both',
      });

      const usage = await activeModelService.getResourceUsage();
      // Should be sum of both model memories
      const textOnly = textModel.fileSize * 1.2;
      const imageOnly = imageModel.size * 1.3;
      expect(usage.estimatedModelMemory).toBeCloseTo(textOnly + imageOnly, -5);
    });
  });

  describe('checkMemoryForModel with other loaded models', () => {
    it('counts image model memory when checking text model', async () => {
      const textModel = createDownloadedModel({
        id: 'text-check',
        fileSize: 3 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-loaded',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load image model first
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-loaded');

      // 8GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('text-check', 'text');

      // currentlyLoadedMemoryGB should include the image model
      expect(result.currentlyLoadedMemoryGB).toBeGreaterThan(0);
    });

    it('counts text model memory when checking image model', async () => {
      const textModel = createDownloadedModel({
        id: 'text-loaded',
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-check',
        size: 2 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load text model first
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('text-loaded');

      // 8GB device
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('img-check', 'image');

      // currentlyLoadedMemoryGB should include the text model
      expect(result.currentlyLoadedMemoryGB).toBeGreaterThan(0);
    });
  });

  describe('checkMemoryForModel critical with other models message', () => {
    it('includes other models in critical message', async () => {
      const textModel = createDownloadedModel({
        id: 'huge-text',
        fileSize: 6 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'img-already',
        size: 3 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load image model
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-already');

      // 8GB device - 6GB text * 1.5 = 9GB + image model memory = way over budget
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForModel('huge-text', 'text');

      expect(result.severity).toBe('critical');
      expect(result.canLoad).toBe(false);
      expect(result.message).toContain('other models are loaded');
    });
  });

  describe('checkMemoryForDualModel warning and critical paths', () => {
    it('returns warning when dual model exceeds 50% RAM', async () => {
      const textModel = createDownloadedModel({
        id: 'dual-text',
        fileSize: 3 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'dual-img',
        size: 1.5 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 8GB device - total ~ 3*1.5 + 1.5*1.8 = 4.5+2.7=7.2GB > 4GB (50%) but < 4.8GB (60%)
      // Actually 7.2 > 4.8, so this will be critical. Let's use 16GB device.
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 16 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel('dual-text', 'dual-img');

      // 16GB * 50% = 8GB warning threshold, 16GB * 60% = 9.6GB critical
      // total ~ 4.5 + 2.7 = 7.2 < 8, so safe
      expect(result.severity).toBe('safe');
      expect(result.canLoad).toBe(true);
    });

    it('returns critical when dual models exceed budget', async () => {
      const textModel = createDownloadedModel({
        id: 'dual-huge-text',
        fileSize: 6 * 1024 * 1024 * 1024,
      });
      const imageModel = createONNXImageModel({
        id: 'dual-huge-img',
        size: 4 * 1024 * 1024 * 1024,
      });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      // 8GB device - both models would exceed 60% budget
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 })
      );

      const result = await activeModelService.checkMemoryForDualModel('dual-huge-text', 'dual-huge-img');

      expect(result.severity).toBe('critical');
      expect(result.canLoad).toBe(false);
      expect(result.message).toContain('Cannot load both');
    });
  });

  describe('syncWithNativeState with image model', () => {
    it('syncs image model internal state from store', async () => {
      const imageModel = createONNXImageModel({ id: 'sync-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'sync-img',
      });

      // Native reports image model loaded, but internal tracking is null
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      await activeModelService.syncWithNativeState();

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.imageModelId).toBe('sync-img');
    });

    it('clears image model internal state when native reports not loaded', async () => {
      // First load an image model
      const imageModel = createONNXImageModel({ id: 'clear-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        activeImageModelId: 'clear-img',
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      await activeModelService.loadImageModel('clear-img');

      // Now native says not loaded
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.syncWithNativeState();

      const ids = activeModelService.getLoadedModelIds();
      expect(ids.imageModelId).toBeNull();
    });
  });

  describe('unloadTextModel with store but no native', () => {
    it('clears store even when native is not loaded', async () => {
      // Set store state without loading natively
      useAppStore.setState({ activeModelId: 'orphan-model' });
      mockLlmService.isModelLoaded.mockReturnValue(false);

      await activeModelService.unloadTextModel();

      // Store should be cleared
      expect(getAppState().activeModelId).toBeNull();
      // Native unload should NOT have been called (nothing loaded)
      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
    });
  });

  describe('unloadImageModel with store but no native', () => {
    it('clears store even when native is not loaded', async () => {
      useAppStore.setState({ activeImageModelId: 'orphan-img' });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await activeModelService.unloadImageModel();

      expect(getAppState().activeImageModelId).toBeNull();
      expect(mockLocalDreamService.unloadModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Additional branch coverage tests - round 3
  // ============================================================================

  describe('loadTextModel vision model no mmproj found', () => {
    it('logs warning when no mmproj file found in directory', async () => {
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-no-mmproj',
        name: 'Qwen3-VL-2B',
        filePath: '/models/qwen3-vl-2b.gguf',
      });
      // Ensure no mmProjPath
      (model as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model] });

      // readDir returns no mmproj files
      RNFS.readDir = jest.fn().mockResolvedValue([
        { name: 'qwen3-vl-2b.gguf', path: '/models/qwen3-vl-2b.gguf', size: 2000000000 },
      ]);

      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('vision-no-mmproj');

      // Should have called loadModel with undefined mmProjPath
      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        undefined
      );
    });
  });

  describe('loadTextModel vision model mmproj search failure', () => {
    it('catches error when readDir fails', async () => {
      const RNFS = require('react-native-fs');

      const model = createDownloadedModel({
        id: 'vision-error',
        name: 'SmolVLM-500M',
        filePath: '/models/smolvlm.gguf',
      });
      (model as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model] });

      // readDir throws
      RNFS.readDir = jest.fn().mockRejectedValue(new Error('Permission denied'));

      mockLlmService.loadModel.mockResolvedValue(undefined);

      // Should not throw - error is caught internally
      await activeModelService.loadTextModel('vision-error');

      expect(mockLlmService.loadModel).toHaveBeenCalledWith(
        model.filePath,
        undefined
      );
    });
  });

  describe('loadTextModel mmproj found updates store with multiple models', () => {
    it('only updates the matching model in store', async () => {
      const RNFS = require('react-native-fs');
      const { modelManager: mockModelManager } = require('../../../src/services/modelManager');

      const model1 = createDownloadedModel({
        id: 'other-model',
        name: 'Regular Model',
        filePath: '/models/regular.gguf',
      });
      const model2 = createDownloadedModel({
        id: 'vision-found',
        name: 'Test-Vision-Model',
        filePath: '/models/vision.gguf',
      });
      (model2 as any).mmProjPath = undefined;
      useAppStore.setState({ downloadedModels: [model1, model2] });

      RNFS.readDir = jest.fn().mockResolvedValue([
        { name: 'mmproj-f16.gguf', path: '/models/mmproj-f16.gguf', size: 500000000 },
      ]);

      if (mockModelManager.saveModelWithMmproj) {
        jest.spyOn(mockModelManager, 'saveModelWithMmproj').mockResolvedValue(undefined);
      }

      mockLlmService.loadModel.mockResolvedValue(undefined);

      await activeModelService.loadTextModel('vision-found');

      // Other model should be untouched, vision model should have mmProjPath
      const models = getAppState().downloadedModels;
      const otherModel = models.find(m => m.id === 'other-model');
      expect((otherModel as any)?.mmProjPath).toBeUndefined();
    });
  });

  describe('unloadTextModel waits for pending load', () => {
    it('waits for pending textLoadPromise before unloading', async () => {
      const model = createDownloadedModel({ id: 'pending-model' });
      useAppStore.setState({ downloadedModels: [model] });

      let resolveLoad: () => void;
      mockLlmService.loadModel.mockImplementation(() =>
        new Promise<void>((resolve) => { resolveLoad = resolve; })
      );
      mockLlmService.isModelLoaded.mockReturnValue(true);

      // Start a load but don't await yet
      const loadPromise = activeModelService.loadTextModel('pending-model');
      await flushPromises();

      // Now call unload while load is pending
      const unloadPromise = activeModelService.unloadTextModel();
      await flushPromises();

      // Resolve the load
      resolveLoad!();
      await loadPromise;
      await unloadPromise;

      expect(getAppState().activeModelId).toBeNull();
    });
  });

  describe('unloadImageModel waits for pending load', () => {
    it('waits for pending imageLoadPromise before unloading', async () => {
      const imageModel = createONNXImageModel({ id: 'pending-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      let resolveLoad: () => void;
      mockLocalDreamService.loadModel.mockImplementation(() =>
        new Promise<boolean>((resolve) => { resolveLoad = () => resolve(true); })
      );
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      // Start a load but don't await yet
      const loadPromise = activeModelService.loadImageModel('pending-img');
      await flushPromises();

      // Now call unload while load is pending
      const unloadPromise = activeModelService.unloadImageModel();
      await flushPromises();

      // Resolve the load
      resolveLoad!();
      await loadPromise;
      await unloadPromise;

      expect(getAppState().activeImageModelId).toBeNull();
    });
  });

  describe('loadImageModel already loaded but needs thread reload', () => {
    it('reloads when imageThreads changed', async () => {
      const imageModel = createONNXImageModel({ id: 'thread-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      // Load with 4 threads
      await activeModelService.loadImageModel('thread-img');
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);

      // Change threads setting
      useAppStore.setState({
        settings: { ...getAppState().settings, imageThreads: 8 },
      });

      // Load same model again - should reload due to thread change
      await activeModelService.loadImageModel('thread-img');
      expect(mockLocalDreamService.unloadModel).toHaveBeenCalled();
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(2);
    });
  });

  describe('loadImageModel concurrent load - different model', () => {
    it('loads new model after pending load for different model completes', async () => {
      const img1 = createONNXImageModel({ id: 'img-a' });
      const img2 = createONNXImageModel({ id: 'img-b' });
      useAppStore.setState({
        downloadedImageModels: [img1, img2],
        settings: { imageThreads: 4 } as any,
      });

      let resolveFirst: (v: boolean) => void;
      let loadCount = 0;

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockImplementation(() => {
        loadCount++;
        if (loadCount === 1) {
          return new Promise<boolean>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve(true);
      });

      // Start loading first model
      const load1 = activeModelService.loadImageModel('img-a');
      await flushPromises();

      // Start loading second model while first is loading
      const load2 = activeModelService.loadImageModel('img-b');
      await flushPromises();

      // Complete first load
      resolveFirst!(true);
      await load1;
      await load2;

      // Both should have completed
      const ids = activeModelService.getLoadedModelIds();
      expect(ids.imageModelId).toBe('img-b');
    });
  });

  describe('unloadAllModels error handling - image unload fails', () => {
    it('handles image unload error gracefully', async () => {
      await setupAndLoadBothModels('text-ok', 'img-fail');

      // Make image unload fail
      mockLocalDreamService.unloadModel.mockRejectedValueOnce(new Error('Image unload failed'));

      const result = await activeModelService.unloadAllModels();

      expect(result.textUnloaded).toBe(true);
      expect(result.imageUnloaded).toBe(false);
    });
  });

  describe('loadImageModel with coreml backend', () => {
    it('uses auto backend for coreml models', async () => {
      const coremlModel = createONNXImageModel({ id: 'coreml-model', backend: 'coreml' });
      useAppStore.setState({
        downloadedImageModels: [coremlModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('coreml-model');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        coremlModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false }, // coreml backend should map to 'auto'
      );
    });

    it('passes attentionVariant through for SDXL-style coreml models', async () => {
      const coremlModel = createONNXImageModel({
        id: 'coreml-sdxl-model',
        backend: 'coreml',
        attentionVariant: 'split_einsum',
      });
      useAppStore.setState({
        downloadedImageModels: [coremlModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('coreml-sdxl-model');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        coremlModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: 'split_einsum' },
      );
    });
  });

  describe('loadImageModel already loaded and native confirms', () => {
    it('skips reload when model is already loaded natively', async () => {
      const imageModel = createONNXImageModel({ id: 'skip-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { ...getAppState().settings, imageThreads: 4 },
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      // Load the model
      await activeModelService.loadImageModel('skip-img');
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);

      // Try to load the same model again - native confirms it's loaded
      mockLocalDreamService.loadModel.mockClear();
      await activeModelService.loadImageModel('skip-img');

      // Should not call loadModel again
      expect(mockLocalDreamService.loadModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // QNN / NPU guard (lines 321-323)
  // ============================================================================
  describe('QNN model NPU guard', () => {
    it('throws when loading a QNN model on a device without NPU (lines 321-323)', async () => {
      const qnnModel = createONNXImageModel({ id: 'qnn-model-1', backend: 'qnn' });
      useAppStore.setState({
        downloadedImageModels: [qnnModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      // Provide getSoCInfo mock returning no NPU
      mockHardwareService.getSoCInfo = jest.fn().mockResolvedValue({ hasNPU: false });

      await expect(activeModelService.loadImageModel('qnn-model-1')).rejects.toThrow(
        'NPU models require a Qualcomm Snapdragon processor',
      );
    });

    it('loads QNN model when device has NPU', async () => {
      const qnnModel = createONNXImageModel({ id: 'qnn-model-2', backend: 'qnn' });
      useAppStore.setState({
        downloadedImageModels: [qnnModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockHardwareService.getSoCInfo = jest.fn().mockResolvedValue({ hasNPU: true });
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(activeModelService.loadImageModel('qnn-model-2')).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // getCurrentlyLoadedMemoryGB private method (lines 527-545)
  // ============================================================================
  describe('getCurrentlyLoadedMemoryGB', () => {
    it('returns 0 when no models are loaded (lines 527-545)', () => {
      // No models loaded → both if-branches skipped
      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(result).toBe(0);
    });

    it('counts text model memory when text model is loaded (lines 531-535)', async () => {
      const textModel = createDownloadedModel({ id: 'mem-text-1' });
      useAppStore.setState({ downloadedModels: [textModel] });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('mem-text-1');

      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('counts image model memory when image model is loaded (lines 538-543)', async () => {
      const imageModel = createONNXImageModel({ id: 'mem-img-1' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('mem-img-1');

      const result = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('sums text and image model memory when both are loaded', async () => {
      await loadBothModelsWithSizes('mem-text-2', 'mem-img-2');

      const textOnly = (activeModelService as any).getCurrentlyLoadedMemoryGB();
      // Both models loaded → sum > either alone
      expect(textOnly).toBeGreaterThan(0);
    });
  });

  describe('loadImageModel concurrent load returns same model', () => {
    it('skips second load when first completed for same model and threads', async () => {
      const imageModel = createONNXImageModel({ id: 'concurrent-img' });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { ...getAppState().settings, imageThreads: 4 },
      });

      let resolveFirst: (v: boolean) => void;
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockImplementation(() =>
        new Promise<boolean>((resolve) => { resolveFirst = resolve; })
      );

      // Start first load
      const load1 = activeModelService.loadImageModel('concurrent-img');
      await flushPromises();

      // Start second load for same model - should wait for first
      const load2 = activeModelService.loadImageModel('concurrent-img');
      await flushPromises();

      // Complete first
      resolveFirst!(true);
      await load1;
      await load2;

      // Only one native load should have happened
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Low-memory device (≤4 GB) image model loading
  // ===========================================================================

  describe('loadImageModel on low-memory device (≤4GB)', () => {
    const LOW_MEM = 4 * 1024 * 1024 * 1024; // 4 GB
    const setupLowMemDevice = () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: LOW_MEM }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(4);
    };

    it('evicts the text model when loading an image (mutual exclusion)', async () => {
      setupLowMemDevice(); // 4GB → ~2.4GB budget

      const textModel = createDownloadedModel({ id: 'txt', fileSize: 1536 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ id: 'img', size: 512 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Load text model first
      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('txt');
      expect(getAppState().activeModelId).toBe('txt');

      // Now load image model — text and image never co-reside, so text is evicted.
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img');

      // Text model freed from RAM, but the SELECTION is kept so chat still shows
      // it and it reloads on demand (eviction must not deselect).
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeModelId).toBe('txt');
      // Image model should be loaded
      expect(getAppState().activeImageModelId).toBe('img');
    });

    it('evicts the text model even when both are small (mutual exclusion is unconditional)', async () => {
      setupLowMemDevice();

      const textModel = createDownloadedModel({ id: 'txt-s', fileSize: 400 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ id: 'img-s', size: 400 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(true);
      await activeModelService.loadTextModel('txt-s');
      mockLlmService.unloadModel.mockClear();

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-s');

      // Even though both are tiny, a generation model evicts the other from RAM
      // (selection kept).
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeModelId).toBe('txt-s');
      expect(getAppState().activeImageModelId).toBe('img-s');
    });

    it('passes cpuOnly=false to native loader', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({ id: 'img-cpu', size: 512 * 1024 * 1024 });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-cpu');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        expect.objectContaining({ cpuOnly: false }),
      );
    });

    it('does not auto-unload text model if none is loaded', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({ id: 'img-no-txt', size: 512 * 1024 * 1024 });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-no-txt');

      expect(mockLlmService.unloadModel).not.toHaveBeenCalled();
      expect(getAppState().activeImageModelId).toBe('img-no-txt');
    });

    it('blocks loading when model exceeds memory budget', async () => {
      setupLowMemDevice();

      const imageModel = createONNXImageModel({ id: 'img-huge', size: 2 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(activeModelService.loadImageModel('img-huge')).rejects.toThrow();
    });
  });

  describe('loadImageModel on high-memory device (>4GB)', () => {
    const HIGH_MEM = 8 * 1024 * 1024 * 1024; // 8 GB
    const setupHighMemDevice = () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: HIGH_MEM }),
      );
      mockHardwareService.getTotalMemoryGB.mockReturnValue(8);
    };

    it('unloads the text model even on a high-memory device (mutual exclusion)', async () => {
      setupHighMemDevice();
      await loadBothModelsWithSizes('txt-hi', 'img-hi');

      // Text and image are mutually exclusive regardless of available RAM, so
      // loading the image frees the text model from RAM — but keeps it selected.
      expect(mockLlmService.unloadModel).toHaveBeenCalled();
      expect(getAppState().activeModelId).toBe('txt-hi');
      expect(getAppState().activeImageModelId).toBe('img-hi');
    });

    it('passes cpuOnly=false to native loader', async () => {
      setupHighMemDevice();

      const imageModel = createONNXImageModel({ id: 'img-gpu', size: 512 * 1024 * 1024 });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);
      await activeModelService.loadImageModel('img-gpu');

      expect(mockLocalDreamService.loadModel).toHaveBeenCalledWith(
        imageModel.modelPath,
        4,
        { backend: 'auto', cpuOnly: false, attentionVariant: undefined },
      );
    });

    it('still blocks critically oversized models', async () => {
      setupHighMemDevice();

      // 6GB model * 1.8x = 10.8GB > 8GB * 0.6 = 4.8GB budget
      const imageModel = createONNXImageModel({ id: 'img-giant', size: 6 * 1024 * 1024 * 1024 });
      useAppStore.setState({
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);

      await expect(
        activeModelService.loadImageModel('img-giant'),
      ).rejects.toThrow();
    });
  });

  describe('memory budget thresholds by device RAM', () => {
    it('uses 40% budget for 4GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 4 * 1024 * 1024 * 1024 }),
      );

      // 800MB * 1.8x = 1.44GB, budget = 4 * 0.4 = 1.6GB → safe
      const smallModel = createONNXImageModel({ id: 'small-4gb', size: 800 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [smallModel] });

      const result = await activeModelService.checkMemoryForModel('small-4gb', 'image');
      expect(result.canLoad).toBe(true);
    });

    it('uses 40% budget for 3GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 3 * 1024 * 1024 * 1024 }),
      );

      // 600MB * 1.8x = 1.08GB, budget = 3 * 0.4 = 1.2GB → safe
      const model = createONNXImageModel({ id: 'tiny-3gb', size: 600 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel('tiny-3gb', 'image');
      expect(result.canLoad).toBe(true);
    });

    it('uses 60% budget for 6GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 6 * 1024 * 1024 * 1024 }),
      );

      // 1.5GB * 1.8x = 2.7GB, budget = 6 * 0.6 = 3.6GB → safe
      const model = createONNXImageModel({ id: 'mid-6gb', size: 1.5 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel('mid-6gb', 'image');
      expect(result.canLoad).toBe(true);
    });

    it('uses 60% budget for 8GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      // 2GB * 1.8x = 3.6GB, budget = 8 * 0.6 = 4.8GB → safe
      const model = createONNXImageModel({ id: 'mid-8gb', size: 2 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel('mid-8gb', 'image');
      expect(result.canLoad).toBe(true);
    });

    it('blocks model exceeding 40% on 4GB device', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 4 * 1024 * 1024 * 1024 }),
      );

      // 1.5GB * 1.8x = 2.7GB > 4 * 0.4 = 1.6GB budget → critical
      const model = createONNXImageModel({ id: 'too-big-4gb', size: 1.5 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel('too-big-4gb', 'image');
      expect(result.canLoad).toBe(false);
      expect(result.severity).toBe('critical');
    });

    it('allows same model on 8GB device that is blocked on 4GB', async () => {
      mockHardwareService.getDeviceInfo.mockResolvedValue(
        createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
      );

      // 1.5GB * 1.8x = 2.7GB < 8 * 0.6 = 4.8GB budget → safe
      const model = createONNXImageModel({ id: 'fits-8gb', size: 1.5 * 1024 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [model] });

      const result = await activeModelService.checkMemoryForModel('fits-8gb', 'image');
      expect(result.canLoad).toBe(true);
    });
  });

  describe('global load serialization', () => {
    it('does not start an image load while a text load is in flight', async () => {
      const textModel = createDownloadedModel({ id: 'txt-1', fileSize: 300 * 1024 * 1024 });
      const imageModel = createONNXImageModel({ id: 'img-1', size: 300 * 1024 * 1024 });
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
        settings: { imageThreads: 4 } as any,
      });

      // Make the text native load hang until we release it.
      let releaseText: () => void = () => {};
      mockLlmService.loadModel.mockImplementation(
        () => new Promise<void>(resolve => { releaseText = () => resolve(); }),
      );
      mockLlmService.isModelLoaded.mockReturnValue(false);
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);

      const textPromise = activeModelService.loadTextModel('txt-1');
      const imagePromise = activeModelService.loadImageModel('img-1');

      // Let microtasks run: text holds the lock, image must be waiting behind it.
      await new Promise(r => setImmediate(r));
      expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
      expect(mockLocalDreamService.loadModel).not.toHaveBeenCalled();

      // Release text — image proceeds only now.
      mockLlmService.isModelLoaded.mockReturnValue(true);
      releaseText();
      await Promise.all([textPromise, imagePromise]);
      expect(mockLocalDreamService.loadModel).toHaveBeenCalledTimes(1);
    });
  });

  describe('budget caps by real available RAM (OOM-freeze guard)', () => {
    it('blocks a model that fits total RAM but not the real free RAM', async () => {
      // 16GB device (physical budget ~9.8GB) but only ~2GB actually free right
      // now — the dynamic cap (available + resident − headroom, floored at 1GB)
      // must block a ~3GB image so it never loads into swap.
      mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(2);
      const imageModel = createONNXImageModel({ id: 'img-big', size: 1200 * 1024 * 1024 }); // ×2.5 ≈ 3GB
      useAppStore.setState({ downloadedImageModels: [imageModel], settings: { imageThreads: 4 } as any });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(false);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await expect(activeModelService.loadImageModel('img-big')).rejects.toThrow();
    });

    it('allows the same model when real free RAM is high', async () => {
      mockHardwareService.getTotalMemoryGB.mockReturnValue(16);
      mockHardwareService.getAvailableMemoryGB.mockReturnValue(16);
      const imageModel = createONNXImageModel({ id: 'img-ok', size: 1200 * 1024 * 1024 });
      useAppStore.setState({ downloadedImageModels: [imageModel], settings: { imageThreads: 4 } as any });
      mockLocalDreamService.isModelLoaded.mockResolvedValue(true);
      mockLocalDreamService.loadModel.mockResolvedValue(true);

      await activeModelService.loadImageModel('img-ok');
      expect(getAppState().activeImageModelId).toBe('img-ok');
    });
  });
});
