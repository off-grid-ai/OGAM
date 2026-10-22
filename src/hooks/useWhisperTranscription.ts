import { useState, useEffect, useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { whisperService, cleanTranscription } from '../services/whisperService';
import { useWhisperStore } from '../stores/whisperStore';
import logger from '../utils/logger';

/** Safely call a state setter only if the component is still mounted. */
const useMountedRef = () => {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
};

export interface UseWhisperTranscriptionParams {
  /**
   * Get whisper resident before the realtime session starts, recovering from a memory refusal — the
   * SAME owner the file path uses (ensureWhisperForTranscription: try load; on a 'blocked' single-model
   * refusal, free the generation model and retry). Resolves true when whisper is loaded, false when it
   * can't be (no model / hard failure). Injected so both dictation modes share ONE recovery path — the
   * realtime path must NOT call whisperStore.loadModel() directly (a 'blocked' return there is not a
   * throw, so it dead-ends into startRealtimeTranscription → 'No Whisper model loaded', no recovery).
   */
  ensureModelReady: () => Promise<boolean>;
  /**
   * The capture ended without a stop: whisper.rn closes the session itself at its length cap. The
   * owner of the voice session must hear this, or it keeps "listening" to a mic that is shut.
   */
  onCaptureEnded?: () => void;
}

export interface UseWhisperTranscriptionResult {
  isRecording: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isStartingRecording: boolean;
  isTranscribing: boolean;
  partialResult: string;
  finalResult: string;
  error: string | null;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearResult: () => void;
}

export const useWhisperTranscription = ({ ensureModelReady, onCaptureEnded }: UseWhisperTranscriptionParams): UseWhisperTranscriptionResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [partialResult, setPartialResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const isCancelled = useRef(false);
  /**
   * A start is IN FLIGHT. Synchronous, and set before the first await.
   *
   * `isRecording` is React state read from a closure, so a second ask in the same tick still sees
   * `false`; `whisperService.isTranscribing` is only set after an await for permissions. Two asks fit
   * inside that window, both clear the old guard, and the native `transcribeRealtime` is entered twice -
   * which is the "State: -100" collision. A plain ref closes the window because it needs no render.
   *
   * Distinct from `startNonce`, which answers "was this start superseded" AFTER the await. This answers
   * "is one already running" BEFORE it.
   */
  const startInFlight = useRef(false);
  /** Set by every stop path; a final event without it means the capture ended by itself. */
  const stopRequested = useRef(false);
  const onCaptureEndedRef = useRef(onCaptureEnded);
  onCaptureEndedRef.current = onCaptureEnded;
  // Session-intent nonce: bumped whenever a start is superseded (stop/cancel). startRecording captures
  // it before the async ensureModelReady() gap (which now frees+reloads the model, so it can be seconds)
  // and aborts the continuation if it changed — otherwise releasing/cancelling the mic DURING the load
  // would still activate a recording that no stop event can reach (a ghost session). (#558 CodeRabbit)
  const startNonce = useRef(0);
  const mountedRef = useMountedRef();
  const transcribingStartTime = useRef<number | null>(null);
  const pendingResult = useRef<string | null>(null);

  const { isModelLoaded, isModelLoading, transcriptionLanguage } = useWhisperStore();

  // On unmount, stop any in-flight realtime session. Without this the mic kept
  // capturing after the user navigated away without releasing the button — the
  // session stayed live for minutes with whisper pinned resident (B11). The
  // mountedRef only flips a flag; it never told the native session to stop.
  useEffect(() => () => {
    if (whisperService.isCurrentlyTranscribing()) {
      void whisperService.forceReset();
    }
  }, []);

  // NOTE: whisper is NOT eager-loaded here. It is warmed once at launch by
  // modelPreloader.preloadStt (fits-gated) and loaded on demand by startRecording. An eager
  // effect keyed on isModelLoaded re-fired the instant the residency manager EVICTED whisper to
  // make room for a text model — reloading it into the just-freed RAM and undoing the eviction
  // (the [MEM-SM] override measured corrupted free RAM). Loading on demand lets eviction stick.

  // Minimum time to show transcribing state (ms)
  const MIN_TRANSCRIBING_TIME = 600;

  // Helper to finalize transcription with minimum display time
  // NOTE: This does NOT clear isTranscribing - that's done by clearResult()
  // which is called from ChatInput after the text is added to the input box.
  // This keeps the loader visible until text actually appears.
  const finalizeTranscription = useCallback((rawText: string) => {
    if (!mountedRef.current) return;
    // Strip Whisper's no-speech markers ([BLANK_AUDIO] etc.) at the single source.
    // An empty result means silence/too-short — clear the transcribing state and
    // emit nothing (never surface "[BLANK_AUDIO]" as the transcript).
    const text = cleanTranscription(rawText);
    if (!text) {
      setPartialResult('');
      setIsTranscribing(false);
      transcribingStartTime.current = null;
      return;
    }
    const startTime = transcribingStartTime.current;
    const elapsed = startTime ? Date.now() - startTime : MIN_TRANSCRIBING_TIME;
    const remaining = Math.max(0, MIN_TRANSCRIBING_TIME - elapsed);

    if (remaining > 0) {
      // Store result and wait for minimum time
      pendingResult.current = text;
      setTimeout(() => {
        if (!mountedRef.current) return;
        if (!isCancelled.current && pendingResult.current !== null) {
          setFinalResult(pendingResult.current);
          pendingResult.current = null;
        } else {
          // If cancelled, clear the transcribing state
          setIsTranscribing(false);
        }
        setPartialResult('');
        transcribingStartTime.current = null;
      }, remaining);
    } else {
      // Minimum time already passed - set result, let clearResult() clear isTranscribing
      setFinalResult(text);
      setPartialResult('');
      transcribingStartTime.current = null;
    }
  }, []);

  // One short tail gives Whisper enough silence to close the phrase without
  // making every manual stop feel blocked.
  const TRAILING_RECORD_TIME_MS = 300;

  // Define stopRecording first since startRecording depends on it
  const stopRecording = useCallback(async () => {
    logger.log('[Whisper] stopRecording called');

    // Supersede any in-flight start still awaiting model load — it must not resurrect a recording.
    startNonce.current++;
    stopRequested.current = true;
    // No live session means no final event will come, so do not wait for one on "Transcribing...".
    if (!startInFlight.current && !whisperService.isCurrentlyTranscribing()) {
      logger.log('[Whisper] stopRecording: no live session - nothing to transcribe');
      if (mountedRef.current) {
        setIsRecording(false);
        setIsStartingRecording(false);
        setIsTranscribing(false);
      }
      transcribingStartTime.current = null;
      return;
    }
    // Immediately update UI to show "Transcribing..." state
    // But keep recording in background for better accuracy
    if (mountedRef.current) setIsRecording(false);
    if (mountedRef.current) setIsStartingRecording(false);
    if (mountedRef.current) setIsTranscribing(true);
    transcribingStartTime.current = Date.now();

    try {
      // Continue recording for a bit longer to capture trailing audio
      // This helps Whisper process the speech more accurately
      // User sees "Transcribing..." during this time
      logger.log('[Whisper] Capturing trailing audio for', TRAILING_RECORD_TIME_MS, 'ms...');
      await new Promise<void>(resolve => setTimeout(() => resolve(), TRAILING_RECORD_TIME_MS));

      // Check if cancelled or unmounted during the wait
      if (isCancelled.current || !mountedRef.current) {
        logger.log('[Whisper] Cancelled/unmounted during trailing capture');
        await whisperService.forceReset();
        return;
      }

      // Now actually stop the transcription
      await whisperService.stopTranscription();
      // Haptic feedback
      if (mountedRef.current) Vibration.vibrate(30);
    } catch (err) {
      logger.error('[Whisper] Stop error:', err);
      // Force reset on error
      await whisperService.forceReset();
      // On error, also clear transcribing state (only if still mounted)
      if (mountedRef.current) {
        setIsTranscribing(false);
        transcribingStartTime.current = null;
      }
    }
  }, []);

  const clearResult = useCallback(() => {
    setFinalResult('');
    setPartialResult('');
    setIsStartingRecording(false);
    setIsTranscribing(false);
    isCancelled.current = true;
    stopRequested.current = true;
    startNonce.current++; // supersede an in-flight start awaiting model load (no ghost recording)
    pendingResult.current = null;
    transcribingStartTime.current = null;
    // Also ensure recording is stopped
    if (whisperService.isCurrentlyTranscribing()) {
      whisperService.stopTranscription();
    }
  }, []);


  /** The start itself, once it is known to be the only one running. */
  const beginRecording = useCallback(async () => {
    // Capture this start's intent BEFORE the async model-load gap. If stop/cancel bumps the nonce while
    // we await, this start has been superseded → abort, or we'd activate a ghost recording no stop reaches.
    const currentNonce = ++startNonce.current;

    logger.log('[Whisper] Ensuring the selected model is resident (blocked → free generation model → retry)...');
    // Always ask the identity-aware readiness owner. `isModelLoaded()` only says that
    // some Whisper context exists; after a download or model switch it may be the
    // context from the previous model.
    let ready = false;
    try {
      ready = await ensureModelReady();
    } catch {
      ready = false;
    }
    if (startNonce.current !== currentNonce || !mountedRef.current) {
      logger.log('[Whisper] Start superseded during model load (stopped/cancelled) — aborting, no ghost recording');
      if (mountedRef.current) {
        setIsStartingRecording(false);
        setIsTranscribing(false);
        transcribingStartTime.current = null;
      }
      return;
    }
    if (!ready) {
      setError("Couldn't load the voice model — free some memory and try again");
      return;
    }

    try {
      isCancelled.current = false;
      stopRequested.current = false;
      setError(null);
      setPartialResult('');
      setFinalResult('');
      setIsStartingRecording(true);

      logger.log('[Whisper] Starting realtime transcription...');

      await whisperService.startRealtimeTranscription((result) => {
        logger.log('[Whisper] Transcription result:', result.isCapturing, result.text?.slice(0, 50));

        if (isCancelled.current || !mountedRef.current) return;

        setRecordingTime(result.recordingTime);

        if (result.isCapturing) {
          // Still recording - update partial result.
          // Clean through cleanTranscription (the single owner of marker stripping)
          // so a partial like "[BLANK_AUDIO] hello" shows "hello", never the raw
          // marker. Guard: only overwrite when cleaning leaves real speech — an
          // empty cleaned partial (pure silence/noise marker mid-capture) must NOT
          // clobber an existing good partial or the "listening…" UI state.
          const cleaned = cleanTranscription(result.text);
          if (cleaned) {
            setPartialResult(cleaned);
          }
        } else {
          // Recording finished - haptic feedback
          if (mountedRef.current) Vibration.vibrate(30);
          if (mountedRef.current) setIsRecording(false);
          if (!stopRequested.current) {
            logger.log('[Whisper] capture ended without a stop');
            onCaptureEndedRef.current?.();
          }
          // Use finalizeTranscription to ensure minimum display time
          if (result.text && !isCancelled.current) {
            finalizeTranscription(result.text);
          } else if (mountedRef.current) {
            setIsTranscribing(false);
            setPartialResult('');
            transcribingStartTime.current = null;
          }
        }
      }, { language: transcriptionLanguage });
      if (startNonce.current !== currentNonce || !mountedRef.current) return;
      // Do not tell the person to speak before both the fallback recorder and
      // whisper.rn have installed their native capture handles.
      setIsStartingRecording(false);
      setIsRecording(true);
      setIsTranscribing(true);
      Vibration.vibrate(50);
    } catch (err) {
      logger.error('[Whisper] Recording error:', err);
      // Force reset whisper service state
      await whisperService.forceReset();
      if (mountedRef.current) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to start recording';
        setError(errorMsg);
        setIsStartingRecording(false);
        setIsRecording(false);
        setIsTranscribing(false);
        // Error haptic
        Vibration.vibrate([0, 50, 50, 50]);
      }
    }
  }, [ensureModelReady, stopRecording, finalizeTranscription, transcriptionLanguage]);

  const startRecording = useCallback(async () => {
    logger.log('[Whisper] startRecording called');
    logger.log('[Whisper] Model loaded:', whisperService.isModelLoaded());
    logger.log('[Whisper] Current isRecording state:', isRecording);

    // Already recording → absorb the redundant press. Previously this stopped and
    // then re-started, entering the native transcribeRealtime a SECOND time while the
    // first session was still tearing down → the "State: -100" collision (B12). A
    // double-tap must be ONE clean recording, so ignore the extra start.
    if (
      startInFlight.current ||
      isRecording ||
      whisperService.isCurrentlyTranscribing()
    ) {
      logger.log('[Whisper] Already recording — ignoring redundant start (no second session)');
      return;
    }
    startInFlight.current = true;
    try {
      await beginRecording();
    } finally {
      // However it ended - recording, superseded, refused, thrown - it is no longer in flight. On the
      // success path the state guards above have taken over by now; leaving this set would make a
      // recorder that failed to start refuse every later attempt.
      startInFlight.current = false;
    }
  }, [isRecording, beginRecording]);


  return {
    isRecording,
    isModelLoaded: isModelLoaded || whisperService.isModelLoaded(),
    isModelLoading,
    isStartingRecording,
    isTranscribing,
    partialResult,
    finalResult,
    error,
    recordingTime,
    startRecording,
    stopRecording,
    clearResult,
  };
};
