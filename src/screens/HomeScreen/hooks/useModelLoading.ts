import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { showAlert, AlertState } from '../../../components';
import { activeModelService } from '../../../services';
import { useAppStore } from '../../../stores';
import { DownloadedModel, ONNXImageModel } from '../../../types';
import { LoadingState, ModelPickerType } from './types';

type Setters = {
  setLoadingState: (s: LoadingState) => void;
  setPickerType: (t: ModelPickerType) => void;
  setAlertState: (s: AlertState) => void;
};

const idle: LoadingState = { isLoading: false, type: null, modelName: null };

/** Yield one interaction cycle so the inline "Loading…" card paints before the
 *  (potentially bridge-blocking) native unload starts. */
const waitForOverlay = () =>
  new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));

export const useModelLoading = ({
  setLoadingState,
  setPickerType,
  setAlertState,
}: Setters) => {
  // Selecting a model only MARKS it active. The actual load is deferred to the
  // first message in chat, where the routing layer (dispatchGenerationFn ->
  // ensureModelLoaded) loads it once and the residency manager swaps the other
  // modality out. Loading eagerly here used to race that path and leave both a
  // text and an image model resident at the same time.
  const handleSelectTextModel = useCallback(
    (model: DownloadedModel) => {
      setPickerType(null);
      // Dispatch the SELECT intent to the owning service — the View no longer writes activeModelId
      // directly (presentation holds no authoritative state). The service is the one writer, so the
      // selection, load-success, and load-failure states can never drift apart.
      activeModelService.selectTextModel(model.id);
    },
    [setPickerType],
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

  const handleSelectImageModel = useCallback(
    (model: ONNXImageModel) => {
      setPickerType(null);
      useAppStore.getState().setActiveImageModelId(model.id);
    },
    [setPickerType],
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
