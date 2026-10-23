/**
 * The spec's model facts (`model`, `quant`, `engine`, `backend`) for the models this app runs.
 * Remote models are always `custom`: their names come from the person's own server.
 */
import { Platform } from 'react-native';
import { useAppStore, type AppSettings } from '../../stores/appStore';
import type { DownloadedModel, ONNXImageModel } from '../../types';
import type { ModelFacts } from './analytics';
import { computeBackend, modelRef } from './values';

export const REMOTE_MODEL_FACTS: ModelFacts = { model: 'custom', engine: 'remote', backend: 'remote' };

export function downloadedModelFacts(model: DownloadedModel, settings: AppSettings): ModelFacts {
  const litert = model.engine === 'litert';
  return {
    model: modelRef(model.id, model.origin?.repoId),
    quant: model.quantization || undefined,
    engine: litert ? 'litert' : 'llama.cpp',
    backend: computeBackend(litert ? settings.liteRTBackend : settings.inferenceBackend),
  };
}

/** The selected text model, or the remote route when one is in use. */
export function textModelFacts(remote: boolean): ModelFacts {
  if (remote) return REMOTE_MODEL_FACTS;
  const { downloadedModels, activeModelId, settings } = useAppStore.getState();
  const model = downloadedModels.find(m => m.id === activeModelId);
  return model
    ? downloadedModelFacts(model, settings)
    : { model: 'custom', engine: 'llama.cpp', backend: computeBackend(settings.inferenceBackend) };
}

export function imageModelFacts(model: ONNXImageModel | undefined): ModelFacts {
  const backend = model?.backend;
  return {
    model: modelRef(model?.id),
    engine: backend === 'coreml' || (!backend && Platform.OS === 'ios') ? 'coreml' : 'onnx',
    backend: computeBackend(backend),
  };
}
