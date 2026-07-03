/**
 * BackgroundDownloadService Unit Tests
 *
 * Tests for Android background download management via NativeModules.
 * Priority: P0 (Critical) - Download reliability.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// We need to test the class directly since the singleton auto-constructs.
// Mock Platform and NativeModules before importing.

// Store original Platform.OS for restoration
const originalOS = Platform.OS;

// Create the mock native module
const mockDownloadManagerModule = {
  startDownload: jest.fn(),
  cancelDownload: jest.fn(),
  retryDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  getDownloadProgress: jest.fn(),
  moveCompletedDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  stopProgressPolling: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

// We need to test the BackgroundDownloadService class directly
// because the exported singleton constructs immediately.
// Extract the class from the module.

describe('BackgroundDownloadService', () => {
  let BackgroundDownloadServiceClass: any;
  let service: any;

  // Captured event handlers from NativeEventEmitter.addListener
  let eventHandlers: Record<string, (event: any) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    eventHandlers = {};

    // Set up NativeModules
    NativeModules.DownloadManagerModule = mockDownloadManagerModule;

    // Mock NativeEventEmitter to capture event listeners
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((eventType: string, handler: any) => {
        eventHandlers[eventType] = handler;
        return { remove: jest.fn() } as any;
      });

    // Reset Platform.OS to android for most tests
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });

    // Re-require the module to get a fresh class
    jest.isolateModules(() => {
      const mod = require('../../../src/services/backgroundDownloadService');
      // The module exports a singleton; we access its constructor to create fresh instances
      BackgroundDownloadServiceClass = (mod.backgroundDownloadService as any)
        .constructor;
    });

    service = new BackgroundDownloadServiceClass();
  });

  afterEach(() => {
    // Restore original Platform.OS
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
  });

  // ========================================================================
  // isAvailable
  // ========================================================================
  describe('isAvailable', () => {
    it('returns true on Android with native module present', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      expect(service.isAvailable()).toBe(true);
    });

    it('returns true on iOS when native module is present', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      expect(service.isAvailable()).toBe(true);
    });

    it('returns false when native module is null', () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      // Create fresh instance without module
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        const freshService = new (
          mod.backgroundDownloadService as any
        ).constructor();
        expect(freshService.isAvailable()).toBe(false);
      });

      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // startDownload
  // ========================================================================
  describe('startDownload', () => {
    it('calls native module with correct params', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
        totalBytes: 4000000000,
      });

      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/model.gguf',
          fileName: 'model.gguf',
          modelId: 'test/model',
          totalBytes: 4000000000,
        }),
      );
      expect(result.downloadId).toBe(42);
      expect(result.status).toBe('pending');
    });

    it('returns pending status', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 1,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      expect(result.status).toBe('pending');
      expect(result.bytesDownloaded).toBe(0);
    });

    it('defaults modelType to text and totalBytes to 0 when not provided', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 1,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const callArgs = mockDownloadManagerModule.startDownload.mock.calls[0][0];
      expect(callArgs.modelType).toBe('text');
      expect(callArgs.totalBytes).toBe(0);
      expect(result.totalBytes).toBe(0);
    });

    it('throws when not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      await expect(
        unavailableService.startDownload({
          url: 'https://example.com/model.gguf',
          fileName: 'model.gguf',
          modelId: 'test/model',
        }),
      ).rejects.toThrow('Background downloads not available');
      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // cancelDownload
  // ========================================================================
  describe('cancelDownload', () => {
    it('delegates to native module', async () => {
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);

      await service.cancelDownload(42);

      expect(mockDownloadManagerModule.cancelDownload).toHaveBeenCalledWith(42);
    });

    it('routes a queued:<modelKey> placeholder id to cancelQueued, NOT native cancel', async () => {
      // A queued placeholder has no native download — it lives only in startQueue.
      // Cancelling it must remove the queued start, or the download starts later anyway.
      // Distinct native ids so 3 unique slots actually fill (activeIds tracks by id).
      let nextId = 100;
      mockDownloadManagerModule.startDownload.mockImplementation(() =>
        Promise.resolve({ downloadId: nextId++, fileName: 'a.gguf', modelId: 'm', status: 'running', bytesDownloaded: 0, totalBytes: 1, startedAt: 0 }));
      // Fill the 3 concurrency slots so the next start is queued.
      await service.startDownload({ url: 'u1', fileName: 'f1', modelId: 'a', modelType: 'text' });
      await service.startDownload({ url: 'u2', fileName: 'f2', modelId: 'b', modelType: 'text' });
      await service.startDownload({ url: 'u3', fileName: 'f3', modelId: 'c', modelType: 'text' });
      const queuedPromise = service.startDownload({ url: 'u4', fileName: 'f4', modelId: 'd', modelKey: 'org/repo/f4.gguf', modelType: 'text' });
      // Swallow the expected rejection so it isn't an unhandled rejection.
      queuedPromise.catch(() => {});
      mockDownloadManagerModule.cancelDownload.mockClear();

      await service.cancelDownload('queued:org/repo/f4.gguf');

      expect(mockDownloadManagerModule.cancelDownload).not.toHaveBeenCalled();
      await expect(queuedPromise).rejects.toMatchObject({ cancelled: true });
    });

    it('throws when not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      await expect(unavailableService.cancelDownload(42)).rejects.toThrow(
        'not available',
      );
      NativeModules.DownloadManagerModule = savedModule;
    });

    it('notifies error listeners with a user_cancelled event so awaiters can settle', async () => {
      // Native cancel emits nothing, so the service synthesizes a cancellation
      // event — without it, anything awaiting downloadFileTo() hangs forever.
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);
      const onError = jest.fn();
      service.onError(42, onError);

      await service.cancelDownload(42);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ downloadId: 42, reasonCode: 'user_cancelled' }),
      );
    });

    it('rejects a downloadFileTo() promise as cancelled when its download is cancelled', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 7,
        fileName: 'f.bin',
        modelId: 'm',
      });
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);

      const { downloadIdPromise, promise } = service.downloadFileTo({
        params: { url: 'https://x/f.bin', fileName: 'f.bin', modelId: 'm' },
        destPath: '/tmp/f.bin',
        silent: true,
      });
      const id = await downloadIdPromise;
      expect(id).toBe(7);

      await service.cancelDownload(7);

      await expect(promise).rejects.toMatchObject({ cancelled: true });
    });

    it('synthesizes the cancellation even if the native cancel throws', async () => {
      mockDownloadManagerModule.cancelDownload.mockRejectedValue(new Error('bridge down'));
      const onError = jest.fn();
      service.onError(99, onError);

      await service.cancelDownload(99);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ downloadId: 99, reasonCode: 'user_cancelled' }),
      );
    });
  });

  // ========================================================================
  // getActiveDownloads
  // ========================================================================
  describe('getActiveDownloads', () => {
    it('returns empty array when not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      const result = await unavailableService.getActiveDownloads();
      expect(result).toEqual([]);
      NativeModules.DownloadManagerModule = savedModule;
    });

    it('maps native response to BackgroundDownloadInfo', async () => {
      mockDownloadManagerModule.getActiveDownloads.mockResolvedValue([
        {
          id: 'dl-1',
          fileName: 'model.gguf',
          modelId: 'test/model',
          status: 'running',
          bytesDownloaded: 1000,
          totalBytes: 5000,
          createdAt: 12345,
          reason: 'still downloading',
        },
      ]);

      const result = await service.getActiveDownloads();

      expect(result).toHaveLength(1);
      expect(result[0].downloadId).toBe('dl-1');
      expect(result[0].status).toBe('running');
      expect(result[0].bytesDownloaded).toBe(1000);
      expect(result[0].reason).toBe('still downloading');
    });
  });

  // ========================================================================
  // moveCompletedDownload
  // ========================================================================
  describe('moveCompletedDownload', () => {
    it('delegates to native module', async () => {
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/final/path/model.gguf',
      );

      const result = await service.moveCompletedDownload(
        42,
        '/final/path/model.gguf',
      );

      expect(
        mockDownloadManagerModule.moveCompletedDownload,
      ).toHaveBeenCalledWith(42, '/final/path/model.gguf');
      expect(result).toBe('/final/path/model.gguf');
    });

    it('throws when not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      await expect(
        unavailableService.moveCompletedDownload(42, '/path'),
      ).rejects.toThrow('not available');
      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // listener registration
  // ========================================================================
  describe('listener registration', () => {
    it('onProgress registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onProgress(42, callback);

      expect(typeof unsub).toBe('function');
      // Verify callback was stored
      expect(service.progressListeners.has('progress_42')).toBe(true);

      // Unsubscribe
      unsub();
      expect(service.progressListeners.has('progress_42')).toBe(false);
    });

    it('onComplete registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onComplete(42, callback);

      expect(service.completeListeners.has('complete_42')).toBe(true);
      unsub();
      expect(service.completeListeners.has('complete_42')).toBe(false);
    });

    it('onError registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onError(42, callback);

      expect(service.errorListeners.has('error_42')).toBe(true);
      unsub();
      expect(service.errorListeners.has('error_42')).toBe(false);
    });

    it('onAnyProgress registers global listener', () => {
      const callback = jest.fn();
      service.onAnyProgress(callback);

      expect(service.progressListeners.has('progress_all')).toBe(true);
    });

    it('onAnyComplete registers global listener', () => {
      const callback = jest.fn();
      service.onAnyComplete(callback);

      expect(service.completeListeners.has('complete_all')).toBe(true);
    });

    it('onAnyError registers global listener', () => {
      const callback = jest.fn();
      service.onAnyError(callback);

      expect(service.errorListeners.has('error_all')).toBe(true);
    });
  });

  // ========================================================================
  // event dispatching
  // ========================================================================
  describe('event dispatching', () => {
    it('dispatches progress to both specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onProgress(42, specificCb);
      service.onAnyProgress(globalCb);

      const event = {
        downloadId: 42,
        bytesDownloaded: 1000,
        totalBytes: 5000,
        status: 'running',
        fileName: 'model.gguf',
        modelId: 'test',
      };

      // Simulate event from NativeEventEmitter
      if (eventHandlers.DownloadProgress) {
        eventHandlers.DownloadProgress(event);
      }

      // Both listeners fire; consumer-side logic handles deduplication
      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches progress to global listener when no per-download listener exists', () => {
      const globalCb = jest.fn();
      service.onAnyProgress(globalCb);

      const event = {
        downloadId: 99,
        bytesDownloaded: 1000,
        totalBytes: 5000,
        status: 'running',
        fileName: 'model.gguf',
        modelId: 'test',
      };

      if (eventHandlers.DownloadProgress) {
        eventHandlers.DownloadProgress(event);
      }

      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches complete to specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onComplete(42, specificCb);
      service.onAnyComplete(globalCb);

      const event = {
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test',
        bytesDownloaded: 5000,
        totalBytes: 5000,
        status: 'completed',
        localUri: '/path/model.gguf',
      };

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete(event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches error to specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onError(42, specificCb);
      service.onAnyError(globalCb);

      const event = {
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test',
        status: 'failed',
        reason: 'Network error',
      };

      if (eventHandlers.DownloadError) {
        eventHandlers.DownloadError(event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('does not throw when no listener registered for downloadId', () => {
      // No listeners registered for download 99
      const event = {
        downloadId: 99,
        bytesDownloaded: 1000,
        totalBytes: 5000,
        status: 'running',
        fileName: 'model.gguf',
        modelId: 'test',
      };

      expect(() => {
        if (eventHandlers.DownloadProgress) {
          eventHandlers.DownloadProgress(event);
        }
      }).not.toThrow();
    });
  });

  // ========================================================================
  // polling
  // ========================================================================
  describe('polling', () => {
    it('startProgressPolling calls native module', () => {
      service.startProgressPolling();

      expect(mockDownloadManagerModule.startProgressPolling).toHaveBeenCalled();
      expect(service.isPolling).toBe(true);
    });

    it('startProgressPolling is idempotent', () => {
      service.startProgressPolling();
      service.startProgressPolling();

      expect(
        mockDownloadManagerModule.startProgressPolling,
      ).toHaveBeenCalledTimes(1);
    });

    it('stopProgressPolling stops polling', () => {
      service.startProgressPolling();
      service.stopProgressPolling();

      expect(mockDownloadManagerModule.stopProgressPolling).toHaveBeenCalled();
      expect(service.isPolling).toBe(false);
    });

    it('does nothing when not available', () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      unavailableService.startProgressPolling();
      expect(
        mockDownloadManagerModule.startProgressPolling,
      ).not.toHaveBeenCalled();
      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // cleanup
  // ========================================================================
  describe('cleanup', () => {
    it('stops polling and clears all listeners', () => {
      // Register some listeners
      service.onProgress(1, jest.fn());
      service.onComplete(1, jest.fn());
      service.onError(1, jest.fn());
      service.startProgressPolling();

      service.cleanup();

      expect(service.progressListeners.size).toBe(0);
      expect(service.completeListeners.size).toBe(0);
      expect(service.errorListeners.size).toBe(0);
      expect(service.isPolling).toBe(false);
    });
  });

  // ========================================================================
  // Additional polling branches
  // ========================================================================
  describe('polling edge cases', () => {
    it('stopProgressPolling does nothing when not already polling', () => {
      // service.isPolling is false by default
      service.stopProgressPolling();

      expect(
        mockDownloadManagerModule.stopProgressPolling,
      ).not.toHaveBeenCalled();
    });

    it('stopProgressPolling does nothing when not available', () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      unavailableService.stopProgressPolling();
      expect(
        mockDownloadManagerModule.stopProgressPolling,
      ).not.toHaveBeenCalled();
      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // Event dispatch edge cases
  // ========================================================================
  describe('event dispatch edge cases', () => {
    it('dispatches progress only to global when no specific listener', () => {
      const globalCb = jest.fn();
      service.onAnyProgress(globalCb);

      const event = {
        downloadId: 99,
        bytesDownloaded: 500,
        totalBytes: 1000,
        status: 'running',
        fileName: 'model.gguf',
        modelId: 'test',
      };
      if (eventHandlers.DownloadProgress) {
        eventHandlers.DownloadProgress(event);
      }

      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches progress only to specific when no global listener', () => {
      const specificCb = jest.fn();
      service.onProgress(42, specificCb);

      const event = {
        downloadId: 42,
        bytesDownloaded: 500,
        totalBytes: 1000,
        status: 'running',
        fileName: 'model.gguf',
        modelId: 'test',
      };
      if (eventHandlers.DownloadProgress) {
        eventHandlers.DownloadProgress(event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
    });

    it('dispatches complete only to global when no specific listener', () => {
      const globalCb = jest.fn();
      service.onAnyComplete(globalCb);

      const event = {
        downloadId: 99,
        fileName: 'model.gguf',
        modelId: 'test',
        bytesDownloaded: 5000,
        totalBytes: 5000,
        status: 'completed',
        localUri: '/path',
      };
      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete(event);
      }

      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches complete only to specific when no global listener', () => {
      const specificCb = jest.fn();
      service.onComplete(42, specificCb);

      const event = {
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test',
        bytesDownloaded: 5000,
        totalBytes: 5000,
        status: 'completed',
        localUri: '/path',
      };
      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete(event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
    });

    it('dispatches error only to global when no specific listener', () => {
      const globalCb = jest.fn();
      service.onAnyError(globalCb);

      const event = {
        downloadId: 99,
        fileName: 'model.gguf',
        modelId: 'test',
        status: 'failed',
        reason: 'Error',
      };
      if (eventHandlers.DownloadError) {
        eventHandlers.DownloadError(event);
      }

      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches error only to specific when no global listener', () => {
      const specificCb = jest.fn();
      service.onError(42, specificCb);

      const event = {
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test',
        status: 'failed',
        reason: 'Error',
      };
      if (eventHandlers.DownloadError) {
        eventHandlers.DownloadError(event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
    });

    it('handles complete event with no listeners at all', () => {
      const event = {
        downloadId: 99,
        fileName: 'model.gguf',
        modelId: 'test',
        bytesDownloaded: 5000,
        totalBytes: 5000,
        status: 'completed',
        localUri: '/path',
      };
      expect(() => {
        if (eventHandlers.DownloadComplete) {
          eventHandlers.DownloadComplete(event);
        }
      }).not.toThrow();
    });

    it('handles error event with no listeners at all', () => {
      const event = {
        downloadId: 99,
        fileName: 'model.gguf',
        modelId: 'test',
        status: 'failed',
        reason: 'Error',
      };
      expect(() => {
        if (eventHandlers.DownloadError) {
          eventHandlers.DownloadError(event);
        }
      }).not.toThrow();
    });
  });

  // ========================================================================
  // startDownload default value branches
  // ========================================================================
  describe('startDownload default values', () => {
    it('uses 0 for totalBytes when not provided', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 1,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const callArgs = mockDownloadManagerModule.startDownload.mock.calls[0][0];
      expect(callArgs.totalBytes).toBe(0);
      expect(result.totalBytes).toBe(0);
    });
  });

  // ========================================================================
  // Unsubscribe functions for global listeners
  // ========================================================================
  describe('global listener unsubscribe', () => {
    it('onAnyProgress returns working unsubscribe', () => {
      const callback = jest.fn();
      const unsub = service.onAnyProgress(callback);
      expect(service.progressListeners.has('progress_all')).toBe(true);
      unsub();
      expect(service.progressListeners.has('progress_all')).toBe(false);
    });

    it('onAnyComplete returns working unsubscribe', () => {
      const callback = jest.fn();
      const unsub = service.onAnyComplete(callback);
      expect(service.completeListeners.has('complete_all')).toBe(true);
      unsub();
      expect(service.completeListeners.has('complete_all')).toBe(false);
    });

    it('onAnyError returns working unsubscribe', () => {
      const callback = jest.fn();
      const unsub = service.onAnyError(callback);
      expect(service.errorListeners.has('error_all')).toBe(true);
      unsub();
      expect(service.errorListeners.has('error_all')).toBe(false);
    });
  });

  // ========================================================================
  // Constructor branch: not available
  // ========================================================================
  describe('constructor when not available', () => {
    it('does not set up event emitter or listeners when module is null', () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      const addListenerSpy = jest.spyOn(
        NativeEventEmitter.prototype,
        'addListener',
      );
      addListenerSpy.mockClear();

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      expect(unavailableService.eventEmitter).toBeNull();
      // addListener should not have been called during construction
      expect(addListenerSpy).not.toHaveBeenCalled();

      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // downloadFileTo
  // ========================================================================
  describe('downloadFileTo', () => {
    // startDownload is async (2+ microtask ticks deep); flush enough ticks so
    // listeners are registered before we fire synthetic events.
    const flushMicrotasks = () => new Promise<void>(resolve => setImmediate(resolve));

    const baseParams = {
      url: 'https://example.com/dep.gguf',
      fileName: 'dep.gguf',
      modelId: 'test/model',
      totalBytes: 1_000_000,
    };

    it('resolves after complete event and calls moveCompletedDownload', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 10,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      // Let startDownload mock resolve and listeners register
      await flushMicrotasks();

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 10,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }

      await promise;
      expect(
        mockDownloadManagerModule.moveCompletedDownload,
      ).toHaveBeenCalledWith(10, '/dest/dep.gguf');
    });

    it('resolves downloadIdPromise once native start returns id', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 17,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const { downloadIdPromise, promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      await expect(downloadIdPromise).resolves.toBe(17);

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 17,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }
      await promise;
    });

    it('rejects downloadIdPromise when native startDownload fails', async () => {
      mockDownloadManagerModule.startDownload.mockRejectedValue(
        new Error('Failed to start'),
      );

      const { downloadIdPromise, promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      await expect(downloadIdPromise).rejects.toThrow('Failed to start');
      await expect(promise).rejects.toThrow('Failed to start');
    });

    it('rejects when error event fires', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 11,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadError) {
        eventHandlers.DownloadError({
          downloadId: 11,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          status: 'failed',
          reason: 'Network timeout',
        });
      }

      await expect(promise).rejects.toThrow('Network timeout');
    });

    it('passes hideNotification:true to native when silent:true', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 12,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
        silent: true,
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 12,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }

      await promise;
      const callArgs = mockDownloadManagerModule.startDownload.mock.calls[0][0];
      expect(callArgs.hideNotification).toBe(true);
    });

    it('passes hideNotification:false when silent is false', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 13,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
        silent: false,
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 13,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }

      await promise;
      const callArgs = mockDownloadManagerModule.startDownload.mock.calls[0][0];
      expect(callArgs.hideNotification).toBe(false);
    });

    it('calls onProgress callback with bytesDownloaded and totalBytes', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 14,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const onProgress = jest.fn();
      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
        onProgress,
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadProgress) {
        eventHandlers.DownloadProgress({
          downloadId: 14,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 500_000,
          totalBytes: 1_000_000,
          status: 'running',
        });
      }

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 14,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }

      await promise;
      expect(onProgress).toHaveBeenCalledWith(500_000, 1_000_000);
    });

    it('starts polling when download begins', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 15,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue(
        '/dest/dep.gguf',
      );

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadComplete) {
        eventHandlers.DownloadComplete({
          downloadId: 15,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          bytesDownloaded: 1_000_000,
          totalBytes: 1_000_000,
          status: 'completed',
          localUri: '/downloads/dep.gguf',
        });
      }

      await promise;
      expect(mockDownloadManagerModule.startProgressPolling).toHaveBeenCalled();
    });

    it('throws when service is not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      let unavailableService: any;
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        unavailableService = new (
          mod.backgroundDownloadService as any
        ).constructor();
      });

      expect(() =>
        unavailableService.downloadFileTo({
          params: baseParams,
          destPath: '/dest/dep.gguf',
        }),
      ).toThrow('not available');

      NativeModules.DownloadManagerModule = savedModule;
    });

    it('rejects with fallback message when error event has no reason', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 16,
        fileName: 'dep.gguf',
        modelId: 'test/model',
      });

      const { promise } = service.downloadFileTo({
        params: baseParams,
        destPath: '/dest/dep.gguf',
      });

      await flushMicrotasks();

      if (eventHandlers.DownloadError) {
        eventHandlers.DownloadError({
          downloadId: 16,
          fileName: 'dep.gguf',
          modelId: 'test/model',
          status: 'failed',
          reason: undefined as any,
        });
      }

      await expect(promise).rejects.toThrow('Download failed');
    });
  });

  // ========================================================================
  // excludeFromBackup
  // ========================================================================
  describe('excludeFromBackup', () => {
    it('returns false when service is not available', async () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      try {
        let freshService: any;
        jest.isolateModules(() => {
          const mod = require('../../../src/services/backgroundDownloadService');
          freshService = new (
            mod.backgroundDownloadService as any
          ).constructor();
        });

        const result = await freshService.excludeFromBackup('/some/path');
        expect(result).toBe(false);
      } finally {
        NativeModules.DownloadManagerModule = savedModule;
      }
    });

    it('returns false when excludePathFromBackup is not a function (Android)', async () => {
      // Simulate Android where the native module lacks excludePathFromBackup
      const originalMethod = (mockDownloadManagerModule as any)
        .excludePathFromBackup;
      delete (mockDownloadManagerModule as any).excludePathFromBackup;

      try {
        const result = await service.excludeFromBackup('/some/path');
        expect(result).toBe(false);
      } finally {
        // Restore for other tests
        (mockDownloadManagerModule as any).excludePathFromBackup =
          originalMethod;
      }
    });

    it('calls native excludePathFromBackup when available (iOS)', async () => {
      (mockDownloadManagerModule as any).excludePathFromBackup = jest.fn(() =>
        Promise.resolve(true),
      );

      const result = await service.excludeFromBackup('/some/path');
      expect(result).toBe(true);
      expect(
        (mockDownloadManagerModule as any).excludePathFromBackup,
      ).toHaveBeenCalledWith('/some/path');
    });

    it('returns false when native excludePathFromBackup rejects', async () => {
      (mockDownloadManagerModule as any).excludePathFromBackup = jest.fn(() =>
        Promise.reject(new Error('fail')),
      );

      const result = await service.excludeFromBackup('/some/path');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // Concurrency queue — never hand more than MAX_CONCURRENT_DOWNLOADS to native
  // ========================================================================
  describe('concurrency queue (max 3)', () => {
    const flush = () => new Promise<void>((r) => setImmediate(r));
    const params = (id: string) => ({
      url: `https://example.com/${id}.gguf`,
      fileName: `${id}.gguf`,
      modelId: id,
      modelKey: id,
      totalBytes: 1000,
    });

    beforeEach(() => {
      let seq = 0;
      mockDownloadManagerModule.startDownload.mockImplementation(async () => ({
        downloadId: String(++seq),
        fileName: 'f',
        modelId: 'm',
      }));
    });

    it('starts only 3 immediately and queues the rest', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      ids.forEach((id) => service.startDownload(params(id)));
      // Slots reserved synchronously, so 2 are queued right away.
      expect(service.getQueuedCount()).toBe(2);
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);
    });

    it('a sidecar (mmproj) does NOT occupy a slot — 3 vision files (main+sidecar each) all download', async () => {
      // Regression for "only one download progressing": a vision file is main + mmproj.
      // If the sidecar counted, 3 files (6 native starts) would fill the 3-cap after ~1.5
      // files and the rest would queue. Sidecars are exempt, so all 3 mains start.
      for (const id of ['a', 'b', 'c']) {
        service.startDownload({ ...params(`${id}-mmproj`), isSidecar: true }); // rides alongside, uncounted
        service.startDownload(params(id));                                     // the main, counted
      }
      await flush();
      // 3 mains + 3 sidecars = 6 native starts, and NONE queued (sidecars don't count).
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(6);
      expect(service.getQueuedCount()).toBe(0);
    });

    it('a 4th vision file queues only its MAIN once the 3 main slots are full', async () => {
      for (const id of ['a', 'b', 'c']) {
        service.startDownload({ ...params(`${id}-mmproj`), isSidecar: true });
        service.startDownload(params(id));
      }
      await flush();
      // 4th file: sidecar starts immediately (uncounted), main queues (cap full with 3 mains).
      service.startDownload({ ...params('d-mmproj'), isSidecar: true });
      service.startDownload(params('d'));
      await flush();
      expect(service.getQueuedCount()).toBe(1);                               // only d's main waits
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(7); // 3 mains + 4 sidecars
    });

    it('promotes the next queued download when one COMPLETES', async () => {
      ['a', 'b', 'c', 'd', 'e'].forEach((id) => service.startDownload(params(id)));
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);

      eventHandlers.DownloadComplete({ downloadId: '1' });
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(4);
      expect(service.getQueuedCount()).toBe(1);
    });

    it('promotes the next queued download when one ERRORS', async () => {
      ['a', 'b', 'c', 'd'].forEach((id) => service.startDownload(params(id)));
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);

      eventHandlers.DownloadError({ downloadId: '2', reason: 'boom' });
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(4);
      expect(service.getQueuedCount()).toBe(0);
    });

    it('promotes the next queued download when one is CANCELLED', async () => {
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);
      ['a', 'b', 'c', 'd'].forEach((id) => service.startDownload(params(id)));
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);

      await service.cancelDownload('3');
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(4);
    });

    it('never exceeds 3 concurrent even as downloads complete', async () => {
      ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id) => service.startDownload(params(id)));
      await flush();
      // 3 active, 3 queued.
      expect(service.getQueuedCount()).toBe(3);
      // Complete two: two more admitted, still capped at 3 concurrent.
      eventHandlers.DownloadComplete({ downloadId: '1' });
      eventHandlers.DownloadComplete({ downloadId: '2' });
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(5);
      expect(service.getQueuedCount()).toBe(1);
    });

    it('coalesces a duplicate start for an already-queued model (queued once, started once)', async () => {
      ['a', 'b', 'c'].forEach((id) => service.startDownload(params(id)));
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);
      // A double-tap on the same queued model must not enqueue it twice.
      service.startDownload(params('d'));
      service.startDownload(params('d'));
      expect(service.getQueuedCount()).toBe(1);
      // When a slot frees, 'd' starts exactly once (not twice).
      eventHandlers.DownloadComplete({ downloadId: '1' });
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(4);
      expect(service.getQueuedCount()).toBe(0);
    });

    it('cancelQueued removes a waiting start, settles it as cancelled, and frees the queue', async () => {
      const promises = ['a', 'b', 'c', 'd'].map((id) => service.startDownload(params(id)));
      await flush();
      // 'd' is queued (a,b,c hold the 3 slots) — it has no native downloadId yet.
      expect(service.getQueuedCount()).toBe(1);
      let rejected: (Error & { cancelled?: boolean }) | null = null;
      const dSettled = promises[3].catch((e: Error & { cancelled?: boolean }) => { rejected = e; });

      const removed = service.cancelQueued('d');

      expect(removed).toBe(true);
      expect(service.getQueuedCount()).toBe(0);
      await dSettled;
      // The awaiting startDownload() settles as a user cancellation, not a failure.
      expect(rejected).not.toBeNull();
      expect(rejected!.cancelled).toBe(true);
      // Cancelling a queued start touches NO native download (it never began).
      expect(mockDownloadManagerModule.cancelDownload).not.toHaveBeenCalled();
    });

    it('cancelQueued returns false for a key that is not queued', () => {
      ['a', 'b', 'c'].forEach((id) => service.startDownload(params(id)));
      expect(service.cancelQueued('nope')).toBe(false);
    });

    it('adoptActive counts restored downloads against the cap', async () => {
      // Simulate a relaunch that resumed 3 downloads natively.
      service.adoptActive(['r1', 'r2', 'r3']);
      service.startDownload(params('new'));
      // Cap already full from restored ones → the fresh start is queued.
      expect(service.getQueuedCount()).toBe(1);
      await flush();
      expect(mockDownloadManagerModule.startDownload).not.toHaveBeenCalled();

      // A restored one finishing frees a slot for the queued start.
      eventHandlers.DownloadComplete({ downloadId: 'r1' });
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(1);
    });

    it('reconcileActiveIds reclaims leaked slots (e.g. folded mmproj sidecars) and pumps the queue', async () => {
      // 3 downloads hold the slots, a 4th is queued.
      ['a', 'b', 'c', 'd'].forEach((id) => service.startDownload(params(id)));
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);
      expect(service.getQueuedCount()).toBe(1);

      // Native truth: only '1' is still transferring — '2' and '3' leaked (their tasks
      // were folded into a main download, so they never emitted DownloadComplete and
      // release() was never called). Without reconcile, pump() sees the cap as full
      // forever and 'd' is wedged — the "1 downloading, N queued" collapse.
      mockDownloadManagerModule.getActiveDownloads.mockResolvedValue([{ downloadId: '1' }]);
      await service.reconcileActiveIds();
      await flush();

      // The two phantom slots are reclaimed, so the queued 'd' starts.
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(4);
      expect(service.getQueuedCount()).toBe(0);
    });

    it('retryDownload re-reserves the slot so a retried download counts against the cap', async () => {
      mockDownloadManagerModule.retryDownload.mockResolvedValue(undefined);
      ['a', 'b', 'c'].forEach((id) => service.startDownload(params(id))); // ids 1,2,3
      await flush();
      // 'a' (id '1') fails -> its slot is released.
      eventHandlers.DownloadError({ downloadId: '1', reason: 'boom' });
      await flush();

      // Retry it. Before the fix this restarted the native transfer without re-reserving,
      // so the cap was silently bypassed and its completion couldn't pump the queue.
      await service.retryDownload('1');

      // At the cap again -> a fresh start must queue.
      service.startDownload(params('d'));
      expect(service.getQueuedCount()).toBe(1);

      // The retried '1' completing frees its slot and promotes the queued 'd'.
      eventHandlers.DownloadComplete({ downloadId: '1' });
      await flush();
      expect(service.getQueuedCount()).toBe(0);
    });

    it('purgeNativeRecord drops the record and frees the slot WITHOUT dispatching an error', async () => {
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);
      const onErr = jest.fn();
      service.onAnyError(onErr);
      service.startDownload(params('a')); // id '1' occupies a slot
      await flush();

      await service.purgeNativeRecord('1');

      // Native record dropped and slot freed, but (unlike cancelDownload) NO synthetic
      // DownloadError — a just-finalized model must not flash "failed".
      expect(mockDownloadManagerModule.cancelDownload).toHaveBeenCalledWith('1');
      expect(onErr).not.toHaveBeenCalled();
      // Slot was freed: three fresh starts all begin, none queued.
      ['b', 'c', 'd'].forEach((id) => service.startDownload(params(id)));
      expect(service.getQueuedCount()).toBe(0);
    });

    it('reconcileActiveIds does NOT drop slots the native layer still reports active', async () => {
      ['a', 'b', 'c', 'd'].forEach((id) => service.startDownload(params(id)));
      await flush();
      // All three are genuinely still downloading — reconcile must not free anything.
      mockDownloadManagerModule.getActiveDownloads.mockResolvedValue([
        { downloadId: '1' }, { downloadId: '2' }, { downloadId: '3' },
      ]);
      await service.reconcileActiveIds();
      await flush();
      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledTimes(3);
      expect(service.getQueuedCount()).toBe(1);
    });
  });
});
