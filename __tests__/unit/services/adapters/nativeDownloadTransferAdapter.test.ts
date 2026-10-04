const mockNative = {
  startDownload: jest.fn(),
  stopDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  moveCompletedDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  requestNotificationPermission: jest.fn(),
  excludePathFromBackup: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
const mockHandlers: Record<string, (event: any) => void> = {};
const mockRemove = jest.fn();
const mockMkdir = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { DownloadManagerModule: mockNative },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (name: string, handler: (event: any) => void) => {
      mockHandlers[name] = handler;
      return { remove: mockRemove };
    },
  })),
  Platform: { OS: 'android' },
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { mkdir: mockMkdir },
}));

function freshAdapter(): any {
  let adapter: any;
  jest.isolateModules(() => {
    const singleton = require('../../../../src/services/adapters/downloads/nativeDownloadTransferAdapter')
      .nativeDownloadTransferAdapter;
    adapter = new singleton.constructor();
  });
  return adapter;
}

describe('nativeDownloadTransferAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
    mockNative.startDownload.mockResolvedValue({ downloadId: 42 });
    mockNative.getActiveDownloads.mockResolvedValue([]);
    mockNative.moveCompletedDownload.mockResolvedValue(undefined);
    mockNative.stopDownload.mockResolvedValue('stopped');
    mockMkdir.mockResolvedValue(undefined);
  });

  it('starts one native artifact transfer, forwards progress, moves completion, and settles', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    const onStarted = jest.fn();
    const onProgress = jest.fn();

    const completion = adapter.start({
      id: 'artifact-1',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      expectedBytes: 8,
      signal: controller.signal,
      onStarted,
      onProgress,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockMkdir).toHaveBeenCalledWith('/models');
    expect(mockNative.startDownload).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://models.test/model.gguf',
      fileName: 'model.gguf',
      modelId: 'artifact-1',
      modelKey: 'artifact-1',
      modelType: 'artifact',
      totalBytes: 8,
    }));
    expect(onStarted).toHaveBeenCalledWith('42');

    mockHandlers.DownloadProgress({ downloadId: '42', bytesDownloaded: 3, totalBytes: 8 });
    expect(onProgress).toHaveBeenCalledWith({ bytesDownloaded: 3, totalBytes: 8 });
    mockHandlers.DownloadComplete({ downloadId: '42' });

    await expect(completion).resolves.toEqual({ transferId: '42' });
    expect(mockNative.moveCompletedDownload).toHaveBeenCalledWith('42', '/models/model.gguf');
  });

  it('rejects errors from the native event and does not wait forever', async () => {
    const adapter = freshAdapter();
    const completion = adapter.start({
      id: 'artifact-2',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    mockHandlers.DownloadError({ downloadId: '42', reason: 'network lost' });
    await expect(completion).rejects.toThrow('network lost');
  });

  it('cancels the native transfer when the admitted handle is aborted', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    const completion = adapter.start({
      id: 'artifact-3',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: controller.signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const stop = adapter.stop({ transferId: '42', disposition: 'retain-partial' });
    await expect(completion).rejects.toThrow('Download cancelled');
    await expect(stop).resolves.toEqual({ outcome: 'stopped' });
    expect(mockNative.stopDownload).toHaveBeenCalledWith('42', true);
  });

  it('refuses a native stop response without a terminal verdict', async () => {
    mockNative.stopDownload.mockResolvedValueOnce(undefined);
    const adapter = freshAdapter();

    await expect(adapter.stop({
      transferId: '42',
      disposition: 'delete-partial',
    })).rejects.toThrow('Native download stop did not return a terminal verdict');
    expect(mockNative.stopDownload).toHaveBeenCalledWith('42', false);
  });

  it('settles the transfer as a failure when native reports not-found', async () => {
    mockNative.stopDownload.mockResolvedValueOnce('not-found');
    const adapter = freshAdapter();
    const completion = adapter.start({
      id: 'artifact-missing',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();

    await expect(adapter.stop({
      transferId: '42',
      disposition: 'delete-partial',
    })).resolves.toEqual({ outcome: 'not-found' });
    await expect(completion).rejects.toThrow('Native transfer was not found');
  });

  it('settles a retained recovered transfer as a typed abort when native already lost it', async () => {
    mockNative.stopDownload.mockResolvedValueOnce('not-found');
    const adapter = freshAdapter();
    const completion = adapter.start({
      id: 'artifact-recovered',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();

    await expect(adapter.stop({
      transferId: '42',
      disposition: 'retain-partial',
    })).resolves.toEqual({ outcome: 'stopped' });
    await expect(completion).rejects.toMatchObject({name: 'DownloadAbortedError'});
  });

  it('does not start native work for an already-aborted request', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.start({
      id: 'artifact-aborted',
      url: 'https://models.test/model.gguf',
      destination: '/models/model.gguf',
      signal: controller.signal,
      onProgress: jest.fn(),
    })).rejects.toMatchObject({ name: 'DownloadAbortedError' });
    expect(mockNative.startDownload).not.toHaveBeenCalled();
  });

  it('settles an already-aborted attach with the typed abort', async () => {
    const adapter = freshAdapter();
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.attach({
      transferId: '42',
      destination: '/models/model.gguf',
      signal: controller.signal,
      onProgress: jest.fn(),
    })).rejects.toMatchObject({ name: 'DownloadAbortedError' });
    expect(mockNative.startProgressPolling).not.toHaveBeenCalled();
  });

  it('attaches to a transfer that completed while JavaScript was stopped', async () => {
    mockNative.getActiveDownloads.mockResolvedValue([{ downloadId: 'survivor', status: 'completed' }]);
    const adapter = freshAdapter();
    await adapter.attach({
      transferId: 'survivor',
      destination: '/models/recovered.gguf',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
    expect(mockNative.moveCompletedDownload).toHaveBeenCalledWith('survivor', '/models/recovered.gguf');
  });

  it('reports only non-failed native rows as active and keeps platform helpers bounded', async () => {
    mockNative.getActiveDownloads.mockResolvedValue([
      { downloadId: 'live', status: 'running' },
      { downloadId: 'dead', status: 'failed' },
      { downloadId: 'paused', status: 'paused' },
      { downloadId: 'cancelled', status: 'cancelled' },
      { downloadId: 'ready-to-move', status: 'completed' },
    ]);
    mockNative.excludePathFromBackup.mockResolvedValue(true);
    const adapter = freshAdapter();
    await expect(adapter.isActive('live')).resolves.toBe(true);
    await expect(adapter.isActive('dead')).resolves.toBe(false);
    await expect(adapter.isActive('paused')).resolves.toBe(false);
    await expect(adapter.isActive('cancelled')).resolves.toBe(false);
    await expect(adapter.isActive('ready-to-move')).resolves.toBe(true);
    await expect(adapter.excludeFromBackup('/models')).resolves.toBe(true);
    adapter.dispose();
    expect(mockRemove).toHaveBeenCalledTimes(3);
  });
});
