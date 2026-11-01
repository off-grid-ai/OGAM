/**
 * sttProvider — the transcription models' side of the Download Manager: what it lists, and its cancel, retry,
 * remove and relaunch reconcile.
 *
 * The phone is the boundary: the native background downloader (its rows; it can refuse a start), the disk
 * and storage (harness/modelManagerDevice). The provider, the transcription downloads and the download store
 * run for real, and a download starts the way the app starts one.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { requireRTL } from '../../harness/nativeBoundary';

const SIZE = 142 * 1024 * 1024;
let device: ModelManagerDevice;
let sttProvider: typeof import('../../../src/services/modelDownloadService/providers/sttProvider')['sttProvider'];
let whisperService: typeof import('../../../src/services/whisperService')['whisperService'];
let store: () => ReturnType<typeof import('../../../src/stores/downloadStore')['useDownloadStore']['getState']>;

beforeEach(async () => {
  device = await installModelManagerDevice();
  ({ sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider'));
  ({ whisperService } = require('../../../src/services/whisperService'));
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  store = () => useDownloadStore.getState();
});

const KEY = 'whisper-base.en/ggml-base.en.bin';
const transfers = () => device.nativeRows().filter(r => r.modelId === 'whisper-base.en');

/** Base (English) is downloading; returns the download's outcome (wrapped, so awaiting this does not wait for it). */
async function downloadingBase() {
  const done = whisperService.downloadModel('base.en').then(() => null, (e: Error) => e);
  await device.settle();
  return { done };
}

describe('sttProvider', () => {
  it('lists an in-flight download mapped to the uniform shape', async () => {
    // The app root carries the native downloader's progress into the store.
    const { useDownloadListeners } = require('../../../src/hooks/useDownloads');
    requireRTL().renderHook(() => useDownloadListeners());
    const { done } = await downloadingBase();
    await device.reportProgress(transfers()[0].downloadId, SIZE / 2, SIZE);
    const d = (await sttProvider.list()).find(x => x.id === 'stt:base.en');
    expect(d).toEqual(expect.objectContaining({ status: 'downloading', modelType: 'stt' }));
    expect(d?.capabilities.resumable).toBe(false);
    expect(d?.progress).toBeCloseTo(0.5);
    void done;
  });

  it('lists completed disk models, skipping ones already in flight', async () => {
    const { done } = await downloadingBase();
    // Small is on the phone from earlier; Base's file is the one being written.
    device.fs.seedFile(whisperService.getModelPath('small'), 466 * 1024 * 1024);
    const list = await sttProvider.list();
    expect(list.filter(d => d.id === 'stt:base.en')).toHaveLength(1);
    expect(list.find(d => d.id === 'stt:small')?.status).toBe('completed');
    void done;
  });

  it('cancel stops the native transfer and clears the row', async () => {
    const { done } = await downloadingBase();
    await sttProvider.cancel('stt:base.en');
    expect(transfers()).toEqual([]);
    expect(store().downloads[KEY]).toBeUndefined();
    void done;
  });

  it('retry stops the dead transfer and downloads again', async () => {
    const { done: first } = await downloadingBase();
    await device.failDownload(transfers()[0].downloadId, 'connection reset');
    await first;
    expect(store().downloads[KEY].status).toBe('failed');

    await sttProvider.retry('stt:base.en');
    await device.settle();
    // One fresh transfer runs; the failed row is replaced by the live download.
    const [again] = transfers();
    expect(transfers()).toHaveLength(1);
    expect(again).toEqual(expect.objectContaining({ status: 'running', bytesDownloaded: 0 }));
    expect(store().downloads[KEY].status).not.toBe('failed');
    await device.finishDownload(again.downloadId, SIZE);
    await device.settle();
    expect(await whisperService.isModelDownloaded('base.en')).toBe(true);
  });

  it('retry restores a failed row if the re-download fails before it registers (no vanished model)', async () => {
    const { done: first } = await downloadingBase();
    await device.failDownload(transfers()[0].downloadId, 'connection reset');
    await first;
    // The phone refuses to start the next transfer.
    device.boundary.download!.module.startDownload.mockRejectedValueOnce(new Error('network down'));

    await sttProvider.retry('stt:base.en');
    await device.settle();
    const restored = store().downloads[KEY];
    expect(restored).toEqual(expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('network down') }));
  });

  it('remove deletes the model from disk', async () => {
    device.fs.seedFile(whisperService.getModelPath('base.en'), SIZE);
    await sttProvider.remove('stt:base.en');
    expect(await device.fs.exists(whisperService.getModelPath('base.en'))).toBe(false);
  });

  it('reconcile strands an interrupted in-flight download as failed (not resumable)', async () => {
    // After a relaunch, the row the last run left behind is in the store, but its foreground transfer died.
    store().add({
      modelKey: KEY as never, downloadId: 'dl-old', modelId: 'whisper-base.en', fileName: 'ggml-base.en.bin',
      quantization: '', modelType: 'stt' as never, status: 'running' as never, bytesDownloaded: 50,
      totalBytes: 100, combinedTotalBytes: 100, progress: 0.5, createdAt: 1,
    });
    await sttProvider.reconcile!();
    expect(store().downloads[KEY].status).toBe('failed');
  });
});
