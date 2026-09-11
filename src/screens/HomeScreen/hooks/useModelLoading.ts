import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { showAlert, AlertState } from '../../../components';
import { selectMobileModel } from '../../../services';
import { unloadAndClearModel } from '../../../services/modelServices/modelFacadeCommands';
import { DownloadedModel } from '../../../types';
import { LoadingState, ModelPickerType } from './types';

type Setters = {
  setLoadingState: (s: LoadingState) => void;
  setPickerType: (t: ModelPickerType) => void;
  setAlertState: (s: AlertState) => void;
};

const idle: LoadingState = { isLoading: false, type: null, modelName: null };

/** Yield one interaction cycle so the inline "Loading..." card paints before the
 *  (potentially bridge-blocking) native unload starts. */
const waitForOverlay = () =>
  new Promise<void>(resolve =>
    InteractionManager.runAfterInteractions(() => resolve()),
  );

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
    async (model: DownloadedModel) => {
      setPickerType(null);
      await selectMobileModel({
        source: 'local',
        hostId: model.engine,
        modality: 'text',
        modelId: model.id,
      });
    },
    [setPickerType],
  );

  const handleUnloadTextModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'text', modelName: null });
    await waitForOverlay();
    try {
      await unloadAndClearModel('text');
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  const handleUnloadImageModel = useCallback(async () => {
    setPickerType(null);
    setLoadingState({ isLoading: true, type: 'image', modelName: null });
    await waitForOverlay();
    try {
      await unloadAndClearModel('image');
    } catch (_error) {
      setAlertState(showAlert('Error', 'Failed to unload model'));
    } finally {
      setLoadingState(idle);
    }
  }, [setLoadingState, setPickerType, setAlertState]);

  return {
    handleSelectTextModel,
    handleUnloadTextModel,
    handleUnloadImageModel,
  };
};
