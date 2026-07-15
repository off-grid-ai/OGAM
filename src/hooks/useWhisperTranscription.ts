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

export interface UseWhisperTranscriptionResult {
  isRecording: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isTranscribing: boolean;
  partialResult: string;
  finalResult: string;
  error: string | null;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearResult: () => void;
}

export const useWhisperTranscription = (): UseWhisperTranscriptionResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [partialResult, setPartialResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const isCancelled = useRef(false);
  const mountedRef = useMountedRef();
  const transcribingStartTime = useRef<number | null>(null);
  const pendingResult = useRef<string | null>(null);

  const { downloadedModelId, isModelLoaded, isModelLoading, loadModel } = useWhisperStore();

  // On unmount, stop any in-flight realtime session. Without this the mic kept
  // capturing after the user navigated away without releasing the button — the
  // session stayed live for minutes with whisper pinned resident (B11). The
  // mountedRef only flips a flag; it never told the native session to stop.
  useEffect(() => () => {
    if (whisperService.isCurrentlyTranscribing()) {
      whisperService.forceReset();
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

  // Extra recording time after user releases button (ms)
  // Whisper needs trailing audio/silence to properly process speech
  const TRAILING_RECORD_TIME = 2500;

  // Define stopRecording first since startRecording depends on it
  const stopRecording = useCallback(async () => {
    logger.log('[Whisper] stopRecording called');

    // Immediately update UI to show "Transcribing..." state
    // But keep recording in background for better accuracy
    if (mountedRef.current) setIsRecording(false);
    transcribingStartTime.current = Date.now();

    try {
      // Continue recording for a bit longer to capture trailing audio
      // This helps Whisper process the speech more accurately
      // User sees "Transcribing..." during this time
      logger.log('[Whisper] Capturing trailing audio for', TRAILING_RECORD_TIME, 'ms...');
      await new Promise<void>(resolve => setTimeout(() => resolve(), TRAILING_RECORD_TIME));

      // Check if cancelled or unmounted during the wait
      if (isCancelled.current || !mountedRef.current) {
        logger.log('[Whisper] Cancelled/unmounted during trailing capture');
        whisperService.forceReset();
        return;
      }

      // Now actually stop the transcription
      await whisperService.stopTranscription();
      // Haptic feedback
      if (mountedRef.current) Vibration.vibrate(30);
    } catch (err) {
      logger.error('[Whisper] Stop error:', err);
      // Force reset on error
      whisperService.forceReset();
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
    setIsTranscribing(false);
    isCancelled.current = true;
    pendingResult.current = null;
    transcribingStartTime.current = null;
    // Also ensure recording is stopped
    if (whisperService.isCurrentlyTranscribing()) {
      whisperService.stopTranscription();
    }
  }, []);

  const startRecording = useCallback(async () => {
    logger.log('[Whisper] startRecording called');
    logger.log('[Whisper] Model loaded:', whisperService.isModelLoaded());
    logger.log('[Whisper] Current isRecording state:', isRecording);

    // Already recording → absorb the redundant press. Previously this stopped and
    // then re-started, entering the native transcribeRealtime a SECOND time while the
    // first session was still tearing down → the "State: -100" collision (B12). A
    // double-tap must be ONE clean recording, so ignore the extra start.
    if (isRecording || whisperService.isCurrentlyTranscribing()) {
      logger.log('[Whisper] Already recording — ignoring redundant start (no second session)');
      return;
    }

    if (!whisperService.isModelLoaded()) {
      logger.log('[Whisper] Model not loaded, trying to load...');
      // Try to load if we have a downloaded model
      if (downloadedModelId) {
        try {
          await loadModel();
        } catch {
          setError('Failed to load Whisper model. Please try again.');
          return;
        }
      } else {
        setError('No transcription model downloaded. Go to Settings to download one.');
        return;
      }
    }

    // Haptic feedback to indicate recording started
    Vibration.vibrate(50);

    try {
      isCancelled.current = false;
      setError(null);
      setPartialResult('');
      setFinalResult('');
      setIsRecording(true);
      setIsTranscribing(true);

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
          // Use finalizeTranscription to ensure minimum display time
          if (result.text && !isCancelled.current) {
            finalizeTranscription(result.text);
          } else if (mountedRef.current) {
            setIsTranscribing(false);
            setPartialResult('');
            transcribingStartTime.current = null;
          }
        }
      });
    } catch (err) {
      logger.error('[Whisper] Recording error:', err);
      // Force reset whisper service state
      whisperService.forceReset();
      if (mountedRef.current) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to start recording';
        setError(errorMsg);
        setIsRecording(false);
        setIsTranscribing(false);
        // Error haptic
        Vibration.vibrate([0, 50, 50, 50]);
      }
    }
  }, [downloadedModelId, loadModel, isRecording, stopRecording, finalizeTranscription]);

  return {
    isRecording,
    isModelLoaded: isModelLoaded || whisperService.isModelLoaded(),
    isModelLoading,
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
