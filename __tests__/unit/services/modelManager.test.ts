/**
 * ModelManager Unit Tests
 *
 * Tests for model download, storage, deletion, and background download management.
 * Priority: P0 (Critical) - Model lifecycle management.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { modelManager } from '../../../src/services/modelManager';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { huggingFaceService } from '../../../src/services/huggingface';
import {
  buildDownloadedModel,
  determineCredibility,
  resolveStoredPath,
} from '../../../src/services/modelManager/storage';
import { isMMProjFile } from '../../../src/services/mmproj';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Mock huggingFaceService
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    getDownloadUrl: jest.fn((modelId: string, fileName: string) =>
      `https://huggingface.co/${modelId}/resolve/main/${fileName}`
    ),
  },
}));

// Mock backgroundDownloadService
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => false),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    downloadFileTo: jest.fn(() => ({ downloadId: 999, downloadIdPromise: Promise.resolve(999), promise: Promise.resolve() })),
    getActiveDownloads: jest.fn(() => Promise.resolve([])),
    moveCompletedDownload: jest.fn(),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
    markSilent: jest.fn(),
    unmarkSilent: jest.fn(),
    excludeFromBackup: jest.fn(() => Promise.resolve(true)),
  },
}));

const mockedBackgroundDownloadService = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

jest.mock('react-native-zip-archive', () => ({ unzip: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn((dir: string) => Promise.resolve(`${dir}/model.mlpackage`)),
}));
// Completeness gate is a collaborator here (covered by imageModelIntegrity unit tests + the G7
// reconcile integration test); stub it so this test focuses on the reconcile flow.
jest.mock('../../../src/utils/imageModelIntegrity', () => ({
  ensureImageExtractionComplete: jest.fn().mockResolvedValue(undefined),
}));

import { unzip as mockedUnzip } from 'react-native-zip-archive';
import { resolveCoreMLModelDir as mockedResolveCoreML } from '../../../src/utils/coreMLModelUtils';

const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';

function setupLiteRTImportMocks() {
  mockedRNFS.exists
    .mockResolvedValueOnce(true)   // modelsDir
    .mockResolvedValueOnce(true)   // imageModelsDir
    .mockResolvedValueOnce(false); // destExists = false
  mockedRNFS.stat.mockResolvedValue({ size: 500000000, isFile: () => true } as any);
  (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
  mockedAsyncStorage.getItem.mockResolvedValue('[]');
}

describe('ModelManager', () => {
  beforeEach(() => {
    jest.resetAllMocks();

    // Reset private state
    (modelManager as any).downloadJobs = new Map();
    (modelManager as any).backgroundDownloadMetadataCallback = null;

    // Re-establish huggingFaceService mock (resetAllMocks clears jest.mock implementations)
    (huggingFaceService.getDownloadUrl as jest.Mock).mockImplementation(
      (modelId: string, fileName: string) =>
        `https://huggingface.co/${modelId}/resolve/main/${fileName}`
    );

    // Default RNFS behaviors
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.mkdir.mockResolvedValue(undefined as any);
    mockedRNFS.stat.mockResolvedValue({ size: 4000000000, isFile: () => true } as any);
    mockedRNFS.unlink.mockResolvedValue(undefined as any);
    mockedRNFS.readDir.mockResolvedValue([]);
    mockedRNFS.downloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
    } as any);
    (mockedRNFS as any).stopDownload = jest.fn();
    (mockedRNFS as any).copyFile = jest.fn(() => Promise.resolve());
    (mockedRNFS as any).moveFile = jest.fn(() => Promise.resolve());

    // Reset backgroundDownloadService mock implementations
    mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);
    mockedBackgroundDownloadService.startDownload.mockResolvedValue({} as any);
    mockedBackgroundDownloadService.cancelDownload.mockResolvedValue(undefined as any);
    mockedBackgroundDownloadService.downloadFileTo.mockReturnValue({ downloadId: 999, downloadIdPromise: Promise.resolve(999), promise: Promise.resolve() } as any);
    mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([]);
    mockedBackgroundDownloadService.moveCompletedDownload.mockResolvedValue('' as any);
    mockedBackgroundDownloadService.startProgressPolling.mockImplementation(() => {});
    mockedBackgroundDownloadService.stopProgressPolling.mockImplementation(() => {});
    mockedBackgroundDownloadService.onProgress.mockReturnValue(jest.fn());
    mockedBackgroundDownloadService.onComplete.mockReturnValue(jest.fn());
    mockedBackgroundDownloadService.onError.mockReturnValue(jest.fn());

    // Reset AsyncStorage defaults
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);
  });

  // ========================================================================
  // initialize
  // ========================================================================
  describe('initialize', () => {
    it('creates models directories when they do not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await modelManager.initialize();

      expect(RNFS.mkdir).toHaveBeenCalledTimes(2);
    });

    it('does not create dirs when they already exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.initialize();

      expect(RNFS.mkdir).not.toHaveBeenCalled();
    });

    it('excludes model directories from iCloud backup on initialize', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.initialize();

      expect(mockedBackgroundDownloadService.excludeFromBackup).toHaveBeenCalledTimes(3);
      expect(mockedBackgroundDownloadService.excludeFromBackup).toHaveBeenCalledWith(
        expect.stringContaining('/models'),
      );
      expect(mockedBackgroundDownloadService.excludeFromBackup).toHaveBeenCalledWith(
        expect.stringContaining('/image_models'),
      );
      expect(mockedBackgroundDownloadService.excludeFromBackup).toHaveBeenCalledWith(
        expect.stringContaining('/whisper-models'),
      );
    });
  });

  // ========================================================================
  // getDownloadedModels
  // ========================================================================
  describe('getDownloadedModels', () => {
    it('returns empty array when nothing stored', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);

      const models = await modelManager.getDownloadedModels();

      expect(models).toEqual([]);
    });

    it('returns stored models that exist on disk', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model1');
    });

    it('filters out models whose files no longer exist', async () => {
      const storedModels = [
        { id: 'exists', name: 'Exists', filePath: '/models/exists.gguf', fileSize: 100 },
        { id: 'gone', name: 'Gone', filePath: '/models/gone.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // exists.gguf
        .mockResolvedValueOnce(false); // gone.gguf

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('exists');
    });

    it('updates storage when invalid entries are removed', async () => {
      const storedModels = [
        { id: 'exists', name: 'Exists', filePath: '/models/exists.gguf', fileSize: 100 },
        { id: 'gone', name: 'Gone', filePath: '/models/gone.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await modelManager.getDownloadedModels();

      // Should save updated list (only the existing model)
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        expect.stringContaining('exists')
      );
    });

    it('returns empty array on parse error', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('invalid json{{{');

      const models = await modelManager.getDownloadedModels();

      expect(models).toEqual([]);
    });
  });

  // ========================================================================
  // deleteModel
  // ========================================================================
  describe('deleteModel', () => {
    it('deletes file and updates storage', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/mock/documents/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteModel('model1');

      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/models/m1.gguf');
      // Storage should be updated with empty list
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        '[]'
      );
    });

    it('also deletes mmproj file when present', async () => {
      const storedModels = [
        {
          id: 'model1',
          name: 'Model 1',
          filePath: '/mock/documents/models/m1.gguf',
          fileSize: 100,
          mmProjPath: '/mock/documents/models/mmproj.gguf',
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteModel('model1');

      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/models/m1.gguf');
      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/models/mmproj.gguf');
    });

    it('throws when model not found', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      await expect(modelManager.deleteModel('nonexistent')).rejects.toThrow('Model not found');
    });
  });

  // ========================================================================
  // getModelPath
  // ========================================================================
  describe('getModelPath', () => {
    it('returns path for existing model', async () => {
      const storedModels = [
        { id: 'model1', name: 'Model 1', filePath: '/models/m1.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const path = await modelManager.getModelPath('model1');
      expect(path).toBe('/models/m1.gguf');
    });

    it('returns null for missing model', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const path = await modelManager.getModelPath('nonexistent');
      expect(path).toBeNull();
    });
  });

  // ========================================================================
  // getStorageUsed
  // ========================================================================
  describe('getStorageUsed', () => {
    it('sums all model file sizes including mmproj', async () => {
      const storedModels = [
        { id: 'm1', filePath: '/m1.gguf', fileSize: 1000, mmProjFileSize: 200 },
        { id: 'm2', filePath: '/m2.gguf', fileSize: 2000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      const used = await modelManager.getStorageUsed();

      expect(used).toBe(3200); // 1000 + 200 + 2000
    });

    it('returns 0 when no models', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const used = await modelManager.getStorageUsed();
      expect(used).toBe(0);
    });
  });

  // ========================================================================
  // getAvailableStorage
  // ========================================================================
  describe('getAvailableStorage', () => {
    it('returns free space from RNFS', async () => {
      (RNFS as any).getFSInfo = jest.fn(() => Promise.resolve({
        freeSpace: 50 * 1024 * 1024 * 1024,
        totalSpace: 128 * 1024 * 1024 * 1024,
      }));

      const available = await modelManager.getAvailableStorage();

      expect(available).toBe(50 * 1024 * 1024 * 1024);
    });
  });

  // ========================================================================
  // getOrphanedFiles
  // ========================================================================
  describe('getOrphanedFiles', () => {
    it('finds untracked GGUF files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'orphan.gguf', path: '/models/orphan.gguf', size: 5000, isFile: () => true, isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([]); // image models dir empty
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].name).toBe('orphan.gguf');
    });

    it('excludes tracked files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'tracked.gguf', path: '/models/tracked.gguf', size: 5000, isFile: () => true, isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([]); // image models dir empty
      const storedModels = [{ id: 'm1', filePath: '/models/tracked.gguf', fileSize: 5000 }];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(0);
    });

    it('returns empty array when directory is empty', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toEqual([]);
    });

    it('finds orphaned image model directories', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([]) // text models dir empty
        .mockResolvedValueOnce([
          { name: 'anythingv5_cpu', path: '/image_models/anythingv5_cpu', size: 0, isFile: () => false, isDirectory: () => true } as any,
        ])
        .mockResolvedValueOnce([ // contents of orphaned image model dir
          { name: 'model.onnx', path: '/image_models/anythingv5_cpu/model.onnx', size: 500000, isFile: () => true, isDirectory: () => false } as any,
        ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].name).toBe('anythingv5_cpu');
      expect(orphaned[0].size).toBe(500000);
    });
  });

  // ========================================================================
  // determineCredibility
  // ========================================================================
  describe('determineCredibility', () => {
    it('recognizes lmstudio-community source', () => {
      const result = determineCredibility('lmstudio-community');
      expect(result.source).toBe('lmstudio');
      expect(result.isVerifiedQuantizer).toBe(true);
    });

    it('recognizes official model authors', () => {
      const result = determineCredibility('meta-llama');
      expect(result.source).toBe('official');
      expect(result.isOfficial).toBe(true);
    });

    it('recognizes verified quantizers', () => {
      const result = determineCredibility('TheBloke');
      expect(result.source).toBe('verified-quantizer');
      expect(result.isVerifiedQuantizer).toBe(true);
    });

    it('defaults to community for unknown authors', () => {
      const result = determineCredibility('random-user');
      expect(result.source).toBe('community');
      expect(result.isOfficial).toBe(false);
      expect(result.isVerifiedQuantizer).toBe(false);
    });
  });

  // ========================================================================
  // downloadModelBackground
  // ========================================================================
  describe('downloadModelBackground', () => {
    const file = createModelFile({
      name: 'bg-model.gguf',
      size: 8000000000,
      quantization: 'Q4_K_M',
    });

    it('throws when not supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      await expect(
        modelManager.downloadModelBackground('test/model', file)
      ).rejects.toThrow('Background downloads not supported');
    });

    it('skips download when files already exist', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');
      mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);

      const onComplete = jest.fn();
      const result = await modelManager.downloadModelBackground('test/model', file);
      modelManager.watchDownload(result.downloadId, onComplete);

      // onComplete is now called after persistDownloadedModel resolves — flush microtasks
      await new Promise(resolve => setImmediate(resolve));

      expect(result.status).toBe('completed');
      expect(onComplete).toHaveBeenCalled();
      expect(mockedBackgroundDownloadService.startDownload).not.toHaveBeenCalled();
    });

    it('starts background download for main model', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(true);  // mmProjExists (no mmproj)

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: '42',
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      const result = await modelManager.downloadModelBackground('test/model', file);

      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalled();
      expect(result.downloadId).toBe('42');
    });

    it('sets up progress listener during start and complete/error via watchDownload', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: '42',
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      const info = await modelManager.downloadModelBackground('test/model', file);
      modelManager.watchDownload(info.downloadId, jest.fn(), jest.fn());

      expect(mockedBackgroundDownloadService.onProgress).toHaveBeenCalledWith('42', expect.any(Function));
      expect(mockedBackgroundDownloadService.onComplete).toHaveBeenCalledWith('42', expect.any(Function));
      expect(mockedBackgroundDownloadService.onError).toHaveBeenCalledWith('42', expect.any(Function));
    });

    it('calls metadata callback with download info', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: '42',
        fileName: 'bg-model.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 8000000000,
        startedAt: Date.now(),
      } as any);

      const metadataCallback = jest.fn();
      modelManager.setBackgroundDownloadMetadataCallback(metadataCallback);

      await modelManager.downloadModelBackground('test/model', file);

      expect(metadataCallback).toHaveBeenCalledWith('42', expect.objectContaining({
        modelId: 'test/model',
        fileName: 'bg-model.gguf',
      }));
    });

    it('downloads mmproj in parallel via startDownload when present', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      const visionFile = createModelFileWithMmProj({
        name: 'vision.gguf',
        size: 4000000000,
        mmProjName: 'mmproj.gguf',
        mmProjSize: 500000000,
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(false); // mmproj doesn't exist

      mockedBackgroundDownloadService.startDownload
        .mockResolvedValueOnce({
          downloadId: '42',
          fileName: 'vision.gguf',
          modelId: 'test/model',
          status: 'pending',
          bytesDownloaded: 0,
          totalBytes: 4000000000,
          startedAt: Date.now(),
        } as any)
        .mockResolvedValueOnce({
          downloadId: 43,
          fileName: 'mmproj.gguf',
          modelId: 'test/model',
          status: 'pending',
          bytesDownloaded: 0,
          totalBytes: 500000000,
          startedAt: Date.now(),
        } as any);

      await modelManager.downloadModelBackground('test/model', visionFile);

      // Both main and mmproj should be started via startDownload (parallel)
      expect(RNFS.downloadFile).not.toHaveBeenCalled();
      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalledTimes(2);
      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'vision.gguf' }),
      );
      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'vision-mmproj.gguf' }),
      );
    });

    it('uses file.downloadUrl when set (cross-repo curated entries)', async () => {
      // Curated entries (e.g. LiteRT recommended) carry an explicit downloadUrl that
      // points at a different repo than the parent modelId. The download path must
      // honor it instead of constructing one from modelId + file.name.
      const customUrl = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm';
      const curated = createModelFile({
        name: 'gemma-4-E2B-it.litertlm',
        size: 2_590_000_000,
        quantization: 'mixed',
        downloadUrl: customUrl,
      });

      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(true);  // mmProjExists (no mmproj)

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: 99,
        fileName: 'gemma-4-E2B-it.litertlm',
        modelId: 'offgrid/litert-recommended',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: curated.size,
        startedAt: Date.now(),
      } as any);

      await modelManager.downloadModelBackground('offgrid/litert-recommended', curated);

      expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ url: customUrl }),
      );
    });
  });

  describe('resetMmProjForRetry', () => {
    it('restores mmproj completion flags and local path for retried sidecars', () => {
      const file = createModelFileWithMmProj({
        name: 'vision.gguf',
        size: 4_000_000_000,
        quantization: 'Q4_K_M',
        mmProjName: 'mmproj.gguf',
        mmProjSize: 500_000_000,
        mmProjDownloadUrl: 'https://huggingface.co/test/model/resolve/main/mmproj.gguf',
      });
      const ctx = {
        modelId: 'test/model',
        file,
        localPath: '/mock/documents/models/vision.gguf',
        mmProjLocalPath: null,
        mmProjDownloadId: '43',
        mmProjCompleted: true,
        mmProjCompleteHandled: true,
        mainCompleted: false,
        mainCompleteHandled: false,
        isFinalizing: false,
      };
      (modelManager as any).backgroundDownloadContext.set('42', ctx);

      modelManager.resetMmProjForRetry('42');

      expect(ctx.mmProjCompleted).toBe(false);
      expect(ctx.mmProjCompleteHandled).toBe(false);
      expect(ctx.mmProjLocalPath).toBe('/mock/documents/models/vision-mmproj.gguf');
    });

    it('leaves entries without mmproj download untouched', () => {
      const file = createModelFile({ name: 'model.gguf', size: 4_000_000_000 });
      const ctx = {
        modelId: 'test/model',
        file,
        localPath: '/mock/documents/models/model.gguf',
        mmProjLocalPath: null,
        mmProjCompleted: true,
        mmProjCompleteHandled: true,
      };
      (modelManager as any).backgroundDownloadContext.set('99', ctx);

      modelManager.resetMmProjForRetry('99');

      expect(ctx.mmProjCompleted).toBe(true);
      expect(ctx.mmProjCompleteHandled).toBe(true);
      expect(ctx.mmProjLocalPath).toBeNull();
    });
  });

  // ========================================================================
  // syncBackgroundDownloads
  // ========================================================================
  describe('syncBackgroundDownloads', () => {
    it('returns empty when not supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      const result = await modelManager.syncBackgroundDownloads({}, jest.fn());

      expect(result).toEqual([]);
    });

    it('processes completed downloads', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true); // dirs exist
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 1,
          fileName: 'model.gguf',
          modelId: 'test/model',
          status: 'completed',
          bytesDownloaded: 4000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);
      mockedBackgroundDownloadService.moveCompletedDownload.mockResolvedValue('/models/model.gguf');
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads(
        {
          1: {
            modelId: 'test/model',
            fileName: 'model.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(result).toHaveLength(1);
      expect(clearCb).toHaveBeenCalledWith(1);
    });

    it('clears failed downloads', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 2,
          fileName: 'failed.gguf',
          modelId: 'test/failed',
          status: 'failed',
          bytesDownloaded: 100,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      await modelManager.syncBackgroundDownloads(
        {
          2: {
            modelId: 'test/failed',
            fileName: 'failed.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(clearCb).toHaveBeenCalledWith(2);
    });

    it('skips downloads with no metadata', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 99,
          fileName: 'unknown.gguf',
          modelId: 'unknown',
          status: 'completed',
          bytesDownloaded: 4000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads({}, clearCb);

      // No metadata for downloadId 99, so it's skipped
      expect(result).toHaveLength(0);
      expect(clearCb).not.toHaveBeenCalled();
    });

    it('leaves running downloads as-is', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      mockedRNFS.exists.mockResolvedValue(true);
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 3,
          fileName: 'running.gguf',
          modelId: 'test/running',
          status: 'running',
          bytesDownloaded: 2000,
          totalBytes: 4000,
          startedAt: 12345,
        } as any,
      ]);

      const clearCb = jest.fn();
      const result = await modelManager.syncBackgroundDownloads(
        {
          3: {
            modelId: 'test/running',
            fileName: 'running.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4000,
          },
        },
        clearCb
      );

      expect(result).toHaveLength(0);
      expect(clearCb).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // scanForUntrackedTextModels
  // ========================================================================
  describe('scanForUntrackedTextModels', () => {
    it('discovers untracked GGUF files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'untracked-Q4_K_M.gguf',
          path: '/models/untracked-Q4_K_M.gguf',
          size: 4000000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].fileName).toBe('untracked-Q4_K_M.gguf');
      expect(discovered[0].quantization).toBe('Q4_K_M');
    });

    it('skips mmproj files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'model-mmproj-f16.gguf',
          path: '/models/model-mmproj-f16.gguf',
          size: 500000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toHaveLength(0);
    });

    it('parses quantization from filename', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'llama-7b-Q8_0.gguf',
          path: '/models/llama-7b-Q8_0.gguf',
          size: 7000000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered[0].quantization).toBe('Q8_0');
    });

    it('returns empty when directory is empty', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toEqual([]);
    });
  });

  // ========================================================================
  // scanForUntrackedImageModels
  // ========================================================================
  describe('scanForUntrackedImageModels', () => {
    const IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';

    it('discovers untracked model directories', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      // readDir is called for:
      // 1. imageModelsDir listing (the scan itself)
      // 2. files inside the discovered model dir
      mockedRNFS.readDir.mockImplementation((dir: string) => {
        if (dir.includes('image_models') && !dir.includes('sd-turbo-mnn')) {
          return Promise.resolve([
            {
              name: 'sd-turbo-mnn',
              path: '/mock/documents/image_models/sd-turbo-mnn',
              size: 0,
              isFile: () => false,
              isDirectory: () => true,
            } as any,
          ]);
        }
        if (dir.includes('sd-turbo-mnn')) {
          return Promise.resolve([
            {
              name: 'model.onnx',
              path: '/mock/documents/image_models/sd-turbo-mnn/model.onnx',
              size: 2000000000,
              isFile: () => true,
              isDirectory: () => false,
            } as any,
          ]);
        }
        return Promise.resolve([]);
      });

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].name).toContain('sd-turbo-mnn');
    });

    it('determines backend from directory name', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          {
            name: 'model-qnn-8gen3',
            path: '/mock/documents/image_models/model-qnn-8gen3',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            name: 'model.bin',
            path: '/mock/documents/image_models/model-qnn-8gen3/model.bin',
            size: 1000000000,
            isFile: () => true,
            isDirectory: () => false,
          } as any,
        ]);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].backend).toBe('qnn');
    });

    it('skips already registered models', async () => {
      const registeredModel = {
        id: 'existing',
        name: 'Existing Model',
        modelPath: '/mock/documents/image_models/existing-model',
        size: 2000000000,
        downloadedAt: new Date().toISOString(),
      };

      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValueOnce([
        {
          name: 'existing-model',
          path: '/mock/documents/image_models/existing-model',
          size: 0,
          isFile: () => false,
          isDirectory: () => true,
        } as any,
      ]);

      mockedAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === IMAGE_MODELS_KEY) {
          return Promise.resolve(JSON.stringify([registeredModel]));
        }
        return Promise.resolve('[]');
      });

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(0);
    });

    it('returns empty when directory does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toEqual([]);
    });
  });

  // ========================================================================
  // resolveStoredPath
  // ========================================================================
  describe('resolveStoredPath', () => {
    it('returns re-resolved path when UUID changes', () => {
      const storedPath = '/old-uuid/Documents/models/mymodel.gguf';
      const currentBaseDir = '/new-uuid/Documents/models';

      const result = resolveStoredPath(storedPath, currentBaseDir);
      expect(result).toBe('/new-uuid/Documents/models/mymodel.gguf');
    });

    it('returns null when stored path does not match base directory pattern', () => {
      const storedPath = '/completely/different/path/model.gguf';
      const currentBaseDir = '/new-uuid/Documents/models';

      const result = resolveStoredPath(storedPath, currentBaseDir);
      expect(result).toBeNull();
    });

    it('returns null when relative part is empty', () => {
      // storedPath ends with the marker directory itself (no file after it)
      const storedPath = '/old-uuid/Documents/models/';
      const currentBaseDir = '/new-uuid/Documents/models';

      const result = resolveStoredPath(storedPath, currentBaseDir);
      expect(result).toBeNull();
    });

    it('handles nested subdirectories', () => {
      const storedPath = '/old-uuid/Documents/image_models/sd-turbo/model.onnx';
      const currentBaseDir = '/new-uuid/Documents/image_models';

      const result = resolveStoredPath(storedPath, currentBaseDir);
      expect(result).toBe('/new-uuid/Documents/image_models/sd-turbo/model.onnx');
    });
  });

  // ========================================================================
  // isMMProjFile
  // ========================================================================
  describe('isMMProjFile', () => {
    it('detects mmproj filenames', () => {
      expect(isMMProjFile('model-mmproj-f16.gguf')).toBe(true);
      expect(isMMProjFile('Qwen3VL-2B-mmproj-Q4_0.gguf')).toBe(true);
    });

    it('detects projector filenames', () => {
      expect(isMMProjFile('model-projector-f16.gguf')).toBe(true);
    });

    it('detects clip .gguf filenames', () => {
      expect(isMMProjFile('clip-vit-large.gguf')).toBe(true);
    });

    it('rejects non-mmproj filenames', () => {
      expect(isMMProjFile('llama-3.2-3B-Q4_K_M.gguf')).toBe(false);
      expect(isMMProjFile('Qwen3-8B-Instruct-Q4_K_M.gguf')).toBe(false);
      expect(isMMProjFile('phi-3-mini.gguf')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isMMProjFile('Model-MMPROJ-F16.GGUF')).toBe(true);
      expect(isMMProjFile('CLIP-model.gguf')).toBe(true);
    });
  });

  // ========================================================================
  // cleanupMMProjEntries
  // ========================================================================
  describe('cleanupMMProjEntries', () => {
    it('removes mmproj entries from models list', async () => {
      const storedModels = [
        { id: 'model1', name: 'Real Model', fileName: 'model-Q4_K_M.gguf', filePath: '/models/model-Q4_K_M.gguf', fileSize: 4000000000 },
        { id: 'mmproj1', name: 'MMProj', fileName: 'model-mmproj-f16.gguf', filePath: '/models/model-mmproj-f16.gguf', fileSize: 500000000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);

      const removedCount = await modelManager.cleanupMMProjEntries();

      expect(removedCount).toBe(1);
      // Saved list should only contain the real model
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        expect.not.stringContaining('mmproj1')
      );
    });

    it('handles empty model list', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);

      const removedCount = await modelManager.cleanupMMProjEntries();

      expect(removedCount).toBe(0);
    });

    it('links orphaned mmproj files to matching vision models', async () => {
      const storedModels = [
        {
          id: 'vision1',
          name: 'Qwen3VL-2B-Instruct',
          fileName: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf',
          filePath: '/models/Qwen3VL-2B-Instruct-Q4_K_M.gguf',
          fileSize: 2000000000,
          isVisionModel: false,
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'Qwen3VL-2B-Instruct-mmproj-f16.gguf',
          path: '/models/Qwen3VL-2B-Instruct-mmproj-f16.gguf',
          size: 300000000,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);

      await modelManager.cleanupMMProjEntries();

      // The saved model list should have the mmproj linked
      const savedCall = mockedAsyncStorage.setItem.mock.calls.find(
        (call) => call[0] === MODELS_STORAGE_KEY
      );
      expect(savedCall).toBeDefined();
      const savedModels = JSON.parse(savedCall![1]);
      expect(savedModels[0].isVisionModel).toBe(true);
      expect(savedModels[0].mmProjFileName).toBe('Qwen3VL-2B-Instruct-mmproj-f16.gguf');
    });

    it('returns count of removed entries', async () => {
      const storedModels = [
        { id: 'm1', name: 'Model', fileName: 'model.gguf', filePath: '/models/model.gguf', fileSize: 1000 },
        { id: 'p1', name: 'Proj1', fileName: 'proj-mmproj.gguf', filePath: '/models/proj-mmproj.gguf', fileSize: 100 },
        { id: 'p2', name: 'Proj2', fileName: 'clip-model.gguf', filePath: '/models/clip-model.gguf', fileSize: 100 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);

      const removedCount = await modelManager.cleanupMMProjEntries();

      expect(removedCount).toBe(2);
    });
  });

  // ========================================================================
  // importLocalModel
  // ========================================================================
  describe('importLocalModel', () => {
    beforeEach(() => {
      // Override Platform.OS for these tests
      jest.spyOn(require('react-native'), 'Platform', 'get').mockReturnValue({ OS: 'ios' } as any);
    });

    it('imports valid .gguf file successfully', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false); // destExists = false
      mockedRNFS.stat.mockResolvedValue({ size: 2000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/source.gguf',
        fileName: 'MyModel-Q4_K_M.gguf',
      });

      expect(result.id).toBe('local_import/MyModel-Q4_K_M.gguf');
      expect(result.author).toBe('Local Import');
      expect(result.quantization).toBe('Q4_K_M');
      expect(result.fileName).toBe('MyModel-Q4_K_M.gguf');
    });

    it('rejects non-.gguf files', async () => {
      await expect(
        modelManager.importLocalModel({ sourceUri: '/path/to/model.bin', fileName: 'model.bin' })
      ).rejects.toThrow('Only .gguf and .litertlm files can be imported');
    });

    it('rejects when destination already exists', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)  // modelsDir
        .mockResolvedValueOnce(true)  // imageModelsDir
        .mockResolvedValue(true);     // destExists = true
      mockedRNFS.stat.mockResolvedValue({ size: 1000, isFile: () => true } as any);

      await expect(
        modelManager.importLocalModel({ sourceUri: '/path/to/source.gguf', fileName: 'existing.gguf' })
      ).rejects.toThrow('already exists');
    });

    it('parses quantization from filename', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockedRNFS.stat.mockResolvedValue({ size: 1000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/source.gguf',
        fileName: 'llama-3.2-3B-Q8_0.gguf',
      });

      expect(result.quantization).toBe('Q8_0');
    });

    it('sets quantization to Unknown when not parseable', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockedRNFS.stat.mockResolvedValue({ size: 1000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/source.gguf',
        fileName: 'custom-model.gguf',
      });

      expect(result.quantization).toBe('Unknown');
    });

    it('adds imported model to storage', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockedRNFS.stat.mockResolvedValue({ size: 1000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      await modelManager.importLocalModel({ sourceUri: '/path/to/source.gguf', fileName: 'imported.gguf' });

      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        MODELS_STORAGE_KEY,
        expect.stringContaining('local_import/imported.gguf')
      );
    });

    it('handles copy failure gracefully', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockedRNFS.stat.mockResolvedValue({ size: 1000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockRejectedValue(new Error('Copy failed'));

      await expect(
        modelManager.importLocalModel({ sourceUri: '/path/to/source.gguf', fileName: 'fail.gguf' })
      ).rejects.toThrow('Copy failed');

      // Partial file should be cleaned up
      expect(RNFS.unlink).toHaveBeenCalled();
    });

    it('reports progress during copy', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false); // dest doesn't exist
      mockedRNFS.stat.mockResolvedValue({ size: 1000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onProgress = jest.fn();
      await modelManager.importLocalModel({
        sourceUri: '/path/to/source.gguf',
        fileName: 'progress-model.gguf',
        onProgress,
      });

      // At minimum, progress should be called with 1.0 at completion
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ fraction: 1, fileName: 'progress-model.gguf' })
      );
    });
  });

  // ========================================================================
  // refreshModelLists
  // ========================================================================
  describe('refreshModelLists', () => {
    it('calls both scan functions and returns combined results', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.refreshModelLists();

      expect(result).toHaveProperty('textModels');
      expect(result).toHaveProperty('imageModels');
      expect(Array.isArray(result.textModels)).toBe(true);
      expect(Array.isArray(result.imageModels)).toBe(true);
    });

    it('returns existing models even when scan finds nothing new', async () => {
      const storedModels = [
        { id: 'm1', name: 'Model 1', filePath: '/models/m1.gguf', fileName: 'm1.gguf', fileSize: 1000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        { name: 'm1.gguf', path: '/models/m1.gguf', size: 1000, isFile: () => true, isDirectory: () => false } as any,
      ]);

      const result = await modelManager.refreshModelLists();

      expect(result.textModels.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // saveModelWithMmproj
  // ========================================================================
  describe('saveModelWithMmproj', () => {
    it('updates model with mmproj info and persists', async () => {
      const storedModels = [
        { id: 'model1', name: 'Test', filePath: '/models/m1.gguf', fileName: 'm1.gguf', fileSize: 1000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 300000000 } as any);

      await modelManager.saveModelWithMmproj('model1', '/models/mmproj.gguf');

      const savedCall = mockedAsyncStorage.setItem.mock.calls.find(
        (call) => call[0] === MODELS_STORAGE_KEY
      );
      expect(savedCall).toBeDefined();
      const savedModels = JSON.parse(savedCall![1]);
      expect(savedModels[0].mmProjPath).toBe('/models/mmproj.gguf');
      expect(savedModels[0].isVisionModel).toBe(true);
    });

    it('derives mmProjFileSize from RNFS.stat', async () => {
      const storedModels = [
        { id: 'model1', name: 'Test', filePath: '/models/m1.gguf', fileName: 'm1.gguf', fileSize: 1000 },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 300000000 } as any);

      await modelManager.saveModelWithMmproj('model1', '/models/mmproj.gguf');

      const savedCall = mockedAsyncStorage.setItem.mock.calls.find(
        (call) => call[0] === MODELS_STORAGE_KEY
      );
      const savedModels = JSON.parse(savedCall![1]);
      expect(savedModels[0].mmProjFileSize).toBe(300000000);
    });
  });

  // ========================================================================
  // Additional branch coverage tests
  // ========================================================================
  describe('deleteOrphanedFile when file does not exist', () => {
    it('handles missing file gracefully', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      // deleteOrphanedFile should not throw when file doesn't exist
      await expect(
        modelManager.deleteOrphanedFile('/models/nonexistent.gguf')
      ).resolves.not.toThrow();
    });
  });

  describe('cancelBackgroundDownload when not supported', () => {
    it('throws when background service is unavailable', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      await expect(modelManager.cancelBackgroundDownload('42')).rejects.toThrow(
        'Background downloads not supported'
      );

      expect(mockedBackgroundDownloadService.cancelDownload).not.toHaveBeenCalled();
    });
  });

  describe('scanForUntrackedTextModels tiny files', () => {
    it('skips files smaller than 1MB', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'tiny-model.gguf',
          path: '/models/tiny-model.gguf',
          size: 500000, // 500KB - under 1MB threshold
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered).toHaveLength(0);
    });
  });

  describe('getOrphanedFiles with directory read error', () => {
    it('returns empty when image model dir read fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([]) // text models dir empty
        .mockRejectedValueOnce(new Error('Permission denied')); // image models dir fails
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      // Should not throw, just return what it could read
      expect(Array.isArray(orphaned)).toBe(true);
    });
  });

  describe('deleteModel mmProjPath catch branch', () => {
    it('continues when mmProjPath deletion fails', async () => {
      const storedModels = [
        {
          id: 'model1',
          name: 'Model 1',
          filePath: '/mock/documents/models/m1.gguf',
          fileSize: 100,
          mmProjPath: '/mock/documents/models/mmproj.gguf',
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));
      mockedRNFS.exists.mockResolvedValue(true);

      // Main file unlink succeeds, mmProj unlink fails
      mockedRNFS.unlink
        .mockResolvedValueOnce(undefined as any)  // main file
        .mockRejectedValueOnce(new Error('Permission denied'));  // mmproj

      // Should not throw - mmproj deletion failure is caught
      await modelManager.deleteModel('model1');

      // Main file should have been unlinked
      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/models/m1.gguf');
    });
  });

  describe('getDownloadedModels path re-resolution', () => {
    it('re-resolves text model path when original path not found', async () => {
      const storedModels = [
        {
          id: 'model-ios',
          name: 'iOS Model',
          filePath: '/old-uuid/Documents/models/model.gguf',
          fileSize: 4000000000,
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));

      // First exists check fails (old UUID), re-resolved path works
      mockedRNFS.exists
        .mockResolvedValueOnce(false)  // original path fails
        .mockResolvedValueOnce(true);  // re-resolved path works

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      // Path should be updated
      expect(models[0].filePath).toContain('model.gguf');
    });

    it('re-resolves mmProjPath when original path not found', async () => {
      const storedModels = [
        {
          id: 'model-mm',
          name: 'Vision Model',
          filePath: '/new-uuid/Documents/models/vision.gguf',
          fileSize: 4000000000,
          mmProjPath: '/old-uuid/Documents/models/mmproj.gguf',
        },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(storedModels));

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // model file exists
        .mockResolvedValueOnce(false)  // mmproj original path fails
        .mockResolvedValueOnce(true);  // re-resolved mmproj path works

      const models = await modelManager.getDownloadedModels();

      expect(models).toHaveLength(1);
      expect((models[0] as any).mmProjPath).toBeDefined();
    });
  });

  describe('getDownloadedImageModels path re-resolution', () => {
    it('re-resolves image model path when original not found', async () => {
      const IMAGE_MODELS_KEY = '@local_llm/downloaded_image_models';
      const storedModels = [
        {
          id: 'img-model-ios',
          name: 'SD Model',
          modelPath: '/old-uuid/Documents/image_models/sd-turbo',
          size: 2000000000,
          downloadedAt: new Date().toISOString(),
        },
      ];

      mockedAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === IMAGE_MODELS_KEY) {
          return Promise.resolve(JSON.stringify(storedModels));
        }
        return Promise.resolve('[]');
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(false)  // original path fails
        .mockResolvedValueOnce(true);  // re-resolved path works

      const models = await modelManager.getDownloadedImageModels();

      expect(models).toHaveLength(1);
    });
  });

  describe('getOrphanedFiles image model isFile branch', () => {
    it('uses file size directly for orphaned image model files', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([]) // text models dir empty
        .mockResolvedValueOnce([
          { name: 'orphan-model.onnx', path: '/image_models/orphan-model.onnx', size: 3000000, isFile: () => true, isDirectory: () => false } as any,
        ]);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned).toHaveLength(1);
      expect(orphaned[0].size).toBe(3000000);
    });
  });

  describe('scanForUntrackedImageModels coreml backend detection', () => {
    it('detects coreml backend from directory name', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          {
            name: 'sd21-coreml-compiled',
            path: '/mock/documents/image_models/sd21-coreml-compiled',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          } as any,
        ])
        .mockResolvedValueOnce([
          {
            name: 'model.mlmodelc',
            path: '/mock/documents/image_models/sd21-coreml-compiled/model.mlmodelc',
            size: 1500000000,
            isFile: () => true,
            isDirectory: () => false,
          } as any,
        ]);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(1);
      expect(discovered[0].backend).toBe('coreml');
    });

    it('skips empty directories', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          {
            name: 'empty-model',
            path: '/mock/documents/image_models/empty-model',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          } as any,
        ])
        .mockResolvedValueOnce([]); // empty directory

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(0);
    });
  });

  describe('scanForUntrackedImageModels readDir error', () => {
    it('skips directory when readDir fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir
        .mockResolvedValueOnce([
          {
            name: 'unreadable-model',
            path: '/mock/documents/image_models/unreadable-model',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          } as any,
        ])
        .mockRejectedValueOnce(new Error('Permission denied'));

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      // Should skip the unreadable directory
      expect(discovered).toHaveLength(0);
    });
  });

  describe('scanForUntrackedImageModels skips non-directories', () => {
    it('skips files in image models directory', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.readDir.mockResolvedValueOnce([
        {
          name: 'stray-file.txt',
          path: '/mock/documents/image_models/stray-file.txt',
          size: 100,
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered).toHaveLength(0);
    });
  });

  describe('downloadModelBackground complete handler', () => {
    it('processes completed background download with mmproj', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      const visionFile = createModelFileWithMmProj({
        name: 'bg-vision.gguf',
        size: 4000000000,
        mmProjName: 'bg-mmproj.gguf',
        mmProjSize: 500000000,
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // main doesn't exist
        .mockResolvedValueOnce(false); // mmproj doesn't exist

      mockedBackgroundDownloadService.startDownload
        .mockResolvedValueOnce({
          downloadId: '42',
          fileName: 'bg-vision.gguf',
          modelId: 'test/model',
          status: 'pending',
          bytesDownloaded: 0,
          totalBytes: 4000000000,
          startedAt: Date.now(),
        } as any)
        .mockResolvedValueOnce({
          downloadId: 43,
          fileName: 'bg-mmproj.gguf',
          modelId: 'test/model',
          status: 'pending',
          bytesDownloaded: 0,
          totalBytes: 500000000,
          startedAt: Date.now(),
        } as any);

      // Capture completion callbacks for both main (42) and mmproj (43)
      const completeCallbacks: Record<string, any> = {};
      mockedBackgroundDownloadService.onComplete.mockImplementation((id: string, cb: any) => {
        completeCallbacks[id] = cb;
        return jest.fn();
      });

      const onComplete = jest.fn();
      const info = await modelManager.downloadModelBackground('test/model', visionFile);
      modelManager.watchDownload(info.downloadId, onComplete);

      // Simulate mmproj completing first, then main
      mockedBackgroundDownloadService.moveCompletedDownload.mockResolvedValue('/models/bg-vision.gguf');
      mockedRNFS.exists.mockResolvedValue(true); // mmproj exists after move
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      // mmproj completes
      if (completeCallbacks['43']) {
        await completeCallbacks['43']({ downloadId: '43', fileName: 'bg-mmproj.gguf' });
      }
      // onComplete should NOT fire yet — main still running
      expect(onComplete).not.toHaveBeenCalled();

      // main completes
      if (completeCallbacks['42']) {
        await completeCallbacks['42']({ downloadId: '42', fileName: 'bg-vision.gguf' });
      }
      // Now both are done, onComplete should fire
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('downloadModelBackground error handler', () => {
    it('calls onError when background download fails', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      const file = createModelFile({
        name: 'bg-fail.gguf',
        size: 4000000000,
        quantization: 'Q4_K_M',
      });

      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      mockedBackgroundDownloadService.startDownload.mockResolvedValue({
        downloadId: '99',
        fileName: 'bg-fail.gguf',
        modelId: 'test/model',
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 4000000000,
        startedAt: Date.now(),
      } as any);

      let errorCallback: any;
      mockedBackgroundDownloadService.onError.mockImplementation((id: string, cb: any) => {
        errorCallback = cb;
        return jest.fn();
      });

      const onError = jest.fn();
      const info = await modelManager.downloadModelBackground('test/model', file);
      modelManager.watchDownload(info.downloadId, undefined, onError);

      // Simulate the error event
      if (errorCallback) {
        await errorCallback({ downloadId: '99', reason: 'Network error' });
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      }
    });
  });

  describe('repairMmProj', () => {
    it('emits onDownloadIdReady with the download id from startDownload', async () => {
      const saveSpy = jest.spyOn(modelManager, 'saveModelWithMmproj').mockResolvedValue(undefined);
      const initSpy = jest.spyOn(modelManager, 'initialize').mockResolvedValue(undefined);
      try {
        mockedBackgroundDownloadService.startDownload.mockResolvedValue({ downloadId: '321' } as any);

        let completeCallback!: (event: any) => void;
        mockedBackgroundDownloadService.onComplete.mockImplementation((_id: string, cb: any) => {
          completeCallback = cb;
          return jest.fn();
        });

        const onDownloadIdReady = jest.fn();
        const file = createModelFileWithMmProj({ name: 'vision-model.gguf', mmProjName: 'vision-model-mmproj.gguf' });
        const repairPromise = modelManager.repairMmProj('test/model', file, { onDownloadIdReady });

        // Flush all microtasks (initialize → RNFS.exists → startDownload)
        await new Promise(resolve => setImmediate(resolve));

        expect(mockedBackgroundDownloadService.startDownload).toHaveBeenCalled();
        expect(onDownloadIdReady).toHaveBeenCalledWith('321');

        // Resolve the download
        completeCallback({ localUri: 'file:///models/vision-model-mmproj.gguf' });
        await repairPromise;
      } finally {
        initSpy.mockRestore();
        saveSpy.mockRestore();
      }
    });
  });

  // ========================================================================
  // getActiveBackgroundDownloads
  // ========================================================================
  describe('getActiveBackgroundDownloads', () => {
    it('returns empty array when background downloads not supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      const result = await modelManager.getActiveBackgroundDownloads();
      expect(result).toEqual([]);
    });

    it('delegates to backgroundDownloadService when supported', async () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);
      const mockDownloads = [
        { downloadId: 1, fileName: 'model.gguf', modelId: 'test', status: 'running', bytesDownloaded: 100, totalBytes: 1000, startedAt: Date.now() },
      ];
      mockedBackgroundDownloadService.getActiveDownloads.mockResolvedValue(mockDownloads as any);

      const result = await modelManager.getActiveBackgroundDownloads();
      expect(result).toEqual(mockDownloads);
      expect(mockedBackgroundDownloadService.getActiveDownloads).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // startBackgroundDownloadPolling / stopBackgroundDownloadPolling
  // ========================================================================
  describe('startBackgroundDownloadPolling', () => {
    it('does nothing when background downloads not supported', () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      modelManager.startBackgroundDownloadPolling();
      expect(mockedBackgroundDownloadService.startProgressPolling).not.toHaveBeenCalled();
    });

    it('delegates when supported', () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      modelManager.startBackgroundDownloadPolling();
      expect(mockedBackgroundDownloadService.startProgressPolling).toHaveBeenCalled();
    });
  });

  describe('stopBackgroundDownloadPolling', () => {
    it('does nothing when background downloads not supported', () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(false);

      modelManager.stopBackgroundDownloadPolling();
      expect(mockedBackgroundDownloadService.stopProgressPolling).not.toHaveBeenCalled();
    });

    it('delegates when supported', () => {
      mockedBackgroundDownloadService.isAvailable.mockReturnValue(true);

      modelManager.stopBackgroundDownloadPolling();
      expect(mockedBackgroundDownloadService.stopProgressPolling).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getImageModelsDirectory
  // ========================================================================
  describe('getImageModelsDirectory', () => {
    it('returns the image models directory path', () => {
      const dir = modelManager.getImageModelsDirectory();
      expect(dir).toContain('image_models');
    });
  });

  // ========================================================================
  // deleteImageModel
  // ========================================================================
  describe('deleteImageModel', () => {
    it('throws when image model not found', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      await expect(modelManager.deleteImageModel('nonexistent')).rejects.toThrow('Image model not found');
    });

    it('deletes model files and updates storage', async () => {
      const imageModel = {
        id: 'img-delete',
        name: 'Delete Me',
        description: 'Test',
        modelPath: '/mock/documents/image_models/delete-model',
        size: 2000000000,
        downloadedAt: new Date().toISOString(),
        backend: 'mnn',
      };
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([imageModel]));
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteImageModel('img-delete');

      // deleteImageModel now deletes the top-level model directory, not model.modelPath
      // (for CoreML models, modelPath is a nested subdir; top-level dir also has tokenizer files)
      expect(mockedRNFS.unlink).toHaveBeenCalledWith('/mock/documents/image_models/img-delete');
      expect(mockedAsyncStorage.setItem).toHaveBeenCalled();
    });

    it('skips file deletion when model path does not exist on disk', async () => {
      const imageModel = {
        id: 'img-no-file',
        name: 'No File',
        description: 'Test',
        modelPath: '/mock/documents/image_models/missing',
        size: 1000,
        downloadedAt: new Date().toISOString(),
        backend: 'mnn',
      };
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([imageModel]));
      // First exists call: model validation in getDownloadedImageModels -> true (so model stays in list)
      // Second exists call: delete check -> false
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // getDownloadedImageModels validation
        .mockResolvedValueOnce(false); // deleteImageModel file check

      await modelManager.deleteImageModel('img-no-file');

      expect(mockedRNFS.unlink).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getImageModelPath
  // ========================================================================
  describe('getImageModelPath', () => {
    it('returns model path when found', async () => {
      const imageModel = {
        id: 'img-path',
        name: 'Path Model',
        modelPath: '/mock/image_models/path-model',
        size: 1000,
        downloadedAt: new Date().toISOString(),
        backend: 'mnn',
      };
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([imageModel]));
      mockedRNFS.exists.mockResolvedValue(true); // model exists on disk

      const result = await modelManager.getImageModelPath('img-path');
      expect(result).toBe('/mock/image_models/path-model');
    });

    it('returns null when model not found', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.getImageModelPath('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // getImageModelsStorageUsed
  // ========================================================================
  describe('getImageModelsStorageUsed', () => {
    it('returns total storage used by image models', async () => {
      const models = [
        { id: 'a', name: 'A', modelPath: '/a', size: 1000, downloadedAt: '', backend: 'mnn' },
        { id: 'b', name: 'B', modelPath: '/b', size: 2000, downloadedAt: '', backend: 'mnn' },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(models));
      mockedRNFS.exists.mockResolvedValue(true); // both models exist on disk

      const result = await modelManager.getImageModelsStorageUsed();
      expect(result).toBe(3000);
    });

    it('returns 0 when no image models', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);

      const result = await modelManager.getImageModelsStorageUsed();
      expect(result).toBe(0);
    });
  });

  // ========================================================================
  // addDownloadedImageModel
  // ========================================================================
  describe('addDownloadedImageModel', () => {
    it('adds new image model to registry', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const model = {
        id: 'new-img',
        name: 'New Image',
        description: 'Test',
        modelPath: '/mock/image_models/new-img',
        size: 2000000000,
        downloadedAt: new Date().toISOString(),
        backend: 'mnn' as const,
      };

      await modelManager.addDownloadedImageModel(model);

      expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
        '@local_llm/downloaded_image_models',
        expect.stringContaining('new-img')
      );
    });

    it('replaces existing image model with same ID', async () => {
      const existing = {
        id: 'replace-img',
        name: 'Old Name',
        description: 'Old',
        modelPath: '/mock/old',
        size: 1000,
        downloadedAt: '',
        backend: 'mnn',
      };
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([existing]));
      mockedRNFS.exists.mockResolvedValue(true); // existing model exists on disk

      const updated = {
        id: 'replace-img',
        name: 'New Name',
        description: 'New',
        modelPath: '/mock/new',
        size: 2000,
        downloadedAt: new Date().toISOString(),
        backend: 'mnn' as const,
      };

      await modelManager.addDownloadedImageModel(updated);

      const savedData = JSON.parse(mockedAsyncStorage.setItem.mock.calls[0][1]);
      expect(savedData).toHaveLength(1);
      expect(savedData[0].name).toBe('New Name');
    });
  });

  // ========================================================================
  // scanForUntrackedTextModels — edge cases
  // ========================================================================
  describe('scanForUntrackedTextModels edge cases', () => {
    it('returns empty when directory does not exist', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);
      mockedRNFS.exists.mockResolvedValue(false);

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toEqual([]);
    });

    it('discovers untracked GGUF files', async () => {
      // initialize: both dirs exist
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(true);  // modelsDir for scan

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')  // getDownloadedModels
        .mockResolvedValueOnce('[]'); // getDownloadedModels (for save)

      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'llama-3.2-Q4_K_M.gguf',
          path: '/mock/models/llama-3.2-Q4_K_M.gguf',
          size: 4000000000,
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const result = await modelManager.scanForUntrackedTextModels();

      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe('llama-3.2-Q4_K_M.gguf');
      expect(result[0].quantization).toBe('Q4_K_M');
    });

    it('skips mmproj files', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'model-mmproj-f16.gguf',
          path: '/mock/models/model-mmproj-f16.gguf',
          size: 500000000,
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toEqual([]);
    });

    it('skips tiny files', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'tiny.gguf',
          path: '/mock/models/tiny.gguf',
          size: 500, // Less than 1MB
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toEqual([]);
    });

    it('skips already registered models', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      const existing = [{ id: 'existing', filePath: '/mock/models/existing.gguf', name: 'Existing', author: 'test', fileName: 'existing.gguf', fileSize: 4000000000, quantization: 'Q4_K_M', downloadedAt: '' }];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existing));

      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'existing.gguf',
          path: '/mock/models/existing.gguf',
          size: 4000000000,
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toEqual([]);
    });

    it('handles string file sizes', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')
        .mockResolvedValueOnce('[]');

      mockedRNFS.readDir.mockResolvedValue([
        {
          name: 'model-f16.gguf',
          path: '/mock/models/model-f16.gguf',
          size: '4000000000' as any, // string size
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toHaveLength(1);
      expect(result[0].fileSize).toBe(4000000000);
    });

    it('catches errors during scan', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');
      mockedRNFS.readDir.mockRejectedValue(new Error('Permission denied'));

      const result = await modelManager.scanForUntrackedTextModels();
      expect(result).toEqual([]);
    });
  });

  // ========================================================================
  // scanForUntrackedImageModels — edge cases
  // ========================================================================
  describe('scanForUntrackedImageModels edge cases', () => {
    it('returns empty when directory does not exist', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false); // imageModelsDir scan

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result).toEqual([]);
    });

    it('discovers untracked image model directories', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(true);  // imageModelsDir scan

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')  // getDownloadedImageModels
        .mockResolvedValueOnce('[]'); // getDownloadedImageModels (for addDownloadedImageModel)

      mockedRNFS.readDir
        .mockResolvedValueOnce([ // image models dir listing
          {
            name: 'sd_v15_mnn',
            path: '/mock/image_models/sd_v15_mnn',
            size: 0,
            isFile: () => false,
            isDirectory: () => true,
          },
        ] as any)
        .mockResolvedValueOnce([ // model dir contents
          {
            name: 'unet.onnx',
            path: '/mock/image_models/sd_v15_mnn/unet.onnx',
            size: 1500000000,
            isFile: () => true,
            isDirectory: () => false,
          },
          {
            name: 'vae.onnx',
            path: '/mock/image_models/sd_v15_mnn/vae.onnx',
            size: 500000000,
            isFile: () => true,
            isDirectory: () => false,
          },
        ] as any);

      const result = await modelManager.scanForUntrackedImageModels();

      expect(result).toHaveLength(1);
      expect(result[0].name).toContain('sd');
      expect(result[0].size).toBe(2000000000);
      expect(result[0].backend).toBe('mnn');
    });

    it('detects qnn backend from directory name', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')
        .mockResolvedValueOnce('[]');

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'sd_qnn_model', path: '/mock/image_models/sd_qnn_model', size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'model.bin', path: '/mock/image_models/sd_qnn_model/model.bin', size: 1000000, isFile: () => true, isDirectory: () => false },
        ] as any);

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result[0].backend).toBe('qnn');
    });

    it('detects coreml backend from directory name', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')
        .mockResolvedValueOnce('[]');

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'sd_coreml_v2', path: '/mock/image_models/sd_coreml_v2', size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'model.mlmodelc', path: '/mock/image_models/sd_coreml_v2/model.mlmodelc', size: 2000000, isFile: () => true, isDirectory: () => false },
        ] as any);

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result[0].backend).toBe('coreml');
    });

    it('skips directories with 0 size', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'empty_model', path: '/mock/image_models/empty_model', size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([] as any); // empty directory

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result).toEqual([]);
    });

    it('skips already registered model directories', async () => {
      const existing = [{ id: 'existing-img', modelPath: '/mock/image_models/existing', name: 'Existing', size: 1000, downloadedAt: '', backend: 'mnn' }];
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existing));

      mockedRNFS.readDir.mockResolvedValue([
        { name: 'existing', path: '/mock/image_models/existing', size: 0, isFile: () => false, isDirectory: () => true },
      ] as any);

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result).toEqual([]);
    });

    it('handles string file sizes in model directory', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')
        .mockResolvedValueOnce('[]');

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'string_size', path: '/mock/image_models/string_size', size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'model.bin', path: '/mock/image_models/string_size/model.bin', size: '1500000' as any, isFile: () => true, isDirectory: () => false },
        ] as any);

      const result = await modelManager.scanForUntrackedImageModels();
      expect(result).toHaveLength(1);
      expect(result[0].size).toBe(1500000);
    });
  });

  // ========================================================================
  // importLocalModel
  // ========================================================================
  // importLocalModel tests already exist above - additional branch coverage only
  describe('importLocalModel additional branches', () => {
    beforeEach(() => {
      jest.spyOn(require('react-native'), 'Platform', 'get').mockReturnValue({ OS: 'ios' } as any);
    });

    it('replaces existing model with same ID in registry', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir (initialize)
        .mockResolvedValueOnce(true)   // imageModelsDir (initialize)
        .mockResolvedValueOnce(false)  // destExists = false
        .mockResolvedValueOnce(true);  // existing model file exists (getDownloadedModels validation)

      mockedRNFS.stat.mockResolvedValue({ size: 4000000000, isFile: () => true } as any);

      const existing = [{ id: 'local_import/model.gguf', name: 'Old', author: 'Local Import', filePath: '/old/model.gguf', fileName: 'model.gguf', fileSize: 3000000000, quantization: 'Q4', downloadedAt: '' }];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existing));

      const result = await modelManager.importLocalModel({ sourceUri: '/external/model.gguf', fileName: 'model.gguf' });

      expect(result.id).toBe('local_import/model.gguf');
    });
  });

  // ========================================================================
  // deleteOrphanedFile
  // ========================================================================
  describe('deleteOrphanedFile', () => {
    it('deletes file that exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await modelManager.deleteOrphanedFile('/mock/orphan.gguf');

      expect(mockedRNFS.unlink).toHaveBeenCalledWith('/mock/orphan.gguf');
    });

    it('does nothing when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await modelManager.deleteOrphanedFile('/mock/missing.gguf');

      expect(mockedRNFS.unlink).not.toHaveBeenCalled();
    });

    it('throws when deletion fails', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.unlink.mockRejectedValue(new Error('Permission denied'));

      await expect(
        modelManager.deleteOrphanedFile('/mock/locked.gguf')
      ).rejects.toThrow('Permission denied');
    });
  });

  // ========================================================================
  // getDownloadedImageModels path resolution
  // ========================================================================
  describe('getDownloadedImageModels', () => {
    it('returns empty array when no stored data', async () => {
      mockedAsyncStorage.getItem.mockResolvedValue(null);

      const result = await modelManager.getDownloadedImageModels();
      expect(result).toEqual([]);
    });

    it('filters out models whose files no longer exist', async () => {
      const models = [
        { id: 'exists', name: 'Exists', modelPath: '/mock/image_models/exists', size: 1000, downloadedAt: '', backend: 'mnn' },
        { id: 'missing', name: 'Missing', modelPath: '/mock/image_models/missing', size: 1000, downloadedAt: '', backend: 'mnn' },
      ];
      mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify(models));

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // exists model
        .mockResolvedValueOnce(false)  // missing model
        .mockResolvedValueOnce(false); // resolved path check for missing

      const result = await modelManager.getDownloadedImageModels();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('exists');
    });
  });

  // ========================================================================
  // setBackgroundDownloadMetadataCallback
  // ========================================================================
  describe('setBackgroundDownloadMetadataCallback', () => {
    it('stores the callback', () => {
      const callback = jest.fn();
      modelManager.setBackgroundDownloadMetadataCallback(callback);

      expect((modelManager as any).backgroundDownloadMetadataCallback).toBe(callback);
    });
  });

  describe('importLocalModel — Android content:// URI handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(require('react-native'), 'Platform', 'get').mockReturnValue({ OS: 'android' } as any);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('copies content:// URI directly to models dir on Android (no temp cache)', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false); // destExists = false

      mockedRNFS.stat.mockResolvedValue({ size: 2000000000, isFile: () => true } as any);
      (mockedRNFS as any).copyFile.mockResolvedValue(undefined);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const result = await modelManager.importLocalModel({
        sourceUri: 'content://com.android.provider/document/model.gguf',
        fileName: 'model-Q4_K_M.gguf',
      });

      // content:// URI is copied directly to the models dir — no temp cache step
      expect((mockedRNFS as any).copyFile).toHaveBeenCalledWith(
        'content://com.android.provider/document/model.gguf',
        expect.stringContaining('model-Q4_K_M.gguf'),
      );
      expect(result.id).toBe('local_import/model-Q4_K_M.gguf');
    });
  });

  describe('copyFileWithProgress — poll interval callback', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(require('react-native'), 'Platform', 'get').mockReturnValue({ OS: 'ios' } as any);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('fires progress callback via setInterval poll during copy', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir
        .mockResolvedValueOnce(true)   // imageModelsDir
        .mockResolvedValueOnce(false)  // destExists = false (importLocalModel check)
        .mockResolvedValue(true);      // dest exists during poll

      // stat for totalBytes (source file) and during poll
      mockedRNFS.stat
        .mockResolvedValueOnce({ size: 2000000000, isFile: () => true } as any) // source stat
        .mockResolvedValue({ size: 1000000000, isFile: () => true } as any); // poll + final stat

      (mockedRNFS as any).copyFile.mockImplementation(async () => {
        // Advance timers to trigger poll interval during copy
        jest.advanceTimersByTime(600);
        await Promise.resolve();
      });
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const onProgress = jest.fn();
      await modelManager.importLocalModel({
        sourceUri: '/source/model-Q4_K_M.gguf',
        fileName: 'model-Q4_K_M.gguf',
        onProgress,
      });

      // progress callback should have been called
      expect(onProgress).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // buildDownloadedModel
  // ========================================================================
  describe('buildDownloadedModel', () => {
    beforeEach(() => {
      mockedRNFS.stat.mockResolvedValue({ size: 4000000000, isFile: () => true } as any);
    });

    it('sets mmProjFileName when mmproj file exists', async () => {
      const file = createModelFileWithMmProj();
      const mmProjLocalPath = '/models/model-mmproj.gguf';

      const model = await buildDownloadedModel({
        modelId: 'meta/llama-3.2-11b',
        file,
        resolvedLocalPath: '/models/llama-3.2-11b.gguf',
        mmProjPath: mmProjLocalPath,
      });

      expect(model.engine).toBe('llama');
      if (model.engine !== 'llama') throw new Error('expected llama model');
      expect(model.mmProjFileName).toBe(file.mmProjFile?.name);
      expect(model.mmProjPath).toBe(mmProjLocalPath);
      expect(model.isVisionModel).toBe(true);
    });

    it('sets mmProjFileName from expectedMmProjFileName when mmproj download failed', async () => {
      const file = createModelFileWithMmProj();

      const model = await buildDownloadedModel({
        modelId: 'meta/llama-3.2-11b',
        file,
        resolvedLocalPath: '/models/llama-3.2-11b.gguf',
        mmProjPath: undefined,
        expectedMmProjFileName: file.mmProjFile?.name,
      });

      expect(model.engine).toBe('llama');
      if (model.engine !== 'llama') throw new Error('expected llama model');
      expect(model.mmProjFileName).toBe(file.mmProjFile?.name);
      expect(model.mmProjPath).toBeUndefined();
      expect(model.isVisionModel).toBe(false);
    });

    it('omits mmProjFileName when model has no vision support', async () => {
      const file = createModelFile();

      const model = await buildDownloadedModel({
        modelId: 'meta/llama-3.2-1b',
        file,
        resolvedLocalPath: '/models/llama-3.2-1b.gguf',
      });

      expect(model.engine).toBe('llama');
      if (model.engine !== 'llama') throw new Error('expected llama model');
      expect(model.mmProjFileName).toBeUndefined();
      expect(model.mmProjPath).toBeUndefined();
      expect(model.isVisionModel).toBe(false);
    });
  });

  describe('reconcileFinishedImageDownloads', () => {
    const IMAGE_MODELS_DIR = '/mock/documents/image_models';

    function setupInitialized() {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // modelsDir init
        .mockResolvedValueOnce(true);  // imageModelsDir init
    }

    it('returns empty when imageModelsDir does not exist', async () => {
      setupInitialized();
      mockedRNFS.exists.mockResolvedValueOnce(false); // imageModelsDir scan
      const result = await modelManager.reconcileFinishedImageDownloads(new Set());
      expect(result).toEqual([]);
    });

    it('registers a dir that has _ready but is not in AsyncStorage', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')   // getDownloadedImageModels (reconciler)
        .mockResolvedValueOnce('[]')   // getDownloadedImageModels (addDownloadedImageModel)
        .mockResolvedValueOnce(null);  // getDownloadedImageModels (addDownloadedImageModel save)

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // imageModelsDir scan
        .mockResolvedValueOnce(true);  // _ready exists

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'sd_v15_mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'unet.mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn/unet.mnn`, size: 1000000000, isFile: () => true, isDirectory: () => false },
        ] as any);

      mockedAsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sd_v15_mnn');
      expect(result[0].backend).toBe('mnn');
    });

    it('skips dirs already in AsyncStorage', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem.mockResolvedValueOnce(
        JSON.stringify([{ id: 'sd_v15_mnn', modelPath: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 1000 }]),
      );

      mockedRNFS.exists.mockResolvedValueOnce(true); // imageModelsDir scan

      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'sd_v15_mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 0, isFile: () => false, isDirectory: () => true },
      ] as any);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());
      expect(result).toHaveLength(0);
    });

    it('skips dirs whose model ID is in activeModelIds', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

      mockedRNFS.exists.mockResolvedValueOnce(true); // imageModelsDir scan

      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'sd_v15_mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 0, isFile: () => false, isDirectory: () => true },
      ] as any);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set(['sd_v15_mnn']));
      expect(result).toHaveLength(0);
    });

    it('re-unzips from valid zip when _zip_name present and zip valid', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')
        .mockResolvedValueOnce('[]');

      mockedRNFS.exists
        .mockResolvedValueOnce(true)    // imageModelsDir scan
        .mockResolvedValueOnce(false)   // _ready missing
        .mockResolvedValueOnce(true)    // _zip_name exists
        .mockResolvedValueOnce(true);   // zip file exists (isValidZip)

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'sd_v15_mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'unet.mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn/unet.mnn`, size: 500000000, isFile: () => true, isDirectory: () => false },
        ] as any);

      mockedRNFS.readFile = jest.fn().mockResolvedValueOnce('sd_v15_mnn.zip');
      mockedRNFS.stat = jest.fn().mockResolvedValue({ size: 400000000, isFile: () => true } as any);
      mockedRNFS.read = jest.fn().mockResolvedValue('PK\x03\x04');
      mockedRNFS.writeFile = jest.fn().mockResolvedValue(undefined as any);
      (mockedUnzip as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());

      expect(mockedUnzip).toHaveBeenCalledWith(
        `${IMAGE_MODELS_DIR}/sd_v15_mnn.zip`,
        `${IMAGE_MODELS_DIR}/sd_v15_mnn`,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sd_v15_mnn');
    });

    it('deletes partial dir when _zip_name present but zip is missing', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

      mockedRNFS.exists
        .mockResolvedValueOnce(true)    // imageModelsDir scan
        .mockResolvedValueOnce(false)   // _ready missing
        .mockResolvedValueOnce(true)    // _zip_name exists
        .mockResolvedValueOnce(false);  // zip file missing (isValidZip)

      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'sd_v15_mnn', path: `${IMAGE_MODELS_DIR}/sd_v15_mnn`, size: 0, isFile: () => false, isDirectory: () => true },
      ] as any);

      mockedRNFS.readFile = jest.fn().mockResolvedValueOnce('sd_v15_mnn.zip');

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());

      expect(RNFS.unlink).toHaveBeenCalledWith(`${IMAGE_MODELS_DIR}/sd_v15_mnn`);
      expect(result).toHaveLength(0);
    });

    it('deletes stale dir when neither _ready nor _zip_name exist', async () => {
      setupInitialized();
      mockedAsyncStorage.getItem.mockResolvedValueOnce('[]');

      mockedRNFS.exists
        .mockResolvedValueOnce(true)    // imageModelsDir scan
        .mockResolvedValueOnce(false)   // _ready missing
        .mockResolvedValueOnce(false);  // _zip_name missing

      mockedRNFS.readDir.mockResolvedValueOnce([
        { name: 'old_partial_dir', path: `${IMAGE_MODELS_DIR}/old_partial_dir`, size: 0, isFile: () => false, isDirectory: () => true },
      ] as any);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());

      expect(RNFS.unlink).toHaveBeenCalledWith(`${IMAGE_MODELS_DIR}/old_partial_dir`);
      expect(result).toHaveLength(0);
    });

    it('resolves CoreML model path via resolveCoreMLModelDir', async () => {
      setupInitialized();
      (mockedResolveCoreML as jest.Mock).mockImplementation((dir: string) =>
        Promise.resolve(`${dir}/model.mlpackage`),
      );
      mockedAsyncStorage.getItem
        .mockResolvedValueOnce('[]')   // getDownloadedImageModels (reconciler)
        .mockResolvedValueOnce('[]')   // getDownloadedImageModels (addDownloadedImageModel)
        .mockResolvedValueOnce(null);  // getDownloadedImageModels (addDownloadedImageModel save)

      mockedRNFS.exists
        .mockResolvedValueOnce(true)   // imageModelsDir scan
        .mockResolvedValueOnce(true);  // _ready exists

      mockedRNFS.readDir
        .mockResolvedValueOnce([
          { name: 'sd_coreml_v1', path: `${IMAGE_MODELS_DIR}/sd_coreml_v1`, size: 0, isFile: () => false, isDirectory: () => true },
        ] as any)
        .mockResolvedValueOnce([
          { name: 'model.mlpackage', path: `${IMAGE_MODELS_DIR}/sd_coreml_v1/model.mlpackage`, size: 800000000, isFile: () => true, isDirectory: () => false },
        ] as any);

      mockedAsyncStorage.setItem.mockResolvedValue(undefined);

      const result = await modelManager.reconcileFinishedImageDownloads(new Set());

      expect(mockedResolveCoreML).toHaveBeenCalledWith(`${IMAGE_MODELS_DIR}/sd_coreml_v1`);
      expect(result[0].modelPath).toBe(`${IMAGE_MODELS_DIR}/sd_coreml_v1/model.mlpackage`);
      expect(result[0].backend).toBe('coreml');
    });
  });

  describe('importLocalModel — LiteRT branches', () => {
    it('imports a .litertlm file with engine=litert and liteRTVision=false', async () => {
      setupLiteRTImportMocks();
      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/gemma.litertlm',
        fileName: 'gemma-4-E2B-it.litertlm',
        engine: 'litert',
        liteRTVision: false,
      });
      expect(result.engine).toBe('litert');
      expect((result as any).liteRTVision).toBe(false);
      expect(result.id).toBe('local_import/gemma-4-E2B-it.litertlm');
    });

    it('imports a .litertlm file with liteRTVision=true', async () => {
      setupLiteRTImportMocks();
      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/gemma-vision.litertlm',
        fileName: 'gemma-vision.litertlm',
        engine: 'litert',
        liteRTVision: true,
      });
      expect((result as any).liteRTVision).toBe(true);
    });

    it('omits engine and liteRTVision when not provided', async () => {
      setupLiteRTImportMocks();
      const result = await modelManager.importLocalModel({
        sourceUri: '/path/to/model.gguf',
        fileName: 'model.gguf',
      });
      expect(result.engine).toBe('llama');
      expect((result as any).liteRTVision).toBeUndefined();
    });
  });
});
