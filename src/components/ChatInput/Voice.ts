import { useEffect, useRef, useState } from 'react';
import { useWhisperTranscription } from '../../hooks/useWhisperTranscription';
import { useWhisperStore, useAppStore, useRemoteServerStore } from '../../stores';
import { activeModelService } from '../../services/activeModelService';
import { audioRecorderService } from '../../services/audioRecorderService';
import { whisperService } from '../../services/whisperService';
import { recordingController } from '../../services/recordingController';
import { useSilenceEndpoint, type SilenceEndpoint } from './useSilenceEndpoint';
import { finaliseRecording, type RecordedAudio } from './finaliseRecording';
import { useVoiceSessionDriver } from './useVoiceSessionDriver';
import { voiceSession } from '../../services/voiceSession';
import { resolveTranscription } from './transcriptionOutcome';
import { ensureWhisperForTranscription } from './ensureWhisperForTranscription';
import logger from '../../utils/logger';

interface UseVoiceInputParams {
  conversationId?: string | null;
  interfaceMode: 'chat' | 'audio';
  onTranscript: (text: string) => void;
  onAudioAttachment?: (audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds?: number; transcription?: string }) => void;
  /** Called in Audio Mode to auto-send. Includes audio info so caller can build attachment atomically. */
  onAutoSend?: (text: string, audio: { uri: string; format: 'wav' | 'mp3'; durationSeconds: number }) => void;
}

/** Stop the recorder and produce the note the person MEANT - dead air cut from both ends. The one
 *  artifact every stop path shares, so two paths cannot disagree about what a recording is. */
async function stopAndFinalise(silence: SilenceEndpoint): Promise<RecordedAudio> {
  return finaliseRecording(
    await audioRecorderService.stopRecording(),
    silence.silenceBeforeSpeech(),
    silence.silenceAfterSpeech(),
  );
}

/** Cancel the active recorder only. Session policy stays with useVoiceInput. */
function cancelActiveCapture(input: {
  isDirectRecording: boolean;
  isAudioModeRecording: boolean;
  setIsDirectRecording: (value: boolean) => void;
  setIsAudioModeRecording: (value: boolean) => void;
  stopWhisperRecording: () => void;
  clearWhisperResult: () => void;
  clearConversation: () => void;
}): void {
  if (input.isDirectRecording || input.isAudioModeRecording) {
    audioRecorderService.cancelRecording();
    if (input.isDirectRecording) input.setIsDirectRecording(false);
    else input.setIsAudioModeRecording(false);
  } else {
    input.stopWhisperRecording();
    input.clearWhisperResult();
  }
  input.clearConversation();
}

/** Build the one readiness boundary shared by realtime and file transcription. */
function createWhisperReadiness(
  downloadedModelId: string | null,
  remoteTranscriptionAvailable: boolean,
): () => Promise<boolean> {
  if (remoteTranscriptionAvailable) return async () => true;
  return () => ensureWhisperForTranscription({
    isSelectedModelLoaded: () => !!downloadedModelId &&
      whisperService.getLoadedModelPath() === whisperService.getModelPath(downloadedModelId),
    hasDownloadedModel: () => !!downloadedModelId,
    loadWhisper: () => useWhisperStore.getState().loadModel(),
    freeGenerationModels: () => activeModelService.unloadAllModels(true).then(() => {}),
  });
}

function useRemoteTranscriptionAvailable(): boolean {
  return useRemoteServerStore(state => {
    const server = state.servers.find(item => item.id === state.activeServerId);
    return !!server?.mediaModels?.transcription;
  });
}

export function useVoiceInput({ conversationId, interfaceMode, onTranscript, onAudioAttachment, onAutoSend }: UseVoiceInputParams) {
  const recordingConversationIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAudioAttachmentRef = useRef(onAudioAttachment);
  onAudioAttachmentRef.current = onAudioAttachment;
  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const downloadedModelId = useWhisperStore(state => state.downloadedModelId);
  const transcriptionLanguage = useWhisperStore(state => state.transcriptionLanguage);
  const remoteTranscriptionAvailable = useRemoteTranscriptionAvailable();
  const [isDirectRecording, setIsDirectRecording] = useState(false);
  const [isAudioModeRecording, setIsAudioModeRecording] = useState(false);
  /** Hands-free: the mic is open but nobody has spoken yet, so the turn has not begun. */

  const [isTranscribingFile, setIsTranscribingFile] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const supportsDirectAudio = (): boolean =>
    activeModelService.supportsAudioInput() && audioRecorderService.supportsDirectAudioInput();

  // The rendered composer mode is the recording mode. Passing it in prevents the
  // Voice layout and recorder from observing two different store snapshots.
  const isInAudioInterfaceMode = (): boolean => interfaceMode === 'audio';

  // Use file-based transcription path when: Audio Mode + Whisper available + not direct audio model
  const shouldUseFilePath = (): boolean =>
    isInAudioInterfaceMode() && !!downloadedModelId && !supportsDirectAudio();

  const ensureWhisper = createWhisperReadiness(downloadedModelId, remoteTranscriptionAvailable);

  const {
    isRecording: isWhisperRecording,
    isModelLoading,
    isStartingRecording,
    isTranscribing: isWhisperTranscribing,
    partialResult,
    finalResult,
    error: whisperError,
    startRecording: startWhisperRecording,
    stopRecording: stopWhisperRecording,
    clearResult,
  } = useWhisperTranscription({ ensureModelReady: ensureWhisper });

  const isTranscribing = isWhisperTranscribing || isTranscribingFile;
  const isRecording = isDirectRecording || isAudioModeRecording || isWhisperRecording;
  const error = directError ?? whisperError;

  // voiceAvailable: direct audio OR whisper downloaded
  const voiceAvailable = supportsDirectAudio() || !!downloadedModelId || remoteTranscriptionAvailable;

  useVoiceSessionDriver({
    // Hands-free auto-arm is voice-mode only (a global setting leaves the session in `listen`, so
    // without this it armed the mic in a text/image chat too); tap-to-dictate via recordingController
    // is deliberately NOT gated. No silencing: a reply only plays while speaking, so the mic can't collide.
    startTurn: () => { if (isInAudioInterfaceMode()) void startRef.current({ silenceAssistant: false }); },
  });
  const silence = useSilenceEndpoint({
    isInAudioInterfaceMode,
    // stopRef is assigned below and kept current every render, so this is never a stale closure.
    stopTurn: () => void stopRef.current(),
  });
  const listenForSilence = silence.listen;
  const stopListeningForSilence = silence.stop;

  const startRecording = async (opts: { silenceAssistant?: boolean } = {}) => {
    // Taking the floor by TAPPING silences the assistant, as it always did. A hands-free ARM must not:
    // it opens the mic before the assistant has even started speaking, so stopping speech here killed
    // autoplay outright. Echo cancellation is what makes the overlap safe, and barge-in stops the
    // assistant on actual detected speech instead - which is the honest trigger for it.
    const { silenceAssistant = true } = opts;
    // The session decides whether a mic may be open. Nothing else needs asking.
    if (!voiceSession.micShouldBeOpen()) {
      logger.log('[TURN] start refused - session is not listening');
      return;
    }
    logger.log(
      `[TURN] start (${silenceAssistant ? 'tapped' : 'hands-free arm'}) direct=${supportsDirectAudio()} file=${shouldUseFilePath()}`,
    );
    recordingConversationIdRef.current = conversationId || null;
    setDirectError(null);

    if (supportsDirectAudio() || remoteTranscriptionAvailable) {
      try {
        setIsDirectRecording(true);
        await audioRecorderService.startRecording();
        listenForSilence();
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
        listenForSilence();
      } catch (err) {
        setIsAudioModeRecording(false);
        const msg = err instanceof Error ? err.message : 'Recording failed';
        logger.error('[Voice] Audio mode recording error:', err);
        setDirectError(msg);
      }
      return;
    }

    // The whisper path drives its own recorder, so this turn's token would otherwise be held by a
    // mic this code never opened.
    await startWhisperRecording();
  };

  // Transcribe a just-recorded file, toggling the transcribing flag around the work.
  // whisperReady tracks whether the MODEL loaded — a throw from transcribeFile after a
  // successful load is a transcription miss (not a load failure), so whisperReady stays
  // true and the user gets "couldn't hear that", not "couldn't load the voice model".
  const transcribeRecordedFile = async (path: string, errLabel: string): Promise<{ whisperReady: boolean; transcript: string }> => {
    let whisperReady = false;
    let transcript = '';
    if (downloadedModelId || remoteTranscriptionAvailable) {
      setIsTranscribingFile(true);
      try {
        whisperReady = await ensureWhisper();
        if (whisperReady) transcript = await whisperService.transcribeFile(path, { language: transcriptionLanguage });
      } catch (err) { logger.error(errLabel, err); }
      setIsTranscribingFile(false);
    }
    return { whisperReady, transcript };
  };

  // Direct-audio model: after stopping, transcribe and either auto-send (Audio Mode) or
  // attach the transcript (Chat mode). In ANY mode we send a TRANSCRIPT, never raw audio.
  const stopDirectRecording = async () => {
    try {
      const { path, durationSeconds } = await stopAndFinalise(silence);
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
            // Nothing to send. Hands-free must NOT re-open the mic: on device that spun - record,
            // hear the room, transcribe to nothing, arm again - three turns in eight seconds with no
            // output. A person tapping the mic resumes it.
            voiceSession.dispatch('nothingHeard');
            voiceSession.dispatch('nothingHeard');
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
            // Nothing to send. Hands-free must NOT re-open the mic: on device that spun - record,
            // hear the room, transcribe to nothing, arm again - three turns in eight seconds with no
            // output. A person tapping the mic resumes it.
            voiceSession.dispatch('nothingHeard');
            voiceSession.dispatch('nothingHeard');
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
      const { path, durationSeconds } = await stopAndFinalise(silence);
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
        if (whisperReady) transcript = await whisperService.transcribeFile(path, { language: transcriptionLanguage });
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
        voiceSession.dispatch('nothingHeard');
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
    // The ONE place that learns how this turn ended, because every path - button, silence, cancel -
    // arrives here. A stop that silence did not cause is a deliberate one, and it suspends hands-free
    // until the person taps for the floor again.
    logger.log('[TURN] stop requested');
    const isChatDictation = !isInAudioInterfaceMode();
    // The person's turn is over and there is audio to work on, so the assistant takes the floor now -
    // before any reply exists. That is what keeps the mic shut while it transcribes and thinks.
    voiceSession.dispatch('turnCaptured');
    // Released on EVERY stop path, so a mic that closed can never keep the floor.
    stopListeningForSilence();
    try {
      if (isDirectRecording) {
        await stopDirectRecording();
        return;
      }

      if (isAudioModeRecording) {
        await stopAudioModeRecording();
        return;
      }

      await stopWhisperRecording();
    } finally {
      // Chat dictation only edits the draft. It does not start an assistant turn,
      // so report its own lifecycle event instead of borrowing Voice-mode reset.
      if (isChatDictation) voiceSession.dispatch('dictationFinished');
    }
  };

  const cancelRecording = () => {
    const isReplayCancellation = !!voiceSession.current().replayReturnsTo;
    stopListeningForSilence();
    try {
      cancelActiveCapture({
        isDirectRecording,
        isAudioModeRecording,
        setIsDirectRecording,
        setIsAudioModeRecording,
        stopWhisperRecording,
        clearWhisperResult: clearResult,
        clearConversation: () => { recordingConversationIdRef.current = null; },
      });
    } finally {
      // A user cancellation ends the manual turn. A replay cancellation is
      // different: replayStarted already owns the floor and replayEnded returns it.
      if (!isReplayCancellation) voiceSession.dispatch('dictationFinished');
    }
  };

  // Register this recorder's concrete intents with the single recording-controller
  // owner, and report phase transitions to it (the controller is the one source of
  // truth every mic reads). Stable wrappers call the latest closures via refs so
  // re-registration isn't needed each render.
  const isTranscribingRef = useRef(isTranscribing);
  isTranscribingRef.current = isTranscribing;
  const startRef = useRef(startRecording);
  startRef.current = startRecording;
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;
  const cancelRef = useRef(cancelRecording);
  cancelRef.current = cancelRecording;
  useEffect(() => {
    return recordingController.registerHandlers({
      start: () => startRef.current(),
      stop: () => {
        // In hands-free there was no tap to start, so the stop button means STOP THE SESSION - and a
        // user-induced stop never returns to listening on its own. In the tapped modes the same button
        // is how a person ends their question, so it just hands the floor over and the answer follows.
        if ((useAppStore.getState().settings.voiceTurnMode ?? 'silence') === 'handsfree') {
          voiceSession.dispatch('userStop');
        }
        stopRef.current();
      },
      cancel: () => cancelRef.current(),
    });
  }, []);



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
    isAwaitingSpeech: silence.isAwaitingSpeech,
    isModelLoading,
    isStartingRecording,
    isTranscribing,
    partialResult,
    error,
    voiceAvailable,
    // INTENTS, not mechanics: the controller's registered handlers own the session decisions
    // (userStart out of stopped, userStop on a deliberate hands-free stop). Handing out the raw
    // closures let the stop button bypass that - the stop read as a captured turn and re-armed.
    startRecording: () => recordingController.start(),
    stopRecording: () => recordingController.stop(),
    cancelRecording: () => recordingController.cancel(),
    clearResult,
    /** True when model accepts audio directly (no Whisper needed) */
    isDirectAudioMode: supportsDirectAudio(),
    /** True when recording in Audio Mode for file-based transcription */
    isAudioModeRecording,
  };
}
