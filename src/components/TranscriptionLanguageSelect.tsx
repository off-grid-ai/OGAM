import React, { useEffect, useMemo } from 'react';
import { transcriptionLanguages } from '@offgrid/speech';
import { useWhisperStore } from '../stores/whisperStore';
import { SettingsOptionSelect } from './SettingsOptionSelect';
import { callHook, HOOKS } from '../bootstrap/hookRegistry';
import { isQwenAsrModelId } from '../services/qwenAsrModel';

interface TranscriptionLanguageSelectProps {
  testID?: string;
}

/** One language setting for every local speech-to-text entry point. */
export const TranscriptionLanguageSelect: React.FC<TranscriptionLanguageSelectProps> = ({
  testID = 'transcription-language-select',
}) => {
  const downloadedModelId = useWhisperStore((state) => state.downloadedModelId);
  const language = useWhisperStore((state) => state.transcriptionLanguage);
  const setLanguage = useWhisperStore((state) => state.setTranscriptionLanguage);
  const languages = useMemo(
    () => transcriptionLanguages(isQwenAsrModelId(downloadedModelId) ? 'qwen3-asr' : 'whisper', downloadedModelId),
    [downloadedModelId],
  );
  const options = useMemo(
    () => languages.map(({ code, label }) => ({ value: code, label })),
    [languages],
  );
  const supportedValue = options.some((option) => option.value === language)
    ? language
    : options[0]?.value ?? 'en';

  useEffect(() => {
    if (supportedValue !== language) setLanguage(supportedValue);
  }, [language, setLanguage, supportedValue]);

  const selectLanguage = (nextLanguage: string) => {
    setLanguage(nextLanguage);
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
      description={options.length === 1
        ? 'This model supports English.'
        : 'Choose a language or use auto-detect.'}
    />
  );
};
