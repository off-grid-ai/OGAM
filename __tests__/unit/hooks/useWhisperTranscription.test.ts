import { renderHook, act } from '@testing-library/react-native';
import { useWhisperTranscription } from '../../../src/hooks/useWhisperTranscription';

const mockLoadModel = jest.fn();
const mockWhisperStoreState = {
  downloadedModelId: null as string | null,
  isModelLoaded: false,
  isModelLoading: false,
  loadModel: mockLoadModel,
};

jest.mock('../../../src/services/whisperService', () => ({
  whisperService: {
    isModelLoaded: jest.fn(() => false),
    isCurrentlyTranscribing: jest.fn(() => false),
    startRealtimeTranscription: jest.fn(),
    stopTranscription: jest.fn(),
    forceReset: jest.fn(),
  },
  // Pure helper used by finalizeTranscription — strip whisper no-speech markers,
  // return '' when only markers/punctuation remain (mirrors the real impl).
  cleanTranscription: (raw: string) => {
    if (!raw) return '';
    const s = raw.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    return /[a-z0-9]/i.test(s) ? s : '';
  },
}));

jest.mock('../../../src/stores/whisperStore', () => ({
  useWhisperStore: jest.fn(() => mockWhisperStoreState),
}));

// Get mock reference after jest.mock hoisting
const { whisperService: mockWhisperService } = require('../../../src/services/whisperService');

jest.mock('react-native', () => ({
  Vibration: {
    vibrate: jest.fn(),
  },
}));

describe('useWhisperTranscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockWhisperService.isCurrentlyTranscribing.mockReturnValue(false);
    mockWhisperStoreState.downloadedModelId = null;
    mockWhisperStoreState.isModelLoaded = false;
    mockWhisperStoreState.isModelLoading = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useWhisperTranscription());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.isModelLoaded).toBe(false);
    expect(result.current.isModelLoading).toBe(false);
    expect(result.current.partialResult).toBe('');
    expect(result.current.finalResult).toBe('');
    expect(result.current.error).toBeNull();
    expect(result.current.recordingTime).toBe(0);
    expect(typeof result.current.startRecording).toBe('function');
    expect(typeof result.current.stopRecording).toBe('function');
    expect(typeof result.current.clearResult).toBe('function');
  });

  it('sets error when startRecording called with no model loaded and no downloadedModelId', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockWhisperStoreState.downloadedModelId = null;

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe(
      'No transcription model downloaded. Go to Settings to download one.',
    );
    expect(mockWhisperService.startRealtimeTranscription).not.toHaveBeenCalled();
  });

  it('calls loadModel when startRecording called with model not loaded but downloadedModelId exists', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockWhisperStoreState.downloadedModelId = 'whisper-tiny';
    mockLoadModel.mockResolvedValue(undefined);
    // After loadModel, model is still not loaded from service perspective
    // so startRealtimeTranscription won't be called unless we update the mock
    mockWhisperService.isModelLoaded
      .mockReturnValueOnce(false) // auto-load check
      .mockReturnValueOnce(false) // console.log check
      .mockReturnValueOnce(false); // the guard check in startRecording

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockLoadModel).toHaveBeenCalled();
  });

  it('sets error when loadModel fails during startRecording', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockWhisperStoreState.downloadedModelId = 'whisper-tiny';
    mockLoadModel.mockRejectedValue(new Error('Load failed'));

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe(
      'Failed to load Whisper model. Please try again.',
    );
  });

  it('calls startRealtimeTranscription and sets isRecording on success', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: true, text: 'partial', recordingTime: 1 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockWhisperService.startRealtimeTranscription).toHaveBeenCalled();
    expect(result.current.partialResult).toBe('partial');
    expect(result.current.recordingTime).toBe(1);
  });

  it('cleans whisper markers out of partial results (never shows "[BLANK_AUDIO]" in the UI)', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        // Mid-capture partial with a leading no-speech marker.
        callback({ isCapturing: true, text: '[BLANK_AUDIO] hello', recordingTime: 1 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    // Stripped through cleanTranscription (the single owner of marker stripping).
    expect(result.current.partialResult).toBe('hello');
  });

  it('does not let an empty cleaned partial clobber an existing good partial', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        // First a real partial, then a pure-marker partial (silence mid-capture):
        // the marker-only result cleans to '' and must NOT wipe the good text.
        callback({ isCapturing: true, text: 'hello world', recordingTime: 1 });
        callback({ isCapturing: true, text: '[BLANK_AUDIO]', recordingTime: 2 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.partialResult).toBe('hello world');
  });

  it('sets error and calls forceReset when startRecording throws', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.startRealtimeTranscription.mockRejectedValue(
      new Error('Mic access denied'),
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe('Mic access denied');
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isTranscribing).toBe(false);
    expect(mockWhisperService.forceReset).toHaveBeenCalled();
  });

  it('stopRecording sets isRecording false and calls stopTranscription after delay', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.stopTranscription.mockResolvedValue(undefined);

    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: true, text: 'hello', recordingTime: 2 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    // Start recording first
    await act(async () => {
      await result.current.startRecording();
    });

    // Stop recording
    let stopPromise: Promise<void>;
    act(() => {
      stopPromise = result.current.stopRecording();
    });

    // isRecording should be false immediately
    expect(result.current.isRecording).toBe(false);

    // Advance past the trailing record time (2500ms)
    await act(async () => {
      jest.advanceTimersByTime(2500);
      await stopPromise;
    });

    expect(mockWhisperService.stopTranscription).toHaveBeenCalled();
  });

  it('clearResult clears finalResult, partialResult, and isTranscribing', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: false, text: 'final text', recordingTime: 3 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    // Advance timers to resolve any pending finalizeTranscription timeouts
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    // Now clear
    act(() => {
      result.current.clearResult();
    });

    expect(result.current.finalResult).toBe('');
    expect(result.current.partialResult).toBe('');
    expect(result.current.isTranscribing).toBe(false);
  });

  it('auto-loads model when downloadedModelId exists and model not loaded', async () => {
    mockWhisperStoreState.downloadedModelId = 'whisper-base';
    mockWhisperStoreState.isModelLoaded = false;
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockLoadModel.mockResolvedValue(undefined);

    renderHook(() => useWhisperTranscription());

    // The useEffect runs asynchronously
    await act(async () => {
      // Let the effect run
    });

    expect(mockLoadModel).toHaveBeenCalled();
  });

  it('does not auto-load model when model is already loaded', async () => {
    mockWhisperStoreState.downloadedModelId = 'whisper-base';
    mockWhisperStoreState.isModelLoaded = true;
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    renderHook(() => useWhisperTranscription());

    await act(async () => {});

    expect(mockLoadModel).not.toHaveBeenCalled();
  });

  it('returns isModelLoaded true when store or service reports loaded', () => {
    mockWhisperStoreState.isModelLoaded = false;
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    const { result } = renderHook(() => useWhisperTranscription());

    expect(result.current.isModelLoaded).toBe(true);
  });

  // ========================================================================
  // startRecording: already-recording branch (lines 143-147)
  // ========================================================================
  it('stops current recording before starting a new one when isCurrentlyTranscribing is true', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    // First check in startRecording returns true (triggers stop), then false for subsequent checks
    mockWhisperService.isCurrentlyTranscribing
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    mockWhisperService.stopTranscription.mockResolvedValue(undefined);
    mockWhisperService.startRealtimeTranscription.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWhisperTranscription());

    // Start recording - it will internally call stopRecording() which has a 2500ms wait,
    // then startRecording waits 150ms after stop completes.
    let startPromise: Promise<void>;
    act(() => {
      startPromise = result.current.startRecording();
    });

    // Advance past stopRecording's TRAILING_RECORD_TIME (2500ms)
    await act(async () => {
      jest.advanceTimersByTime(2600);
    });

    // Advance past startRecording's 150ms debounce after stopRecording
    await act(async () => {
      jest.advanceTimersByTime(200);
      await startPromise!;
    });

    // stopTranscription called as part of stopping the previous session
    expect(mockWhisperService.stopTranscription).toHaveBeenCalled();
    // startRealtimeTranscription called for the new session
    expect(mockWhisperService.startRealtimeTranscription).toHaveBeenCalled();
  });

  // ========================================================================
  // transcription callback: no text path (lines 197-200)
  // ========================================================================
  it('clears isTranscribing when recording finishes with no text result', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    // Simulate callback: capturing=false, no text
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: false, text: null, recordingTime: 0 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.partialResult).toBe('');
    expect(result.current.finalResult).toBe('');
  });

  it('clears isTranscribing when recording finishes with empty string text', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);

    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: false, text: '', recordingTime: 0 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isTranscribing).toBe(false);
    expect(result.current.finalResult).toBe('');
  });

  // ========================================================================
  // clearResult: calls stopTranscription when currently transcribing (line 132-134)
  // ========================================================================
  it('calls stopTranscription in clearResult when isCurrentlyTranscribing is true', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.isCurrentlyTranscribing.mockReturnValue(true);
    mockWhisperService.stopTranscription.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWhisperTranscription());

    act(() => {
      result.current.clearResult();
    });

    expect(mockWhisperService.stopTranscription).toHaveBeenCalled();
  });

  it('does not call stopTranscription in clearResult when not transcribing', async () => {
    mockWhisperService.isCurrentlyTranscribing.mockReturnValue(false);

    const { result } = renderHook(() => useWhisperTranscription());

    act(() => {
      result.current.clearResult();
    });

    expect(mockWhisperService.stopTranscription).not.toHaveBeenCalled();
  });

  // ========================================================================
  // stopRecording: cancelled during trailing capture (lines 104-108)
  // ========================================================================
  it('aborts stopRecording early and calls forceReset when cancelled during trailing capture', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.stopTranscription.mockResolvedValue(undefined);
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: true, text: 'partial', recordingTime: 1 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    // Start stopping (triggers 2500ms trailing wait)
    let stopPromise: Promise<void>;
    act(() => {
      stopPromise = result.current.stopRecording();
    });

    // Cancel during the trailing wait (before 2500ms)
    act(() => {
      result.current.clearResult(); // sets isCancelled.current = true
    });

    // Advance past trailing time
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await stopPromise!;
    });

    // forceReset is called because cancelled during trailing capture
    expect(mockWhisperService.forceReset).toHaveBeenCalled();
    // stopTranscription should NOT be called (returned early)
    expect(mockWhisperService.stopTranscription).not.toHaveBeenCalled();
  });

  // ========================================================================
  // stopRecording: error path (lines 114-121)
  // ========================================================================
  it('calls forceReset and clears transcribing state when stopTranscription throws', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.stopTranscription.mockRejectedValue(new Error('Stop failed'));
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        callback({ isCapturing: true, text: 'partial', recordingTime: 1 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      const stopPromise = result.current.stopRecording();
      jest.advanceTimersByTime(3000);
      await stopPromise;
    });

    expect(mockWhisperService.forceReset).toHaveBeenCalled();
    expect(result.current.isTranscribing).toBe(false);
  });

  // ========================================================================
  // finalizeTranscription: cancelled branch inside deferred timeout (lines 68-71)
  // When transcribingStartTime is set and remaining > 0, a deferred setTimeout
  // is created. If cancelled before it fires, isTranscribing is cleared.
  // ========================================================================
  it('does not set finalResult when cancelled before deferred finalizeTranscription fires', async () => {
    mockWhisperService.isModelLoaded.mockReturnValue(true);
    mockWhisperService.stopTranscription.mockResolvedValue(undefined);

    // Provide a callback that fires after stop (simulating real Whisper behaviour)
    // We set transcribingStartTime via stopRecording(), then trigger the callback
    let capturedCallback: ((result: any) => void) | null = null;
    mockWhisperService.startRealtimeTranscription.mockImplementation(
      async (callback: any) => {
        capturedCallback = callback;
        // Emit a partial result so we're "recording"
        callback({ isCapturing: true, text: 'partial', recordingTime: 1 });
      },
    );

    const { result } = renderHook(() => useWhisperTranscription());

    await act(async () => {
      await result.current.startRecording();
    });

    // Begin stopping - this sets transcribingStartTime.current = Date.now()
    let stopPromise: Promise<void>;
    act(() => {
      stopPromise = result.current.stopRecording();
    });

    // Fire the final callback BEFORE the 2500ms trailing wait ends
    // transcribingStartTime was just set, so elapsed ≈ 0 → remaining ≈ 600ms
    act(() => {
      capturedCallback!({ isCapturing: false, text: 'hello world', recordingTime: 5 });
    });

    // Now cancel (sets isCancelled = true) while the deferred timer is pending
    act(() => {
      result.current.clearResult();
    });

    // Advance past trailing wait and the deferred MIN_TRANSCRIBING_TIME timer
    await act(async () => {
      jest.advanceTimersByTime(3200);
      await stopPromise!;
    });

    // clearResult cleared the result; the deferred timer should NOT override it
    expect(result.current.finalResult).toBe('');
    expect(result.current.isTranscribing).toBe(false);
  });

  // ========================================================================
  // auto-load: error is swallowed gracefully (lines 41-43)
  // ========================================================================
  it('swallows auto-load error and does not propagate', async () => {
    mockWhisperStoreState.downloadedModelId = 'whisper-base';
    mockWhisperStoreState.isModelLoaded = false;
    mockWhisperService.isModelLoaded.mockReturnValue(false);
    mockLoadModel.mockRejectedValue(new Error('Network error'));

    let thrownError: unknown;
    try {
      const { unmount } = renderHook(() => useWhisperTranscription());
      await act(async () => {});
      unmount();
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeUndefined();
  });
});
