import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceInfo, DownloadedModel, ModelRecommendation, ONNXImageModel, ImageGenerationMode, AutoDetectMethod, CacheType, InferenceBackend, INFERENCE_BACKENDS, LiteRTBackend, GeneratedImage } from '../types';

function isUnknownLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'unknown';
}

function isSuspiciousRecoveredTextModel(model: DownloadedModel): boolean {
  const isRecovered = model.id.startsWith('recovered_');
  if (!isRecovered) return false;

  const hasUnknownAuthor = isUnknownLike(model.author);
  const hasUnknownQuantization = isUnknownLike(model.quantization);

  return hasUnknownAuthor || hasUnknownQuantization;
}

function isSuspiciousRecoveredImageModel(model: ONNXImageModel): boolean {
  return model.id.startsWith('recovered_');
}

// Whisper STT models are managed by whisperService (modelId 'whisper-<id>',
// file 'ggml-<id>.bin') and belong to the Voice/Speech surfaces. They were being
// recovered into the text model store, so they appeared under Text in the model
// selector and as text-icon entries in the Download Manager. Exclude them here so
// the single downloadedModels source never carries them — which also clears the
// phantom entries already persisted on devices on the next setDownloadedModels.
function isWhisperTextModel(model: DownloadedModel): boolean {
  return (
    model.id.startsWith('whisper-') ||
    (model.fileName?.startsWith('ggml-') === true && model.fileName.endsWith('.bin'))
  );
}

function isExcludedTextModel(model: DownloadedModel): boolean {
  return isSuspiciousRecoveredTextModel(model) || isWhisperTextModel(model);
}

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
  imageUseOpenCL: boolean; enhanceImagePrompts: boolean;
  enableGpu: boolean; gpuLayers: number; flashAttn: boolean;
  cacheType: CacheType; showGenerationDetails: boolean; enabledTools: string[];
  thinkingEnabled: boolean;
  inferenceBackend: InferenceBackend;
  liteRTBackend: LiteRTBackend;
  liteRTTemperature: number;
  liteRTTopP: number;
  liteRTMaxTokens: number;
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
  /** Last text model the user explicitly selected. Persists across residency
   *  eviction so routing can reload it on demand. */
  lastTextModelId: string | null;
  setLastTextModelId: (modelId: string | null) => void;
  isLoadingModel: boolean;
  setIsLoadingModel: (loading: boolean) => void;
  modelMaxContext: number | null;
  setModelMaxContext: (ctx: number | null) => void;
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
  downloadedImageModels: ONNXImageModel[];
  activeImageModelId: string | null;
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  removeDownloadedImageModel: (modelId: string) => void;
  setActiveImageModelId: (modelId: string | null) => void;
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
  // PRO pre-order state
  hasRegisteredPro: boolean;
  setHasRegisteredPro: (v: boolean) => void;
  /** DEV-only: when true, suppresses the __DEV__ Pro auto-unlock so the
   *  free → Pro activation flow can be exercised in a debug build. No effect in
   *  release (__DEV__ is false there). */
  devProDisabled: boolean;
  setDevProDisabled: (v: boolean) => void;
  proBannerDismissed: boolean;
  setProBannerDismissed: (v: boolean) => void;
  proAhaTriggeredBy: 'image' | 'text' | null;
  setProAhaTriggeredBy: (by: 'image' | 'text' | null) => void;
  toolCountHintDismissed: boolean;
  setToolCountHintDismissed: () => void;
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
  enableGpu: Platform.OS === 'ios',
  inferenceBackend: Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU,
  gpuLayers: 99,
  flashAttn: true,
  cacheType: 'q8_0' as CacheType,
  showGenerationDetails: false,
  enabledTools: ['web_search', 'read_url', 'search_knowledge_base'],
  thinkingEnabled: false,
  liteRTBackend: 'gpu',
  liteRTTemperature: 0.7,
  liteRTTopP: 0.9,
  liteRTMaxTokens: 4096,
};

function migrateEnabledTools(merged: any): void {
  if (merged.settings?.enabledTools && !merged.settings.enabledTools.includes('search_knowledge_base')) {
    merged.settings = { ...merged.settings, enabledTools: [...merged.settings.enabledTools, 'search_knowledge_base'] };
  }
}
function migratePersistedState(persistedState: any, currentState: AppState): AppState {
  const merged = {
    ...currentState,
    ...persistedState,
    settings: { ...DEFAULT_SETTINGS, ...persistedState?.settings },
  };
  // Drop legacy download tracking fields. The unified downloadStore (backed
  // by the native Room DB) is now the source of truth. Persisted entries
  // from old versions are silently ignored on rehydrate.
  delete merged.downloadProgress;
  delete merged.activeBackgroundDownloads;
  delete merged.imageModelDownloading;
  delete merged.imageModelDownloadIds;
  delete merged.imageModelDownloadId;
  // modelLoadingStrategy was removed (the residency manager owns swapping now).
  if (merged.settings?.modelLoadingStrategy !== undefined) {
    delete merged.settings.modelLoadingStrategy;
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

  if (merged.checklistDismissed && merged.onboardingChecklist &&
    !Object.values(merged.onboardingChecklist).every(Boolean)) merged.checklistDismissed = false;
  migrateEnabledTools(merged);
  return merged as AppState;
}

export const selectIsLiteRT = (state: AppState): boolean =>
  state.downloadedModels.find(m => m.id === state.activeModelId)?.engine === 'litert';

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
      setDownloadedModels: (models) => set({ downloadedModels: models.filter(m => !isExcludedTextModel(m)) }),
      addDownloadedModel: (model) =>
        set((state) => {
          if (isExcludedTextModel(model)) return state;
          return {
            downloadedModels: [...state.downloadedModels.filter(m => m.id !== model.id), model],
          };
        }),
      removeDownloadedModel: (modelId) =>
        set((state) => ({
          downloadedModels: state.downloadedModels.filter((m) => m.id !== modelId),
          activeModelId: state.activeModelId === modelId ? null : state.activeModelId,
        })),
      activeModelId: null,
      setActiveModelId: (modelId) => set({ activeModelId: modelId }),
      lastTextModelId: null,
      setLastTextModelId: (modelId) => set({ lastTextModelId: modelId }),
      isLoadingModel: false,
      setIsLoadingModel: (loading) => set({ isLoadingModel: loading }),
      modelMaxContext: null,
      setModelMaxContext: (ctx) => set({ modelMaxContext: ctx }),
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
      // Image models (ONNX-based)
      downloadedImageModels: [],
      activeImageModelId: null,
      setDownloadedImageModels: (models) => set({ downloadedImageModels: models.filter(m => !isSuspiciousRecoveredImageModel(m)) }),
      addDownloadedImageModel: (model) =>
        set((state) => {
          if (isSuspiciousRecoveredImageModel(model)) return state;
          return {
            downloadedImageModels: [...state.downloadedImageModels.filter(m => m.id !== model.id), model],
          };
        }),
      removeDownloadedImageModel: (modelId) =>
        set((state) => ({
          downloadedImageModels: state.downloadedImageModels.filter((m) => m.id !== modelId),
          activeImageModelId: state.activeImageModelId === modelId ? null : state.activeImageModelId,
        })),
      setActiveImageModelId: (modelId) => set({ activeImageModelId: modelId }),
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
      hasRegisteredPro: false,
      setHasRegisteredPro: (v) => set({ hasRegisteredPro: v }),
      devProDisabled: false,
      setDevProDisabled: (v) => set({ devProDisabled: v }),
      proBannerDismissed: false,
      setProBannerDismissed: (v) => set({ proBannerDismissed: v }),
      proAhaTriggeredBy: null,
      setProAhaTriggeredBy: (by) => set({ proAhaTriggeredBy: by }),
      toolCountHintDismissed: false,
      setToolCountHintDismissed: () => set({ toolCountHintDismissed: true }),
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
        lastTextModelId: state.lastTextModelId,
        settings: state.settings,
        activeImageModelId: state.activeImageModelId,
        generatedImages: state.generatedImages,
        shownSpotlights: state.shownSpotlights,
        textGenerationCount: state.textGenerationCount, imageGenerationCount: state.imageGenerationCount,
        hasEngagedSharePrompt: state.hasEngagedSharePrompt,
        hasRegisteredPro: state.hasRegisteredPro,
        devProDisabled: state.devProDisabled,
        proBannerDismissed: state.proBannerDismissed,
        proAhaTriggeredBy: state.proAhaTriggeredBy,
        loadedSettings: state.loadedSettings,
      }),
    }
  )
);
