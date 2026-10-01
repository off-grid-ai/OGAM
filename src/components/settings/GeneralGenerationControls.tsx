import React from 'react';
import { useTextGenerationSettings } from '../../hooks/useTextGenerationSettings';
import {
  BackendSelector,
  LiteRTBackendSelector,
  ModelLoadingModeSelector,
  ShowGenerationDetailsToggle,
} from './textGenAdvancedSections';

/** Shared defaults used by every generation settings surface. */
export const GeneralGenerationControls: React.FC = () => {
  const { isLiteRT } = useTextGenerationSettings();

  return (
    <>
      {isLiteRT ? <LiteRTBackendSelector /> : <BackendSelector />}
      <ModelLoadingModeSelector />
      <ShowGenerationDetailsToggle />
    </>
  );
};
