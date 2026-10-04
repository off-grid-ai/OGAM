import { useCallback } from 'react';
import { showAlert } from '../../../components';
import {
  selectModelRoute,
  unloadAndClearModel,
} from '../../../services/modelServices/modelFacadeCommands';
import { RemoteModel } from '../../../types';
import { LoadingState } from './types';
import logger from '../../../utils/logger';

interface RemoteModelHandlersParams {
  setPickerType: (type: 'text' | 'image' | null) => void;
  setLoadingState: (state: LoadingState) => void;
  setAlertState: (state: any) => void;
}

export function useRemoteModelHandlers({
  setPickerType,
  setLoadingState,
  setAlertState,
}: RemoteModelHandlersParams) {
  const handleSelectRemoteTextModel = useCallback(
    async (model: RemoteModel) => {
      logger.log(
        '[useHomeScreen] handleSelectRemoteTextModel called:',
        model.id,
        model.serverId,
      );
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
    try {
      // Unload any active local model first — only one active model at a time
        await selectModelRoute({
          source: 'remote',
          hostId: model.serverId,
          modality: 'text',
          modelId: model.id,
        });
      logger.log('[useHomeScreen] Remote text model set successfully');
    } catch (_error) {
        logger.error(
          '[useHomeScreen] Failed to set remote text model:',
          _error,
        );
        setAlertState(
          showAlert(
            'Error',
            `Failed to connect to remote model: ${(_error as Error).message}`,
          ),
        );
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
    },
    [setPickerType, setLoadingState, setAlertState],
  );

  const handleUnloadRemoteTextModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    try {
        await unloadAndClearModel('text');
    } catch {
      setAlertState(showAlert('Error', 'Failed to disconnect remote model'));
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
  }, [setPickerType, setLoadingState, setAlertState]);

  const handleSelectRemoteImageModel = useCallback(
    async (model: RemoteModel) => {
    setPickerType(null);
      setLoadingState({
        isLoading: true,
        type: 'image',
        modelName: model.name,
      });
    try {
        await selectModelRoute({
          source: 'remote',
          hostId: model.serverId,
          modality: 'image',
          modelId: model.id,
        });
    } catch (_error) {
        setAlertState(
          showAlert(
            'Error',
            `Failed to connect to remote model: ${(_error as Error).message}`,
          ),
        );
    } finally {
      setLoadingState({ isLoading: false, type: null, modelName: null });
    }
    },
    [setPickerType, setLoadingState, setAlertState],
  );

  const handleUnloadRemoteImageModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    try {
      await unloadAndClearModel('image');
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
