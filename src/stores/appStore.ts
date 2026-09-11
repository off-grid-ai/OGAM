import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import type { RecordProvenance } from '@offgrid/sync';
import {
  DEFAULT_SILENCE_AFTER_SPEECH_MS,
  DEFAULT_SPEAKER_DRAIN_MS,
} from '@offgrid/speech';
import { DEFAULT_MAX_TOOL_CALLS, REASONING_BUDGET_AUTO } from '@offgrid/models';
import { APP_CONFIG } from '../constants';
import { createHydrationGatedStorage } from '../utils/hydrationGatedStorage';
import {
  VoiceTurnMode,
  DeviceInfo,
  DownloadedModel,
  ModelRecommendation,
  ONNXImageModel,
  ImageGenerationMode,
  AutoDetectMethod,
  CacheType,
  InferenceBackend,
  INFERENCE_BACKENDS,
  LiteRTBackend,
  GeneratedImage,
} from '../types';
import {
  emitChangedModelSettings,
  mobileModelSettingPatch,
} from '../services/sync/mutation';
import { createProAccessSlice, type ProAccessSlice } from './proAccessSlice';
import {
  isExcludedTextModel,
  isSuspiciousRecoveredImageModel,
} from '../utils/modelSelectorFilters';
import { migratePersistedState } from './appStoreMigrations';
import { defaultImageSteps, SWEET_SPOT_SIZE } from '../utils/imageGenAdvice';

type OnboardingChecklist = {
  downloadedModel: boolean;
  loadedModel: boolean;
  sentMessage: boolean;
  triedImageGen: boolean;
  exploredSettings: boolean;
  createdProject: boolean;
};

export type AppSettings = {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  /** Emergency ceiling for tool calls made by one response. Shared by every text engine and UI. */
  maxToolCalls: number;
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
  /** MTP speculative decoding: the model drafts several tokens per step and verifies them in one
   *  pass. Only models carrying MTP draft layers benefit; the engine ignores it on the rest. */
  speculativeDecoding: boolean;
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
  /**
   * How a voice turn begins and ends.
   *
   *  - 'tap'       you start it and you stop it
   *  - 'silence'   you start it, it ends when you stop speaking
   *  - 'handsfree' you start listening, it begins when you speak and ends when you stop
   */
  voiceTurnMode: VoiceTurnMode;
  /** The pause that ends a spoken turn, in ms. The person's trade between lag and being cut off
   *  mid-thought; defaults and choices live in @offgrid/speech. */
  voiceSilenceAfterSpeechMs: number;
  /** The wait after a reply finishes before the mic may reopen, in ms. Covers the speaker's
   *  physical tail - too short and the recorder hears the assistant's own voice. */
  voiceSpeakerDrainMs: number;
  enabledTools: string[];
  thinkingEnabled: boolean;
  /** Cap on the tokens the model may spend thinking per reply. REASONING_BUDGET_AUTO (0) sends no
   *  cap so the model reasons for as long as it wants. Applies only while Thinking is on; the
   *  answer still streams after the cap closes the thinking block. Optional so installs persisted
   *  before this setting read as auto. */
  reasoningBudget?: number;
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
  /** Auto-discover remote LLMs: the background LAN scan that finds + auto-adds Ollama / LM Studio /
   *  gateway servers. Fresh installs are OFF (never scan the network unprompted); a one-time
   *  migration turns it ON for users who already had a gateway. `undefined` = never set (reads OFF).
   *  Optional so the migration can distinguish "never set" from an explicit choice. */
  autoDiscoverRemoteModels?: boolean;
};

type ThemeMode = 'system' | 'light' | 'dark';

export interface AppState extends ProAccessSlice {
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
  modelSettingProvenance: Record<string, RecordProvenance>;
  updateSettings: (settings: Partial<AppSettings>) => void;
  applySyncedModelSetting: (
    wireKey: string,
    fields: Record<string, unknown>,
    provenance?: RecordProvenance,
  ) => void;
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
  toolCountHintDismissed: boolean;
  setToolCountHintDismissed: () => void;
  loadedSettings: Partial<AppSettings> | null;
  setLoadedSettings: (settings: Partial<AppSettings> | null) => void;
}

const DEFAULT_CHECKLIST: OnboardingChecklist = {
  downloadedModel: false,
  loadedModel: false,
  sentMessage: false,
  triedImageGen: false,
  exploredSettings: false,
  createdProject: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  // ONE owner for the default persona. This was its own copy, and `projectStore` a third - three texts for
  // one idea, all opening with the same sentence. That matters beyond tidiness: `systemPrompt` is a SYNCED
  // model setting, so whichever copy a device happens to hold is the one that travels to its peers.
  systemPrompt: APP_CONFIG.defaultSystemPrompt,
  temperature: 0.7,
  maxTokens: 1024,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
  speculativeDecoding: false,
  imageGenerationMode: 'auto' as ImageGenerationMode,
  autoDetectMethod: 'pattern' as AutoDetectMethod,
  classifierModelId: null,
  imageSteps: defaultImageSteps(Platform.OS),
  imageGuidanceScale: 7.5,
  imageThreads: 4,
  imageWidth: SWEET_SPOT_SIZE,
  imageHeight: SWEET_SPOT_SIZE,
  imageUseOpenCL: true,
  enhanceImagePrompts: false,
  enableGpu: Platform.OS === 'ios',
  inferenceBackend:
    Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU,
  gpuLayers: 99,
  flashAttn: true,
  aggressiveModelLoading: false,
  modelLoadingMode: 'balanced',
  cacheType: 'q8_0' as CacheType,
  showGenerationDetails: false,
  // Ends on silence by default: a turn that waits for a tap is the thing people ask us to fix.
  // 'tap' is for anyone who pauses mid-thought and wants the recorder to keep waiting.
  voiceTurnMode: 'silence' as VoiceTurnMode,
  voiceSilenceAfterSpeechMs: DEFAULT_SILENCE_AFTER_SPEECH_MS,
  voiceSpeakerDrainMs: DEFAULT_SPEAKER_DRAIN_MS,
  enabledTools: ['web_search', 'read_url', 'search_knowledge_base'],
  thinkingEnabled: false,
  reasoningBudget: REASONING_BUDGET_AUTO,
  liteRTBackend: 'gpu',
  liteRTTemperature: 0.7,
  liteRTTopP: 0.9,
  liteRTMaxTokens: 4096,
};

export const selectIsLiteRT = (state: AppState): boolean =>
  state.downloadedModels.find(m => m.id === state.activeModelId)?.engine ===
  'litert';

const appStorage = createHydrationGatedStorage<ReturnType<typeof persistedAppState>>();

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
      modelSettingProvenance: {},
      updateSettings: newSettings => {
        const before = get().settings;
        const after = { ...before, ...newSettings };
        set({ settings: after });
        emitChangedModelSettings(before, after);
      },
      applySyncedModelSetting: (wireKey, fields, provenance) => {
        const patch = mobileModelSettingPatch(wireKey, fields);
        if (patch) {
          set(state => ({
            settings: { ...state.settings, ...(patch as Partial<AppSettings>) },
            modelSettingProvenance: provenance
              ? {
                  ...state.modelSettingProvenance,
                  [wireKey]:
                    state.modelSettingProvenance[wireKey] ?? provenance,
                }
              : state.modelSettingProvenance,
          }));
        }
      },
      resetSettings: () => {
        const before = get().settings;
        const after = { ...DEFAULT_SETTINGS };
        set({ settings: after });
        emitChangedModelSettings(before, after);
      },
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
      ...createProAccessSlice(state => set(state)),
      toolCountHintDismissed: false,
      setToolCountHintDismissed: () => set({ toolCountHintDismissed: true }),
      loadedSettings: null,
      setLoadedSettings: settings => set({ loadedSettings: settings }),
    }),
    {
      name: 'local-llm-app-storage',
      storage: appStorage.storage,
      onRehydrateStorage: () => () => appStorage.markHydrated(),
      merge: (persisted, current) =>
        migratePersistedState(persisted, current, {
          defaultSettings: DEFAULT_SETTINGS,
          documentsPath: RNFS.DocumentDirectoryPath,
        }),
      partialize: persistedAppState,
    },
  ),
);

function persistedAppState(state: AppState) {
  return {
        themeMode: state.themeMode,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        onboardingChecklist: state.onboardingChecklist,
        checklistDismissed: state.checklistDismissed,
        activeModelId: state.activeModelId,
        lastTextModelId: state.lastTextModelId,
        settings: state.settings,
        modelSettingProvenance: state.modelSettingProvenance,
        activeImageModelId: state.activeImageModelId,
        generatedImages: state.generatedImages,
        warmedImageModels: state.warmedImageModels,
        textGenerationCount: state.textGenerationCount,
        imageGenerationCount: state.imageGenerationCount,
        hasEngagedSharePrompt: state.hasEngagedSharePrompt,
        hasRegisteredPro: state.hasRegisteredPro,
        // Persist eviction so a relaunch cannot grant Pro while the roster is offline.
        proDeviceAdmission: state.proDeviceAdmission,
        devProDisabled: state.devProDisabled,
        proBannerDismissed: state.proBannerDismissed,
        desktopPromoDismissed: state.desktopPromoDismissed,
        proAhaTriggeredBy: state.proAhaTriggeredBy,
        loadedSettings: state.loadedSettings,
  };
}
