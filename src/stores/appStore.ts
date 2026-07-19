import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DeviceInfo,
  DownloadedModel,
  ModelRecommendation,
  ONNXImageModel,
  ImageGenerationMode,
  AutoDetectMethod,
  CacheType,
  InferenceBackend,
  LiteRTBackend,
  GeneratedImage,
} from '../types';
import {
  DEFAULT_CHECKLIST,
  DEFAULT_SETTINGS,
  migratePersistedState,
} from './appStorePersistence';

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
    (model.fileName?.startsWith('ggml-') === true &&
      model.fileName.endsWith('.bin'))
  );
}

function isExcludedTextModel(model: DownloadedModel): boolean {
  return isSuspiciousRecoveredTextModel(model) || isWhisperTextModel(model);
}

type OnboardingChecklist = {
  downloadedModel: boolean;
  loadedModel: boolean;
  sentMessage: boolean;
  triedImageGen: boolean;
  exploredSettings: boolean;
  createdProject: boolean;
};

type AppSettings = {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  repeatPenalty: number;
  contextLength: number;
  nThreads: number;
  nBatch: number;
  imageGenerationMode: ImageGenerationMode;
  autoDetectMethod: AutoDetectMethod;
  classifierModelId: string | null;
  imageSteps: number;
  imageGuidanceScale: number;
  imageThreads: number;
  imageWidth: number;
  imageHeight: number;
  imageUseOpenCL: boolean;
  enhanceImagePrompts: boolean;
  enableGpu: boolean;
  gpuLayers: number;
  flashAttn: boolean;
  /** Aggressive model loading: commit more RAM + a smaller reserve so large models
   *  load (with a "Load Anyway" override when the budget still blocks). Off by
   *  default (behaviour-neutral). Single source of truth read by both the Settings
   *  screen and the in-chat settings; projected onto the residency manager. */
  aggressiveModelLoading: boolean;
  /** How the residency manager handles multiple models (single source of truth read
   *  by both settings surfaces, projected onto the manager via loadPolicySync):
   *  'conservative' = one model at a time; 'balanced' = co-reside within budget;
   *  'aggressive' = co-reside with a larger RAM commitment. */
  modelLoadingMode?: 'conservative' | 'balanced' | 'aggressive';
  cacheType: CacheType;
  showGenerationDetails: boolean;
  enabledTools: string[];
  thinkingEnabled: boolean;
  /** Experimental embedded Multi-Token Prediction. Off by default. */
  experimentalMtp?: boolean;
  inferenceBackend: InferenceBackend;
  /** True once the user has explicitly picked an inference backend in Settings.
   *  While false, the boot-time backendSync may upgrade the default to the GPU
   *  path when the device supports it; once true, that auto-selection never
   *  overrides the user's choice. Defaults to false (the current default was
   *  auto-selected). */
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
  /** The text model that is ACTUALLY loaded in native memory right now (engine-agnostic — llama OR litert),
   *  as opposed to activeModelId (the SELECTED model, which may be selected-but-not-yet-loaded or evicted).
   *  A reactive projection of ActiveModelService's authoritative loaded state — the SINGLE source every
   *  surface reads for "currently loaded", so the model sheet and the overview can't disagree (device
   *  2026-07-14: sheet read llmService.getLoadedModelPath() — llama-only + stale — while the overview read
   *  activeModelId). Not persisted (a relaunch has nothing loaded). */
  loadedTextModelId: string | null;
  setLoadedTextModelId: (modelId: string | null) => void;
  /** The active text model was EVICTED to free RAM (e.g. an image/TTS load in voice mode)
   *  while still selected. Drives the chat "tap to continue" reload affordance so a big
   *  model that got unloaded can be brought back on demand. Set by the service, cleared
   *  when a text model loads. Not persisted (a relaunch has nothing loaded to evict). */
  textModelEvicted: boolean;
  setTextModelEvicted: (evicted: boolean) => void;
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
  setImageGenerationProgress: (
    progress: { step: number; totalSteps: number } | null,
  ) => void;
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
  /** Image models that have completed at least one generation. The FIRST run for a
   *  model compiles/warms the backend (OpenCL kernels on Android, the CoreML model
   *  on iOS) and takes ~120s — this drives the one-time warm-up notice on BOTH
   *  platforms, persisted so it only shows once per model. */
  warmedImageModels: string[];
  markImageModelWarmed: (modelId: string) => void;
  textGenerationCount: number;
  imageGenerationCount: number;
  incrementTextGenerationCount: () => number;
  incrementImageGenerationCount: () => number;
  hasEngagedSharePrompt: boolean;
  setHasEngagedSharePrompt: (v: boolean) => void;
  // PRO pre-order state
  hasRegisteredPro: boolean;
  setHasRegisteredPro: (v: boolean) => void;
  /**
   * Authoritative "Pro is unlocked right now" — the same signal loadProFeatures uses
   * to activate paid features (keychain entitlement OR a __DEV__ unlock), set at boot.
   * This is the ONE flag every upsell gate must read: hasRegisteredPro alone misses a
   * keychain/dev-unlocked Pro user, so the upsell wrongly fired for them. Not persisted
   * — recomputed authoritatively each launch.
   */
  isProActive: boolean;
  setProActive: (v: boolean) => void;
  /** DEV-only: when true, suppresses the __DEV__ Pro auto-unlock so the
   *  free → Pro activation flow can be exercised in a debug build. No effect in
   *  release (__DEV__ is false there). */
  devProDisabled: boolean;
  setDevProDisabled: (v: boolean) => void;
  proBannerDismissed: boolean;
  setProBannerDismissed: (v: boolean) => void;
  desktopPromoDismissed: boolean;
  setDesktopPromoDismissed: (v: boolean) => void;
  proAhaTriggeredBy: 'image' | 'text' | null;
  setProAhaTriggeredBy: (by: 'image' | 'text' | null) => void;
  toolCountHintDismissed: boolean;
  setToolCountHintDismissed: () => void;
  loadedSettings: Partial<AppSettings> | null;
  setLoadedSettings: (settings: Partial<AppSettings> | null) => void;
}

export const selectIsLiteRT = (state: AppState): boolean =>
  state.downloadedModels.find(m => m.id === state.activeModelId)?.engine ===
  'litert';

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      themeMode: 'system' as ThemeMode,
      setThemeMode: mode => set({ themeMode: mode }),
      hasCompletedOnboarding: false,
      setOnboardingComplete: complete =>
        set({ hasCompletedOnboarding: complete }),
      onboardingChecklist: { ...DEFAULT_CHECKLIST },
      checklistDismissed: false,
      completeChecklistStep: key =>
        set(state => ({
          onboardingChecklist: { ...state.onboardingChecklist, [key]: true },
        })),
      dismissChecklist: () => set({ checklistDismissed: true }),
      resetChecklist: () =>
        set({
          checklistDismissed: false,
          onboardingChecklist: { ...DEFAULT_CHECKLIST },
          shownSpotlights: {},
        }),
      deviceInfo: null,
      modelRecommendation: null,
      setDeviceInfo: info => set({ deviceInfo: info }),
      setModelRecommendation: rec => set({ modelRecommendation: rec }),
      downloadedModels: [],
      setDownloadedModels: models =>
        set({ downloadedModels: models.filter(m => !isExcludedTextModel(m)) }),
      addDownloadedModel: model =>
        set(state => {
          if (isExcludedTextModel(model)) return state;
          return {
            downloadedModels: [
              ...state.downloadedModels.filter(m => m.id !== model.id),
              model,
            ],
          };
        }),
      removeDownloadedModel: modelId =>
        set(state => ({
          downloadedModels: state.downloadedModels.filter(
            m => m.id !== modelId,
          ),
          activeModelId:
            state.activeModelId === modelId ? null : state.activeModelId,
        })),
      activeModelId: null,
      setActiveModelId: modelId => set({ activeModelId: modelId }),
      loadedTextModelId: null,
      setLoadedTextModelId: modelId => set({ loadedTextModelId: modelId }),
      textModelEvicted: false,
      setTextModelEvicted: evicted => set({ textModelEvicted: evicted }),
      lastTextModelId: null,
      setLastTextModelId: modelId => set({ lastTextModelId: modelId }),
      isLoadingModel: false,
      setIsLoadingModel: loading => set({ isLoadingModel: loading }),
      modelMaxContext: null,
      setModelMaxContext: ctx => set({ modelMaxContext: ctx }),
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: newSettings =>
        set(state => ({
          settings: { ...state.settings, ...newSettings },
        })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
      // Image models (ONNX-based)
      downloadedImageModels: [],
      activeImageModelId: null,
      setDownloadedImageModels: models =>
        set({
          downloadedImageModels: models.filter(
            m => !isSuspiciousRecoveredImageModel(m),
          ),
        }),
      addDownloadedImageModel: model =>
        set(state => {
          if (isSuspiciousRecoveredImageModel(model)) return state;
          return {
            downloadedImageModels: [
              ...state.downloadedImageModels.filter(m => m.id !== model.id),
              model,
            ],
          };
        }),
      removeDownloadedImageModel: modelId =>
        set(state => ({
          downloadedImageModels: state.downloadedImageModels.filter(
            m => m.id !== modelId,
          ),
          activeImageModelId:
            state.activeImageModelId === modelId
              ? null
              : state.activeImageModelId,
        })),
      setActiveImageModelId: modelId => set({ activeImageModelId: modelId }),
      // Image generation state
      isGeneratingImage: false,
      imageGenerationProgress: null,
      imageGenerationStatus: null,
      imagePreviewPath: null,
      setIsGeneratingImage: generating =>
        set({ isGeneratingImage: generating }),
      setImageGenerationProgress: progress =>
        set({ imageGenerationProgress: progress }),
      setImageGenerationStatus: status =>
        set({ imageGenerationStatus: status }),
      setImagePreviewPath: path => set({ imagePreviewPath: path }),
      // Gallery
      generatedImages: [],
      addGeneratedImage: image =>
        set(state => ({
          generatedImages: [image, ...state.generatedImages],
        })),
      removeGeneratedImage: imageId =>
        set(state => ({
          generatedImages: state.generatedImages.filter(
            img => img.id !== imageId,
          ),
        })),
      removeImagesByConversationId: conversationId => {
        const state = get();
        const imagesToRemove = state.generatedImages.filter(
          img => img.conversationId === conversationId,
        );
        const imageIds = imagesToRemove.map(img => img.id);
        set({
          generatedImages: state.generatedImages.filter(
            img => img.conversationId !== conversationId,
          ),
        });
        return imageIds;
      },
      clearGeneratedImages: () => set({ generatedImages: [] }),
      // Reactive spotlight tracking
      shownSpotlights: {},
      markSpotlightShown: key =>
        set(state => ({
          shownSpotlights: { ...state.shownSpotlights, [key]: true },
        })),
      resetShownSpotlights: () => set({ shownSpotlights: {} }),
      warmedImageModels: [],
      markImageModelWarmed: modelId =>
        set(state =>
          state.warmedImageModels.includes(modelId)
            ? state
            : { warmedImageModels: [...state.warmedImageModels, modelId] },
        ),
      textGenerationCount: 0,
      imageGenerationCount: 0,
      incrementTextGenerationCount: () => {
        const c = get().textGenerationCount + 1;
        set({ textGenerationCount: c });
        return c;
      },
      incrementImageGenerationCount: () => {
        const c = get().imageGenerationCount + 1;
        set({ imageGenerationCount: c });
        return c;
      },
      hasEngagedSharePrompt: false,
      setHasEngagedSharePrompt: v => set({ hasEngagedSharePrompt: v }),
      hasRegisteredPro: false,
      setHasRegisteredPro: v => set({ hasRegisteredPro: v }),
      isProActive: false,
      setProActive: v => set({ isProActive: v }),
      devProDisabled: false,
      setDevProDisabled: v => set({ devProDisabled: v }),
      proBannerDismissed: false,
      setProBannerDismissed: v => set({ proBannerDismissed: v }),
      desktopPromoDismissed: false,
      setDesktopPromoDismissed: v => set({ desktopPromoDismissed: v }),
      proAhaTriggeredBy: null,
      setProAhaTriggeredBy: by => set({ proAhaTriggeredBy: by }),
      toolCountHintDismissed: false,
      setToolCountHintDismissed: () => set({ toolCountHintDismissed: true }),
      loadedSettings: null,
      setLoadedSettings: settings => set({ loadedSettings: settings }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Versioned persistence must never discard an older user's state. Field-level
      // upgrades remain centralized in migratePersistedState below via `merge`.
      migrate: persistedState => persistedState as AppState,
      merge: migratePersistedState,
      partialize: state => ({
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
        warmedImageModels: state.warmedImageModels,
        textGenerationCount: state.textGenerationCount,
        imageGenerationCount: state.imageGenerationCount,
        hasEngagedSharePrompt: state.hasEngagedSharePrompt,
        hasRegisteredPro: state.hasRegisteredPro,
        devProDisabled: state.devProDisabled,
        proBannerDismissed: state.proBannerDismissed,
        desktopPromoDismissed: state.desktopPromoDismissed,
        proAhaTriggeredBy: state.proAhaTriggeredBy,
        loadedSettings: state.loadedSettings,
      }),
    },
  ),
);
