import { useMemo } from 'react';
import { DownloadedModel, ONNXImageModel, RemoteModel } from '../../types';
import logger from '../../utils/logger';
import {
  isSuspiciousRecoveredImageModel,
  isSuspiciousRecoveredTextModel,
} from '../../utils/modelSelectorFilters';
import { ActiveModelInfo } from './chatScreenTypes';

type Params = {
  activeServerId: string | null;
  activeRemoteTextModelId: string | null;
  discoveredModels: Record<string, RemoteModel[]>;
  activeModelId: string | null;
  downloadedModels: DownloadedModel[];
  activeImageModelId: string | null;
  downloadedImageModels: ONNXImageModel[];
};

export function useChatActiveModels({
  activeServerId,
  activeRemoteTextModelId,
  discoveredModels,
  activeModelId,
  downloadedModels,
  activeImageModelId,
  downloadedImageModels,
}: Params) {
  const activeModelInfo = useMemo((): ActiveModelInfo => {
    if (activeServerId && activeRemoteTextModelId) {
      const remoteModel = (discoveredModels[activeServerId] || []).find(
        model => model.id === activeRemoteTextModelId,
      );
      if (remoteModel) {
        return {
          isRemote: true,
          model: remoteModel,
          modelId: remoteModel.id,
          modelName: remoteModel.name,
        };
      }
      logger.warn(
        '[ChatScreen] Remote model not found:',
        activeServerId,
        activeRemoteTextModelId,
      );
    }
    const localModel = downloadedModels.find(
      model => model.id === activeModelId,
    );
    return localModel
      ? {
          isRemote: false,
          model: localModel,
          modelId: localModel.id,
          modelName: localModel.name,
        }
      : {
          isRemote: false,
          model: null,
          modelId: null,
          modelName: 'Unknown',
        };
  }, [
    activeServerId,
    activeRemoteTextModelId,
    discoveredModels,
    activeModelId,
    downloadedModels,
  ]);

  const activeModel = activeModelInfo.isRemote
    ? undefined
    : (activeModelInfo.model as DownloadedModel | undefined);
  const activeRemoteModel = activeModelInfo.isRemote
    ? (activeModelInfo.model as RemoteModel | null)
    : null;
  const hasTextModel = activeModelInfo.modelId !== null;
  const activeImageModel = downloadedImageModels.find(
    model => model.id === activeImageModelId,
  );
  const hasAvailableModels =
    downloadedModels.some(model => !isSuspiciousRecoveredTextModel(model)) ||
    downloadedImageModels.some(
      model => !isSuspiciousRecoveredImageModel(model),
    ) ||
    Object.values(discoveredModels).some(models => models.length > 0);

  return {
    activeModelInfo,
    activeModel,
    activeRemoteModel,
    hasTextModel,
    hasActiveModel: hasTextModel || !!activeImageModelId,
    activeModelName: activeModelInfo.modelName,
    activeImageModel,
    imageModelLoaded: !!activeImageModel,
    hasAvailableModels,
  };
}
