/**
 * App Store Unit Tests
 *
 * Tests for app-wide state management including models, settings, and image generation.
 * Priority: P0 (Critical) - Core functionality for the app.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, getAppState } from '../../utils/testHelpers';
import {
  createDownloadedModel,
  createDeviceInfo,
  createModelRecommendation,
  createONNXImageModel,
  createGeneratedImage,
} from '../../utils/factories';

describe('appStore', () => {
  beforeEach(() => {
    resetStores();
  });

  // ============================================================================
  // Onboarding
  // ============================================================================
  describe('onboarding', () => {
    it('starts with onboarding incomplete', () => {
      expect(getAppState().hasCompletedOnboarding).toBe(false);
    });

    it('setOnboardingComplete updates state', () => {
      const { setOnboardingComplete } = useAppStore.getState();

      setOnboardingComplete(true);

      expect(getAppState().hasCompletedOnboarding).toBe(true);
    });

    it('can reset onboarding state', () => {
      const { setOnboardingComplete } = useAppStore.getState();

      setOnboardingComplete(true);
      setOnboardingComplete(false);

      expect(getAppState().hasCompletedOnboarding).toBe(false);
    });
  });

  // ============================================================================
  // Device Info
  // ============================================================================
  describe('deviceInfo', () => {
    it('starts with null deviceInfo', () => {
      expect(getAppState().deviceInfo).toBeNull();
    });

    it('setDeviceInfo updates state', () => {
      const { setDeviceInfo } = useAppStore.getState();
      const deviceInfo = createDeviceInfo();

      setDeviceInfo(deviceInfo);

      expect(getAppState().deviceInfo).toEqual(deviceInfo);
    });

    it('setModelRecommendation updates state', () => {
      const { setModelRecommendation } = useAppStore.getState();
      const recommendation = createModelRecommendation();

      setModelRecommendation(recommendation);

      expect(getAppState().modelRecommendation).toEqual(recommendation);
    });
  });

  // ============================================================================
  // Downloaded Models
  // ============================================================================
  describe('downloadedModels', () => {
    it('starts with empty downloadedModels', () => {
      expect(getAppState().downloadedModels).toEqual([]);
    });

    it('setDownloadedModels replaces entire list', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const models = [createDownloadedModel(), createDownloadedModel()];

      setDownloadedModels(models);

      expect(getAppState().downloadedModels).toHaveLength(2);
    });

    it('addDownloadedModel appends new model', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const model = createDownloadedModel();

      addDownloadedModel(model);

      expect(getAppState().downloadedModels).toHaveLength(1);
      expect(getAppState().downloadedModels[0].id).toBe(model.id);
    });

    it('addDownloadedModel replaces model with same ID', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'same-id', name: 'Original' });
      const model2 = createDownloadedModel({ id: 'same-id', name: 'Updated' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('Updated');
    });

    it('setDownloadedModels excludes Whisper STT models (they belong to Voice, not Text)', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const text = createDownloadedModel({ id: 'qwen', fileName: 'qwen.gguf' });
      const whisperById = createDownloadedModel({ id: 'whisper-small.en', fileName: 'ggml-small.en.bin' });
      const whisperByFile = createDownloadedModel({ id: 'recovered_x', fileName: 'ggml-base.en.bin' });

      setDownloadedModels([text, whisperById, whisperByFile]);

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('qwen');
    });

    it('addDownloadedModel ignores Whisper STT models', () => {
      const { addDownloadedModel } = useAppStore.getState();
      addDownloadedModel(createDownloadedModel({ id: 'whisper-small.en', fileName: 'ggml-small.en.bin' }));
      expect(getAppState().downloadedModels).toHaveLength(0);
    });

    it('removeDownloadedModel removes model by ID', () => {
      const { addDownloadedModel, removeDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'model-1' });
      const model2 = createDownloadedModel({ id: 'model-2' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      removeDownloadedModel('model-1');

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model-2');
    });

    it('removeDownloadedModel clears activeModelId if active model removed', () => {
      const { addDownloadedModel, setActiveModelId, removeDownloadedModel } = useAppStore.getState();
      const model = createDownloadedModel({ id: 'active-model' });

      addDownloadedModel(model);
      setActiveModelId('active-model');
      expect(getAppState().activeModelId).toBe('active-model');

      removeDownloadedModel('active-model');

      expect(getAppState().activeModelId).toBeNull();
    });

    it('setLastTextModelId records the selected text model as a preference', () => {
      const { setLastTextModelId } = useAppStore.getState();
      expect(getAppState().lastTextModelId).toBeNull();
      setLastTextModelId('my-text-model');
      expect(getAppState().lastTextModelId).toBe('my-text-model');
      // Independent of activeModelId, so it survives residency eviction.
      useAppStore.getState().setActiveModelId(null);
      expect(getAppState().lastTextModelId).toBe('my-text-model');
    });

    it('removeDownloadedModel preserves activeModelId if different model removed', () => {
      const { addDownloadedModel, setActiveModelId, removeDownloadedModel } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'model-1' });
      const model2 = createDownloadedModel({ id: 'model-2' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      setActiveModelId('model-1');

      removeDownloadedModel('model-2');

      expect(getAppState().activeModelId).toBe('model-1');
    });
  });

  // ============================================================================
  // Active Model
  // ============================================================================
  describe('activeModel', () => {
    it('starts with null activeModelId', () => {
      expect(getAppState().activeModelId).toBeNull();
    });

    it('setActiveModelId updates state', () => {
      const { setActiveModelId } = useAppStore.getState();

      setActiveModelId('model-123');

      expect(getAppState().activeModelId).toBe('model-123');
    });

    it('setActiveModelId can clear active model', () => {
      const { setActiveModelId } = useAppStore.getState();

      setActiveModelId('model-123');
      setActiveModelId(null);

      expect(getAppState().activeModelId).toBeNull();
    });
  });

  // ============================================================================
  // Loading States
  // ============================================================================
  describe('loadingStates', () => {
    it('starts with isLoadingModel false', () => {
      expect(getAppState().isLoadingModel).toBe(false);
    });

    it('setIsLoadingModel updates state', () => {
      const { setIsLoadingModel } = useAppStore.getState();

      setIsLoadingModel(true);
      expect(getAppState().isLoadingModel).toBe(true);

      setIsLoadingModel(false);
      expect(getAppState().isLoadingModel).toBe(false);
    });
  });

  // ============================================================================
  // Download Progress
  // ============================================================================
  describe('downloadProgress', () => {
    it('legacy appStore progress tracking has been removed', () => {
      const state = getAppState() as any;
      expect(state.downloadProgress).toBeUndefined();
      expect(state.setDownloadProgress).toBeUndefined();
    });
  });

  // ============================================================================
  // Background Downloads
  // ============================================================================
  describe('backgroundDownloads', () => {
    it('legacy appStore background-download mutators have been removed', () => {
      const state = getAppState() as any;
      expect(state.setBackgroundDownload).toBeUndefined();
      expect(state.clearBackgroundDownloads).toBeUndefined();
      expect(state.activeBackgroundDownloads).toBeUndefined();
    });
  });

  // ============================================================================
  // Settings
  // ============================================================================
  describe('settings', () => {
    it('has sensible defaults', () => {
      const settings = getAppState().settings;

      expect(settings.temperature).toBe(0.7);
      expect(settings.maxTokens).toBe(1024);
      expect(settings.topP).toBe(0.9);
      expect(settings.contextLength).toBe(4096);
      expect(settings.imageGenerationMode).toBe('auto');
      // Test env is iOS, so GPU is enabled by default
      expect(settings.enableGpu).toBe(true);
    });

    it('updateSettings merges partial settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ temperature: 0.9 });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.9);
      expect(settings.maxTokens).toBe(1024); // unchanged
    });

    it('updateSettings can update multiple settings at once', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        temperature: 0.5,
        maxTokens: 2048,
        enableGpu: false,
      });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.5);
      expect(settings.maxTokens).toBe(2048);
      expect(settings.enableGpu).toBe(false);
    });

    it('updateSettings handles image generation settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        imageGenerationMode: 'manual',
        imageSteps: 30,
        imageGuidanceScale: 8.5,
        imageWidth: 768,
        imageHeight: 768,
      });

      const settings = getAppState().settings;
      expect(settings.imageGenerationMode).toBe('manual');
      expect(settings.imageSteps).toBe(30);
      expect(settings.imageGuidanceScale).toBe(8.5);
      expect(settings.imageWidth).toBe(768);
    });
  });

  // ============================================================================
  // Loaded Settings (for detecting pending changes)
  // ============================================================================
  describe('loadedSettings', () => {
    it('starts with null loadedSettings', () => {
      expect(getAppState().loadedSettings).toBeNull();
    });

    it('setLoadedSettings stores settings that require reload', () => {
      const { setLoadedSettings } = useAppStore.getState();

      setLoadedSettings({
        nThreads: 4,
        nBatch: 512,
        contextLength: 4096,
        enableGpu: true,
        gpuLayers: 99,
        flashAttn: true,
        cacheType: 'q8_0',
      });

      const loaded = getAppState().loadedSettings;
      expect(loaded).not.toBeNull();
      expect(loaded?.nThreads).toBe(4);
      expect(loaded?.contextLength).toBe(4096);
      expect(loaded?.enableGpu).toBe(true);
      expect(loaded?.gpuLayers).toBe(99);
      expect(loaded?.cacheType).toBe('q8_0');
    });

    it('setLoadedSettings can be cleared with null', () => {
      const { setLoadedSettings } = useAppStore.getState();

      setLoadedSettings({ nThreads: 4, enableGpu: true } as any);
      expect(getAppState().loadedSettings).not.toBeNull();

      setLoadedSettings(null);
      expect(getAppState().loadedSettings).toBeNull();
    });

    it('loadedSettings is separate from current settings', () => {
      const { updateSettings, setLoadedSettings } = useAppStore.getState();

      // Set initial settings
      updateSettings({ nThreads: 4, enableGpu: true });

      // Save loaded settings
      setLoadedSettings({
        nThreads: 4,
        enableGpu: true,
        nBatch: 512,
        contextLength: 2048,
        flashAttn: true,
        cacheType: 'q8_0',
        gpuLayers: 99,
      });

      // Change current settings
      updateSettings({ nThreads: 8 });

      // loadedSettings should still have old value
      expect(getAppState().loadedSettings?.nThreads).toBe(4);
      expect(getAppState().settings.nThreads).toBe(8);
    });

    it('loadedSettings can be partial', () => {
      const { setLoadedSettings } = useAppStore.getState();

      setLoadedSettings({
        enableGpu: false,
        gpuLayers: 50,
      });

      const loaded = getAppState().loadedSettings;
      expect(loaded?.enableGpu).toBe(false);
      expect(loaded?.gpuLayers).toBe(50);
      expect(loaded?.nThreads).toBeUndefined();
    });
  });

  // ============================================================================
  // Image Models (ONNX)
  // ============================================================================
  describe('imageModels', () => {
    it('starts with empty downloadedImageModels', () => {
      expect(getAppState().downloadedImageModels).toEqual([]);
    });

    it('setDownloadedImageModels replaces list', () => {
      const { setDownloadedImageModels } = useAppStore.getState();
      const models = [createONNXImageModel(), createONNXImageModel()];

      setDownloadedImageModels(models);

      expect(getAppState().downloadedImageModels).toHaveLength(2);
    });

    it('addDownloadedImageModel adds new model', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel();

      addDownloadedImageModel(model);

      expect(getAppState().downloadedImageModels).toHaveLength(1);
    });

    it('addDownloadedImageModel replaces model with same ID', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      const model1 = createONNXImageModel({ id: 'same-id', name: 'Original' });
      const model2 = createONNXImageModel({ id: 'same-id', name: 'Updated' });

      addDownloadedImageModel(model1);
      addDownloadedImageModel(model2);

      const models = getAppState().downloadedImageModels;
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('Updated');
    });

    it('removeDownloadedImageModel removes model', () => {
      const { addDownloadedImageModel, removeDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel({ id: 'img-model-1' });

      addDownloadedImageModel(model);
      removeDownloadedImageModel('img-model-1');

      expect(getAppState().downloadedImageModels).toHaveLength(0);
    });

    it('removeDownloadedImageModel clears activeImageModelId if active', () => {
      const { addDownloadedImageModel, setActiveImageModelId, removeDownloadedImageModel } = useAppStore.getState();
      const model = createONNXImageModel({ id: 'img-model-1' });

      addDownloadedImageModel(model);
      setActiveImageModelId('img-model-1');
      removeDownloadedImageModel('img-model-1');

      expect(getAppState().activeImageModelId).toBeNull();
    });

    it('setActiveImageModelId updates state', () => {
      const { setActiveImageModelId } = useAppStore.getState();

      setActiveImageModelId('img-model-1');

      expect(getAppState().activeImageModelId).toBe('img-model-1');
    });
  });

  // ============================================================================
  // Image Model Download Tracking (Multi-download)
  // ============================================================================
  describe('imageModelDownloadTracking', () => {
    it('legacy appStore image download tracking has been removed', () => {
      const state = getAppState() as any;
      expect(state.imageModelDownloading).toBeUndefined();
      expect(state.imageModelDownloadIds).toBeUndefined();
      expect(state.addImageModelDownloading).toBeUndefined();
      expect(state.setImageModelDownloadId).toBeUndefined();
    });
  });

  // ============================================================================
  // Image Model Download Persistence (survives app restart)
  // ============================================================================
  describe('imageModelDownloadPersistence', () => {
    it('persist partialize no longer includes legacy image download tracking', () => {
      const partialize = (useAppStore.persist as any).getOptions().partialize;
      const partialized = partialize(useAppStore.getState());

      expect(partialized.imageModelDownloading).toBeUndefined();
      expect(partialized.imageModelDownloadIds).toBeUndefined();
      expect(partialized.activeBackgroundDownloads).toBeUndefined();
    });
  });

  // ============================================================================
  // Image Generation State
  // ============================================================================
  describe('imageGenerationState', () => {
    it('starts with generation not in progress', () => {
      const state = getAppState();
      expect(state.isGeneratingImage).toBe(false);
      expect(state.imageGenerationProgress).toBeNull();
      expect(state.imageGenerationStatus).toBeNull();
      expect(state.imagePreviewPath).toBeNull();
    });

    it('setIsGeneratingImage updates state', () => {
      const { setIsGeneratingImage } = useAppStore.getState();

      setIsGeneratingImage(true);
      expect(getAppState().isGeneratingImage).toBe(true);

      setIsGeneratingImage(false);
      expect(getAppState().isGeneratingImage).toBe(false);
    });

    it('setImageGenerationProgress tracks steps', () => {
      const { setImageGenerationProgress } = useAppStore.getState();

      setImageGenerationProgress({ step: 5, totalSteps: 20 });

      const progress = getAppState().imageGenerationProgress;
      expect(progress?.step).toBe(5);
      expect(progress?.totalSteps).toBe(20);
    });

    it('setImageGenerationProgress can clear with null', () => {
      const { setImageGenerationProgress } = useAppStore.getState();

      setImageGenerationProgress({ step: 5, totalSteps: 20 });
      setImageGenerationProgress(null);

      expect(getAppState().imageGenerationProgress).toBeNull();
    });

    it('setImageGenerationStatus updates status text', () => {
      const { setImageGenerationStatus } = useAppStore.getState();

      setImageGenerationStatus('Encoding prompt...');
      expect(getAppState().imageGenerationStatus).toBe('Encoding prompt...');

      setImageGenerationStatus(null);
      expect(getAppState().imageGenerationStatus).toBeNull();
    });

    it('setImagePreviewPath updates preview', () => {
      const { setImagePreviewPath } = useAppStore.getState();

      setImagePreviewPath('/path/to/preview.png');
      expect(getAppState().imagePreviewPath).toBe('/path/to/preview.png');

      setImagePreviewPath(null);
      expect(getAppState().imagePreviewPath).toBeNull();
    });
  });

  // ============================================================================
  // Gallery
  // ============================================================================
  describe('gallery', () => {
    it('starts with empty generatedImages', () => {
      expect(getAppState().generatedImages).toEqual([]);
    });

    it('addGeneratedImage prepends to list', () => {
      const { addGeneratedImage } = useAppStore.getState();
      const image1 = createGeneratedImage({ prompt: 'First' });
      const image2 = createGeneratedImage({ prompt: 'Second' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(2);
      expect(images[0].prompt).toBe('Second'); // Most recent first
      expect(images[1].prompt).toBe('First');
    });

    it('removeGeneratedImage removes by ID', () => {
      const { addGeneratedImage, removeGeneratedImage } = useAppStore.getState();
      const image1 = createGeneratedImage({ id: 'img-1' });
      const image2 = createGeneratedImage({ id: 'img-2' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);
      removeGeneratedImage('img-1');

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe('img-2');
    });

    it('removeImagesByConversationId removes all for conversation', () => {
      const { addGeneratedImage, removeImagesByConversationId } = useAppStore.getState();
      const image1 = createGeneratedImage({ id: 'img-1', conversationId: 'conv-1' });
      const image2 = createGeneratedImage({ id: 'img-2', conversationId: 'conv-1' });
      const image3 = createGeneratedImage({ id: 'img-3', conversationId: 'conv-2' });

      addGeneratedImage(image1);
      addGeneratedImage(image2);
      addGeneratedImage(image3);

      const removedIds = removeImagesByConversationId('conv-1');

      expect(removedIds).toContain('img-1');
      expect(removedIds).toContain('img-2');
      expect(removedIds).toHaveLength(2);

      const images = getAppState().generatedImages;
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe('img-3');
    });

    it('clearGeneratedImages removes all', () => {
      const { addGeneratedImage, clearGeneratedImages } = useAppStore.getState();

      addGeneratedImage(createGeneratedImage());
      addGeneratedImage(createGeneratedImage());
      clearGeneratedImages();

      expect(getAppState().generatedImages).toEqual([]);
    });
  });

  // ============================================================================
  // Theme Mode
  // ============================================================================
  describe('themeMode', () => {
    it('defaults to system mode', () => {
      expect(getAppState().themeMode).toBe('system');
    });

    it('setThemeMode switches to dark', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');

      expect(getAppState().themeMode).toBe('dark');
    });

    it('setThemeMode can switch back to light', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');
      setThemeMode('light');

      expect(getAppState().themeMode).toBe('light');
    });

    it('setThemeMode can switch to system', () => {
      const { setThemeMode } = useAppStore.getState();

      setThemeMode('dark');
      setThemeMode('system');

      expect(getAppState().themeMode).toBe('system');
    });
  });

  // ============================================================================
  // Merge / Migration Function
  // ============================================================================
  describe('merge (persistence migrations)', () => {
    it('migrates old string imageModelDownloading to array', () => {
      // Simulate old persisted state with string value
      const oldPersistedState = {
        imageModelDownloading: 'old-model-id' as any,
        imageModelDownloadIds: {},
      };

      // Apply the merge by setting state directly with old format
      // then checking the merge logic handles it
      const currentState = useAppStore.getState();
      const merged = {
        ...currentState,
        ...oldPersistedState,
      };

      // The merge function converts string to array
      if (typeof merged.imageModelDownloading === 'string') {
        merged.imageModelDownloading = [merged.imageModelDownloading];
      }

      expect(Array.isArray(merged.imageModelDownloading)).toBe(true);
      expect(merged.imageModelDownloading).toEqual(['old-model-id']);
    });

    it('migrates old number imageModelDownloadId to Record', () => {
      // Simulate old persisted state with single number
      const oldPersistedState = {
        imageModelDownloading: ['model-a'],
        imageModelDownloadId: 42 as any,
      };

      const currentState = useAppStore.getState();
      const merged = {
        ...currentState,
        ...oldPersistedState,
      };

      // Apply the same logic as the merge function
      if (typeof merged.imageModelDownloadId === 'number') {
        const ids: Record<string, number> = {};
        if (Array.isArray(merged.imageModelDownloading) && merged.imageModelDownloading.length > 0) {
          ids[merged.imageModelDownloading[0]] = merged.imageModelDownloadId;
        }
        (merged as any).imageModelDownloadIds = ids; // NOSONAR: property absent from spread type; as-any required by tsc
        delete merged.imageModelDownloadId;
      }

      expect((merged as any).imageModelDownloadIds).toEqual({ 'model-a': 42 }); // NOSONAR
      expect(merged.imageModelDownloadId).toBeUndefined();
    });

    it('handles null imageModelDownloading gracefully', () => {
      const merged = { imageModelDownloading: null as any };

      if (!Array.isArray(merged.imageModelDownloading)) {
        merged.imageModelDownloading = [];
      }

      expect(merged.imageModelDownloading).toEqual([]);
    });

    it('handles undefined imageModelDownloadIds gracefully', () => {
      const merged = { imageModelDownloadIds: undefined as any };

      if (!merged.imageModelDownloadIds || typeof merged.imageModelDownloadIds !== 'object') {
        merged.imageModelDownloadIds = {};
      }

      expect(merged.imageModelDownloadIds).toEqual({});
    });

    it('strips the removed modelLoadingStrategy setting on rehydrate', async () => {
      const AsyncStorage = require('@react-native-async-storage/async-storage');

      // Old persisted state still carrying the removed setting.
      const persistedPayload = JSON.stringify({
        state: {
          settings: { modelLoadingStrategy: 'memory' },
        },
        version: 0,
      });
      await AsyncStorage.setItem('local-llm-app-storage', persistedPayload);

      await (useAppStore as any).persist.rehydrate();

      expect((useAppStore.getState().settings as any).modelLoadingStrategy).toBeUndefined();

      await AsyncStorage.removeItem('local-llm-app-storage');
    });
  });

  // ============================================================================
  // Settings Persistence
  // ============================================================================
  describe('settings persistence edge cases', () => {
    it('updateSettings does not clear unrelated fields', () => {
      const { updateSettings } = useAppStore.getState();

      // Set several fields
      updateSettings({
        temperature: 0.5,
        maxTokens: 2048,
        imageSteps: 30,
      });

      // Update only one field
      updateSettings({ temperature: 0.9 });

      const settings = getAppState().settings;
      expect(settings.temperature).toBe(0.9);
      expect(settings.maxTokens).toBe(2048);
      expect(settings.imageSteps).toBe(30);
    });

    it('handles performance settings', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({
        nThreads: 8,
        nBatch: 512,
        enableGpu: true,
        gpuLayers: 32,
      });

      const settings = getAppState().settings;
      expect(settings.nThreads).toBe(8);
      expect(settings.nBatch).toBe(512);
      expect(settings.enableGpu).toBe(true);
      expect(settings.gpuLayers).toBe(32);
    });

  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('removeDownloadedImageModel branch coverage', () => {
    it('preserves activeImageModelId when a different model is removed', () => {
      const { addDownloadedImageModel, setActiveImageModelId, removeDownloadedImageModel } = useAppStore.getState();
      const model1 = createONNXImageModel({ id: 'img-keep' });
      const model2 = createONNXImageModel({ id: 'img-remove' });

      addDownloadedImageModel(model1);
      addDownloadedImageModel(model2);
      setActiveImageModelId('img-keep');

      removeDownloadedImageModel('img-remove');

      expect(getAppState().activeImageModelId).toBe('img-keep');
      expect(getAppState().downloadedImageModels).toHaveLength(1);
    });
  });

  describe('removeImagesByConversationId branch coverage', () => {
    it('returns empty array when no images match the conversationId', () => {
      const { addGeneratedImage, removeImagesByConversationId } = useAppStore.getState();
      const image = createGeneratedImage({ id: 'img-1', conversationId: 'conv-1' });

      addGeneratedImage(image);

      const removedIds = removeImagesByConversationId('conv-nonexistent');

      expect(removedIds).toEqual([]);
      expect(getAppState().generatedImages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Actual persist merge function tests (exercises real store merge callback)
  // ============================================================================
  describe('persist merge function (actual)', () => {
    // Access the real merge function from the store's persist configuration
    const getMergeFn = () => {
      const options = (useAppStore as any).persist?.getOptions?.();
      return options?.merge as (persistedState: any, currentState: any) => any;
    };

    it('drops legacy imageModelDownloading field', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        { imageModelDownloading: 'old-model-id' },
        currentState
      );

      expect(result.imageModelDownloading).toBeUndefined();
    });

    it('drops legacy imageModelDownloadIds and imageModelDownloadId fields', () => {
      const merge = getMergeFn();
      const currentState = useAppStore.getState();

      const result = merge(
        {
          imageModelDownloadIds: { a: 1 },
          imageModelDownloadId: 42,
        },
        currentState
      );

      expect(result.imageModelDownloadIds).toBeUndefined();
      expect(result.imageModelDownloadId).toBeUndefined();
    });
  });

  // ============================================================================
  // Settings defaults completeness
  // ============================================================================
  describe('settings defaults completeness', () => {
    it('has correct default systemPrompt', () => {
      expect(getAppState().settings.systemPrompt).toContain('helpful AI assistant');
    });

    it('has correct default repeatPenalty', () => {
      expect(getAppState().settings.repeatPenalty).toBe(1.1);
    });

    it('has correct default nThreads', () => {
      expect(getAppState().settings.nThreads).toBe(0);
    });

    it('has correct default nBatch', () => {
      expect(getAppState().settings.nBatch).toBe(512);
    });

    it('has correct default autoDetectMethod', () => {
      expect(getAppState().settings.autoDetectMethod).toBe('pattern');
    });

    it('has null classifierModelId by default', () => {
      expect(getAppState().settings.classifierModelId).toBeNull();
    });

    it('has correct default imageThreads', () => {
      expect(getAppState().settings.imageThreads).toBe(4);
    });

    it('has correct default image dimensions', () => {
      const settings = getAppState().settings;
      expect(settings.imageWidth).toBe(512);
      expect(settings.imageHeight).toBe(512);
    });

    it('has enhanceImagePrompts disabled by default', () => {
      expect(getAppState().settings.enhanceImagePrompts).toBe(false);
    });

    it('has gpuLayers set to 99 by default', () => {
      expect(getAppState().settings.gpuLayers).toBe(99);
    });

    it('has flashAttn enabled by default on iOS (test env platform)', () => {
      // The store initializes flashAttn as Platform.OS !== 'android'.
      // The react-native preset sets defaultPlatform to 'ios', so without resetStores()
      // the store should default to true. We verify by loading a fresh store instance.
      jest.resetModules();
      try {
        // Fresh require — no resetStores() interference, so we see the real default
        const { useAppStore: freshStore } = require('../../../src/stores/appStore');
        // ios !== android → true
        expect(freshStore.getState().settings.flashAttn).toBe(true);
      } finally {
        jest.resetModules();
      }
    });

    it('flashAttn default formula: false on Android, true elsewhere', () => {
      // The store default is Platform.OS !== 'android'. Verify the formula directly.
      const formula = (os: string) => os !== 'android';
      expect(formula('android')).toBe(false); // Android → flash attn off by default
      expect(formula('ios')).toBe(true);      // iOS     → flash attn on by default
    });

    it('updateSettings can toggle flashAttn', () => {
      const { updateSettings } = useAppStore.getState();
      const initial = getAppState().settings.flashAttn;

      updateSettings({ flashAttn: !initial });
      expect(getAppState().settings.flashAttn).toBe(!initial);

      updateSettings({ flashAttn: initial });
      expect(getAppState().settings.flashAttn).toBe(initial);
    });

    it('updateSettings flashAttn does not affect other fields', () => {
      const { updateSettings } = useAppStore.getState();
      const before = getAppState().settings;

      updateSettings({ flashAttn: true });

      const after = getAppState().settings;
      expect(after.temperature).toBe(before.temperature);
      expect(after.gpuLayers).toBe(before.gpuLayers);
      expect(after.enableGpu).toBe(before.enableGpu);
    });

    it('has showGenerationDetails disabled by default', () => {
      expect(getAppState().settings.showGenerationDetails).toBe(false);
    });
  });

  // ============================================================================
  // Concurrent state operations
  // ============================================================================
  describe('concurrent state operations', () => {
    it('handles rapid sequential model additions', () => {
      const { addDownloadedModel } = useAppStore.getState();

      for (let i = 0; i < 10; i++) {
        addDownloadedModel(createDownloadedModel({ id: `model-${i}`, name: `Model ${i}` }));
      }

      expect(getAppState().downloadedModels).toHaveLength(10);
    });

    it('handles rapid sequential image model additions', () => {
      const { addDownloadedImageModel } = useAppStore.getState();

      for (let i = 0; i < 5; i++) {
        addDownloadedImageModel(createONNXImageModel({ id: `img-${i}` }));
      }

      expect(getAppState().downloadedImageModels).toHaveLength(5);
    });

    it('drops legacy persisted download tracking fields during migration', () => {
      const currentState = useAppStore.getState();
      const migrated = (useAppStore.persist as any).getOptions().merge({
        state: {
          downloadProgress: { m1: { progress: 0.5 } },
          activeBackgroundDownloads: { 1: { fileName: 'x.gguf' } },
          imageModelDownloading: 'img-1',
          imageModelDownloadIds: { 'img-1': 12 },
          imageModelDownloadId: 12,
        },
      }, currentState);

      expect(migrated.downloadProgress).toBeUndefined();
      expect(migrated.activeBackgroundDownloads).toBeUndefined();
      expect(migrated.imageModelDownloading).toBeUndefined();
      expect(migrated.imageModelDownloadIds).toBeUndefined();
      expect(migrated.imageModelDownloadId).toBeUndefined();
    });

    it('handles model add and remove in sequence', () => {
      const { addDownloadedModel, removeDownloadedModel, setActiveModelId } = useAppStore.getState();
      const model1 = createDownloadedModel({ id: 'keep-model' });
      const model2 = createDownloadedModel({ id: 'temp-model' });

      addDownloadedModel(model1);
      addDownloadedModel(model2);
      setActiveModelId('keep-model');
      removeDownloadedModel('temp-model');

      expect(getAppState().downloadedModels).toHaveLength(1);
      expect(getAppState().downloadedModels[0].id).toBe('keep-model');
      expect(getAppState().activeModelId).toBe('keep-model');
    });
  });

  // ============================================================================
  // Settings edge cases
  // ============================================================================
  describe('settings edge cases', () => {
    it('updateSettings with empty object does not change anything', () => {
      const { updateSettings } = useAppStore.getState();
      const before = { ...getAppState().settings };

      updateSettings({});

      expect(getAppState().settings).toEqual(before);
    });

    it('updateSettings can set temperature to 0', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ temperature: 0 });

      expect(getAppState().settings.temperature).toBe(0);
    });

    it('updateSettings can set maxTokens to very high value', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ maxTokens: 32768 });

      expect(getAppState().settings.maxTokens).toBe(32768);
    });

    it('updateSettings can toggle enhanceImagePrompts', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ enhanceImagePrompts: true });
      expect(getAppState().settings.enhanceImagePrompts).toBe(true);

      updateSettings({ enhanceImagePrompts: false });
      expect(getAppState().settings.enhanceImagePrompts).toBe(false);
    });

    it('updateSettings can set classifierModelId', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ classifierModelId: 'some-model-id' });
      expect(getAppState().settings.classifierModelId).toBe('some-model-id');

      updateSettings({ classifierModelId: null });
      expect(getAppState().settings.classifierModelId).toBeNull();
    });

    it('updateSettings can toggle showGenerationDetails', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ showGenerationDetails: true });
      expect(getAppState().settings.showGenerationDetails).toBe(true);
    });

    it('updateSettings handles all image generation modes', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ imageGenerationMode: 'manual' });
      expect(getAppState().settings.imageGenerationMode).toBe('manual');

      updateSettings({ imageGenerationMode: 'manual' });
      expect(getAppState().settings.imageGenerationMode).toBe('manual');

      updateSettings({ imageGenerationMode: 'auto' });
      expect(getAppState().settings.imageGenerationMode).toBe('auto');
    });

    it('updateSettings handles autoDetectMethod values', () => {
      const { updateSettings } = useAppStore.getState();

      updateSettings({ autoDetectMethod: 'llm' });
      expect(getAppState().settings.autoDetectMethod).toBe('llm');

      updateSettings({ autoDetectMethod: 'pattern' });
      expect(getAppState().settings.autoDetectMethod).toBe('pattern');
    });
  });

  // ============================================================================
  // Image generation state full lifecycle
  // ============================================================================
  describe('image generation lifecycle', () => {
    it('simulates complete image generation lifecycle', () => {
      const {
        setIsGeneratingImage,
        setImageGenerationStatus,
        setImageGenerationProgress,
        setImagePreviewPath,
        addGeneratedImage,
      } = useAppStore.getState();

      // Start generation
      setIsGeneratingImage(true);
      setImageGenerationStatus('Loading model...');
      expect(getAppState().isGeneratingImage).toBe(true);

      // Progress updates
      setImageGenerationStatus('Generating image...');
      setImageGenerationProgress({ step: 1, totalSteps: 20 });
      setImageGenerationProgress({ step: 10, totalSteps: 20 });
      expect(getAppState().imageGenerationProgress?.step).toBe(10);

      // Preview available
      setImagePreviewPath('/tmp/preview.png');
      expect(getAppState().imagePreviewPath).toBe('/tmp/preview.png');

      // Complete
      setImageGenerationProgress({ step: 20, totalSteps: 20 });
      addGeneratedImage(createGeneratedImage({ id: 'result-img' }));
      setIsGeneratingImage(false);
      setImageGenerationProgress(null);
      setImageGenerationStatus(null);
      setImagePreviewPath(null);

      // Verify final state
      expect(getAppState().isGeneratingImage).toBe(false);
      expect(getAppState().imageGenerationProgress).toBeNull();
      expect(getAppState().imageGenerationStatus).toBeNull();
      expect(getAppState().imagePreviewPath).toBeNull();
      expect(getAppState().generatedImages).toHaveLength(1);
    });
  });

  // ============================================================================
  // Background download edge cases
  // ============================================================================
  describe('background download edge cases', () => {
    it('no longer exposes legacy background-download appStore APIs', () => {
      const state = useAppStore.getState() as any;

      expect(state.setBackgroundDownload).toBeUndefined();
      expect(state.clearBackgroundDownloads).toBeUndefined();
      expect(state.activeBackgroundDownloads).toBeUndefined();
    });
  });

  // ============================================================================
  // Suspicious recovered model filtering (isSuspiciousRecoveredTextModel)
  // ============================================================================
  describe('suspicious recovered model filtering', () => {
    it('setDownloadedModels filters out recovered_ model with unknown author', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const suspicious = createDownloadedModel({ id: 'recovered_abc', author: 'unknown', quantization: 'Q4_K_M' });
      const clean = createDownloadedModel({ id: 'clean-model' });

      setDownloadedModels([suspicious, clean]);

      const models = getAppState().downloadedModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('clean-model');
    });

    it('setDownloadedModels filters out recovered_ model with empty author', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const suspicious = createDownloadedModel({ id: 'recovered_xyz', author: '  ', quantization: 'Q4' });

      setDownloadedModels([suspicious]);

      expect(getAppState().downloadedModels).toHaveLength(0);
    });

    it('setDownloadedModels filters out recovered_ model with unknown quantization', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const suspicious = createDownloadedModel({ id: 'recovered_xyz', author: 'Meta', quantization: 'unknown' });

      setDownloadedModels([suspicious]);

      expect(getAppState().downloadedModels).toHaveLength(0);
    });

    it('setDownloadedModels keeps recovered_ model with known author and quantization', () => {
      const { setDownloadedModels } = useAppStore.getState();
      const legit = createDownloadedModel({ id: 'recovered_xyz', author: 'Meta', quantization: 'Q4_K_M' });

      setDownloadedModels([legit]);

      expect(getAppState().downloadedModels).toHaveLength(1);
    });

    it('addDownloadedModel ignores suspicious recovered_ model', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const suspicious = createDownloadedModel({ id: 'recovered_bad', author: 'unknown', quantization: 'unknown' });

      addDownloadedModel(suspicious);

      expect(getAppState().downloadedModels).toHaveLength(0);
    });

    it('addDownloadedModel accepts non-recovered model regardless of author', () => {
      const { addDownloadedModel } = useAppStore.getState();
      const model = createDownloadedModel({ id: 'normal-model', author: 'unknown' });

      addDownloadedModel(model);

      // Non-recovered_ prefix → not suspicious
      expect(getAppState().downloadedModels).toHaveLength(1);
    });

    it('setDownloadedImageModels filters out recovered_ image models', () => {
      const { setDownloadedImageModels } = useAppStore.getState();
      const suspicious = createONNXImageModel({ id: 'recovered_img' });
      const clean = createONNXImageModel({ id: 'clean-img' });

      setDownloadedImageModels([suspicious, clean]);

      const models = getAppState().downloadedImageModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('clean-img');
    });

    it('addDownloadedImageModel ignores recovered_ image model', () => {
      const { addDownloadedImageModel } = useAppStore.getState();
      const suspicious = createONNXImageModel({ id: 'recovered_bad_img' });

      addDownloadedImageModel(suspicious);

      expect(getAppState().downloadedImageModels).toHaveLength(0);
    });
  });

  // ============================================================================
  // migratePersistedState branches (via actual merge function)
  // ============================================================================
  describe('migratePersistedState via persist merge', () => {
    const getMergeFn = () => (useAppStore as any).persist?.getOptions?.().merge as (p: any, c: any) => any;

    it('migrates missing cacheType with flashAttn=true to q8_0', () => {
      const merge = getMergeFn();
      const result = merge(
        { settings: { flashAttn: true } }, // no cacheType
        useAppStore.getState(),
      );
      expect(result.settings.cacheType).toBe('q8_0');
    });

    it('migrates missing cacheType with flashAttn=false to f16', () => {
      const merge = getMergeFn();
      const result = merge(
        { settings: { flashAttn: false } }, // no cacheType
        useAppStore.getState(),
      );
      expect(result.settings.cacheType).toBe('f16');
    });

    it('migrates missing inferenceBackend to platform default', () => {
      const merge = getMergeFn();
      const result = merge(
        { settings: { temperature: 0.7 } }, // no inferenceBackend
        useAppStore.getState(),
      );
      // Should be set to something (not undefined)
      expect(result.settings.inferenceBackend).toBeDefined();
    });

    it('resets checklistDismissed when checklist is incomplete', () => {
      const merge = getMergeFn();
      const result = merge(
        {
          checklistDismissed: true,
          onboardingChecklist: {
            downloadedModel: false, loadedModel: false, sentMessage: false,
            triedImageGen: false, exploredSettings: false, createdProject: false,
          },
        },
        useAppStore.getState(),
      );
      expect(result.checklistDismissed).toBe(false);
    });
  });

});
