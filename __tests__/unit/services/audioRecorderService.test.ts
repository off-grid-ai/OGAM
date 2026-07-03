/**
 * AudioRecorderService Unit Tests
 *
 * Wraps react-native-audio-api's AudioRecorder for 16kHz mono WAV capture used
 * as direct audio input to whisper.rn / llama.rn. Covers permission gating
 * (Android grant/deny/throw vs iOS passthrough), iOS audio-session activation,
 * the re-entrant start guard, native start()/stop() error branches, and the
 * cancel/idle guards.
 */

import { Platform, PermissionsAndroid } from 'react-native';

// Local mock of the native audio module so we can drive every branch.
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockEnableFileOutput = jest.fn();
const mockSetAudioSessionOptions = jest.fn();
const mockSetAudioSessionActivity = jest.fn();

jest.mock(
  'react-native-audio-api',
  () => ({
    AudioRecorder: jest.fn().mockImplementation(() => ({
      enableFileOutput: mockEnableFileOutput,
      start: mockStart,
      stop: mockStop,
    })),
    AudioManager: {
      setAudioSessionOptions: (...args: unknown[]) => mockSetAudioSessionOptions(...args),
      setAudioSessionActivity: (...args: unknown[]) => mockSetAudioSessionActivity(...args),
    },
    FileFormat: { Wav: 0 },
    FileDirectory: { Document: 0 },
    BitDepth: { Bit16: 16 },
    IOSAudioQuality: { High: 2 },
    FlacCompressionLevel: { L5: 5 },
  }),
  { virtual: true },
);

const { audioRecorderService } = require('../../../src/services/audioRecorderService');
// The recorder now routes the AVAudioSession through audioSessionManager (single
// owner). Reset its mode between tests so a prior test's session state doesn't make
// a later ensureRecording() a no-op.
const { audioSessionManager } = require('../../../src/services/audioSessionManager');

const originalPlatformOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = originalPlatformOS;
  // Reset singleton internal state between tests.
  (audioRecorderService as any).isRecording = false;
  (audioRecorderService as any).recorder = null;
  audioSessionManager._reset();
  // Default happy-path native results.
  mockStart.mockReturnValue({ status: 'success' });
  mockStop.mockReturnValue({ status: 'success', path: '/mock/input.wav', duration: 2.5 });
  mockSetAudioSessionActivity.mockResolvedValue(undefined);
});

afterAll(() => {
  Platform.OS = originalPlatformOS;
});

describe('static capability getters', () => {
  it('supportsDirectAudioInput returns true', () => {
    expect(audioRecorderService.supportsDirectAudioInput()).toBe(true);
  });

  it('getFormat returns wav', () => {
    expect(audioRecorderService.getFormat()).toBe('wav');
  });
});

describe('requestPermissions', () => {
  it('returns true on Android when RECORD_AUDIO is granted', async () => {
    Platform.OS = 'android';
    const spy = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

    await expect(audioRecorderService.requestPermissions()).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      expect.objectContaining({ buttonPositive: 'OK', buttonNegative: 'Cancel' }),
    );
  });

  it('returns false on Android when permission is denied', async () => {
    Platform.OS = 'android';
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

    await expect(audioRecorderService.requestPermissions()).resolves.toBe(false);
  });

  it('returns false on Android when the request throws (catch branch)', async () => {
    Platform.OS = 'android';
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockRejectedValue(new Error('boom'));

    await expect(audioRecorderService.requestPermissions()).resolves.toBe(false);
  });

  it('returns true on iOS without touching PermissionsAndroid', async () => {
    Platform.OS = 'ios';
    const spy = jest.spyOn(PermissionsAndroid, 'request');

    await expect(audioRecorderService.requestPermissions()).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('startRecording', () => {
  it('throws when permission is denied and does not arm the recorder', async () => {
    Platform.OS = 'android';
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

    await expect(audioRecorderService.startRecording()).rejects.toThrow(
      'Microphone permission denied',
    );
    expect(mockStart).not.toHaveBeenCalled();
    expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
  });

  it('configures and activates the iOS audio session before starting', async () => {
    Platform.OS = 'ios';

    await audioRecorderService.startRecording();

    expect(mockSetAudioSessionOptions).toHaveBeenCalledWith(
      expect.objectContaining({ iosCategory: 'playAndRecord' }),
    );
    expect(mockSetAudioSessionActivity).toHaveBeenCalledWith(true);
    expect(mockEnableFileOutput).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(audioRecorderService.isCurrentlyRecording()).toBe(true);
  });

  it('switches to playAndRecord and activates the session before starting capture', async () => {
    Platform.OS = 'ios';

    await audioRecorderService.startRecording();

    // The session must be switched to playAndRecord AND activated before the
    // recorder starts.
    const optionsOrder = mockSetAudioSessionOptions.mock.invocationCallOrder[0];
    const activityOrder = mockSetAudioSessionActivity.mock.invocationCallOrder[0];
    const startOrder = mockStart.mock.invocationCallOrder[0];
    expect(optionsOrder).toBeLessThan(activityOrder);
    expect(activityOrder).toBeLessThan(startOrder);
  });

  it('does not configure the audio session on Android', async () => {
    Platform.OS = 'android';
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

    await audioRecorderService.startRecording();

    expect(mockSetAudioSessionOptions).not.toHaveBeenCalled();
    expect(mockSetAudioSessionActivity).not.toHaveBeenCalled();
    expect(audioRecorderService.isCurrentlyRecording()).toBe(true);
  });

  it('stops a prior in-flight recording before starting again (re-entrant guard)', async () => {
    Platform.OS = 'ios';
    // Arm a fake in-flight recording.
    (audioRecorderService as any).isRecording = true;
    (audioRecorderService as any).recorder = { stop: mockStop };

    await audioRecorderService.startRecording();

    // The pre-existing recorder was stopped, then a fresh one started.
    expect(mockStop).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(audioRecorderService.isCurrentlyRecording()).toBe(true);
  });

  it('swallows errors from stopping a prior recording (.catch branch)', async () => {
    Platform.OS = 'ios';
    (audioRecorderService as any).isRecording = true;
    // stop() throws synchronously -> stopRecording rejects -> .catch swallows it.
    (audioRecorderService as any).recorder = {
      stop: jest.fn(() => {
        throw new Error('stop failed');
      }),
    };

    await expect(audioRecorderService.startRecording()).resolves.toBeUndefined();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('throws and resets state when native start reports a non-success status', async () => {
    Platform.OS = 'ios';
    mockStart.mockReturnValue({ status: 'error', errorMessage: 'session not active' });

    await expect(audioRecorderService.startRecording()).rejects.toThrow(
      'Recording failed to start: session not active',
    );
    expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
    expect((audioRecorderService as any).recorder).toBeNull();
  });

  it('falls back through errorMessage ?? error ?? status when building the failure message', async () => {
    Platform.OS = 'ios';
    mockStart.mockReturnValue({ status: 'denied' });

    await expect(audioRecorderService.startRecording()).rejects.toThrow(
      'Recording failed to start: denied',
    );
  });

  it('treats a falsy/empty native start result as success', async () => {
    Platform.OS = 'ios';
    mockStart.mockReturnValue(undefined);

    await expect(audioRecorderService.startRecording()).resolves.toBeUndefined();
    expect(audioRecorderService.isCurrentlyRecording()).toBe(true);
  });
});

describe('stopRecording', () => {
  it('throws when there is no active recording', async () => {
    await expect(audioRecorderService.stopRecording()).rejects.toThrow(
      'No active recording',
    );
  });

  it('returns path and duration on success', async () => {
    Platform.OS = 'ios';
    await audioRecorderService.startRecording();

    await expect(audioRecorderService.stopRecording()).resolves.toEqual({
      path: '/mock/input.wav',
      durationSeconds: 2.5,
    });
    expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
  });

  it('defaults durationSeconds to 0 when native omits it (?? fallback)', async () => {
    Platform.OS = 'ios';
    await audioRecorderService.startRecording();
    mockStop.mockReturnValue({ status: 'success', path: '/mock/input.wav' });

    await expect(audioRecorderService.stopRecording()).resolves.toEqual({
      path: '/mock/input.wav',
      durationSeconds: 0,
    });
  });

  it('throws when native stop reports a non-success status', async () => {
    Platform.OS = 'ios';
    await audioRecorderService.startRecording();
    mockStop.mockReturnValue({ status: 'error' });

    await expect(audioRecorderService.stopRecording()).rejects.toThrow(
      'Recording failed to save',
    );
    // State is still reset even on the save-failure path.
    expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
  });
});

describe('cancelRecording', () => {
  it('is a no-op when not recording', () => {
    audioRecorderService.cancelRecording();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('stops the active recorder and clears state', async () => {
    Platform.OS = 'ios';
    await audioRecorderService.startRecording();
    expect(audioRecorderService.isCurrentlyRecording()).toBe(true);

    audioRecorderService.cancelRecording();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
  });
});
