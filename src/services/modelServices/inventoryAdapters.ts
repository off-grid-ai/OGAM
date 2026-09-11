import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  catalogKindForArtifact,
  projectGgufCapabilities,
  runtimeModalityForModelKind,
  type ModelInventoryAdapter,
  type RuntimeModel,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { selectedLocalModelId } from './modelSelectionProjection';
import type { DownloadedModel } from '../../types';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { whisperService } from '../whisperService';
import { listDownloadedModels } from '../whisperModelFiles';
import { WHISPER_MODELS, projectLiteRTCapabilities } from '@offgrid/models';
import { getActiveModels } from './modelState';
import {
  EMBEDDING_MODEL_FILENAME,
  EMBEDDING_RESIDENT_MB,
  embeddingService,
} from '../adapters/native/embeddingRuntimeAdapter';
import {
  mobileExecutionAdapterId,
  mobileRouteId,
  type MobileRouteFacts,
} from './mobileRoute';
import { mobileLocalVoiceInventoryAdapter } from './voiceGenerationAdapter';
import { readMobileModelSelection } from './modelSelectionProjection';

function runtime(
  identity: MobileRouteFacts,
  values: Omit<
    RuntimeModel,
    'id' | 'source' | 'modality' | 'adapterId' | 'providerId'
  >,
): RuntimeModel {
  return {
    ...values,
    id: identity.modelId,
    source: identity.source,
    modality: identity.modality,
    adapterId: mobileExecutionAdapterId(
      identity.source,
      identity.hostId,
      identity.modality,
    ),
    providerId: identity.source === 'local' ? identity.hostId : undefined,
    serverId: identity.source === 'remote' ? identity.hostId : undefined,
  };
}

function localTextRuntime(model: DownloadedModel): RuntimeModel {
  const catalogKind = catalogKindForArtifact(model);
  const identity: MobileRouteFacts = {
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId: model.id,
  };
  const state = useAppStore.getState();
  const selected = readMobileModelSelection('text') === mobileRouteId(identity);
  const loaded =
    selected &&
    useModelResidencyStore.getState().loadedTextModelId === model.id &&
    (model.engine === 'litert'
      ? liteRTService.isModelLoaded()
      : llmService.isModelLoaded());
  const projected =
    model.engine === 'llama'
      ? projectGgufCapabilities({
          artifact: {
            id: model.id,
            name: model.name,
            fileName: model.fileName,
            projectorPresent: !!model.mmProjPath,
          },
          runtime: loaded
            ? {
                loaded: true,
                tools: llmService.supportsToolCalling(),
                thinking: llmService.supportsThinking(),
                vision: llmService.supportsVision(),
              }
            : undefined,
        })
      : projectLiteRTCapabilities({ vision: model.liteRTVision });
  const supportsVision = projected.vision;
  return runtime(identity, {
    ...(model.registryFamilyId
      ? { sourceModelId: model.registryFamilyId }
      : {}),
    name: model.name,
    // Capability is the SSOT for route kind. A LiteRT vision bundle must be
    // selectable for a vision operation just like a GGUF with a projector.
    kind: catalogKind ?? (supportsVision ? 'vision' : 'text'),
    capabilities: {
      textGeneration: true,
      streaming: true,
      vision: supportsVision,
      audioInput: model.engine === 'litert' && !!model.liteRTAudio,
      // Mobile provides the portable tool loop for every local text route. The
      // catalog flag describes native template evidence, not route capability.
      tools: true,
      thinking: model.engine === 'litert' ? true : projected.thinking,
    },
    reasoning:
      model.engine === 'llama' && loaded
        ? llmService.getReasoningMetadata()
        : undefined,
    // The window the route runs with. LiteRT and remote routes leave it unknown (gap as data),
    // so Shared keeps its flat tool-result bound there.
    contextLength:
      model.engine === 'llama'
        ? llmService.getPerformanceSettings()?.contextLength || undefined
        : undefined,
    residentSizeMB: Math.ceil(
      (model.fileSize +
        (model.engine === 'llama' ? model.mmProjFileSize ?? 0 : 0)) /
        (1024 * 1024),
    ),
    residencyKey: 'mobile:text-engine',
    installed: true,
    ready: true,
    loaded,
    loading: selected && state.isLoadingModel,
  });
}

const localLlamaInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-llama-inventory',
  async listModels() {
    return useAppStore
      .getState()
      .downloadedModels.filter(
        model =>
          model.engine === 'llama' &&
          runtimeModalityForModelKind(
            catalogKindForArtifact(model) ?? 'text',
          ) === 'text',
      )
      .map(localTextRuntime);
  },
};

const localLiteRTInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-litert-inventory',
  async listModels() {
    return useAppStore
      .getState()
      .downloadedModels.filter(
        model =>
          model.engine === 'litert' &&
          runtimeModalityForModelKind(
            catalogKindForArtifact(model) ?? 'text',
          ) === 'text',
      )
      .map(localTextRuntime);
  },
};

const localImageInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-image-inventory',
  async listModels() {
    const state = useAppStore.getState();
    return state.downloadedImageModels.map(model => {
      const identity: MobileRouteFacts = {
        source: 'local',
        hostId: model.backend ?? 'image-runtime',
        modality: 'image',
        modelId: model.id,
      };
      const selected = activeLocalModelId('image') === model.id;
      const imageState = getActiveModels().image;
      return runtime(identity, {
        name: model.name,
        kind: 'image',
        capabilities: { imageGeneration: true },
        residentSizeMB: Math.ceil(model.size / (1024 * 1024)),
        residencyKey: 'mobile:image-engine',
        installed: true,
        ready: true,
        loaded: selected && imageState.isLoaded,
        loading: selected && imageState.isLoading,
      });
    });
  },
};

const localWhisperInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-whisper-inventory',
  async listModels() {
    const downloaded = await listDownloadedModels();
    const selectedModelId = activeLocalModelId('transcription');
    return downloaded.map(({ modelId }) => {
      const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
      const identity: MobileRouteFacts = {
        source: 'local',
        hostId: 'whisper.rn',
        modality: 'transcription',
        modelId,
      };
      const selected = selectedModelId === modelId;
      return runtime(identity, {
        name: model?.name ?? modelId,
        kind: 'transcription',
        capabilities: { audioInput: true, transcription: true },
        residentSizeMB: model?.size,
        installed: true,
        ready: true,
        loaded:
          selected &&
          whisperService.isModelLoaded() &&
          whisperService.getLoadedModelPath() ===
            whisperService.getModelPath(modelId),
      });
    });
  },
};

function embeddingRuntime(modality: 'embedding'): RuntimeModel {
  return runtime(
    {
      source: 'local',
      hostId: 'llama.rn-sidecar',
      modality,
      modelId: EMBEDDING_MODEL_FILENAME,
    },
    {
      name: 'MiniLM tool and memory index',
      kind: modality,
      capabilities:
        modality === 'embedding'
          ? { embeddings: true }
          : { toolSelection: true, embeddings: true },
      residentSizeMB: EMBEDDING_RESIDENT_MB,
      installed: true,
      ready: true,
      loaded: embeddingService.isLoaded(),
    },
  );
}

const embeddingInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-embedding-inventory',
  async listModels() {
    return [embeddingRuntime('embedding')];
  },
};

const classifierInventoryAdapter: ModelInventoryAdapter = {
  id: 'mobile-local-classifier-inventory',
  async listModels() {
    const state = useAppStore.getState();
    // The canonical selection projection already resolves the explicit classifier pick and, when
    // there is none, the active/remembered text fallback. Reading it keeps ONE fallback rule.
    const modelId = selectedLocalModelId('classifier');
    const model = modelId
      ? state.downloadedModels.find(candidate => candidate.id === modelId)
      : null;
    if (!model || catalogKindForArtifact(model) === 'computer_use') return [];
    return [
      runtime(
        {
          source: 'local',
          hostId: model.engine,
          modality: 'classifier',
          modelId: model.id,
        },
        {
          name: model.name,
          kind: 'classifier',
          capabilities: { classification: true, textGeneration: true },
          residentSizeMB: Math.ceil(model.fileSize / (1024 * 1024)),
          residencyKey: 'mobile:text-engine',
          residencyLifecycle: 'operation',
          installed: true,
          ready: true,
          loaded:
            useModelResidencyStore.getState().loadedTextModelId === model.id,
          loading:
            state.isLoadingModel && activeLocalModelId('text') === model.id,
        },
      ),
    ];
  },
};

export const mobileInventoryAdapters: ModelInventoryAdapter[] = [
  localLlamaInventoryAdapter,
  localLiteRTInventoryAdapter,
  localImageInventoryAdapter,
  localWhisperInventoryAdapter,
  mobileLocalVoiceInventoryAdapter,
  embeddingInventoryAdapter,
  classifierInventoryAdapter,
];
