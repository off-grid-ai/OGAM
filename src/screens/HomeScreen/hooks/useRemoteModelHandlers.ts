import { useCallback } from 'react';
import { showAlert } from '../../../components';
import { remoteServerManager } from '../../../services';
import { RemoteModel } from '../../../types';
import { LoadingState } from './types';
import logger from '../../../utils/logger';

interface RemoteModelHandlersParams {
  setPickerType: (type: 'text' | 'image' | null) => void;
  setLoadingState: (state: LoadingState) => void;
  setAlertState: (state: any) => void;
}

export function useRemoteModelHandlers({ setPickerType, setLoadingState, setAlertState }: RemoteModelHandlersParams) {
  const handleSelectRemoteTextModel = useCallback(async (model: RemoteModel) => {
    logger.log('[useHomeScreen] handleSelectRemoteTextModel called:', model.id, model.serverId);
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
    try {
      await remoteServerManager.setActiveRemoteTextModel(model.serverId, model.id);
      logger.log('[useHomeScreen] Remote text model set successfully');
    } catch (_error) {
      logger.error('[useHomeScreen] Failed to set remote text model:', _error);
      setAlertState(showAlert('Error', `Failed to connect to remote model: ${(_error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleUnloadRemoteTextModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    try {
      remoteServerManager.clearActiveRemoteModel();
    } catch {
      setAlertState(showAlert('Error', 'Failed to disconnect remote model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleSelectRemoteImageModel = useCallback(async (model: RemoteModel) => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: model.name });
    try {
      await remoteServerManager.setActiveRemoteImageModel(model.serverId, model.id);
    } catch (_error) {
      setAlertState(showAlert('Error', `Failed to connect to remote model: ${(_error as Error).message}`));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleUnloadRemoteImageModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    try {
      remoteServerManager.clearActiveRemoteModel();
    } catch {
      setAlertState(showAlert('Error', 'Failed to disconnect remote model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  return {
    handleSelectRemoteTextModel,
    handleUnloadRemoteTextModel,
    handleSelectRemoteImageModel,
    handleUnloadRemoteImageModel,
  };
}
