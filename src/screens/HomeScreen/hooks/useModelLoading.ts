import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { showAlert, hideAlert, AlertState } from '../../../components';
import { activeModelService, hardwareService } from '../../../services';
import { useAppStore } from '../../../stores';
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { LoadingState, ModelPickerType } from './useHomeScreen';

type Setters = {
  setLoadingState: (s: LoadingState) => void;
  setPickerType: (t: ModelPickerType) => void;
  setAlertState: (s: AlertState) => void;
};

const idle: LoadingState = { isLoading: false, type: null, modelName: null };

/** Yield one interaction cycle so the inline "Loading…" card paints before the
 *  (potentially bridge-blocking) native load starts. No full-screen overlay now. */
const waitForOverlay = () =>
  new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));

/** Wait for the picker sheet Modal to animate out before opening a new Modal (alert). */
const waitForSheetClose = () =>
  new Promise<void>(resolve => setTimeout(resolve, 300));

export const useModelLoading = ({
  setLoadingState,
  setPickerType,
  setAlertState,
}: Setters) => {
  const proceedWithTextModelLoad = useCallback(
    async (model: DownloadedModel) => {
      setPickerType(null);
      setLoadingState({ isLoading: true, type: 'text', modelName: model.name });
      await waitForOverlay();
      try {
        // Remember the user's explicit text-model choice so routing can reload
        // it on demand even after the residency manager evicts it.
        useAppStore.getState().setLastTextModelId(model.id);
        await activeModelService.loadTextModel(model.id);
      } catch (error) {
        setAlertState(
          showAlert(
            'Error',
            `Failed to load model: ${(error as Error).message}`,
          ),
        );
      } finally {
        setLoadingState(idle);
      }
    },
    [setLoadingState, setPickerType, setAlertState],
  );

  const handleSelectTextModel = useCallback(
    async (model: DownloadedModel) => {
      const loadedIds = activeModelService.getLoadedModelIds();
      if (loadedIds.textModelId === model.id) {
        return;
      }
      const memoryCheck = await activeModelService.checkMemoryForModel(
        model.id,
        'text',
      );
      if (!memoryCheck.canLoad) {
        setPickerType(null);
        await waitForSheetClose();
        setAlertState(
          showAlert('Insufficient Memory', memoryCheck.message, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Load Anyway',
              style: 'destructive',
              onPress: () => {
                setAlertState(hideAlert());
                proceedWithTextModelLoad(model);
              },
            },
          ]),
        );
        return;
      }
      if (memoryCheck.severity === 'warning') {
        setPickerType(null);
        await waitForSheetClose();
        setAlertState(
          showAlert('Low Memory Warning', memoryCheck.message, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Load Anyway',
              style: 'default',
              onPress: () => {
                setAlertState(hideAlert());
                proceedWithTextModelLoad(model);
              },
            },
          ]),
        );
        return;
      }
      proceedWithTextModelLoad(model);
    },
    [setAlertState, setPickerType, proceedWithTextModelLoad],
  );

  const handleUnloadTextModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    await waitForOverlay();
    try {
      await activeModelService.unloadTextModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  const proceedWithImageModelLoad = useCallback(
    async (model: ONNXImageModel) => {
      setPickerType(null);
      setLoadingState({
        isLoading: true,
        type: 'image',
        modelName: model.name,
      });
      await waitForOverlay();
      try {
        await activeModelService.loadImageModel(model.id);
      } catch (error) {
        setAlertState(
          showAlert(
            'Error',
            `Failed to load model: ${(error as Error).message}`,
          ),
        );
      } finally {
        setLoadingState(idle);
      }
    },
    [setLoadingState, setPickerType, setAlertState],
  );

  const handleSelectImageModel = useCallback(
    async (model: ONNXImageModel) => {
      const loadedIds = activeModelService.getLoadedModelIds();
      if (loadedIds.imageModelId === model.id) {
        return;
      }

      // On ≤4GB devices the service will auto-unload the text model before loading,
      // so check memory as if only the image model will be loaded.
      const isLowMemDevice = hardwareService.getTotalMemoryGB() <= 4;
      const memoryCheck = isLowMemDevice
        ? await activeModelService.checkMemoryForDualModel(null, model.id)
        : await activeModelService.checkMemoryForModel(model.id, 'image');

      if (!memoryCheck.canLoad) {
        setPickerType(null);
        await waitForSheetClose();
        const lowMemNote = isLowMemDevice
          ? '\nImage generation will use CPU-only mode (slower).'
          : '';
        setAlertState(
          showAlert('Insufficient Memory', memoryCheck.message + lowMemNote, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Load Anyway',
              style: 'destructive',
              onPress: () => {
                setAlertState(hideAlert());
                proceedWithImageModelLoad(model);
              },
            },
          ]),
        );
        return;
      }
      if (memoryCheck.severity === 'warning') {
        setPickerType(null);
        await waitForSheetClose();
        const lowMemNote = isLowMemDevice
          ? '\nThe text model will be unloaded and image generation will use CPU-only mode (slower).'
          : '';
        setAlertState(
          showAlert('Low Memory', memoryCheck.message + lowMemNote, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: isLowMemDevice ? 'Load (slower)' : 'Load Anyway',
              style: 'default',
              onPress: () => {
                setAlertState(hideAlert());
                proceedWithImageModelLoad(model);
              },
            },
          ]),
        );
        return;
      }
      // On ≤4GB devices, inform user that text model will be unloaded and it'll be slower
      if (isLowMemDevice) {
        setPickerType(null);
        await waitForSheetClose();
        setAlertState(
          showAlert(
            'Image Generation (Slower)',
            'The text model will be unloaded and image generation will use CPU-only mode on this device.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Load (slower)',
                style: 'default',
                onPress: () => {
                  setAlertState(hideAlert());
                  proceedWithImageModelLoad(model);
                },
              },
            ],
          ),
        );
        return;
      }
      proceedWithImageModelLoad(model);
    },
    [setAlertState, setPickerType, proceedWithImageModelLoad],
  );

  const handleUnloadImageModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    await waitForOverlay();
    try {
      await activeModelService.unloadImageModel();
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  return {
    handleSelectTextModel,
    handleUnloadTextModel,
    handleSelectImageModel,
    handleUnloadImageModel,
  };
};
