import {
  WHISPER_MODELS,
  createWhisperPublicDownloadRequest,
  type ModelsFailure,
  type ModelsSnapshot,
  type OperationHandle,
  type Outcome,
} from '@offgrid/application';
import { applicationFacade } from './applicationFacade';

/** Start one catalog download through the closed Models application boundary. */
export function downloadTranscriptionModel(
  modelId: string,
): Promise<Outcome<OperationHandle, ModelsFailure>> {
  const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
  if (!model) {
    return Promise.resolve({
      ok: false,
      failure: { kind: 'unknown_model', identifier: modelId },
    });
  }
  return applicationFacade().models.download(
    createWhisperPublicDownloadRequest(model),
  );
}

/** Select a downloaded transcription model without eager native loading. */
export function selectTranscriptionModel(modelId: string) {
  return applicationFacade().models.select({
    modality: 'transcription',
    modelId,
  });
}

/** @runtime Loaded after the rendered test fixture installs the native boundary. */
export function loadTranscriptionModel(modelId?: string) {
  return applicationFacade().models.load({
    modality: 'transcription',
    ...(modelId ? { modelId } : {}),
  });
}

/** Delete a transcription model through the application library boundary. */
export function removeTranscriptionModel(modelId: string) {
  return applicationFacade().models.remove(modelId);
}

/** Reconcile disk-backed inventory and preserve a typed partial-failure result. */
export function refreshTranscriptionModels(): Promise<Outcome<ModelsSnapshot, ModelsFailure>> {
  return applicationFacade().models.refresh();
}
