import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo, DownloadedModel, ModelRecommendation, ONNXImageModel, ImageGenerationMode, AutoDetectMethod, ModelLoadingStrategy, CacheType, InferenceBackend, INFERENCE_BACKENDS, GeneratedImage, PersistedDownloadInfo, BackgroundDownloadReasonCode, BackgroundDownloadStatus } from '../types';

type DownloadProgressInfo = {
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  ownerDownloadId?: number;
  status?: BackgroundDownloadStatus | string;
  reason?: string;
  reasonCode?: BackgroundDownloadReasonCode;
};

type OnboardingChecklist = {
  downloadedModel: boolean; loadedModel: boolean; sentMessage: boolean;
  triedImageGen: boolean; exploredSettings: boolean; createdProject: boolean;
};

type AppSettings = {
  systemPrompt: string; temperature: number; maxTokens: number;
  topP: number; repeatPenalty: number; contextLength: number;
  nThreads: number; nBatch: number;
  imageGenerationMode: ImageGenerationMode; autoDetectMethod: AutoDetectMethod;
  classifierModelId: string | null; imageSteps: number; imageGuidanceScale: number;
  imageThreads: number; imageWidth: number; imageHeight: number;
  imageUseOpenCL: boolean; enhanceImagePrompts: boolean; modelLoadingStrategy: ModelLoadingStrategy;
  enableGpu: boolean; gpuLayers: number; flashAttn: boolean;
  cacheType: CacheType; showGenerationDetails: boolean; enabledTools: string[];
  thinkingEnabled: boolean;
  inferenceBackend: InferenceBackend;
};

type ThemeMode = 'system' | 'light' | 'dark';

interface AppState {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  hasCompletedOnboarding: boolean;
  setOnboardingComplete: (complete: boolean) => void;
  onboardingChecklist: OnboardingChecklist;
  checklistDismissed: boolean;
  completeChecklistStep: (key: string) => void;
  dismissChecklist: () => void;
  resetChecklist: () => void;
  deviceInfo: DeviceInfo | null;
  modelRecommendation: ModelRecommendation | null;
  setDeviceInfo: (info: DeviceInfo) => void;
  setModelRecommendation: (rec: ModelRecommendation) => void;
  downloadedModels: DownloadedModel[];
  setDownloadedModels: (models: DownloadedModel[]) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
  removeDownloadedModel: (modelId: string) => void;
  activeModelId: string | null;
  setActiveModelId: (modelId: string | null) => void;
  isLoadingModel: boolean;
  setIsLoadingModel: (loading: boolean) => void;
  modelMaxContext: number | null;
  setModelMaxContext: (ctx: number | null) => void;
  downloadProgress: Record<string, DownloadProgressInfo>;
  setDownloadProgress: (modelId: string, progress: DownloadProgressInfo | null) => void;
  activeBackgroundDownloads: Record<number, PersistedDownloadInfo>;
  setBackgroundDownload: (downloadId: number, info: PersistedDownloadInfo | null) => void;
  clearBackgroundDownloads: () => void;
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
  downloadedImageModels: ONNXImageModel[];
  activeImageModelId: string | null;
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  removeDownloadedImageModel: (modelId: string) => void;
  setActiveImageModelId: (modelId: string | null) => void;
  imageModelDownloading: string[];
  imageModelDownloadIds: Record<string, number>;
  addImageModelDownloading: (modelId: string) => void;
  removeImageModelDownloading: (modelId: string) => void;
  clearImageModelDownloading: () => void;
  setImageModelDownloadId: (modelId: string, downloadId: number | null) => void;
  isGeneratingImage: boolean;
  imageGenerationProgress: { step: number; totalSteps: number } | null;
  imageGenerationStatus: string | null;
  imagePreviewPath: string | null;
  setIsGeneratingImage: (generating: boolean) => void;
  setImageGenerationProgress: (progress: { step: number; totalSteps: number } | null) => void;
  setImageGenerationStatus: (status: string | null) => void;
  setImagePreviewPath: (path: string | null) => void;
  generatedImages: GeneratedImage[];
  addGeneratedImage: (image: GeneratedImage) => void;
  removeGeneratedImage: (imageId: string) => void;
  removeImagesByConversationId: (conversationId: string) => string[];
  clearGeneratedImages: () => void;
  shownSpotlights: Record<string, boolean>;
  markSpotlightShown: (key: string) => void;
  resetShownSpotlights: () => void;
  textGenerationCount: number;
  imageGenerationCount: number;
  incrementTextGenerationCount: () => number;
  incrementImageGenerationCount: () => number;
  hasEngagedSharePrompt: boolean;
  setHasEngagedSharePrompt: (v: boolean) => void;
  loadedSettings: Partial<AppSettings> | null;
  setLoadedSettings: (settings: Partial<AppSettings> | null) => void;
}

const DEFAULT_CHECKLIST: OnboardingChecklist = {
  downloadedModel: false, loadedModel: false, sentMessage: false,
  triedImageGen: false, exploredSettings: false, createdProject: false,
};

const DEFAULT_SETTINGS: AppSettings = {
  systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful.',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
  imageGenerationMode: 'auto' as ImageGenerationMode,
  autoDetectMethod: 'pattern' as AutoDetectMethod,
  classifierModelId: null,
  imageSteps: Platform.OS === 'ios' ? 20 : 8,
  imageGuidanceScale: 7.5,
  imageThreads: 4,
  imageWidth: 512,
  imageHeight: 512,
  imageUseOpenCL: true,
  enhanceImagePrompts: false,
  modelLoadingStrategy: 'performance' as ModelLoadingStrategy,
  enableGpu: Platform.OS === 'ios',
  inferenceBackend: Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU,
  gpuLayers: 99,
  flashAttn: true,
  cacheType: 'q8_0' as CacheType,
  showGenerationDetails: false,
  enabledTools: ['web_search', 'calculator', 'get_current_datetime', 'get_device_info', 'read_url', 'search_knowledge_base'],
  thinkingEnabled: true,
};

function migrateEnabledTools(merged: any): void {
  if (merged.settings?.enabledTools && !merged.settings.enabledTools.includes('search_knowledge_base')) {
    merged.settings = { ...merged.settings, enabledTools: [...merged.settings.enabledTools, 'search_knowledge_base'] };
  }
}
function migratePersistedState(persistedState: any, currentState: AppState): AppState {
  const merged = { ...currentState, ...persistedState };
  if (typeof merged.imageModelDownloading === 'string') {
    merged.imageModelDownloading = [merged.imageModelDownloading];
  } else if (!Array.isArray(merged.imageModelDownloading)) {
    merged.imageModelDownloading = [];
  }
  if (persistedState?.settings?.modelLoadingStrategy === 'memory') {
    merged.settings = { ...merged.settings, modelLoadingStrategy: 'performance' };
  }
  if (persistedState?.settings && !persistedState.settings.cacheType) {
    merged.settings = { ...merged.settings, cacheType: persistedState.settings.flashAttn ? 'q8_0' : 'f16', flashAttn: true };
  }
  if (persistedState?.settings && !persistedState.settings.inferenceBackend) {
    merged.settings = {
      ...merged.settings,
      inferenceBackend: Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU,
    };
  }

  if (typeof merged.imageModelDownloadId === 'number') {
    const ids: Record<string, number> = {};
    if (Array.isArray(merged.imageModelDownloading) && merged.imageModelDownloading.length > 0) {
      ids[merged.imageModelDownloading[0]] = merged.imageModelDownloadId;
    }
    merged.imageModelDownloadIds = ids;
    delete merged.imageModelDownloadId;
  } else if (!merged.imageModelDownloadIds || typeof merged.imageModelDownloadIds !== 'object') {
    merged.imageModelDownloadIds = {};
  }
  if (merged.checklistDismissed && merged.onboardingChecklist &&
    !Object.values(merged.onboardingChecklist).every(Boolean)) merged.checklistDismissed = false;
  migrateEnabledTools(merged);
  return merged as AppState;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      themeMode: 'system' as ThemeMode,
      setThemeMode: (mode) => set({ themeMode: mode }),
      hasCompletedOnboarding: false,
      setOnboardingComplete: (complete) =>
        set({ hasCompletedOnboarding: complete }),
      onboardingChecklist: { ...DEFAULT_CHECKLIST },
      checklistDismissed: false,
      completeChecklistStep: (key) =>
        set((state) => ({ onboardingChecklist: { ...state.onboardingChecklist, [key]: true } })),
      dismissChecklist: () => set({ checklistDismissed: true }),
      resetChecklist: () => set({ checklistDismissed: false, onboardingChecklist: { ...DEFAULT_CHECKLIST }, shownSpotlights: {} }),
      deviceInfo: null,
      modelRecommendation: null,
      setDeviceInfo: (info) => set({ deviceInfo: info }),
      setModelRecommendation: (rec) => set({ modelRecommendation: rec }),
      downloadedModels: [],
      setDownloadedModels: (models) => set({ downloadedModels: models }),
      addDownloadedModel: (model) =>
        set((state) => ({
          downloadedModels: [...state.downloadedModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedModel: (modelId) =>
        set((state) => ({
          downloadedModels: state.downloadedModels.filter((m) => m.id !== modelId),
          activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
        })),
      activeModelId: null,
      setActiveModelId: (modelId) => set({ activeModelId: modelId }),
      isLoadingModel: false,
      setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),
      modelMaxContext: null,
      setModelMaxContext: (ctx) => set({ modelMaxContext: ctx }),
      downloadProgress: {},
      setDownloadProgress: (modelId, progress) =>
        set((state) => {
          if (progress === null) {
            const { [modelId]: _removed, ...rest } = state.downloadProgress;
            return { downloadProgress: rest };
          }
          return {
            downloadProgress: {
              ...state.downloadProgress,
              [modelId]: progress,
            },
          };
        }),
      activeBackgroundDownloads: {},
      setBackgroundDownload: (downloadId, info) =>
        set((state) => {
          if (info === null) {
            const { [downloadId]: _removed, ...rest } = state.activeBackgroundDownloads;
            return { activeBackgroundDownloads: rest };
          }
          return {
            activeBackgroundDownloads: {
              ...state.activeBackgroundDownloads,
              [downloadId]: info,
            },
          };
        }),
      clearBackgroundDownloads: () =>
        set({ activeBackgroundDownloads: {} }),
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
      // Image models (ONNX-based)
      downloadedImageModels: [],
      activeImageModelId: null,
      setDownloadedImageModels: (models) => set({ downloadedImageModels: models }),
      addDownloadedImageModel: (model) =>
        set((state) => ({
          downloadedImageModels: [...state.downloadedImageModels.filter(m => m.id !== model.id), model],
        })),
      removeDownloadedImageModel: (modelId) =>
        set((state) => ({
          downloadedImageModels: state.downloadedImageModels.filter((m) => m.id !== modelId),
          activeImageModelId: state.activeImageModelId === modelId ? null : state.activeImageModelId,
        })),
      setActiveImageModelId: (modelId) => set({ activeImageModelId: modelId }),
      // Image model download tracking
      imageModelDownloading: [],
      imageModelDownloadIds: {},
      addImageModelDownloading: (modelId) =>
        set((state) => ({
          imageModelDownloading: [...state.imageModelDownloading.filter(id => id !== modelId), modelId],
        })),
      removeImageModelDownloading: (modelId) =>
        set((state) => {
          const { [modelId]: _removed, ...restIds } = state.imageModelDownloadIds;
          return {
            imageModelDownloading: state.imageModelDownloading.filter(id => id !== modelId),
            imageModelDownloadIds: restIds,
          };
        }),
      clearImageModelDownloading: () =>
        set({ imageModelDownloading: [], imageModelDownloadIds: {} }),
      setImageModelDownloadId: (modelId, downloadId) =>
        set((state) => {
          if (downloadId === null) {
            const { [modelId]: _removed, ...rest } = state.imageModelDownloadIds;
            return { imageModelDownloadIds: rest };
          }
          return {
            imageModelDownloadIds: { ...state.imageModelDownloadIds, [modelId]: downloadId },
          };
        }),
      // Image generation state
      isGeneratingImage: false,
      imageGenerationProgress: null,
      imageGenerationStatus: null,
      imagePreviewPath: null,
      setIsGeneratingImage: (generating) => set({ isGeneratingImage: generating }),
      setImageGenerationProgress: (progress) => set({ imageGenerationProgress: progress }),
      setImageGenerationStatus: (status) => set({ imageGenerationStatus: status }),
      setImagePreviewPath: (path) => set({ imagePreviewPath: path }),
      // Gallery
      generatedImages: [],
      addGeneratedImage: (image) =>
        set((state) => ({
          generatedImages: [image, ...state.generatedImages],
        })),
      removeGeneratedImage: (imageId) =>
        set((state) => ({
          generatedImages: state.generatedImages.filter((img) => img.id !== imageId),
        })),
      removeImagesByConversationId: (conversationId) => {
        const state = get();
        const imagesToRemove = state.generatedImages.filter(
          (img) => img.conversationId === conversationId
        );
        const imageIds = imagesToRemove.map((img) => img.id);
        set({
          generatedImages: state.generatedImages.filter(
            (img) => img.conversationId !== conversationId
          ),
        });
        return imageIds;
      },
      clearGeneratedImages: () =>
        set({ generatedImages: [] }),
      // Reactive spotlight tracking
      shownSpotlights: {},
      markSpotlightShown: (key) =>
        set((state) => ({ shownSpotlights: { ...state.shownSpotlights, [key]: true } })),
      resetShownSpotlights: () => set({ shownSpotlights: {} }),
      textGenerationCount: 0,
      imageGenerationCount: 0,
      incrementTextGenerationCount: () => { const c = get().textGenerationCount + 1; set({ textGenerationCount: c }); return c; },
      incrementImageGenerationCount: () => { const c = get().imageGenerationCount + 1; set({ imageGenerationCount: c }); return c; },
      hasEngagedSharePrompt: false,
      setHasEngagedSharePrompt: (v) => set({ hasEngagedSharePrompt: v }),
      loadedSettings: null,
      setLoadedSettings: (settings) => set({ loadedSettings: settings }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      merge: migratePersistedState,
      partialize: (state) => ({
        themeMode: state.themeMode,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        onboardingChecklist: state.onboardingChecklist,
        checklistDismissed: state.checklistDismissed,
        activeModelId: state.activeModelId,
        settings: state.settings,
        activeBackgroundDownloads: state.activeBackgroundDownloads,
        activeImageModelId: state.activeImageModelId,
        imageModelDownloading: state.imageModelDownloading,
        imageModelDownloadIds: state.imageModelDownloadIds,
        generatedImages: state.generatedImages,
        shownSpotlights: state.shownSpotlights,
        textGenerationCount: state.textGenerationCount, imageGenerationCount: state.imageGenerationCount,
        hasEngagedSharePrompt: state.hasEngagedSharePrompt,
        loadedSettings: state.loadedSettings,
      }),
    }
  )
);
