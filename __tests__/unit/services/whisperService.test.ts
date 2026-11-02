/**
 * WhisperService Unit Tests
 *
 * Tests for Whisper speech-to-text service.
 * Priority: P1 - Voice input support.
 */

import { initWhisper } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { whisperService } from '../../../src/services/whisperService';
import { audioSessionManager } from '../../../src/services/audioSessionManager';
import { audioRecorderService } from '../../../src/services/audioRecorderService';
import { AudioManager } from 'react-native-audio-api';

// The realtime permission path drives audioSessionManager, which calls these.
const mockSetAudioSessionOptions =
  AudioManager.setAudioSessionOptions as jest.Mock;
const mockSetAudioSessionActivity =
  AudioManager.setAudioSessionActivity as jest.Mock;

// The real audioRecorderService records through react-native-audio-api's AudioRecorder (faked in
// jest.setup), which writes the take to this file.
const RECORDED_FILE = '/mock/audio/input.wav';

// Downloads (the native downloader, the download store and its rows) are covered on the phone's fakes in
// transcriptionDownloads.test.ts.

// whisper.rn's realtime transcriber (faked in jest.setup): every session the service opened.
const sessions = (): any[] => require('whisper.rn/realtime-transcription/RealtimeTranscriber').__sessions;
const lastTranscriber = () => sessions()[sessions().length - 1];

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedInitWhisper = initWhisper as jest.MockedFunction<
  typeof initWhisper
>;

/** Mock RNFS to report a valid model file (exists + large enough) */
const mockValidModelFile = () => {
  mockedRNFS.exists.mockResolvedValue(true);
  mockedRNFS.stat.mockResolvedValue({
    size: 75 * 1024 * 1024,
    isFile: () => true,
  } as any);
};

describe('WhisperService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // Reset singleton state
    (whisperService as any).context = null;
    (whisperService as any).currentModelPath = null;
    (whisperService as any).isTranscribing = false;
    (whisperService as any).stopFn = null;
    (whisperService as any).isReleasingContext = false;
    (whisperService as any).transcriptionFullyStopped = Promise.resolve();
    (whisperService as any).nativeLane = Promise.resolve();
    (whisperService as any).activeDownloadId = null;
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
  // downloadModel
  // ========================================================================
  describe('deleteModel', () => {
    it('deletes file when it exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await whisperService.deleteModel('tiny.en');

      expect(RNFS.unlink).toHaveBeenCalledWith(
        '/mock/documents/whisper-models/ggml-tiny.en.bin',
      );
    });

    it('does nothing when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await whisperService.deleteModel('tiny.en');

      expect(RNFS.unlink).not.toHaveBeenCalled();
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
      mockedRNFS.stat.mockResolvedValue({
        size: 1000,
        isFile: () => true,
      } as any);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(
        whisperService.validateModelFile('/path/model.bin'),
      ).rejects.toThrow('too small');
      expect(RNFS.unlink).toHaveBeenCalledWith('/path/model.bin');
    });

    it('passes for valid file with sufficient size', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({
        size: 75 * 1024 * 1024,
        isFile: () => true,
      } as any);

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
        transcribeData: jest.fn(),
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
        transcribeData: jest.fn(),
        transcribe: jest.fn(),
      };
      const mockContext2 = {
        id: 'ctx2',
        release: jest.fn(() => Promise.resolve()),
        transcribeData: jest.fn(),
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
        transcribeData: jest.fn(),
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
      mockedRNFS.stat.mockResolvedValue({
        size: 500,
        isFile: () => true,
      } as any);
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
        transcribeData: jest.fn(),
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

    const loadContext = async (transcript = 'transcribed text') => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeData: jest.fn(),
        transcribe: jest.fn(() => ({
          stop: jest.fn(),
          promise: Promise.resolve({ result: transcript }),
        })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');
      return mockContext;
    };

    it('throws when no model loaded', async () => {
      await expect(
        whisperService.startRealtimeTranscription(jest.fn()),
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('stops existing transcription before starting new one', async () => {
      await loadContext();
      const previousStop = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = previousStop;
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' }); // auto-grant permissions

      await whisperService.startRealtimeTranscription(jest.fn());

      expect(previousStop).toHaveBeenCalledTimes(1);
      expect(lastTranscriber().active).toBe(true);
      await whisperService.stopTranscription();
    });

    it('throws when permission denied', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest
        .spyOn(PermissionsAndroid, 'request')
        .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

      await expect(
        whisperService.startRealtimeTranscription(jest.fn()),
      ).rejects.toThrow('Microphone permission denied');
    });

    it('stops the exact session when stop arrives while permission is pending', async () => {
      await loadContext();
      const sessionsBefore = sessions().length;
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
      expect(sessions().length).toBe(sessionsBefore);

      answerPermission(PermissionsAndroid.RESULTS.GRANTED);
      await Promise.all([start, stop]);

      expect(sessions().length).toBe(sessionsBefore + 1);
      expect(lastTranscriber().active).toBe(false);
      expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('decodes the live preview in the chosen language', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn(), {
        language: 'fr',
        maxLen: 100,
      });

      expect(lastTranscriber().options.transcribeOptions).toEqual(
        expect.objectContaining({
          language: 'fr',
          translate: false,
          beamSize: 5,
          maxLen: 100,
        }),
      );
      await whisperService.stopTranscription();
    });

    it('records the utterance while the preview runs, and stops recording on stop', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn());
      expect(audioRecorderService.isCurrentlyRecording()).toBe(true);

      await whisperService.stopTranscription();
      await (whisperService as any).transcriptionFullyStopped;
      expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
    });

    it('shows every decoded slice, in order, as the live preview', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb);

      lastTranscriber().emitSlice('world', 1);
      lastTranscriber().emitSlice('hello', 0);

      expect(resultCb).toHaveBeenLastCalledWith({
        text: 'hello world',
        isCapturing: true,
        processTime: 10,
        recordingTime: 500,
      });
      await whisperService.stopTranscription();
    });

    it('takes the final text from the recording, which hears the last words the preview missed', async () => {
      await loadContext('hello world and goodbye');
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb);
      lastTranscriber().emitSlice('hello world');

      await whisperService.stopTranscription();
      await (whisperService as any).transcriptionFullyStopped;

      expect(resultCb).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'hello world and goodbye', isCapturing: false }),
      );
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('falls back to the preview when the recording cannot be transcribed', async () => {
      const ctx = await loadContext();
      ctx.transcribe.mockImplementation(() => ({
        stop: jest.fn(),
        promise: Promise.reject(new Error('decode failed')),
      }));
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb);
      lastTranscriber().emitSlice('hello world');

      await whisperService.stopTranscription();
      await (whisperService as any).transcriptionFullyStopped;

      expect(resultCb).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'hello world', isCapturing: false }),
      );
    });

    it('keeps the session live when the transcriber reports an error', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      await whisperService.startRealtimeTranscription(jest.fn());

      lastTranscriber().callbacks.onError('slice decode failed');

      expect(whisperService.isCurrentlyTranscribing()).toBe(true);
      expect(lastTranscriber().active).toBe(true);
      await whisperService.stopTranscription();
    });

    it('gives the microphone back when the model is released while permission is pending', async () => {
      await loadContext();
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      let answerPermission!: (result: string) => void;
      jest.spyOn(PermissionsAndroid, 'request').mockImplementationOnce(
        () => new Promise(resolve => { answerPermission = resolve; }) as Promise<any>,
      ).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      const start = whisperService.startRealtimeTranscription(jest.fn());
      while (!answerPermission) await new Promise(resolve => setImmediate(resolve));
      // The context goes away while the permission prompt is open.
      (whisperService as any).context = null;
      answerPermission(PermissionsAndroid.RESULTS.GRANTED);

      await expect(start).rejects.toThrow('Whisper context was released before transcription could start');
      expect(audioRecorderService.isCurrentlyRecording()).toBe(false);
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('keeps the selected language when the final text comes from the recorded file', async () => {
      const mockContext = await loadContext('नमस्ते दुनिया');
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb, {
        language: 'hi',
      });
      await whisperService.stopTranscription();
      await (whisperService as any).transcriptionFullyStopped;

      expect(mockContext.transcribe).toHaveBeenCalledWith(
        RECORDED_FILE,
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
  // one native job at a time
  // ========================================================================
  describe('native job lane', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>(r => {
        resolve = r;
      });
      return { promise, resolve };
    }
    const flush = () => new Promise<void>(r => setImmediate(r));

    it('releases the context only after a running file transcription has finished', async () => {
      const job = deferred<{ result: string }>();
      const events: string[] = [];
      const mockContext = {
        id: 'ctx',
        release: jest.fn(async () => {
          events.push('release');
        }),
        transcribe: jest.fn(() => ({ stop: jest.fn(), promise: job.promise })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      mockValidModelFile();
      await whisperService.loadModel('/path/model.bin');

      const transcript = whisperService.transcribeFile('/clip.wav').then(text => {
        events.push('transcribed');
        return text;
      });
      await flush();
      const unloaded = whisperService.unloadModel();
      await flush();
      expect(mockContext.release).not.toHaveBeenCalled();

      job.resolve({ result: 'hello there' });
      await expect(transcript).resolves.toBe('hello there');
      await unloaded;
      expect(events).toEqual(['transcribed', 'release']);
      expect(whisperService.isModelLoaded()).toBe(false);
    });

    it('starts the next live session only after the previous one has finished its file pass', async () => {
      const fileJob = deferred<{ result: string }>();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeData: jest.fn(),
        transcribe: jest.fn(() => ({ stop: jest.fn(), promise: fileJob.promise })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      mockValidModelFile();
      await whisperService.loadModel('/path/model.bin');
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
      const sessionsBefore = sessions().length;

      const firstResult = jest.fn();
      await whisperService.startRealtimeTranscription(firstResult);
      // The utterance ends; the recording is transcribed for the final text.
      await whisperService.stopTranscription();

      // The user taps the mic again while that file job is still running.
      const second = whisperService.startRealtimeTranscription(jest.fn());
      await flush();
      expect(sessions().length).toBe(sessionsBefore + 1);

      fileJob.resolve({ result: 'what I said' });
      await second;
      expect(sessions().length).toBe(sessionsBefore + 2);
      // The first session finishing must not clear the live second one.
      expect(whisperService.isCurrentlyTranscribing()).toBe(true);
      expect(firstResult).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'what I said', isCapturing: false }),
      );
      await whisperService.stopTranscription();
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
        whisperService.transcribeFile('/path/to/audio.wav'),
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('returns transcription result', async () => {
      mockValidModelFile();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeData: jest.fn(),
        transcribe: jest.fn(() => ({
          promise: Promise.resolve({ result: 'transcribed text' }),
        })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      const result = await whisperService.transcribeFile('/audio.wav');

      expect(result).toBe('transcribed text');
      expect(mockContext.transcribe).toHaveBeenCalledWith(
        '/audio.wav',
        expect.objectContaining({
          language: 'en',
        }),
      );
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

    it('handles stopFn error gracefully during forceReset', async () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = () => {
        throw new Error('stop error');
      };
      (whisperService as any).context = { release: jest.fn() };

      // Should not throw
      await whisperService.forceReset();

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
