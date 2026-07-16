import { useEffect, useRef, useState } from 'react';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { useWhisperStore, useUiModeStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { activeModelService } from '../../services/activeModelService';
import { audioRecorderService } from '../../services/audioRecorderService';
import { whisperService } from '../../services/whisperService';
import { recordingController } from '../../services/recordingController';
import { resolveTranscription } from './transcriptionOutcome';
import { ensureWhisperForTranscription } from './ensureWhisperForTranscription';
import logger from '../../utils/logger';

interface UseVoiceInputParams {
  conversationId?: string | null;
  onTranscript: (text: string) => void;
  onAudioAttachment?: (audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds?: number; transcription?: string }) => void;
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

  // Ensure whisper is resident before transcribing (the decision lives in the pure
  // ensureWhisperForTranscription — it frees a blocking generation model, but never
  // evicts on a hard whisper-load failure). One seam for both paths below.
  const ensureWhisper = (): Promise<boolean> => ensureWhisperForTranscription({
    isLoaded: () => whisperService.isModelLoaded(),
    hasDownloadedModel: () => !!downloadedModelId,
    loadWhisper: () => useWhisperStore.getState().loadModel(),
    // keepSelection=true so routing reloads the right generation model after the
    // transcript decides text-vs-image.
    freeGenerationModels: () => activeModelService.unloadAllModels(true).then(() => {}),
  });

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

  // Transcribe a just-recorded file, toggling the transcribing flag around the work.
  // whisperReady tracks whether the MODEL loaded — a throw from transcribeFile after a
  // successful load is a transcription miss (not a load failure), so whisperReady stays
  // true and the user gets "couldn't hear that", not "couldn't load the voice model".
  const transcribeRecordedFile = async (path: string, errLabel: string): Promise<{ whisperReady: boolean; transcript: string }> => {
    let whisperReady = false;
    let transcript = '';
    if (downloadedModelId) {
      setIsTranscribingFile(true);
      try {
        whisperReady = await ensureWhisper();
        if (whisperReady) transcript = await whisperService.transcribeFile(path);
      } catch (err) { logger.error(errLabel, err); }
      setIsTranscribingFile(false);
    }
    return { whisperReady, transcript };
  };

  // Direct-audio model: after stopping, transcribe and either auto-send (Audio Mode) or
  // attach the transcript (Chat mode). In ANY mode we send a TRANSCRIPT, never raw audio.
  const stopDirectRecording = async () => {
    try {
      const { path, durationSeconds } = await audioRecorderService.stopRecording();
      setIsDirectRecording(false);
      if (!recordingConversationIdRef.current || recordingConversationIdRef.current === conversationId) {
        const format = audioRecorderService.getFormat();
        // In Audio Mode, transcribe FIRST, then auto-send with the text.
        // Sending audio with EMPTY text made the intent router classify on "" — so a
        // voice request like "draw a dog" always routed to the text model (image gen
        // needs the transcribed prompt, which never reached routing). We still attach
        // the audio so multimodal text models get the original speech; the text is what
        // lets routing pick image vs text.
        if (onAutoSendRef.current && isInAudioInterfaceMode()) {
          const { whisperReady, transcript } = await transcribeRecordedFile(path, '[Voice] transcription error:');
          // NEVER dispatch an empty transcript — that misroutes to the text model.
          const outcome = resolveTranscription(whisperReady, transcript);
          if (outcome.dispatch) {
            onAutoSendRef.current(outcome.text, { uri: path, format, durationSeconds });
          } else {
            setDirectError(outcome.message);
            setTimeout(() => setDirectError(null), 3000);
          }
        } else {
          // CHAT mode: STT is dictation-into-the-input-box on EVERY engine — the SAME behavior a non-audio
          // (llama) model's hold-to-talk has. Transcribe the recording and drop the text into the composer
          // for the user to review/edit/send; do NOT build a voice-note attachment (that was the litert-only
          // divergence). Voice/Audio interface mode still attaches audio above. `durationSeconds`/`format`
          // are unused here now (no attachment) — the temp recording file is transient.
          const { whisperReady, transcript } = await transcribeRecordedFile(path, '[Voice] chat-mode dictation transcription error:');
          const outcome = resolveTranscription(whisperReady, transcript);
          if (outcome.dispatch) {
            onTranscriptRef.current(outcome.text);
          } else {
            setDirectError(outcome.message);
            setTimeout(() => setDirectError(null), 3000);
          }
        }
      }
      recordingConversationIdRef.current = null;
    } catch (err) {
      setIsDirectRecording(false);
      logger.error('[Voice] Failed to stop direct recording:', err);
    }
  };

  // Audio Mode with a Whisper model: stop, transcribe the file, then auto-send or attach.
  const stopAudioModeRecording = async () => {
    try {
      const { path, durationSeconds } = await audioRecorderService.stopRecording();
      setIsAudioModeRecording(false);
      if (recordingConversationIdRef.current && recordingConversationIdRef.current !== conversationId) {
        recordingConversationIdRef.current = null;
        return;
      }
      setIsTranscribingFile(true);
      let whisperReady = false;
      let transcript = '';
      try {
        whisperReady = await ensureWhisper();
        if (whisperReady) transcript = await whisperService.transcribeFile(path);
      } catch (transcribeErr) {
        logger.error('[Voice] File transcription error:', transcribeErr);
      }
      setIsTranscribingFile(false);
      recordingConversationIdRef.current = null;
      // NEVER dispatch an empty transcript — that misroutes to the text model.
      const outcome = resolveTranscription(whisperReady, transcript);
      if (outcome.dispatch) {
        if (onAutoSendRef.current) {
          onAutoSendRef.current(outcome.text, { uri: path, format: 'wav', durationSeconds });
        } else {
          onAudioAttachmentRef.current?.({ uri: path, format: 'wav', durationSeconds, transcription: outcome.text });
          onTranscriptRef.current(outcome.text);
        }
      } else {
        setDirectError(outcome.message);
        setTimeout(() => setDirectError(null), 3000);
      }
    } catch (err) {
      setIsAudioModeRecording(false);
      setIsTranscribingFile(false);
      logger.error('[Voice] Failed to stop audio mode recording:', err);
    }
  };

  const stopRecording = async () => {
    if (isDirectRecording) {
      await stopDirectRecording();
      return;
    }

    if (isAudioModeRecording) {
      await stopAudioModeRecording();
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

  // Register this recorder's concrete intents with the single recording-controller
  // owner, and report phase transitions to it (the controller is the one source of
  // truth every mic reads). Stable wrappers call the latest closures via refs so
  // re-registration isn't needed each render.
  const startRef = useRef(startRecording);
  startRef.current = startRecording;
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;
  const cancelRef = useRef(cancelRecording);
  cancelRef.current = cancelRecording;
  useEffect(() => {
    return recordingController.registerHandlers({
      start: () => startRef.current(),
      stop: () => stopRef.current(),
      cancel: () => cancelRef.current(),
    });
  }, []);
  useEffect(() => {
    recordingController.setPhase(isRecording ? 'recording' : isTranscribing ? 'transcribing' : 'idle');
  }, [isRecording, isTranscribing]);

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
