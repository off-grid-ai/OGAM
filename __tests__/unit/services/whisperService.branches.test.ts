/**
 * WhisperService — additional branch coverage.
 *
 * Targets error/cleanup paths not exercised by whisperService.test.ts:
 * downloadModel validation failure, listDownloadedModels,
 * deleteModel active-download cancellation, loadModel release-wait,
 * unloadModel mid-transcription, requestPermissions non-mobile platform,
 * and startRealtimeTranscription guards / event finish / error paths.
 */

import { initWhisper } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import { AudioManager } from 'react-native-audio-api';
import RNFS from 'react-native-fs';
import { whisperService } from '../../../src/services/whisperService';
import { audioSessionManager } from '../../../src/services/audioSessionManager';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    downloadFileTo: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
  },
}));

const mockedBDS = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;
// The iOS realtime permission path drives audioSessionManager, which calls these.
const mockSetAudioSessionOptions = AudioManager.setAudioSessionOptions as jest.Mock;
const mockSetAudioSessionActivity = AudioManager.setAudioSessionActivity as jest.Mock;
const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedInitWhisper = initWhisper as jest.MockedFunction<typeof initWhisper>;

const resetService = () => {
  (whisperService as any).context = null;
  (whisperService as any).currentModelPath = null;
  (whisperService as any).isTranscribing = false;
  (whisperService as any).stopFn = null;
  (whisperService as any).isReleasingContext = false;
  (whisperService as any).contextReleasePromise = Promise.resolve();
  (whisperService as any).transcriptionFullyStopped = Promise.resolve();
  (whisperService as any).activeDownloadId = null;
};

describe('WhisperService — branch coverage', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // clearAllMocks() clears call history but NOT the mockResolvedValueOnce
    // queue, so an unconsumed once from a prior test would shift these
    // ordered exists()/stat() chains. Reset them for true per-test isolation.
    mockedRNFS.exists.mockReset();
    mockedRNFS.stat.mockReset();
    resetService();
    mockedBDS.isAvailable.mockReturnValue(true);
    mockedBDS.cancelDownload.mockResolvedValue(undefined as any);
    mockedBDS.downloadFileTo.mockReturnValue({
      downloadId: 0,
      downloadIdPromise: Promise.resolve(0),
      promise: Promise.resolve(),
    } as any);
    // clearMocks wipes the activity mock's resolved value each test; re-establish
    // the default (success) and reset the session owner's mode.
    mockSetAudioSessionActivity.mockResolvedValue(true);
    audioSessionManager._reset();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
  });

  // ── downloadModel: validation fails after download (lines 85-87) ──────────
  describe('downloadModel validation failure', () => {
    it('deletes the file and throws "invalid" when validation fails', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // models dir exists
        .mockResolvedValueOnce(false)  // model not downloaded yet
        .mockResolvedValueOnce(true);  // validateModelFile: file exists
      // stat reports a too-small (corrupt) file → validateModelFile throws
      mockedRNFS.stat.mockResolvedValueOnce({ size: 1000, isFile: () => true } as any);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);
      mockedBDS.downloadFileTo.mockReturnValue({
        downloadId: 1,
        downloadIdPromise: Promise.resolve(1),
        promise: Promise.resolve(),
      } as any);

      await expect(whisperService.downloadModel('tiny.en')).rejects.toThrow(
        /Downloaded model file is invalid/,
      );
      // validateModelFile unlinks once (corrupt), then downloadModel unlinks again on the catch
      expect(mockedRNFS.unlink).toHaveBeenCalledWith('/mock/documents/whisper-models/ggml-tiny.en.bin');
    });
  });


  // ── listDownloadedModels (lines 114-127) ──────────────────────────────────
  describe('listDownloadedModels', () => {
    it('returns [] when the models dir does not exist', async () => {
      mockedRNFS.exists.mockResolvedValueOnce(false);
      expect(await whisperService.listDownloadedModels()).toEqual([]);
    });

    it('maps ggml .bin files and ignores everything else', async () => {
      mockedRNFS.exists.mockResolvedValueOnce(true);
      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'ggml-tiny.en.bin', size: '123', path: '/d/ggml-tiny.en.bin', isFile: () => true },
        { name: 'notes.txt', size: '5', path: '/d/notes.txt', isFile: () => true },        // wrong ext
        { name: 'subdir', size: '0', path: '/d/subdir', isFile: () => false },            // not a file
        { name: 'other.bin', size: 'NaN', path: '/d/other.bin', isFile: () => true },     // wrong prefix
      ] as any);

      const result = await whisperService.listDownloadedModels();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        modelId: 'tiny.en',
        fileName: 'ggml-tiny.en.bin',
        sizeBytes: 123,
        filePath: '/d/ggml-tiny.en.bin',
      });
    });

    it('coerces an unparseable size to 0', async () => {
      mockedRNFS.exists.mockResolvedValueOnce(true);
      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'ggml-base.bin', size: 'oops', path: '/d/ggml-base.bin', isFile: () => true },
      ] as any);
      const result = await whisperService.listDownloadedModels();
      expect(result[0].sizeBytes).toBe(0);
    });
  });

  // ── deleteModel: active download cancellation (lines 130-132) ──────────────
  describe('deleteModel with active download', () => {
    it('cancels the active download before deleting', async () => {
      (whisperService as any).activeDownloadId = 'dl-1';
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await whisperService.deleteModel('tiny.en');

      expect(mockedBDS.cancelDownload).toHaveBeenCalledWith('dl-1');
      expect((whisperService as any).activeDownloadId).toBeNull();
      expect(mockedRNFS.unlink).toHaveBeenCalled();
    });

    it('swallows cancellation errors', async () => {
      (whisperService as any).activeDownloadId = 'dl-2';
      mockedBDS.cancelDownload.mockRejectedValueOnce(new Error('cancel fail'));
      mockedRNFS.exists.mockResolvedValue(false);

      await expect(whisperService.deleteModel('tiny.en')).resolves.toBeUndefined();
      expect((whisperService as any).activeDownloadId).toBeNull();
    });
  });

  // ── loadModel: waits for in-progress release (lines 178-181) ──────────────
  describe('loadModel while releasing context', () => {
    it('awaits the release promise before loading', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 75 * 1024 * 1024, isFile: () => true } as any);
      let releaseResolved = false;
      (whisperService as any).isReleasingContext = true;
      (whisperService as any).contextReleasePromise = Promise.resolve().then(() => {
        releaseResolved = true;
        (whisperService as any).isReleasingContext = false;
      });
      const ctx = { id: 'c', release: jest.fn(), transcribeRealtime: jest.fn(), transcribe: jest.fn() };
      mockedInitWhisper.mockResolvedValueOnce(ctx as any);

      await whisperService.loadModel('/path/model.bin');

      expect(releaseResolved).toBe(true);
      expect(mockedInitWhisper).toHaveBeenCalled();
    });
  });

  // ── unloadModel: stops active transcription first (lines 203-207) ─────────
  describe('unloadModel while transcribing', () => {
    it('stops transcription before releasing the context', async () => {
      const stopFn = jest.fn();
      const release = jest.fn(() => Promise.resolve());
      (whisperService as any).context = { release } as any;
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = stopFn;
      (whisperService as any).transcriptionFullyStopped = Promise.resolve();

      await whisperService.unloadModel();

      expect(stopFn).toHaveBeenCalled();
      expect(release).toHaveBeenCalled();
      expect(whisperService.isModelLoaded()).toBe(false);
    });
  });

  // ── requestPermissions: non-mobile platform returns true (line 249) ───────
  describe('requestPermissions on other platforms', () => {
    it('returns true when not android or ios', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'web' as any });
      expect(await whisperService.requestPermissions()).toBe(true);
      // Neither the iOS session owner nor Android permissions are touched.
      expect(mockSetAudioSessionOptions).not.toHaveBeenCalled();
      const requestSpy = jest.spyOn(PermissionsAndroid, 'request');
      expect(requestSpy).not.toHaveBeenCalled();
    });
  });

  // ── startRealtimeTranscription guards / finish / error (293-347) ──────────
  describe('startRealtimeTranscription', () => {
    const loadCtx = async (ctx: any) => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 75 * 1024 * 1024, isFile: () => true } as any);
      mockedInitWhisper.mockResolvedValueOnce(ctx as any);
      await whisperService.loadModel('/path/model.bin');
    };

    it('throws when context is released during the async permission check', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const ctx = {
        id: 'c', release: jest.fn(), transcribe: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({ stop: jest.fn(), subscribe: jest.fn() })),
      };
      await loadCtx(ctx);
      // requestPermissions runs (now via audioSessionManager → setAudioSessionActivity),
      // then we null the context to hit the post-permission guard.
      mockSetAudioSessionActivity.mockImplementationOnce(async () => {
        (whisperService as any).context = null;
        return true;
      });

      await expect(whisperService.startRealtimeTranscription(jest.fn())).rejects.toThrow(
        'Whisper context was released before transcription could start',
      );
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('clears state when an event reports isCapturing=false (recording finished)', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      let subscribeFn: any;
      const ctx = {
        id: 'c', release: jest.fn(), transcribe: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: (fn: any) => { subscribeFn = fn; },
        })),
      };
      await loadCtx(ctx);

      const cb = jest.fn();
      await whisperService.startRealtimeTranscription(cb);
      expect(whisperService.isCurrentlyTranscribing()).toBe(true);

      // Fire a final event with no data and isCapturing=false
      subscribeFn({ isCapturing: false, data: undefined, processTime: undefined, recordingTime: undefined });

      expect(cb).toHaveBeenCalledWith({ text: '', isCapturing: false, processTime: 0, recordingTime: 0 });
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
      expect((whisperService as any).stopFn).toBeNull();
    });

    it('resets state and rethrows when transcribeRealtime throws', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const ctx = {
        id: 'c', release: jest.fn(), transcribe: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.reject(new Error('native boom'))),
      };
      await loadCtx(ctx);

      await expect(whisperService.startRealtimeTranscription(jest.fn())).rejects.toThrow('native boom');
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
      expect((whisperService as any).stopFn).toBeNull();
    });
  });
});
