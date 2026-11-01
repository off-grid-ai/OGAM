/**
 * useVoiceRecording Hook Unit Tests
 *
 * The hook and voiceService run for real. Only the device is faked: the OS speech recognizer
 * (@react-native-voice/voice, faked in jest.setup; the test fires its speech events the way the OS
 * does) and the Android microphone permission dialog.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Platform, PermissionsAndroid } from 'react-native';
import { useVoiceRecording } from '../../../src/hooks/useVoiceRecording';

type Recognizer = {
  start: jest.Mock; stop: jest.Mock; cancel: jest.Mock; destroy: jest.Mock;
  isAvailable: jest.Mock; getSpeechRecognitionServices: jest.Mock;
  onSpeechStart: ((e: object) => void) | null;
  onSpeechEnd: ((e: object) => void) | null;
  onSpeechResults: ((e: { value?: string[] }) => void) | null;
  onSpeechPartialResults: ((e: { value?: string[] }) => void) | null;
  onSpeechError: ((e: { error?: { message?: string } }) => void) | null;
};
const recognizer = require('@react-native-voice/voice') as Recognizer;

/** The OS recognizer's events, as it fires them. */
const os = {
  started: () => act(() => { recognizer.onSpeechStart?.({}); }),
  ended: () => act(() => { recognizer.onSpeechEnd?.({}); }),
  heard: (value: string[]) => act(() => { recognizer.onSpeechResults?.({ value }); }),
  heardSoFar: (value: string[]) => act(() => { recognizer.onSpeechPartialResults?.({ value }); }),
  failed: (message: string) => act(() => { recognizer.onSpeechError?.({ error: { message } }); }),
};

const setPlatform = (value: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { configurable: true, value });

async function mount() {
  const view = renderHook(() => useVoiceRecording());
  await act(async () => {});
  return view;
}

describe('useVoiceRecording', () => {
  beforeEach(() => {
    setPlatform('ios');
    recognizer.start.mockReset().mockResolvedValue(undefined);
    recognizer.stop.mockReset().mockResolvedValue(undefined);
    recognizer.cancel = jest.fn().mockResolvedValue(undefined);
    recognizer.destroy.mockReset().mockResolvedValue(undefined);
    recognizer.isAvailable.mockReset().mockResolvedValue(true);
    recognizer.getSpeechRecognitionServices = jest.fn().mockResolvedValue([]);
  });

  // ========================================================================
  // Initial state
  // ========================================================================
  it('returns correct initial state', () => {
    const { result } = renderHook(() => useVoiceRecording());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.partialResult).toBe('');
    expect(result.current.finalResult).toBe('');
    expect(result.current.error).toBeNull();
  });

  // ========================================================================
  // Initialization
  // ========================================================================
  describe('initialization', () => {
    it('is available when the recognizer is present (iOS needs no runtime prompt)', async () => {
      const { result } = await mount();
      expect(result.current.isAvailable).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('asks for the microphone on Android and is available when granted', async () => {
      setPlatform('android');
      const asked: string[] = [];
      PermissionsAndroid.request = (async (permission: string) => {
        asked.push(permission);
        return PermissionsAndroid.RESULTS.GRANTED;
      }) as typeof PermissionsAndroid.request;

      const { result } = await mount();

      expect(asked).toEqual([PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]);
      expect(result.current.isAvailable).toBe(true);
    });

    it('sets isAvailable to false and error when permissions denied', async () => {
      setPlatform('android');
      PermissionsAndroid.request = (async () => PermissionsAndroid.RESULTS.DENIED) as typeof PermissionsAndroid.request;

      const { result } = await mount();

      expect(result.current.isAvailable).toBe(false);
      expect(result.current.error).toBe('Microphone permission denied');
    });

    it('sets error when the device has no speech recognizer', async () => {
      recognizer.isAvailable.mockResolvedValue(false);

      const { result } = await mount();

      expect(result.current.isAvailable).toBe(false);
      expect(result.current.error).toBe(
        'Voice recognition not available on this device. Check if Google app is installed.',
      );
    });

    it('releases the recognizer on unmount', async () => {
      const { unmount } = await mount();
      expect(recognizer.destroy).not.toHaveBeenCalled();

      unmount();

      expect(recognizer.destroy).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // Speech events
  // ========================================================================
  describe('speech events', () => {
    it('speech start sets isRecording to true and clears error; speech end sets it false', async () => {
      const { result } = await mount();
      await os.failed('earlier');

      await os.started();
      expect(result.current.isRecording).toBe(true);
      expect(result.current.error).toBeNull();

      await os.ended();
      expect(result.current.isRecording).toBe(false);
    });

    it('final results set finalResult (the best guess) and clear partialResult', async () => {
      const { result } = await mount();
      await os.heardSoFar(['hel']);
      expect(result.current.partialResult).toBe('hel');

      await os.heard(['hello world', 'hello']);

      expect(result.current.finalResult).toBe('hello world');
      expect(result.current.partialResult).toBe('');
    });

    it('ignores empty results', async () => {
      const { result } = await mount();

      await os.heard([]);
      await os.heardSoFar([]);

      expect(result.current.finalResult).toBe('');
      expect(result.current.partialResult).toBe('');
    });

    it('an error sets error and stops recording', async () => {
      const { result } = await mount();
      await os.started();

      await os.failed('Network timeout');

      expect(result.current.error).toBe('Network timeout');
      expect(result.current.isRecording).toBe(false);
    });
  });

  // ========================================================================
  // startRecording / stopRecording / cancelRecording
  // ========================================================================
  describe('startRecording', () => {
    it('starts the recognizer in US English and clears an earlier error', async () => {
      const { result } = await mount();
      await os.failed('previous error');

      await act(async () => { await result.current.startRecording(); });

      expect(recognizer.start).toHaveBeenCalledWith('en-US');
      expect(result.current.error).toBeNull();
    });

    it('sets error when the recognizer refuses to start', async () => {
      recognizer.start.mockRejectedValue(new Error('Mic busy'));
      const { result } = await mount();

      await act(async () => { await result.current.startRecording(); });

      expect(result.current.error).toBe('Failed to start recording');
      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('stopRecording', () => {
    it('stops the recognizer, and the final result still arrives', async () => {
      const { result } = await mount();
      await act(async () => { await result.current.startRecording(); });

      await act(async () => { await result.current.stopRecording(); });
      await os.heard(['done']);

      expect(recognizer.stop).toHaveBeenCalledTimes(1);
      expect(result.current.finalResult).toBe('done');
    });

    it('sets error when the recognizer refuses to stop', async () => {
      recognizer.stop.mockRejectedValue(new Error('Stop failed'));
      const { result } = await mount();

      await act(async () => { await result.current.stopRecording(); });

      expect(result.current.error).toBe('Failed to stop recording');
    });
  });

  describe('cancelRecording', () => {
    it('cancels the recognizer, clears what was heard and ignores results that arrive late', async () => {
      const { result } = await mount();
      await os.started();
      await os.heardSoFar(['partial']);
      expect(result.current.partialResult).toBe('partial');

      await act(async () => { await result.current.cancelRecording(); });
      await os.heard(['late result']);

      expect(recognizer.cancel).toHaveBeenCalledTimes(1);
      expect(result.current.isRecording).toBe(false);
      expect(result.current.partialResult).toBe('');
      expect(result.current.finalResult).toBe('');
    });

    it('sets error when the recognizer refuses to cancel', async () => {
      recognizer.cancel.mockRejectedValue(new Error('Cancel failed'));
      const { result } = await mount();

      await act(async () => { await result.current.cancelRecording(); });

      expect(result.current.error).toBe('Failed to cancel recording');
    });

    it('a new recording after a cancel accepts results again', async () => {
      const { result } = await mount();
      await act(async () => { await result.current.cancelRecording(); });

      await act(async () => { await result.current.startRecording(); });
      await os.heard(['new result']);

      expect(result.current.finalResult).toBe('new result');
    });
  });

  describe('clearResult', () => {
    it('clears finalResult and partialResult', async () => {
      const { result } = await mount();
      await os.heard(['some result']);
      await os.heardSoFar(['partial']);

      act(() => { result.current.clearResult(); });

      expect(result.current.finalResult).toBe('');
      expect(result.current.partialResult).toBe('');
    });
  });
});
