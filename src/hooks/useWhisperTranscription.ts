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
import {
  logVoiceDiagnostic,
  voiceDiagnosticError,
} from '../utils/voiceDiagnostics';

let recordingStartAttempt = 0;

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
  const [finalCapture, setFinalCapture] = useState<{
    text: string;
    recording: FinalizedRecording | null;
  }>({ text: '', recording: null });
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
          // A transcript and its recording are one completed capture. Separate React writes let
          // the delivery effect observe the text before the WAV path and send a plain text turn.
          setFinalCapture({
            text: event.text,
            recording: event.recording ?? null,
          });
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
    const attempt = ++recordingStartAttempt;
    const before = speech.snapshot();
    logVoiceDiagnostic('recording_start_requested', {
      attempt,
      mode,
      transcriptionStatus: before.transcription.status,
      sessionState: before.voice.state,
      sessionPhase: before.voice.phase,
    });
    setCommandError(null);
    setFinalCapture({ text: '', recording: null });
    const ready = await applicationFacade().workflows.prepareTranscription();
    logVoiceDiagnostic('transcription_prepare_finished', {
      attempt,
      outcome: ready.ok ? 'ready' : ready.failure.kind,
    });
    if (!ready.ok) {
      setCommandError(
        ready.failure.kind === 'models'
          ? modelsFailureMessage(ready.failure.failure)
          : ready.failure.kind,
      );
      return;
    }
    let outcome: Awaited<ReturnType<typeof speech.startRealtime>>;
    try {
      outcome = await speech.startRealtime({
        mode,
        language: transcriptionLanguage,
      });
    } catch (error) {
      logVoiceDiagnostic('realtime_start_threw', {
        attempt,
        error: voiceDiagnosticError(error),
      });
      throw error;
    }
    const after = speech.snapshot();
    logVoiceDiagnostic('realtime_start_finished', {
      attempt,
      outcome: outcome.ok ? 'listening' : outcome.failure.kind,
      failure:
        outcome.ok || outcome.failure.kind !== 'runtime'
          ? undefined
          : outcome.failure.message,
      transcriptionStatus: after.transcription.status,
      sessionState: after.voice.state,
      sessionPhase: after.voice.phase,
    });
    if (!outcome.ok) {
      setCommandError(speechFailureMessage(outcome.failure));
      return;
    }
    Vibration.vibrate(50);
  }, [mode, speech, transcriptionLanguage]);

  const stopRecording = useCallback(async () => {
    const outcome = await speech.stopRealtime();
    if (!outcome.ok && outcome.failure.kind !== 'cancelled') {
      setCommandError(speechFailureMessage(outcome.failure));
    }
    // Shared Speech publishes the one authoritative `transcription_final` event. Writing the
    // returned value here as well delivered the same capture twice: the event effect delivered and
    // cleared it first, then this command continuation restored it for a second send.
  }, [speech]);

  const clearResult = useCallback(() => {
    setFinalCapture({ text: '', recording: null });
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
    finalResult: finalCapture.text,
    finalRecording: finalCapture.recording,
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
