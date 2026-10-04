/**
 * WhisperService Unit Tests
 *
 * Tests for Whisper speech-to-text service.
 * Priority: P1 - Voice input support.
 */

import { initWhisper } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import {
  whisperService,
} from '../../../src/services/whisperService';
import { audioSessionManager } from '../../../src/services/audioSessionManager';
import { audioRecorderService } from '../../../src/services/audioRecorderService';
import { AudioManager } from 'react-native-audio-api';

// The realtime permission path drives audioSessionManager, which calls these.
const mockSetAudioSessionOptions =
  AudioManager.setAudioSessionOptions as jest.Mock;
const mockSetAudioSessionActivity =
  AudioManager.setAudioSessionActivity as jest.Mock;

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedInitWhisper = initWhisper as jest.MockedFunction<
  typeof initWhisper
>;

const mockModelFilesSize = (size: number) => {
  mockedRNFS.readDir.mockImplementation(async (directory: string) =>
    ['model.bin', 'model1.bin', 'model2.bin', 'ggml-tiny.en.bin'].map(name => ({
      name,
      path: `${directory}/${name}`,
      size,
      isFile: () => true,
      isDirectory: () => false,
      mtime: new Date(),
    })) as any,
  );
};

/** Mock the native filesystem boundary to report a valid model file. */
const mockValidModelFile = () => {
  mockedRNFS.exists.mockResolvedValue(true);
  mockModelFilesSize(75 * 1024 * 1024);
};

describe('WhisperService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockedRNFS.exists.mockReset();
    mockedRNFS.readDir.mockReset();
    mockedRNFS.unlink.mockReset();
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.unlink.mockResolvedValue(undefined as any);
    // Reset singleton state
    (whisperService as any).context = null;
    (whisperService as any).currentModelPath = null;
    (whisperService as any).isTranscribing = false;
    (whisperService as any).stopFn = null;
    (whisperService as any).isReleasingContext = false;
    (whisperService as any).transcriptionFullyStopped = Promise.resolve();
    mockedRNFS.readDir.mockResolvedValue([]);
    // Reset the audio-session owner's mode between tests (the realtime permission
    // path now drives it instead of AudioSessionIos directly). clearMocks wipes
    // the activity mock's resolved value, so re-establish the default (success).
    audioSessionManager._reset();
    mockSetAudioSessionActivity.mockResolvedValue(true);
  });

  // ========================================================================
  // getModelsDir / getModelPath
  // ========================================================================
  describe('getModelsDir', () => {
    it('returns path under DocumentDirectoryPath', () => {
      expect(whisperService.getModelsDir()).toBe(
        '/mock/documents/whisper-models',
      );
    });
  });

  describe('getModelPath', () => {
    it('returns correct path for a model ID', () => {
      expect(whisperService.getModelPath('tiny.en')).toBe(
        '/mock/documents/whisper-models/ggml-tiny.en.bin',
      );
    });
  });

  // ========================================================================
  // isModelDownloaded
  // ========================================================================
  describe('isModelDownloaded', () => {
    it('returns true when file exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      expect(await whisperService.isModelDownloaded('tiny.en')).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      expect(await whisperService.isModelDownloaded('tiny.en')).toBe(false);
    });
  });

  // ========================================================================
  // validateModelFile
  // ========================================================================
  describe('validateModelFile', () => {
    it('throws when path is empty', async () => {
      await expect(whisperService.validateModelFile('')).rejects.toThrow(
        'empty or undefined',
      );
    });

    it('throws when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(
        whisperService.validateModelFile('/missing/model.bin'),
      ).rejects.toThrow('not found');
    });

    it('throws and deletes file when file is too small (corrupted)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockModelFilesSize(1000);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(
        whisperService.validateModelFile('/path/model.bin'),
      ).rejects.toThrow('too small');
      expect(RNFS.unlink).toHaveBeenCalledWith('/path/model.bin');
    });

    it('passes for valid file with sufficient size', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockModelFilesSize(75 * 1024 * 1024);

      await expect(
        whisperService.validateModelFile('/path/model.bin'),
      ).resolves.toBeUndefined();
    });
  });

  // ========================================================================
  // loadModel
  // ========================================================================
  describe('loadModel', () => {
    it('calls initWhisper with file path', async () => {
      mockValidModelFile();
      const mockContext = {
        id: 'test-whisper',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValue(mockContext as any);

      await whisperService.loadModel('/path/to/model.bin');

      expect(initWhisper).toHaveBeenCalledWith({
        filePath: '/path/to/model.bin',
      });
      expect(whisperService.isModelLoaded()).toBe(true);
      expect(whisperService.getLoadedModelPath()).toBe('/path/to/model.bin');
    });

    it('unloads different model before loading new one', async () => {
      mockValidModelFile();
      const mockContext1 = {
        id: 'ctx1',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      const mockContext2 = {
        id: 'ctx2',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };

      mockedInitWhisper.mockResolvedValueOnce(mockContext1 as any);
      await whisperService.loadModel('/path/model1.bin');

      mockedInitWhisper.mockResolvedValueOnce(mockContext2 as any);
      await whisperService.loadModel('/path/model2.bin');

      expect(mockContext1.release).toHaveBeenCalled();
      expect(whisperService.getLoadedModelPath()).toBe('/path/model2.bin');
    });

    it('skips loading if same model already loaded', async () => {
      mockValidModelFile();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);

      await whisperService.loadModel('/path/model.bin');
      await whisperService.loadModel('/path/model.bin');

      expect(initWhisper).toHaveBeenCalledTimes(1);
    });

    it('throws on initWhisper failure and clears context', async () => {
      mockValidModelFile();
      mockedInitWhisper.mockRejectedValue(new Error('Load failed'));

      await expect(whisperService.loadModel('/bad/model.bin')).rejects.toThrow(
        'Load failed',
      );
      expect(whisperService.isModelLoaded()).toBe(false);
      expect(whisperService.getLoadedModelPath()).toBeNull();
    });

    it('throws when model file is missing (prevents native crash)', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(
        whisperService.loadModel('/missing/model.bin'),
      ).rejects.toThrow('not found');
      expect(initWhisper).not.toHaveBeenCalled();
    });

    it('throws when model file is corrupted/too small (prevents native crash)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockModelFilesSize(500);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(
        whisperService.loadModel('/corrupted/model.bin'),
      ).rejects.toThrow('too small');
      expect(initWhisper).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // unloadModel
  // ========================================================================
  describe('unloadModel', () => {
    it('releases context and clears state', async () => {
      mockValidModelFile();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      await whisperService.unloadModel();

      expect(mockContext.release).toHaveBeenCalled();
      expect(whisperService.isModelLoaded()).toBe(false);
      expect(whisperService.getLoadedModelPath()).toBeNull();
    });

    it('does nothing when no model loaded', async () => {
      await whisperService.unloadModel(); // Should not throw
      expect(whisperService.isModelLoaded()).toBe(false);
    });
  });

  // ========================================================================
  // requestPermissions
  // ========================================================================
  describe('requestPermissions', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    describe('Android', () => {
      beforeEach(() => {
        Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      });

      it('returns true when granted', async () => {
        jest
          .spyOn(PermissionsAndroid, 'request')
          .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

        expect(await whisperService.requestPermissions()).toBe(true);
      });

      it('returns false when denied', async () => {
        jest
          .spyOn(PermissionsAndroid, 'request')
          .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('returns false on permission error', async () => {
        jest
          .spyOn(PermissionsAndroid, 'request')
          .mockRejectedValue(new Error('Permission error'));

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('does not touch the iOS audio session (manager mode stays null)', async () => {
        jest
          .spyOn(PermissionsAndroid, 'request')
          .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

        await whisperService.requestPermissions();

        // Android handles mic permission via PermissionsAndroid; the iOS session
        // owner must not be driven, so its mode stays null.
        expect(mockSetAudioSessionOptions).not.toHaveBeenCalled();
        expect(audioSessionManager.getMode()).toBeNull();
      });

      it('requests RECORD_AUDIO permission with correct message', async () => {
        const requestSpy = jest
          .spyOn(PermissionsAndroid, 'request')
          .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

        await whisperService.requestPermissions();

        expect(requestSpy).toHaveBeenCalledWith(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          expect.objectContaining({
            title: 'Microphone Permission',
            buttonPositive: 'OK',
          }),
        );
      });
    });

    describe('iOS', () => {
      beforeEach(() => {
        Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
        mockSetAudioSessionActivity.mockResolvedValue(true);
      });

      it('drives audioSessionManager into recording mode (not AudioSessionIos directly) and returns true', async () => {
        expect(await whisperService.requestPermissions()).toBe(true);

        // The realtime path now routes the iOS session setup through the SINGLE
        // owner, so its mode is accurate for a later TTS ensurePlayback() (the
        // old direct AudioSessionIos path left mode stale → silent TTS after STT).
        expect(audioSessionManager.getMode()).toBe('record');
        expect(mockSetAudioSessionOptions).toHaveBeenCalledWith(
          expect.objectContaining({ iosCategory: 'playAndRecord' }),
        );
        // Behaviour-neutral: the session is re-activated (not skipped) on the call.
        expect(mockSetAudioSessionActivity).toHaveBeenCalledWith(true);
      });

      it('returns false when audio session activation fails (permission denied)', async () => {
        // A throw on activation is how iOS surfaces a denied mic permission.
        mockSetAudioSessionActivity.mockRejectedValueOnce(
          new Error('Microphone permission denied'),
        );

        expect(await whisperService.requestPermissions()).toBe(false);
        // Activation failed → mode must not advance to record.
        expect(audioSessionManager.getMode()).toBeNull();
      });

      it('does not call PermissionsAndroid', async () => {
        const requestSpy = jest.spyOn(PermissionsAndroid, 'request');

        await whisperService.requestPermissions();

        expect(requestSpy).not.toHaveBeenCalled();
      });

      it('restores playback after stopTranscription so TTS is not silenced (F4)', async () => {
        // Dictation sets the owner to record mode.
        await whisperService.requestPermissions();
        expect(audioSessionManager.getMode()).toBe('record');

        // Stopping dictation must hand the session back to the owner. Previously nothing
        // did, so mode stayed 'record' and the next TTS ensurePlayback() early-returned
        // → silent speech after dictation.
        await whisperService.stopTranscription();
        // restore is fire-and-forget in stopTranscription's finally and now runs through
        // the session owner's serialized queue, so let that microtask settle.
        await new Promise(resolve => setImmediate(resolve));
        expect(audioSessionManager.getMode()).toBe('playback');

        // And a subsequent TTS playback request is actually applied (not skipped).
        mockSetAudioSessionOptions.mockClear();
        await audioSessionManager.ensurePlayback();
        expect(mockSetAudioSessionOptions).toHaveBeenCalledWith(
          expect.objectContaining({ iosCategory: 'playback' }),
        );
      });
    });
  });

  // ========================================================================
  // startRealtimeTranscription
  // ========================================================================
  describe('startRealtimeTranscription', () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      // Most tests in this block need a loaded model, which requires valid file mocks
      mockValidModelFile();
    });

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    it('throws when no model loaded', async () => {
      await expect(
        whisperService.startRealtimeTranscription(jest.fn()),
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('stops existing transcription before starting new one', async () => {
      // Set up a loaded model
      const mockStop = jest.fn();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() =>
          Promise.resolve({
            stop: mockStop,
            subscribe: jest.fn(),
          }),
        ),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      // Simulate existing transcription
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn();

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' }); // auto-grant permissions

      await whisperService.startRealtimeTranscription(jest.fn());

      // The old stopFn should have been called
      expect((whisperService as any).stopFn).not.toBeNull(); // New stopFn is set
    });

    it('throws when permission denied', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest
        .spyOn(PermissionsAndroid, 'request')
        .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

      await expect(
        whisperService.startRealtimeTranscription(jest.fn()),
      ).rejects.toThrow('Microphone permission denied');
    });

    it('stops the exact session when stop arrives while permission is pending', async () => {
      const nativeStop = jest.fn(async () => undefined);
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(async () => ({
          stop: nativeStop,
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      let answerPermission!: (result: string) => void;
      let permissionRequests = 0;
      jest.spyOn(PermissionsAndroid, 'request').mockImplementation(() => {
        permissionRequests += 1;
        if (permissionRequests > 1) {
          return Promise.resolve(PermissionsAndroid.RESULTS.GRANTED);
        }
        return new Promise(resolve => {
          answerPermission = resolve;
        }) as Promise<any>;
      });

      const start = whisperService.startRealtimeTranscription(jest.fn());
      await Promise.resolve();
      const stop = whisperService.stopTranscription();
      await Promise.resolve();
      expect(mockContext.transcribeRealtime).not.toHaveBeenCalled();

      answerPermission(PermissionsAndroid.RESULTS.GRANTED);
      await Promise.all([start, stop]);

      expect(mockContext.transcribeRealtime).toHaveBeenCalledTimes(1);
      expect(nativeStop).toHaveBeenCalledTimes(1);
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('calls transcribeRealtime with correct options', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() =>
          Promise.resolve({
            stop: jest.fn(),
            subscribe: jest.fn(),
          }),
        ),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn(), {
        language: 'fr',
        maxLen: 100,
      });

      expect(mockContext.transcribeRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'fr',
          translate: false,
          beamSize: 5,
          maxLen: 100,
        }),
      );
    });

    it('includes audioSessionOnStartIos options on iOS', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() =>
          Promise.resolve({
            stop: jest.fn(),
            subscribe: jest.fn(),
          }),
        ),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn());

      expect(mockContext.transcribeRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          audioSessionOnStartIos: expect.objectContaining({
            category: 'PlayAndRecord',
            options: ['AllowBluetooth', 'MixWithOthers'],
            mode: 'Default',
          }),
          audioSessionOnStopIos: 'restore',
        }),
      );
    });

    it('does not include audioSession options on Android', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn((..._args: any[]) =>
          Promise.resolve({
            stop: jest.fn(),
            subscribe: jest.fn(),
          }),
        ),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest
        .spyOn(PermissionsAndroid, 'request')
        .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      await whisperService.startRealtimeTranscription(jest.fn());

      const callArgs = mockContext.transcribeRealtime.mock.calls[0]![0]!;
      expect(callArgs.audioSessionOnStartIos).toBeUndefined();
      expect(callArgs.audioSessionOnStopIos).toBeUndefined();
    });

    it('forwards events to callback via subscribe', async () => {
      let subscribeFn: any;
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() =>
          Promise.resolve({
            stop: jest.fn(),
            subscribe: (fn: any) => {
              subscribeFn = fn;
            },
          }),
        ),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb);

      // Simulate event from subscribe
      subscribeFn({
        isCapturing: true,
        data: { result: 'hello world' },
        processTime: 100,
        recordingTime: 200,
      });

      expect(resultCb).toHaveBeenCalledWith({
        text: 'hello world',
        isCapturing: true,
        processTime: 100,
        recordingTime: 200,
      });
    });

    it('keeps the selected language when the realtime result falls back to the recorded file', async () => {
      let subscribeFn: any;
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() =>
          Promise.resolve({
            stop: jest.fn(),
            subscribe: (fn: any) => {
              subscribeFn = fn;
            },
          }),
        ),
        transcribe: jest.fn(() => ({
          stop: jest.fn(),
          promise: Promise.resolve({ result: 'नमस्ते दुनिया' }),
        })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      jest.spyOn(audioRecorderService, 'startRecording').mockResolvedValue();
      jest.spyOn(audioRecorderService, 'stopRecording').mockResolvedValue({
        path: '/recorded-hindi.wav',
        durationSeconds: 1,
      });

      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb, {
        language: 'hi',
      });
      subscribeFn({ isCapturing: false, data: { result: '' } });
      await (whisperService as any).transcriptionFullyStopped;

      expect(mockContext.transcribe).toHaveBeenCalledWith(
        '/recorded-hindi.wav',
        expect.objectContaining({
          language: 'hi',
          translate: false,
          temperature: 0,
          beamSize: 5,
        }),
      );
      const decodeOptions = (
        mockContext.transcribe.mock.calls as unknown as Array<
          [string, Record<string, unknown>]
        >
      )[0][1];
      expect(decodeOptions).not.toHaveProperty('prompt');
      expect(resultCb).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'नमस्ते दुनिया',
          isCapturing: false,
        }),
      );
    });
  });

  // ========================================================================
  // stopTranscription
  // ========================================================================
  describe('stopTranscription', () => {
    it('calls stored stop function', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).isTranscribing = true;
      // Context must exist for stopFn to be called (guard against SIGSEGV on freed context)
      (whisperService as any).context = { release: jest.fn() };

      await whisperService.stopTranscription();

      expect(mockStopFn).toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('skips stopFn when context is already released', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).isTranscribing = true;
      (whisperService as any).context = null; // Context already freed

      await whisperService.stopTranscription();

      expect(mockStopFn).not.toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('handles error in stop function gracefully', async () => {
      (whisperService as any).stopFn = () => {
        throw new Error('stop error');
      };
      (whisperService as any).isTranscribing = true;
      (whisperService as any).context = { release: jest.fn() };

      await whisperService.stopTranscription(); // Should not throw

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('is safe to call when not transcribing', async () => {
      await whisperService.stopTranscription(); // Should not throw
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });
  });

  // ========================================================================
  // transcribeFile
  // ========================================================================
  describe('transcribeFile', () => {
    it('throws when no model loaded', async () => {
      await expect(
        whisperService.transcribeFileRaw('/path/to/audio.wav'),
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('returns transcription result', async () => {
      mockValidModelFile();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(() => ({
          promise: Promise.resolve({ result: 'transcribed text' }),
        })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      const result = await whisperService.transcribeFileRaw('/audio.wav');

      expect(result).toBe('transcribed text');
      expect(mockContext.transcribe).toHaveBeenCalledWith(
        '/audio.wav',
        expect.objectContaining({
          language: 'en',
        }),
      );
    });

    it('does not start native transcription for an already-aborted request', async () => {
      const transcribe = jest.fn();
      (whisperService as any).context = { transcribe };
      const controller = new AbortController();
      controller.abort();

      await expect(
        whisperService.transcribeFileRaw('/audio.wav', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'GenerationAbortedError' });
      expect(transcribe).not.toHaveBeenCalled();
    });

    it('awaits file stop and rejects instead of returning a transcript after cancellation', async () => {
      let resolveTranscript!: (value: { result: string }) => void;
      let rejectStop!: (error: Error) => void;
      const nativeFailure = new Error('native file stop failed');
      const stop = jest.fn(() => new Promise<void>((_resolve, reject) => { rejectStop = reject; }));
      (whisperService as any).context = {
        transcribe: jest.fn(() => ({
          promise: new Promise(resolve => { resolveTranscript = resolve; }),
          stop,
        })),
      };
      const controller = new AbortController();
      const result = whisperService.transcribeFileRaw('/audio.wav', { signal: controller.signal });

      controller.abort();
      await Promise.resolve();
      resolveTranscript({ result: 'must not escape after cancellation' });
      rejectStop(nativeFailure);

      await expect(result).rejects.toBe(nativeFailure);
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // forceReset
  // ========================================================================
  describe('forceReset', () => {
    it('resets transcription state', async () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn();

      await whisperService.forceReset();

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('calls native stopFn when context exists (prevents SIGSEGV)', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = { release: jest.fn() };

      await whisperService.forceReset();

      expect(mockStopFn).toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('does not call stopFn when context is null (prevents SIGSEGV on freed context)', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = null;

      await whisperService.forceReset();

      expect(mockStopFn).not.toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('cleans up and preserves a native stop error during forceReset', async () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = () => {
        throw new Error('stop error');
      };
      (whisperService as any).context = { release: jest.fn() };

      await expect(whisperService.forceReset()).rejects.toThrow('stop error');

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('does not finish until the native realtime job has stopped', async () => {
      let finishNativeStop: (() => void) | undefined;
      const nativeStop = new Promise<void>(resolve => {
        finishNativeStop = resolve;
      });
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn(() => nativeStop);
      (whisperService as any).context = { release: jest.fn() };

      let resetFinished = false;
      const reset = whisperService.forceReset().then(() => {
        resetFinished = true;
      });
      await Promise.resolve();

      expect(resetFinished).toBe(false);
      finishNativeStop?.();
      await reset;
      expect(resetFinished).toBe(true);
    });
  });

  // ========================================================================
  // stopTranscription — double-stop race condition fix
  // ========================================================================
  describe('stopTranscription race condition', () => {
    it('prevents double-stop by atomically clearing stopFn', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = { release: jest.fn() };

      // Call stopTranscription twice concurrently (simulates trailing audio + clearResult race)
      await Promise.all([
        whisperService.stopTranscription(),
        whisperService.stopTranscription(),
      ]);

      // Native stop should only be called once, not twice
      expect(mockStopFn).toHaveBeenCalledTimes(1);
    });

    it('clears stopFn before calling it to prevent reentry', async () => {
      let stopFnDuringCall: any = 'not-checked';
      const mockStopFn = jest.fn(() => {
        // Check that stopFn is already null while this is executing
        stopFnDuringCall = (whisperService as any).stopFn;
      });
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = { release: jest.fn() };

      await whisperService.stopTranscription();

      expect(mockStopFn).toHaveBeenCalled();
      expect(stopFnDuringCall).toBeNull();
    });
  });
});
