import { useActiveMobileModel } from './useActiveMobileModel';

export const NO_TRANSCRIPTION_MODEL_LABEL = 'No model selected. Tap to choose.';

/**
 * One projection of the shared selected STT route for every settings surface.
 */
export function useTranscriptionModelSetting(): {
  modelId: string | null;
  modelName: string | null;
  isRemote: boolean;
} {
  const model = useActiveMobileModel('transcription').model;
  return {
    modelId: model?.id ?? null,
    modelName: model?.name ?? null,
    isRemote: model?.source === 'remote',
  };
}
