import type { ActiveModelInfo } from '../services/modelServices/modelStateTypes';
import { mobileTextModelRecord } from '../services/modelServices';
import { useAppStore } from '../stores/appStore';
import { useActiveMobileModel } from './useActiveMobileModel';

/**
 * The active-model snapshot, live: which model is selected, whether it is loaded, whether a load is
 * running. One subscription to the owning service, shared by every surface that asks.
 *
 * Before this, three views answered the question from three different places - the chat from its own
 * useState, the model sheet from a flag it set when you tapped a row, Home from a third - so they
 * disagreed in exactly the ways you would expect: a sheet showing a spinner for a load that never
 * started, a chat refusing to send to a model the engine had loaded. A view that renders state it does
 * not own is a view that can be wrong; this hook is the only place that reads it.
 */
export function useActiveModelStatus(): ActiveModelInfo {
  const text = useActiveMobileModel('text').model;
  const image = useActiveMobileModel('image').model;
  const downloadedImageModels = useAppStore(state => state.downloadedImageModels);
  const textRecord = mobileTextModelRecord(text);
  const imageRecord = image?.source === 'local'
    ? downloadedImageModels.find(candidate => candidate.id === image.id) ?? null
    : null;
  return {
    text: {
      model: textRecord && 'filePath' in textRecord ? textRecord : null,
      isLoaded: !!text?.loaded,
      isLoading: !!text?.loading,
    },
    image: {
      model: imageRecord,
      isLoaded: !!image?.loaded,
      isLoading: !!image?.loading,
    },
  };
}
