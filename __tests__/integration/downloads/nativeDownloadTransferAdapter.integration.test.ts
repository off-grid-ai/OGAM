import { installNativeBoundary } from '../../harness/nativeBoundary';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

describe('native download transfer terminal ownership', () => {
  it('uses the in-flight move as the one terminal operation when abort races completion', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    const move = deferred<string>();
    nativeDownload.module.moveCompletedDownload.mockReturnValueOnce(move.promise);
    nativeDownload.seedActive({ downloadId: 'transfer-1', status: 'running' });
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();
    const abort = new AbortController();

    const attached = adapter.attach({
      transferId: 'transfer-1',
      destination: '/staging/model.bin',
      signal: abort.signal,
      onProgress: jest.fn(),
    });
    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-1' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).toHaveBeenCalledTimes(1);

    abort.abort();
    const stopped = adapter.stop({
      transferId: 'transfer-1',
      disposition: 'delete-partial',
    });
    expect(nativeDownload.module.stopDownload).not.toHaveBeenCalled();

    move.resolve('/staging/model.bin');
    await expect(stopped).resolves.toEqual({ outcome: 'completed' });
    await expect(attached).resolves.toBeUndefined();
    expect(nativeDownload.module.moveCompletedDownload).toHaveBeenCalledTimes(1);
    expect(nativeDownload.module.stopDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('does not start a move after native cancellation owns terminal settlement', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    const stopAcknowledgement = deferred<string>();
    nativeDownload.module.stopDownload.mockReturnValueOnce(stopAcknowledgement.promise);
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();
    const abort = new AbortController();
    const attached = adapter.attach({
      transferId: 'transfer-cancel-first',
      destination: '/staging/model.bin',
      signal: abort.signal,
      onProgress: jest.fn(),
    });

    const stopped = adapter.stop({
      transferId: 'transfer-cancel-first',
      disposition: 'delete-partial',
    });
    nativeDownload.events.emit('DownloadComplete', {
      downloadId: 'transfer-cancel-first',
    });
    abort.abort();
    await Promise.resolve();
    expect(nativeDownload.module.stopDownload).toHaveBeenCalledWith(
      'transfer-cancel-first',
      false,
    );
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();

    stopAcknowledgement.resolve('stopped');
    await expect(stopped).resolves.toEqual({ outcome: 'stopped' });
    await expect(attached).rejects.toMatchObject({ name: 'DownloadAbortedError' });
    expect(nativeDownload.module.stopDownload).toHaveBeenCalledTimes(1);
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('removes native listeners when progress polling setup throws', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    nativeDownload.module.startProgressPolling.mockImplementationOnce(() => {
      throw new Error('poll setup failed');
    });
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();

    await expect(adapter.attach({
      transferId: 'transfer-2',
      destination: '/staging/model.bin',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    })).rejects.toThrow('poll setup failed');

    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-2' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('removes native listeners when the initial transfer query rejects', async () => {
    const boundary = installNativeBoundary({ download: true });
    const nativeDownload = boundary.download!;
    nativeDownload.module.getActiveDownloads.mockRejectedValueOnce(
      new Error('download query failed'),
    );
    const { NativeDownloadTransferAdapter } = require(
      '../../../src/services/adapters/downloads/nativeDownloadTransferAdapter'
    );
    const adapter = new NativeDownloadTransferAdapter();

    await expect(adapter.attach({
      transferId: 'transfer-3',
      destination: '/staging/model.bin',
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    })).rejects.toThrow('download query failed');

    nativeDownload.events.emit('DownloadComplete', { downloadId: 'transfer-3' });
    await Promise.resolve();
    expect(nativeDownload.module.moveCompletedDownload).not.toHaveBeenCalled();
    adapter.dispose();
  });
});
