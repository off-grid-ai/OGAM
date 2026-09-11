import React, { useMemo, useState } from 'react';
import {
  speechFailureMessage,
  transcriptionLanguages,
} from '@offgrid/application';
import { SettingsOptionSelect } from './SettingsOptionSelect';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import { useTranscriptionModelsProjection } from '../hooks/useTranscriptionModelsProjection';
import { useSpeechProjection } from '../hooks/useApplicationProjection';
import { applicationFacade } from '../services/applicationFacade';

interface TranscriptionLanguageSelectProps {
  testID?: string;
}

/** One language setting for every local speech-to-text entry point. */
export const TranscriptionLanguageSelect: React.FC<
  TranscriptionLanguageSelectProps
> = ({ testID = 'transcription-language-select' }) => {
  const downloadedModelId = useTranscriptionModelsProjection().selectedModelId;
  const language = useSpeechProjection().preferences.transcriptionLanguage;
  const [failure, setFailure] = useState<string | null>(null);
  const languages = useMemo(
    () => transcriptionLanguages('whisper', downloadedModelId),
    [downloadedModelId],
  );
  const options = useMemo(
    () => languages.map(({ code, label }) => ({ value: code, label })),
    [languages],
  );
  const supportedValue = options.some(option => option.value === language)
    ? language
    : options[0]?.value ?? 'en';

  const selectLanguage = async (nextLanguage: string): Promise<void> => {
    setFailure(null);
    const outcome = await applicationFacade().speech.savePreferences({
      transcriptionLanguage: nextLanguage,
    });
    if (!outcome.ok) {
      setFailure(speechFailureMessage(outcome.failure));
      return;
    }
    if (nextLanguage !== 'auto') {
      callHook(HOOKS.audioSelectLanguage, nextLanguage);
    }
  };

  return (
    <SettingsOptionSelect
      testID={testID}
      label="Language"
      value={supportedValue}
      options={options}
      onChange={selectLanguage}
      description={
        failure ??
        (options.length === 1
          ? 'This model supports English.'
          : 'Choose a language or use auto-detect.')
      }
    />
  );
};
