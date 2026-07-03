/**
 * Unit tests for AudioSessionManager — the single owner of the iOS AVAudioSession.
 * Guards the mode state machine (playback / record / restore) and the iOS-only +
 * idempotence behaviour, so the silent-playback regressions can't come back.
 */
import { Platform } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import { audioSessionManager } from '../../../src/services/audioSessionManager';

const setOptions = AudioManager.setAudioSessionOptions as jest.Mock;
const setActivity = AudioManager.setAudioSessionActivity as jest.Mock;

const originalOS = Platform.OS;

const categoryOfLastCall = (): string | undefined =>
  setOptions.mock.calls.at(-1)?.[0]?.iosCategory;

describe('AudioSessionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audioSessionManager._reset();
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('iOS', () => {
    beforeEach(() => { Platform.OS = 'ios'; });

    it('ensurePlayback activates a playback-category session', async () => {
      await audioSessionManager.ensurePlayback();
      expect(categoryOfLastCall()).toBe('playback');
      expect(setActivity).toHaveBeenCalledWith(true);
      expect(audioSessionManager.getMode()).toBe('playback');
    });

    it('ensurePlayback re-asserts activation on every call (iOS can drop it)', async () => {
      await audioSessionManager.ensurePlayback();
      setActivity.mockClear();
      await audioSessionManager.ensurePlayback();
      // Must re-activate, not skip — TTS went silent when this was idempotent.
      expect(setActivity).toHaveBeenCalledWith(true);
    });

    it('ensureRecording activates a playAndRecord session', async () => {
      await audioSessionManager.ensureRecording();
      expect(categoryOfLastCall()).toBe('playAndRecord');
      expect(audioSessionManager.getMode()).toBe('record');
    });

    it('ensurePlayback does NOT downgrade an active recording session', async () => {
      await audioSessionManager.ensureRecording();
      setOptions.mockClear();
      await audioSessionManager.ensurePlayback();
      expect(setOptions).not.toHaveBeenCalled(); // playAndRecord already permits playback
      expect(audioSessionManager.getMode()).toBe('record');
    });

    it('restorePlaybackAfterRecording switches a record session back to playback', async () => {
      await audioSessionManager.ensureRecording();
      await audioSessionManager.restorePlaybackAfterRecording();
      expect(categoryOfLastCall()).toBe('playback');
      expect(audioSessionManager.getMode()).toBe('playback');
    });

    it('restorePlaybackAfterRecording is a no-op when not recording', async () => {
      await audioSessionManager.ensurePlayback();
      setOptions.mockClear();
      await audioSessionManager.restorePlaybackAfterRecording();
      expect(setOptions).not.toHaveBeenCalled();
      expect(audioSessionManager.getMode()).toBe('playback');
    });

    it('ensureRecordingPermission activates a playAndRecord session, sets mode, returns true', async () => {
      setActivity.mockResolvedValueOnce(true);
      const granted = await audioSessionManager.ensureRecordingPermission();
      // Routes the realtime-STT permission/session setup through the owner so a
      // later ensurePlayback() sees an accurate mode (was: direct AudioSessionIos
      // left mode stale → silent TTS after STT).
      expect(granted).toBe(true);
      expect(categoryOfLastCall()).toBe('playAndRecord');
      expect(setActivity).toHaveBeenCalledWith(true);
      expect(audioSessionManager.getMode()).toBe('record');
    });

    it('ensureRecordingPermission returns false and leaves mode null when activation throws (mic denied)', async () => {
      setActivity.mockRejectedValueOnce(new Error('Microphone permission denied'));
      const granted = await audioSessionManager.ensureRecordingPermission();
      expect(granted).toBe(false);
      // A throw is how iOS surfaces a denied mic permission; mode must not advance.
      expect(audioSessionManager.getMode()).toBeNull();
    });

    it('serializes concurrent record + playback so the last call wins deterministically (no stale-mode race)', async () => {
      // Fire recording then playback without awaiting between them. With the check-then-act
      // race, both read the old mode and apply concurrently — the final category depended on
      // which setAudioSessionActivity resolved last. Serialized, they run in call order.
      const order: string[] = [];
      setOptions.mockImplementation((opts: any) => { order.push(opts.iosCategory); });

      const p1 = audioSessionManager.ensureRecording();
      const p2 = audioSessionManager.ensurePlayback();
      await Promise.all([p1, p2]);

      // ensureRecording applied first (playAndRecord); ensurePlayback then saw mode==='record'
      // and correctly skipped the downgrade — so record is the final, deterministic mode.
      expect(order).toEqual(['playAndRecord']);
      expect(audioSessionManager.getMode()).toBe('record');
    });
  });

  describe('Android', () => {
    beforeEach(() => { Platform.OS = 'android'; });

    it('every method is a no-op (no session API touched, mode stays null)', async () => {
      await audioSessionManager.ensurePlayback();
      await audioSessionManager.ensureRecording();
      await audioSessionManager.restorePlaybackAfterRecording();
      expect(setOptions).not.toHaveBeenCalled();
      expect(setActivity).not.toHaveBeenCalled();
      expect(audioSessionManager.getMode()).toBeNull();
    });

    it('ensureRecordingPermission is a no-op that returns true (Android handles mic via PermissionsAndroid)', async () => {
      const granted = await audioSessionManager.ensureRecordingPermission();
      expect(granted).toBe(true);
      expect(setOptions).not.toHaveBeenCalled();
      expect(audioSessionManager.getMode()).toBeNull();
    });
  });
});
