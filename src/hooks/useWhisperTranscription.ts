import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';
import {
  modelsFailureMessage,
  speechFailureMessage,
  type FinalizedRecording,
  type SpeechFacade,
  type VoiceTurnMode,
} from '@offgrid/application';
import logger from '../utils/logger';
import { applicationFacade } from '../services/applicationFacade';
import { useTranscriptionModelsProjection } from './useTranscriptionModelsProjection';

export interface UseWhisperTranscriptionParams {
  mode?: VoiceTurnMode;
}

export interface UseWhisperTranscriptionResult {
  isRecording: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isStartingRecording: boolean;
  isTranscribing: boolean;
  partialResult: string;
  finalResult: string;
  finalRecording: FinalizedRecording | null;
  error: string | null;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearResult: () => void;
}

async function cancelActiveTranscription(speech: SpeechFacade): Promise<void> {
  const snapshot = speech.snapshot();
  const operation = snapshot.transcriptionOperations.active;
  if (operation) {
    const outcome = await speech.cancelTranscription(operation.operationId);
    if (outcome.ok) return;
  }
  if (
    snapshot.transcription.status === 'listening' ||
    snapshot.transcription.status === 'transcribing'
  ) {
    await speech.cancelRealtime();
  }
}

export const useWhisperTranscription = ({
  mode = 'tap',
}: UseWhisperTranscriptionParams): UseWhisperTranscriptionResult => {
  const speech = applicationFacade().speech;
  const speechSnapshot = useSyncExternalStore(
    speech.subscribe,
    speech.snapshot,
    speech.snapshot,
  );
  const [finalResult, setFinalResult] = useState('');
  const [finalRecording, setFinalRecording] =
    useState<FinalizedRecording | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const transcriptionModels = useTranscriptionModelsProjection();
  const isModelLoaded = transcriptionModels.models.some(
    row => row.selected && row.loaded,
  );
  const isModelLoading = transcriptionModels.models.some(
    row => row.selected && row.loading,
  );
  const transcriptionLanguage =
    speechSnapshot.preferences.transcriptionLanguage;

  useEffect(
    () =>
      speech.events(event => {
        if (event.type === 'transcription_final') {
          setFinalResult(event.text);
          setFinalRecording(event.recording ?? null);
          Vibration.vibrate(30);
        }
      }),
    [speech],
  );

  useEffect(
    () => () => {
      cancelActiveTranscription(speech).catch(error => {
        logger.error('[Whisper] Shared transcription cleanup failed:', error);
      });
    },
    [speech],
  );

  const startRecording = useCallback(async () => {
    setCommandError(null);
    setFinalResult('');
    setFinalRecording(null);
    const ready = await applicationFacade().workflows.prepareTranscription();
    if (!ready.ok) {
      setCommandError(
        ready.failure.kind === 'models'
          ? modelsFailureMessage(ready.failure.failure)
          : ready.failure.kind,
      );
      return;
    }
    const outcome = await speech.startRealtime({
      mode,
      language: transcriptionLanguage,
    });
    if (!outcome.ok) {
      setCommandError(speechFailureMessage(outcome.failure));
      return;
    }
    Vibration.vibrate(50);
  }, [mode, speech, transcriptionLanguage]);

  const stopRecording = useCallback(async () => {
    const outcome = await speech.stopRealtime();
    if (!outcome.ok) {
      if (outcome.failure.kind !== 'cancelled') {
        setCommandError(speechFailureMessage(outcome.failure));
      }
      return;
    }
    setFinalResult(outcome.value.text);
    setFinalRecording(outcome.value.recording ?? null);
  }, [speech]);

  const clearResult = useCallback(() => {
    setFinalResult('');
    setFinalRecording(null);
    setCommandError(null);
    cancelActiveTranscription(speech).catch(error => {
      logger.error(
        '[Whisper] Shared transcription cancellation failed:',
        error,
      );
    });
  }, [speech]);

  return {
    isRecording: speechSnapshot.transcription.status === 'listening',
    isModelLoaded,
    isModelLoading,
    isStartingRecording: false,
    isTranscribing: speechSnapshot.transcription.status === 'transcribing',
    partialResult: speechSnapshot.transcription.partial,
    finalResult,
    finalRecording,
    error:
      commandError ||
      (speechSnapshot.transcription.failure
        ? speechFailureMessage(speechSnapshot.transcription.failure)
        : null),
    recordingTime: 0,
    startRecording,
    stopRecording,
    clearResult,
  };
};
