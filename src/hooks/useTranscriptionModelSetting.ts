import { useWhisperStore } from '../stores/whisperStore';
import { WHISPER_MODELS } from '../services/whisperService';
import { useWithRemoteCatalog } from '../stores/modelCatalogStore';
import { selectedRemoteModelName } from '../services/remoteModelSelection';
import { useRemoteServerStore } from '../stores/remoteServerStore';

export const NO_TRANSCRIPTION_MODEL_LABEL = 'No model selected. Tap to choose.';

/**
 * One projection of the selected STT model for every settings surface. The
 * Whisper store owns the selection. Views only decide how to present it and
 * when to open the shared picker.
 */
export function useTranscriptionModelSetting(): {
  modelId: string | null;
  modelName: string | null;
  isRemote: boolean;
} {
  const modelId = useWhisperStore(state => state.downloadedModelId);
  const whisperModels = useWithRemoteCatalog('transcription', WHISPER_MODELS);
  const activeServer = useRemoteServerStore(state =>
    state.servers.find(
      server => server.id === state.activeRemoteMediaServerIds.transcription,
    ),
  );
  const remoteModelName = selectedRemoteModelName(
    activeServer,
    'transcription',
  );
  return {
    modelId: remoteModelName
      ? activeServer?.mediaModels?.transcription ?? null
      : modelId,
    modelName:
      remoteModelName ??
      whisperModels.find(model => model.id === modelId)?.name ??
      null,
    isRemote: remoteModelName !== null,
  };
}
