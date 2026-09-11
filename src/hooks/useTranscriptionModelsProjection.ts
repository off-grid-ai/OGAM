import { useCallback, useSyncExternalStore } from 'react';
import {
  createTranscriptionModelsSelector,
  type TranscriptionModelsSnapshot,
} from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';

// One selector cache for every Mobile transcription surface. The Models facade owns the state;
// this module only adapts its read-only projection to React's external-store contract.
const selectTranscriptionModels = createTranscriptionModelsSelector();

/** Subscribe only to the structurally shared transcription branch of the Models facade. */
export function useTranscriptionModelsProjection(): TranscriptionModelsSnapshot {
  const models = applicationFacade().models;
  const getSnapshot = useCallback(
    () => selectTranscriptionModels(models.snapshot()),
    [models],
  );
  const subscribe = useCallback(
    (notify: () => void) => models.watch(selectTranscriptionModels, notify),
    [models],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
