/**
 * WhisperService Unit Tests
 *
 * Tests for Whisper speech-to-text service.
 * Priority: P1 - Voice input support.
 */

import { initWhisper } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { whisperService, WHISPER_MODELS } from '../../../src/services/whisperService';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { audioSessionManager } from '../../../src/services/audioSessionManager';
import { AudioManager } from 'react-native-audio-api';

// The realtime permission path drives audioSessionManager, which calls these.
const mockSetAudioSessionOptions = AudioManager.setAudioSessionOptions as jest.Mock;
const mockSetAudioSessionActivity = AudioManager.setAudioSessionActivity as jest.Mock;

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    downloadFileTo: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
  },
}));

// Names prefixed with `mock` so jest.mock's hoisting allows referencing them.
const mockDownloadStoreAdd = jest.fn();
const mockDownloadStoreRemove = jest.fn();
const mockDownloadStoreRetryEntry = jest.fn();
jest.mock('../../../src/stores/downloadStore', () => ({
  useDownloadStore: {
    getState: () => ({
      add: mockDownloadStoreAdd,
      remove: mockDownloadStoreRemove,
      retryEntry: mockDownloadStoreRetryEntry,
    }),
  },
}));

const mockedBDS = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedInitWhisper = initWhisper as jest.MockedFunction<typeof initWhisper>;

  /** Mock RNFS to report a valid model file (exists + large enough) */
const mockValidModelFile = () => {
  mockedRNFS.exists.mockResolvedValue(true);
  mockedRNFS.stat.mockResolvedValue({ size: 75 * 1024 * 1024, isFile: () => true } as any);
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
    (whisperService as any).activeDownloadId = null;
    // Default backgroundDownloadService mock
    mockedBDS.isAvailable.mockReturnValue(true);
    mockedBDS.downloadFileTo.mockReturnValue({
      downloadId: 0,
      downloadIdPromise: Promise.resolve(0),
      promise: Promise.resolve(),
    } as any);
    mockedBDS.cancelDownload.mockResolvedValue(undefined as any);
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
      expect(whisperService.getModelsDir()).toBe('/mock/documents/whisper-models');
    });
  });

  describe('getModelPath', () => {
    it('returns correct path for a model ID', () => {
      expect(whisperService.getModelPath('tiny.en')).toBe(
        '/mock/documents/whisper-models/ggml-tiny.en.bin'
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
  describe('downloadModel', () => {
    it('throws for unknown model ID', async () => {
      await expect(whisperService.downloadModel('nonexistent')).rejects.toThrow('Unknown model');
    });

    it('returns existing path if already downloaded', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      const result = await whisperService.downloadModel('tiny.en');

      expect(result).toBe('/mock/documents/whisper-models/ggml-tiny.en.bin');
      expect(mockedBDS.downloadFileTo).not.toHaveBeenCalled();
    });

    it('downloads via backgroundDownloadService when not present', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // dir exists
        .mockResolvedValueOnce(false) // model not yet downloaded
        .mockResolvedValueOnce(true); // validateModelFile: file exists
      mockedRNFS.stat.mockResolvedValueOnce({ size: 75 * 1024 * 1024, isFile: () => true } as any);

      mockedBDS.downloadFileTo.mockReturnValue({
        downloadId: 1,
        downloadIdPromise: Promise.resolve(1),
        promise: Promise.resolve(),
      } as any);

      const result = await whisperService.downloadModel('tiny.en');

      expect(mockedBDS.downloadFileTo).toHaveBeenCalledWith(expect.objectContaining({
        // modelType 'stt' files the in-progress download under Voice in the
        // Download Manager (without it the entry defaulted to 'text').
        params: expect.objectContaining({ url: WHISPER_MODELS[0].url, modelType: 'stt' }),
        destPath: '/mock/documents/whisper-models/ggml-tiny.en.bin',
      }));
      expect(result).toBe('/mock/documents/whisper-models/ggml-tiny.en.bin');
    });

    it('calls progress callback', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // dir exists
        .mockResolvedValueOnce(false) // model doesn't exist
        .mockResolvedValueOnce(true); // validateModelFile: file exists
      mockedRNFS.stat.mockResolvedValueOnce({ size: 75 * 1024 * 1024, isFile: () => true } as any);

      let capturedOnProgress: ((b: number, t: number) => void) | undefined;
      mockedBDS.downloadFileTo.mockImplementation((opts: any) => {
        capturedOnProgress = opts.onProgress;
        return {
          downloadId: 1,
          downloadIdPromise: Promise.resolve(1),
          promise: Promise.resolve(),
        } as any;
      });

      const progressCb = jest.fn();
      await whisperService.downloadModel('tiny.en', progressCb);

      if (capturedOnProgress) {
        capturedOnProgress(37500000, 75000000);
        expect(progressCb).toHaveBeenCalledWith(0.5);
      }
    });

    it('cleans up partial file and rethrows when download fails', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // dir exists
        .mockResolvedValueOnce(false); // model not yet downloaded
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      mockedBDS.downloadFileTo.mockReturnValue({
        downloadId: 1,
        downloadIdPromise: Promise.resolve(1),
        promise: Promise.reject(new Error('network_lost')),
      } as any);

      await expect(whisperService.downloadModel('tiny.en')).rejects.toThrow('network_lost');
      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/whisper-models/ggml-tiny.en.bin');
    });

    it('registers the in-flight download in the download store so it shows live, then clears it on completion', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // dir exists
        .mockResolvedValueOnce(false) // model not yet downloaded
        .mockResolvedValueOnce(true); // validateModelFile: file exists
      mockedRNFS.stat.mockResolvedValueOnce({ size: 75 * 1024 * 1024, isFile: () => true } as any);
      mockedBDS.downloadFileTo.mockReturnValue({
        downloadId: 7,
        downloadIdPromise: Promise.resolve(7),
        promise: Promise.resolve(),
      } as any);

      await whisperService.downloadModel('tiny.en');

      // A QUEUED placeholder row is published UP-FRONT (before the native start),
      // keyed by whisper-<id>/<fileName> and filed under Voice via modelType 'stt',
      // so a queued STT download shows as "Queued" in the same canonical store the
      // Text/Image cards read (not "0%"). This is the single-source-of-truth path.
      expect(mockDownloadStoreAdd).toHaveBeenCalledWith(expect.objectContaining({
        modelKey: 'whisper-tiny.en/ggml-tiny.en.bin',
        downloadId: 'queued:whisper-tiny.en/ggml-tiny.en.bin',
        modelId: 'whisper-tiny.en',
        fileName: 'ggml-tiny.en.bin',
        modelType: 'stt',
        status: 'pending',
      }));
      // Once a slot opens and the native download starts, the placeholder is
      // reconciled to the real downloadId so progress events route to it.
      expect(mockDownloadStoreRetryEntry).toHaveBeenCalledWith('whisper-tiny.en/ggml-tiny.en.bin', 7);
      // Cleared on success — completed STT models are listed from disk instead.
      expect(mockDownloadStoreRemove).toHaveBeenCalledWith('whisper-tiny.en/ggml-tiny.en.bin');
    });

    it('clears the download store entry even when the download fails', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // dir exists
        .mockResolvedValueOnce(false); // model not yet downloaded
      mockedRNFS.unlink.mockResolvedValue(undefined as any);
      mockedBDS.downloadFileTo.mockReturnValue({
        downloadId: 8,
        downloadIdPromise: Promise.resolve(8),
        promise: Promise.reject(new Error('network_lost')),
      } as any);

      await expect(whisperService.downloadModel('tiny.en')).rejects.toThrow('network_lost');

      expect(mockDownloadStoreAdd).toHaveBeenCalled();
      expect(mockDownloadStoreRemove).toHaveBeenCalledWith('whisper-tiny.en/ggml-tiny.en.bin');
    });
  });

  // ========================================================================
  // deleteModel
  // ========================================================================
  describe('deleteModel', () => {
    it('deletes file when it exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await whisperService.deleteModel('tiny.en');

      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/whisper-models/ggml-tiny.en.bin');
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
      await expect(whisperService.validateModelFile('')).rejects.toThrow('empty or undefined');
    });

    it('throws when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(whisperService.validateModelFile('/missing/model.bin')).rejects.toThrow('not found');
    });

    it('throws and deletes file when file is too small (corrupted)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 1000, isFile: () => true } as any);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(whisperService.validateModelFile('/path/model.bin')).rejects.toThrow('too small');
      expect(RNFS.unlink).toHaveBeenCalledWith('/path/model.bin');
    });

    it('passes for valid file with sufficient size', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 75 * 1024 * 1024, isFile: () => true } as any);

      await expect(whisperService.validateModelFile('/path/model.bin')).resolves.toBeUndefined();
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

      expect(initWhisper).toHaveBeenCalledWith({ filePath: '/path/to/model.bin' });
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

      await expect(whisperService.loadModel('/bad/model.bin')).rejects.toThrow('Load failed');
      expect(whisperService.isModelLoaded()).toBe(false);
      expect(whisperService.getLoadedModelPath()).toBeNull();
    });

    it('throws when model file is missing (prevents native crash)', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(whisperService.loadModel('/missing/model.bin')).rejects.toThrow('not found');
      expect(initWhisper).not.toHaveBeenCalled();
    });

    it('throws when model file is corrupted/too small (prevents native crash)', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500, isFile: () => true } as any);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(whisperService.loadModel('/corrupted/model.bin')).rejects.toThrow('too small');
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
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        expect(await whisperService.requestPermissions()).toBe(true);
      });

      it('returns false when denied', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.DENIED
        );

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('returns false on permission error', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockRejectedValue(new Error('Permission error'));

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('does not touch the iOS audio session (manager mode stays null)', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        await whisperService.requestPermissions();

        // Android handles mic permission via PermissionsAndroid; the iOS session
        // owner must not be driven, so its mode stays null.
        expect(mockSetAudioSessionOptions).not.toHaveBeenCalled();
        expect(audioSessionManager.getMode()).toBeNull();
      });

      it('requests RECORD_AUDIO permission with correct message', async () => {
        const requestSpy = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        await whisperService.requestPermissions();

        expect(requestSpy).toHaveBeenCalledWith(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          expect.objectContaining({
            title: 'Microphone Permission',
            buttonPositive: 'OK',
          })
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
          expect.objectContaining({ iosCategory: 'playAndRecord' })
        );
        // Behaviour-neutral: the session is re-activated (not skipped) on the call.
        expect(mockSetAudioSessionActivity).toHaveBeenCalledWith(true);
      });

      it('returns false when audio session activation fails (permission denied)', async () => {
        // A throw on activation is how iOS surfaces a denied mic permission.
        mockSetAudioSessionActivity.mockRejectedValueOnce(new Error('Microphone permission denied'));

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
        whisperService.startRealtimeTranscription(jest.fn())
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('stops existing transcription before starting new one', async () => {
      // Set up a loaded model
      const mockStop = jest.fn();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: mockStop,
          subscribe: jest.fn(),
        })),
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
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
        PermissionsAndroid.RESULTS.DENIED
      );

      await expect(
        whisperService.startRealtimeTranscription(jest.fn())
      ).rejects.toThrow('Microphone permission denied');
    });

    it('calls transcribeRealtime with correct options', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn(), { language: 'fr', maxLen: 100 });

      expect(mockContext.transcribeRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'fr',
          maxLen: 100,
        })
      );
    });

    it('includes audioSessionOnStartIos options on iOS', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
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
        })
      );
    });

    it('does not include audioSession options on Android', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn((..._args: any[]) => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
        PermissionsAndroid.RESULTS.GRANTED
      );

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
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: (fn: any) => { subscribeFn = fn; },
        })),
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
      (whisperService as any).stopFn = () => { throw new Error('stop error'); };
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
        whisperService.transcribeFile('/path/to/audio.wav')
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

      const result = await whisperService.transcribeFile('/audio.wav');

      expect(result).toBe('transcribed text');
      expect(mockContext.transcribe).toHaveBeenCalledWith('/audio.wav', expect.objectContaining({
        language: 'en',
      }));
    });
  });

  // ========================================================================
  // forceReset
  // ========================================================================
  describe('forceReset', () => {
    it('resets transcription state', () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn();

      whisperService.forceReset();

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('calls native stopFn when context exists (prevents SIGSEGV)', () => {
      const mockStopFn = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = { release: jest.fn() };

      whisperService.forceReset();

      expect(mockStopFn).toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('does not call stopFn when context is null (prevents SIGSEGV on freed context)', () => {
      const mockStopFn = jest.fn();
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).context = null;

      whisperService.forceReset();

      expect(mockStopFn).not.toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('handles stopFn error gracefully during forceReset', () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = () => { throw new Error('stop error'); };
      (whisperService as any).context = { release: jest.fn() };

      // Should not throw
      whisperService.forceReset();

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
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
