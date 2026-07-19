import { Platform } from 'react-native';
import {
  LITERT_TEXT_GENERATION_DEFAULTS,
  LLAMA_TEXT_GENERATION_DEFAULTS,
} from '../config/textGenerationDefaults';
import {
  AutoDetectMethod,
  CacheType,
  ImageGenerationMode,
  INFERENCE_BACKENDS,
} from '../types';
export const DEFAULT_CHECKLIST = {
  downloadedModel: false,
  loadedModel: false,
  sentMessage: false,
  triedImageGen: false,
  exploredSettings: false,
  createdProject: false,
};

export const DEFAULT_SETTINGS = {
  systemPrompt:
    "You are a helpful AI assistant running locally on the user's device. Be concise and helpful.",
  ...LLAMA_TEXT_GENERATION_DEFAULTS,
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
  inferenceBackend:
    Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU,
  gpuLayers: 99,
  flashAttn: true,
  aggressiveModelLoading: false,
  modelLoadingMode: 'balanced' as const,
  cacheType: 'q8_0' as CacheType,
  showGenerationDetails: false,
  enabledTools: ['web_search', 'read_url', 'search_knowledge_base'],
  thinkingEnabled: false,
  experimentalMtp: false,
  liteRTBackend: 'gpu' as const,
  ...LITERT_TEXT_GENERATION_DEFAULTS,
};

function migrateEnabledTools(merged: any): void {
  if (
    merged.settings?.enabledTools &&
    !merged.settings.enabledTools.includes('search_knowledge_base')
  ) {
    merged.settings = {
      ...merged.settings,
      enabledTools: [...merged.settings.enabledTools, 'search_knowledge_base'],
    };
  }
}

export function migratePersistedState<T extends { settings: object }>(
  persistedState: any,
  currentState: T,
): T {
  const merged: any = {
    ...currentState,
    ...persistedState,
    settings: { ...DEFAULT_SETTINGS, ...persistedState?.settings },
  };
  delete merged.downloadProgress;
  delete merged.activeBackgroundDownloads;
  delete merged.imageModelDownloading;
  delete merged.imageModelDownloadIds;
  delete merged.imageModelDownloadId;
  delete merged.settings?.modelLoadingStrategy;

  if (persistedState?.settings && !persistedState.settings.cacheType) {
    merged.settings = {
      ...merged.settings,
      cacheType: persistedState.settings.flashAttn ? 'q8_0' : 'f16',
      flashAttn: true,
    };
  }
  if (persistedState?.settings && !persistedState.settings.inferenceBackend) {
    merged.settings = {
      ...merged.settings,
      inferenceBackend:
        Platform.OS === 'ios'
          ? INFERENCE_BACKENDS.METAL
          : INFERENCE_BACKENDS.CPU,
    };
  }
  if (
    merged.checklistDismissed &&
    merged.onboardingChecklist &&
    !Object.values(merged.onboardingChecklist).every(Boolean)
  ) {
    merged.checklistDismissed = false;
  }
  migrateEnabledTools(merged);
  return merged as T;
}
