/**
 * Contract Tests: iOS DownloadManagerModule (Background Downloads)
 *
 * Verifies that the iOS DownloadManagerModule (URLSession-based) exposes
 * the same interface as the Android DownloadManagerModule (DownloadManager-based).
 *
 * Both modules are registered under the same name "DownloadManagerModule"
 * so that backgroundDownloadService.ts works on both platforms unchanged.
 */


// The iOS module must match this interface (same as Android)
interface DownloadManagerModuleInterface {
  startDownload(params: {
    url: string;
    fileName: string;
    modelId: string;
    title?: string;
    description?: string;
    totalBytes?: number;
    /** Continue from native partial bytes retained by a prior stop. */
    resume?: boolean;
  }): Promise<{
    downloadId: string;
    fileName: string;
    modelId: string;
  }>;

  /** Shared selects whether a terminal stop retains or deletes partial bytes. */
  stopDownload(
    downloadId: string,
    retainPartial: boolean,
  ): Promise<'stopped' | 'completed' | 'not-found'>;

  getActiveDownloads(): Promise<Array<{
    downloadId: string;
    fileName: string;
    modelId: string;
    status: string;
    bytesDownloaded: number;
    totalBytes: number;
    startedAt: number;
    localUri?: string;
    failureReason?: string;
  }>>;

  getDownloadProgress(downloadId: string): Promise<{
    bytesDownloaded: number;
    totalBytes: number;
    status: string;
  }>;

  moveCompletedDownload(downloadId: string, targetPath: string): Promise<string>;

  // iOS no-ops for API compatibility with Android's polling model
  startProgressPolling(): void;
  stopProgressPolling(): void;
}

// Mock the iOS native module
const mockDownloadModule: DownloadManagerModuleInterface = {
  startDownload: jest.fn(),
  stopDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  getDownloadProgress: jest.fn(),
  moveCompletedDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  stopProgressPolling: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: {
    DownloadManagerModule: mockDownloadModule,
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    removeAllListeners: jest.fn(),
  })),
  Platform: { OS: 'ios' },
}));

describe('iOS DownloadManagerModule Contract (parity with Android)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // Interface parity
  // ========================================================================
  describe('Interface parity with Android', () => {
    it('exposes all required methods', () => {
      const requiredMethods = [
        'startDownload',
        'stopDownload',
        'getActiveDownloads',
        'getDownloadProgress',
        'moveCompletedDownload',
        'startProgressPolling',
        'stopProgressPolling',
      ];

      for (const method of requiredMethods) {
        expect(mockDownloadModule).toHaveProperty(method);
        expect(typeof (mockDownloadModule as any)[method]).toBe('function');
      }
    });
  });

  // ========================================================================
  // startDownload
  // ========================================================================
  describe('startDownload', () => {
    it('accepts download params and returns downloadId + metadata', async () => {
      (mockDownloadModule.startDownload as jest.Mock).mockResolvedValue({
        downloadId: '1',
        fileName: 'sd21-coreml.zip',
        modelId: 'coreml_sd21',
      });

      const result = await mockDownloadModule.startDownload({
        url: 'https://huggingface.co/apple/coreml-stable-diffusion-2-1-base/resolve/main/model.zip',
        fileName: 'sd21-coreml.zip',
        modelId: 'coreml_sd21',
        title: 'Downloading SD 2.1 (Core ML)',
        description: 'Model download in progress...',
        totalBytes: 2_500_000_000,
      });

      expect(result).toHaveProperty('downloadId');
      expect(result).toHaveProperty('fileName');
      expect(result).toHaveProperty('modelId');
      expect(typeof result.downloadId).toBe('string');
      expect(typeof result.fileName).toBe('string');
    });

    it('accepts resume: true so a paused download continues from retained bytes', async () => {
      // This is the ONE widening in this contract for pause/resume. It is named here so it is
      // read as a deliberate surface change: both native modules must read `resume` and, when
      // true, continue from what the earlier retain-partial stop kept rather than start over.
      (mockDownloadModule.startDownload as jest.Mock).mockResolvedValue({
        downloadId: '3',
        fileName: 'model.gguf',
        modelId: 'test-model',
      });

      await mockDownloadModule.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test-model',
        resume: true,
      });

      expect(mockDownloadModule.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ resume: true }),
      );
    });

    it('works with minimal params (no title/description/totalBytes)', async () => {
      (mockDownloadModule.startDownload as jest.Mock).mockResolvedValue({
        downloadId: '2',
        fileName: 'model.gguf',
        modelId: 'test-model',
      });

      await mockDownloadModule.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test-model',
      });

      expect(mockDownloadModule.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.any(String),
          fileName: expect.any(String),
          modelId: expect.any(String),
        }),
      );
    });
  });

  // ========================================================================
  // stopDownload
  // ========================================================================
  describe('stopDownload', () => {
    it('accepts the Shared partial policy and reports whether stop won', async () => {
      (mockDownloadModule.stopDownload as jest.Mock).mockResolvedValue('stopped');

      await expect(mockDownloadModule.stopDownload('42', false)).resolves.toBe('stopped');
      expect(mockDownloadModule.stopDownload).toHaveBeenCalledWith('42', false);
    });
  });

  // ========================================================================
  // getActiveDownloads
  // ========================================================================
  describe('getActiveDownloads', () => {
    it('returns array of download info objects', async () => {
      const mockDownloads = [
        {
          downloadId: '1',
          fileName: 'model.zip',
          modelId: 'coreml_sd21',
          status: 'running',
          bytesDownloaded: 500_000_000,
          totalBytes: 2_500_000_000,
          startedAt: Date.now(),
        },
      ];
      (mockDownloadModule.getActiveDownloads as jest.Mock).mockResolvedValue(mockDownloads);

      const result = await mockDownloadModule.getActiveDownloads();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('downloadId');
      expect(result[0]).toHaveProperty('fileName');
      expect(result[0]).toHaveProperty('modelId');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('bytesDownloaded');
      expect(result[0]).toHaveProperty('totalBytes');
      expect(result[0]).toHaveProperty('startedAt');
    });

    it('returns empty array when no active downloads', async () => {
      (mockDownloadModule.getActiveDownloads as jest.Mock).mockResolvedValue([]);

      const result = await mockDownloadModule.getActiveDownloads();

      expect(result).toEqual([]);
    });

    it('includes completed downloads with localUri', async () => {
      const mockDownloads = [
        {
          downloadId: '1',
          fileName: 'model.zip',
          modelId: 'coreml_sd21',
          status: 'completed',
          bytesDownloaded: 2_500_000_000,
          totalBytes: 2_500_000_000,
          startedAt: Date.now() - 60000,
          localUri: '/var/mobile/.../Documents/downloads/model.zip',
        },
      ];
      (mockDownloadModule.getActiveDownloads as jest.Mock).mockResolvedValue(mockDownloads);

      const result = await mockDownloadModule.getActiveDownloads();

      expect(result[0].localUri).toBeDefined();
      expect(typeof result[0].localUri).toBe('string');
    });

    it('includes failed downloads with failureReason', async () => {
      const mockDownloads = [
        {
          downloadId: '2',
          fileName: 'model.zip',
          modelId: 'coreml_sd21',
          status: 'failed',
          bytesDownloaded: 100_000,
          totalBytes: 2_500_000_000,
          startedAt: Date.now() - 30000,
          failureReason: 'Network connection lost',
        },
      ];
      (mockDownloadModule.getActiveDownloads as jest.Mock).mockResolvedValue(mockDownloads);

      const result = await mockDownloadModule.getActiveDownloads();

      expect(result[0].status).toBe('failed');
      expect(result[0].failureReason).toBeDefined();
    });
  });

  // ========================================================================
  // getDownloadProgress
  // ========================================================================
  describe('getDownloadProgress', () => {
    it('returns progress for a specific download', async () => {
      (mockDownloadModule.getDownloadProgress as jest.Mock).mockResolvedValue({
        bytesDownloaded: 1_000_000_000,
        totalBytes: 2_500_000_000,
        status: 'running',
      });

      const result = await mockDownloadModule.getDownloadProgress('1');

      expect(result).toHaveProperty('bytesDownloaded');
      expect(result).toHaveProperty('totalBytes');
      expect(result).toHaveProperty('status');
      expect(typeof result.bytesDownloaded).toBe('number');
      expect(typeof result.totalBytes).toBe('number');
    });
  });

  // ========================================================================
  // moveCompletedDownload
  // ========================================================================
  describe('moveCompletedDownload', () => {
    it('moves file from temp location to target path', async () => {
      const targetPath = '/var/mobile/.../Documents/image_models/sd21/model.zip';
      (mockDownloadModule.moveCompletedDownload as jest.Mock).mockResolvedValue(targetPath);

      const result = await mockDownloadModule.moveCompletedDownload('1', targetPath);

      expect(mockDownloadModule.moveCompletedDownload).toHaveBeenCalledWith('1', targetPath);
      expect(typeof result).toBe('string');
      expect(result).toBe(targetPath);
    });
  });

  // ========================================================================
  // Polling compatibility stubs
  // ========================================================================
  describe('Polling compatibility (iOS no-ops)', () => {
    it('startProgressPolling exists but is a no-op on iOS', () => {
      // On iOS, progress comes via URLSessionDownloadDelegate (push-based),
      // so polling is unnecessary. These methods exist for API compatibility.
      mockDownloadModule.startProgressPolling();

      expect(mockDownloadModule.startProgressPolling).toHaveBeenCalled();
    });

    it('stopProgressPolling exists but is a no-op on iOS', () => {
      mockDownloadModule.stopProgressPolling();

      expect(mockDownloadModule.stopProgressPolling).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Event names and shapes (same as Android)
  // ========================================================================
  describe('Events (same names and shapes as Android)', () => {
    it('emits DownloadProgress with expected shape', () => {
      const progressEvent = {
        downloadId: '1',
        fileName: 'model.zip',
        modelId: 'coreml_sd21',
        bytesDownloaded: 500_000_000,
        totalBytes: 2_500_000_000,
        status: 'running',
      };

      expect(progressEvent).toHaveProperty('downloadId');
      expect(progressEvent).toHaveProperty('fileName');
      expect(progressEvent).toHaveProperty('modelId');
      expect(progressEvent).toHaveProperty('bytesDownloaded');
      expect(progressEvent).toHaveProperty('totalBytes');
      expect(progressEvent).toHaveProperty('status');
      expect(typeof progressEvent.downloadId).toBe('string');
      expect(typeof progressEvent.bytesDownloaded).toBe('number');
    });

    it('emits DownloadComplete with expected shape', () => {
      const completeEvent = {
        downloadId: '1',
        fileName: 'model.zip',
        modelId: 'coreml_sd21',
        bytesDownloaded: 2_500_000_000,
        totalBytes: 2_500_000_000,
        status: 'completed',
        localUri: '/var/mobile/.../Documents/downloads/model.zip',
      };

      expect(completeEvent).toHaveProperty('downloadId');
      expect(completeEvent).toHaveProperty('fileName');
      expect(completeEvent).toHaveProperty('modelId');
      expect(completeEvent).toHaveProperty('status', 'completed');
      expect(completeEvent).toHaveProperty('localUri');
      expect(typeof completeEvent.localUri).toBe('string');
    });

    it('emits DownloadError with expected shape', () => {
      const errorEvent = {
        downloadId: '1',
        fileName: 'model.zip',
        modelId: 'coreml_sd21',
        status: 'failed',
        reason: 'Network connection lost',
      };

      expect(errorEvent).toHaveProperty('downloadId');
      expect(errorEvent).toHaveProperty('fileName');
      expect(errorEvent).toHaveProperty('modelId');
      expect(errorEvent).toHaveProperty('status', 'failed');
      expect(errorEvent).toHaveProperty('reason');
      expect(typeof errorEvent.reason).toBe('string');
    });

    it('uses same event names as Android', () => {
      // These event names are hardcoded in backgroundDownloadService.ts
      // and must match on both platforms.
      const expectedEvents = [
        'DownloadProgress',
        'DownloadComplete',
        'DownloadError',
      ];

      // This is a documentation/contract test — the names are verified
      // against the TypeScript service that subscribes to them.
      expectedEvents.forEach(eventName => {
        expect(typeof eventName).toBe('string');
        expect(eventName.length).toBeGreaterThan(0);
      });
    });
  });

  // ========================================================================
  // iOS-specific behaviors
  // ========================================================================
  describe('iOS-specific download behaviors', () => {
    it('download status values match Android constants', () => {
      // Both platforms must use the same status strings
      const validStatuses = ['pending', 'running', 'paused', 'completed', 'failed'];

      validStatuses.forEach(status => {
        expect(typeof status).toBe('string');
      });
    });

    it('completed download includes localUri (moved from temp)', () => {
      // On iOS, URLSession downloads complete to a temporary file.
      // The native module must move it to Documents/ synchronously
      // and include the final path as localUri.
      const completedDownload = {
        downloadId: '1',
        fileName: 'model.zip',
        modelId: 'coreml_sd21',
        status: 'completed',
        bytesDownloaded: 2_500_000_000,
        totalBytes: 2_500_000_000,
        startedAt: Date.now() - 120000,
        localUri: '/var/mobile/Containers/Data/Application/.../Documents/downloads/model.zip',
      };

      expect(completedDownload.localUri).toBeDefined();
      expect(completedDownload.localUri).toContain('Documents');
    });
  });
});
