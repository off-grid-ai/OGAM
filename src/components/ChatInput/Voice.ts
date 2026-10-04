import { useCallback, useRef } from 'react';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useSpeechProjection } from '../../hooks/useApplicationProjection';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { supportsAudioInput } from '../../services/modelServices/modelState';
import { recordingController } from '../../services/recordingController';
import { useVoiceControllerEffects } from './voiceControllerEffects';
import { useVoiceSessionDriver } from './useVoiceSessionDriver';
import type { FinalizedRecording } from '@offgrid/application';

interface UseVoiceInputParams {
  conversationId?: string | null;
  interfaceMode: 'chat' | 'audio';
  onTranscript: (text: string) => void;
  onAudioAttachment?: (audio: {
    uri: string;
    format: 'wav' | 'mp3';
    durationSeconds?: number;
    transcription?: string;
  }) => void;
  onAutoSend?: (
    text: string,
    audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds: number },
  ) => void;
}

const audioFormat = (mime: string): 'wav' | 'mp3' =>
  mime === 'audio/mpeg' ? 'mp3' : 'wav';

export function useVoiceInput({
  conversationId,
  interfaceMode,
  onTranscript,
  onAudioAttachment,
  onAutoSend,
}: UseVoiceInputParams) {
  const activeModel = useActiveMobileModel('transcription').model;
  const recordingConversationIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAudioAttachmentRef = useRef(onAudioAttachment);
  onAudioAttachmentRef.current = onAudioAttachment;
  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;

  const speech = useSpeechProjection();
  const capture = useWhisperTranscription({
    mode: interfaceMode === 'audio' ? speech.preferences.turnMode : 'tap',
  });

  const startRecording = async () => {
    recordingConversationIdRef.current = conversationId ?? null;
    await capture.startRecording();
  };
  const startRef = useRef(startRecording);
  startRef.current = startRecording;
  const stopRef = useRef(capture.stopRecording);
  stopRef.current = capture.stopRecording;
  const cancelRef = useRef(() => {
    recordingConversationIdRef.current = null;
    capture.clearResult();
  });
  cancelRef.current = () => {
    recordingConversationIdRef.current = null;
    capture.clearResult();
  };

  useVoiceSessionDriver({
    startTurn: () => {
      if (interfaceMode === 'audio') startRef.current().catch(() => undefined);
    },
  });

  const deliverTranscript = useCallback((text: string) => {
    onTranscriptRef.current(text);
  }, []);
  const deliverCapture = useCallback(
    (text: string, recording: FinalizedRecording) => {
      if (interfaceMode !== 'audio' || !recording.path) {
        onTranscriptRef.current(text);
        return;
      }
      const audio = {
        uri: recording.path,
        format: audioFormat(recording.mime),
        durationSeconds: recording.durationSeconds ?? 0,
      };
      if (onAutoSendRef.current) onAutoSendRef.current(text, audio);
      else {
        onAudioAttachmentRef.current?.({ ...audio, transcription: text });
        onTranscriptRef.current(text);
      }
    },
    [interfaceMode],
  );
  useVoiceControllerEffects({
    conversationId,
    recordingConversationIdRef,
    startRef,
    stopRef,
    cancelRef,
    finalResult: capture.finalResult,
    finalRecording: capture.finalRecording,
    clearResult: capture.clearResult,
    deliverTranscript,
    deliverCapture,
  });

  const isRecording =
    speech.transcription.status === 'listening' ||
    speech.voice.phase === 'recording';
  return {
    isRecording,
    isAwaitingSpeech:
      interfaceMode === 'audio' &&
      speech.voice.phase === 'listening' &&
      speech.preferences.turnMode === 'handsfree',
    isModelLoading: capture.isModelLoading,
    isStartingRecording: capture.isStartingRecording,
    isTranscribing: capture.isTranscribing,
    partialResult: capture.partialResult,
    error: capture.error,
    voiceAvailable: !!activeModel,
    startRecording: () => recordingController.start(),
    stopRecording: () => recordingController.stop(),
    cancelRecording: () => recordingController.cancel(),
    clearResult: capture.clearResult,
    isDirectAudioMode: supportsAudioInput(),
    isAudioModeRecording: interfaceMode === 'audio' && isRecording,
  };
}
