import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {
  DEFAULT_SILENCE_AFTER_SPEECH_MS,
  DEFAULT_SPEAKER_DRAIN_MS,
  DEFAULT_IMAGE_GUIDANCE,
  MOBILE_LITERT_SETTINGS_DEFAULTS,
  MOBILE_TEXT_SETTINGS_DEFAULTS,
  REASONING_BUDGET_AUTO,
  isExcludedTextModel,
  isSuspiciousRecoveredImageModel,
  type RemoteLanProviderKind,
} from '@offgrid/application';
import { APP_CONFIG } from '../constants';
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
import { emitChangedModelSettings } from '../services/sync/mutation';
import { createProAccessSlice, type ProAccessSlice } from './proAccessSlice';
import { migratePersistedState } from './appStoreMigrations';
import { changedSliceStorage } from './persistence/changedSliceStorage';
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
  /** Which server kinds a network scan looks for. Absent means all. */
  remoteScanKinds?: RemoteLanProviderKind[];
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
  /** @deprecated Legacy persistence read once by the selection migration. Selection lives in modelSelectionStore. */
  activeModelId?: string | null;
  /** @deprecated Legacy persistence read once by the selection migration. */
  lastTextModelId?: string | null;
  isLoadingModel: boolean;
  setIsLoadingModel: (loading: boolean) => void;
  modelMaxContext: number | null;
  setModelMaxContext: (ctx: number | null) => void;
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => void;
  /**
   * Persist one COMMITTED settings record, whole, in a single write. The shared settings command has
   * already normalized, validated, diffed and published it, so this must not run the portable-setting
   * scan `updateSettings` runs - that would publish the same change a second time.
   */
  replaceCommittedSettings: (settings: AppSettings) => void;
  downloadedImageModels: ONNXImageModel[];
  /** @deprecated Legacy persistence read once by the selection migration. */
  activeImageModelId?: string | null;
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
  addDownloadedImageModel: (model: ONNXImageModel) => void;
  removeDownloadedImageModel: (modelId: string) => void;
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
  // ONE owner for the default persona. This was its own copy, and the retired legacy project store a
  // third - three texts for one idea, all opening with the same sentence. That matters beyond tidiness:
  // `systemPrompt` is a SYNCED model setting, so whichever copy a device happens to hold is the one
  // that travels to its peers.
  systemPrompt: APP_CONFIG.defaultSystemPrompt,
  ...MOBILE_TEXT_SETTINGS_DEFAULTS,
  nThreads: 0,
  nBatch: 512,
  speculativeDecoding: false,
  imageGenerationMode: 'auto' as ImageGenerationMode,
  autoDetectMethod: 'pattern' as AutoDetectMethod,
  imageSteps: defaultImageSteps(Platform.OS),
  imageGuidanceScale: DEFAULT_IMAGE_GUIDANCE,
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
  liteRTTemperature: MOBILE_LITERT_SETTINGS_DEFAULTS.temperature,
  liteRTTopP: MOBILE_LITERT_SETTINGS_DEFAULTS.topP,
  liteRTMaxTokens: MOBILE_LITERT_SETTINGS_DEFAULTS.maxTokens,
};

/**
 * The durable slice of the app store: settings, onboarding, counters, Pro admission and the
 * generated-image gallery.
 *
 * Everything else the store holds is ephemeral projection state - the model load flag, the image
 * generation flag/progress/status/preview - and is never reloaded.
 */
const persistedAppSlice = (state: AppState) => ({
  themeMode: state.themeMode,
  hasCompletedOnboarding: state.hasCompletedOnboarding,
  onboardingChecklist: state.onboardingChecklist,
  checklistDismissed: state.checklistDismissed,
  settings: state.settings,
  generatedImages: state.generatedImages,
  textGenerationCount: state.textGenerationCount,
  imageGenerationCount: state.imageGenerationCount,
  hasEngagedSharePrompt: state.hasEngagedSharePrompt,
  hasRegisteredPro: state.hasRegisteredPro,
  // Persisted so an eviction STICKS. Without it every relaunch starts at 'unknown', which grants
  // access, and a device the owner removed is Pro again for as long as the roster takes to answer -
  // or forever, if it never does because the app is offline.
  proDeviceAdmission: state.proDeviceAdmission,
  devProDisabled: state.devProDisabled,
  proBannerDismissed: state.proBannerDismissed,
  desktopPromoDismissed: state.desktopPromoDismissed,
  proAhaTriggeredBy: state.proAhaTriggeredBy,
  loadedSettings: state.loadedSettings,
});

type PersistedAppSlice = ReturnType<typeof persistedAppSlice>;

/**
 * Ephemeral state shares this store with the gallery, so a plain JSON storage re-serialised every
 * generated image on every transient `set`. Every durable update above replaces its field with a
 * new value, so a reference compare writes exactly when durable state moves and never for a
 * progress tick, a model load flag, or a status line.
 */
const appPersistStorage = changedSliceStorage<PersistedAppSlice>(
  () => AsyncStorage,
  (previous, next) =>
    (Object.keys(next) as (keyof PersistedAppSlice)[]).every(
      key => previous[key] === next[key],
    ),
);

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
        })),
      isLoadingModel: false,
      setIsLoadingModel: loading => set({ isLoadingModel: loading }),
      modelMaxContext: null,
      setModelMaxContext: ctx => set({ modelMaxContext: ctx }),
      settings: { ...DEFAULT_SETTINGS },
      updateSettings: newSettings => {
        const before = get().settings;
        const after = { ...before, ...newSettings };
        set({ settings: after });
        emitChangedModelSettings(before, after);
      },
      replaceCommittedSettings: settings => set({ settings }),
      // Image models (ONNX-based)
      downloadedImageModels: [],
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
        })),
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
      storage: appPersistStorage,
      merge: (persisted, current) =>
        migratePersistedState(persisted, current, {
          defaultSettings: DEFAULT_SETTINGS,
          documentsPath: RNFS.DocumentDirectoryPath,
        }),
      partialize: persistedAppSlice,
    },
  ),
);
