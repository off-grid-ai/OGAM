import { useState, useEffect, useCallback, useRef } from 'react';
import { voiceService } from '../services/voiceService';
import logger from '../utils/logger';

export interface UseVoiceRecordingResult {
  isRecording: boolean;
  isAvailable: boolean;
  partialResult: string;
  finalResult: string;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  clearResult: () => void;
}

export const useVoiceRecording = (): UseVoiceRecordingResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [partialResult, setPartialResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCancelled = useRef(false);

  const onStartRef = useRef(() => {
    setIsRecording(true);
    setError(null);
  });
  const onEndRef = useRef(() => {
    setIsRecording(false);
  });
  const onResultsRef = useRef((results: string[]) => {
    if (!isCancelled.current && results.length > 0) {
      setFinalResult(results[0]);
      setPartialResult('');
    }
  });
  const onPartialResultsRef = useRef((results: string[]) => {
    if (!isCancelled.current && results.length > 0) {
      setPartialResult(results[0]);
    }
  });
  const onErrorRef = useRef((errorMsg: string) => {
    setError(errorMsg);
    setIsRecording(false);
  });

  useEffect(() => {
    const initVoice = async () => {
      logger.log('[Voice] Starting initialization...');

      const hasPermission = await voiceService.requestPermissions();
      logger.log('[Voice] Permission granted:', hasPermission);

      if (hasPermission) {
        const initialized = await voiceService.initialize();
        logger.log('[Voice] Initialized:', initialized);
        setIsAvailable(initialized);

        if (!initialized) {
          setError('Voice recognition not available on this device. Check if Google app is installed.');
        }
      } else {
        logger.log('[Voice] Permission denied');
        setIsAvailable(false);
        setError('Microphone permission denied');
      }
    };

    initVoice();

    voiceService.setCallbacks({
      onStart: () => onStartRef.current(),
      onEnd: () => onEndRef.current(),
      onResults: (results) => onResultsRef.current(results),
      onPartialResults: (results) => onPartialResultsRef.current(results),
      onError: (errorMsg) => onErrorRef.current(errorMsg),
    });

    return () => {
      voiceService.setCallbacks({});
      voiceService.destroy();
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      isCancelled.current = false;
      setError(null);
      setPartialResult('');
      setFinalResult('');
      await voiceService.startListening();
    } catch {
      setError('Failed to start recording');
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      await voiceService.stopListening();
    } catch {
      setError('Failed to stop recording');
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    try {
      isCancelled.current = true;
      setPartialResult('');
      setFinalResult('');
      await voiceService.cancelListening();
      setIsRecording(false);
    } catch {
      setError('Failed to cancel recording');
    }
  }, []);

  const clearResult = useCallback(() => {
    setFinalResult('');
    setPartialResult('');
  }, []);

  return {
    isRecording,
    isAvailable,
    partialResult,
    finalResult,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    clearResult,
  };
};
