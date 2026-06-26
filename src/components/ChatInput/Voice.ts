import { useEffect, useRef, useState } from 'react';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { useWhisperStore, useChatStore, useUiModeStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { activeModelService } from '../../services/activeModelService';
import { audioRecorderService } from '../../services/audioRecorderService';
import { whisperService } from '../../services/whisperService';
import logger from '../../utils/logger';

interface UseVoiceInputParams {
  conversationId?: string | null;
  onTranscript: (text: string) => void;
  onAudioAttachment?: (uri: string, format: 'wav' | 'mp3', durationSeconds?: number) => void;
  /** Called in Audio Mode to auto-send. Includes audio info so caller can build attachment atomically. */
  onAutoSend?: (text: string, audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds: number }) => void;
}

export function useVoiceInput({ conversationId, onTranscript, onAudioAttachment, onAutoSend }: UseVoiceInputParams) {
  const recordingConversationIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAudioAttachmentRef = useRef(onAudioAttachment);
  onAudioAttachmentRef.current = onAudioAttachment;
  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const { downloadedModelId } = useWhisperStore();
  const [isDirectRecording, setIsDirectRecording] = useState(false);
  const [isAudioModeRecording, setIsAudioModeRecording] = useState(false);
  const [isTranscribingFile, setIsTranscribingFile] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const {
    isRecording: isWhisperRecording,
    isModelLoading,
    isTranscribing: isWhisperTranscribing,
    partialResult,
    finalResult,
    error: whisperError,
    startRecording: startWhisperRecording,
    stopRecording: stopWhisperRecording,
    clearResult,
  } = useWhisperTranscription();

  const supportsDirectAudio = (): boolean =>
    activeModelService.supportsAudioInput() && audioRecorderService.supportsDirectAudioInput();

  const isInAudioInterfaceMode = (): boolean =>
    useUiModeStore.getState().interfaceMode === 'audio';

  // Use file-based transcription path when: Audio Mode + Whisper available + not direct audio model
  const shouldUseFilePath = (): boolean =>
    isInAudioInterfaceMode() && !!downloadedModelId && !supportsDirectAudio();

  const isTranscribing = isWhisperTranscribing || isTranscribingFile;
  const isRecording = isDirectRecording || isAudioModeRecording || isWhisperRecording;
  const error = directError ?? whisperError;

  // voiceAvailable: direct audio OR whisper downloaded
  const voiceAvailable = supportsDirectAudio() || !!downloadedModelId;

  const startRecording = async () => {
    recordingConversationIdRef.current = conversationId || null;
    setDirectError(null);
    // Stop any TTS playback before recording — mic and speaker shouldn't overlap.
    // No-op without the pro audio feature.
    callHook(HOOKS.audioStop);

    if (supportsDirectAudio()) {
      try {
        setIsDirectRecording(true);
        await audioRecorderService.startRecording();
      } catch (err) {
        setIsDirectRecording(false);
        const msg = err instanceof Error ? err.message : 'Recording failed';
        logger.error('[Voice] Direct audio recording error:', err);
        setDirectError(msg);
      }
      return;
    }

    if (shouldUseFilePath()) {
      try {
        setIsAudioModeRecording(true);
        await audioRecorderService.startRecording();
      } catch (err) {
        setIsAudioModeRecording(false);
        const msg = err instanceof Error ? err.message : 'Recording failed';
        logger.error('[Voice] Audio mode recording error:', err);
        setDirectError(msg);
      }
      return;
    }

    await startWhisperRecording();
  };

  const stopRecording = async () => {
    if (isDirectRecording) {
      try {
        const { path, durationSeconds } = await audioRecorderService.stopRecording();
        setIsDirectRecording(false);
        if (!recordingConversationIdRef.current || recordingConversationIdRef.current === conversationId) {
          const format = audioRecorderService.getFormat();
          // In Audio Mode, auto-send directly — no transcription needed for multimodal models
          if (onAutoSendRef.current && isInAudioInterfaceMode()) {
            onAutoSendRef.current('', { uri: path, format, durationSeconds });

            // Parallel transcription: send audio to model immediately, transcribe in background
            // so the voice bubble gets a transcript for display/playback review
            if (downloadedModelId) {
              const convId = conversationId;
              whisperService.transcribeFile(path).then(text => {
                if (!text?.trim() || !convId) return;
                const conv = useChatStore.getState().conversations.find(c => c.id === convId);
                const msg = conv?.messages.find(m =>
                  m.role === 'user' && m.attachments?.some(a => a.uri === path),
                );
                if (msg) {
                  useChatStore.getState().updateMessageContent(convId, msg.id, text.trim());
                }
              }).catch(err => logger.error('[Voice] Background transcription error:', err));
            }
          } else {
            onAudioAttachmentRef.current?.(path, format, durationSeconds);
          }
        }
        recordingConversationIdRef.current = null;
      } catch (err) {
        setIsDirectRecording(false);
        logger.error('[Voice] Failed to stop direct recording:', err);
      }
      return;
    }

    if (isAudioModeRecording) {
      try {
        const { path, durationSeconds } = await audioRecorderService.stopRecording();
        setIsAudioModeRecording(false);
        if (recordingConversationIdRef.current && recordingConversationIdRef.current !== conversationId) {
          recordingConversationIdRef.current = null;
          return;
        }
        setIsTranscribingFile(true);
        let text = '';
        try {
          text = await whisperService.transcribeFile(path);
        } catch (transcribeErr) {
          logger.error('[Voice] File transcription error:', transcribeErr);
        }
        setIsTranscribingFile(false);
        recordingConversationIdRef.current = null;
        if (text.trim()) {
          if (onAutoSendRef.current) {
            onAutoSendRef.current(text.trim(), { uri: path, format: 'wav', durationSeconds });
          } else {
            onAudioAttachmentRef.current?.(path, 'wav', durationSeconds);
            onTranscriptRef.current(text.trim());
          }
        } else {
          // Transcription returned nothing — clip too short or too quiet
          setDirectError("Couldn't hear that — try again");
          setTimeout(() => setDirectError(null), 3000);
        }
      } catch (err) {
        setIsAudioModeRecording(false);
        setIsTranscribingFile(false);
        logger.error('[Voice] Failed to stop audio mode recording:', err);
      }
      return;
    }

    await stopWhisperRecording();
  };

  const cancelRecording = () => {
    if (isDirectRecording) {
      audioRecorderService.cancelRecording();
      setIsDirectRecording(false);
      recordingConversationIdRef.current = null;
      return;
    }
    if (isAudioModeRecording) {
      audioRecorderService.cancelRecording();
      setIsAudioModeRecording(false);
      recordingConversationIdRef.current = null;
      return;
    }
    stopWhisperRecording();
    clearResult();
    recordingConversationIdRef.current = null;
  };

  useEffect(() => {
    if (recordingConversationIdRef.current && recordingConversationIdRef.current !== conversationId) {
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [conversationId, clearResult]);

  useEffect(() => {
    if (finalResult) {
      if (!recordingConversationIdRef.current || recordingConversationIdRef.current === conversationId) {
        onTranscriptRef.current(finalResult);
      }
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [finalResult, clearResult, conversationId]);

  return {
    isRecording,
    isModelLoading,
    isTranscribing,
    partialResult,
    error,
    voiceAvailable,
    startRecording,
    stopRecording,
    cancelRecording,
    clearResult,
    /** True when model accepts audio directly (no Whisper needed) */
    isDirectAudioMode: supportsDirectAudio(),
    /** True when recording in Audio Mode for file-based transcription */
    isAudioModeRecording,
  };
}
