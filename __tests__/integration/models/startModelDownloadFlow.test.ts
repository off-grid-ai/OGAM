/**
 * startModelDownload ↔ real modelManager ↔ real downloadStore ↔ real appStore.
 *
 * The unit test mocks the stores; this exercises the REAL download pipeline so the shared download
 * action's actual mutations are validated: a completed download registers the model in appStore AND
 * clears its in-flight downloadStore entry; the duplicate guard reads the real store; a native error
 * flips the real entry to 'failed'. Only the phone is faked (modelManagerDevice: the native background
 * downloader, the disk, async-storage); modelManager, backgroundDownloadService and the stores run for real.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';

const FILE = {
  name: 'model.gguf',
  size: 1000,
  quantization: 'Q4_K_M',
  downloadUrl: 'https://huggingface.co/author/model/resolve/main/model.gguf',
} as any;

let device: ModelManagerDevice;
let startModelDownload: typeof import('../../../src/services/startModelDownload').startModelDownload;
let useDownloadStore: typeof import('../../../src/stores/downloadStore').useDownloadStore;
let useAppStore: typeof import('../../../src/stores').useAppStore;
let KEY: string;

beforeEach(async () => {
  device = await installModelManagerDevice();
  ({ startModelDownload } = require('../../../src/services/startModelDownload'));
  ({ useDownloadStore } = require('../../../src/stores/downloadStore'));
  ({ useAppStore } = require('../../../src/stores'));
  KEY = require('../../../src/utils/modelKey').makeModelKey('author/model', 'model.gguf');
});

/** The one native transfer the app started for this model. */
function nativeDownloadId(): string {
  const rows = device.nativeRows().filter(row => row.fileName === 'model.gguf');
  expect(rows).toHaveLength(1);
  return rows[0].downloadId;
}

describe('startModelDownload flow (real stores)', () => {
  it('completion registers the model in appStore and clears the in-flight entry', async () => {
    await startModelDownload('author/model', FILE);
    await device.settle();

    await device.finishDownload(nativeDownloadId(), FILE.size);

    expect(useAppStore.getState().downloadedModels.some(m => m.fileName === 'model.gguf')).toBe(true);
    expect(useDownloadStore.getState().downloads[KEY]).toBeUndefined();
  });

  it('does not start a second download when one is already active (real-store guard)', async () => {
    useDownloadStore.getState().add({
      modelKey: KEY, downloadId: 'dl-earlier', modelId: 'author/model', fileName: 'model.gguf',
      quantization: 'Q4_K_M', modelType: 'text', status: 'running',
      bytesDownloaded: 0, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0, createdAt: 1000,
    });

    await startModelDownload('author/model', FILE);
    await device.settle();

    // Nothing reached the native downloader.
    expect(device.nativeRows()).toHaveLength(0);
  });

  it('publishes a real queued (pending) row up-front so screens can show it', () => {
    // The row is published before the native start is even asked for.
    startModelDownload('author/model', FILE).catch(() => {});
    const entry = useDownloadStore.getState().downloads[KEY];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('pending');
    expect(entry.downloadId).toBe(`queued:${KEY}`);
  });

  it('dedups a rapid second tap while the first is still queued (real store)', async () => {
    startModelDownload('author/model', FILE).catch(() => {}); // queues, publishes pending row
    await startModelDownload('author/model', FILE); // second tap
    await device.settle();

    // One native transfer, not two.
    expect(device.nativeRows().filter(row => row.fileName === 'model.gguf')).toHaveLength(1);
  });

  it('flips the real entry to failed when the native download reports an error', async () => {
    await startModelDownload('author/model', FILE);
    await device.settle();
    const id = nativeDownloadId();
    // Native progress marks it running — the state the error fires against.
    await device.reportProgress(id, 100, FILE.size);

    await device.failDownload(id, 'net');

    expect(useDownloadStore.getState().downloads[KEY].status).toBe('failed');
  });

  it('keeps the native reason code on the failed row, so it is never a generic error', async () => {
    // The watcher once rebuilt the native event as `new Error(reason)`: the code was lost, and every
    // Android failure counted as a bare "error" (PostHog 0.0.122: 245 failures, 108 people).
    await startModelDownload('author/model', FILE);
    await device.settle();
    const id = nativeDownloadId();
    await device.reportProgress(id, 100, FILE.size);

    await device.failDownload(id, 'The download was interrupted.', 'download_interrupted');

    expect(useDownloadStore.getState().downloads[KEY]).toMatchObject({ status: 'failed', errorCode: 'download_interrupted' });
  });

  it('a download whose save failed is saved again on Retry, from the bytes already on disk', async () => {
    // Play review (0.0.122): a download that failed while processing needed a whole new download. The
    // native row is completed, so a native retry refused it and nothing could save the file again.
    const { textProvider } = require('../../../src/services/modelDownloadService/providers/textProvider');
    await startModelDownload('author/model', FILE);
    await device.settle();
    const id = nativeDownloadId();
    device.failNextMove('No space left on device');

    await device.finishDownload(id, FILE.size);
    expect(useDownloadStore.getState().downloads[KEY]).toMatchObject({ status: 'failed', errorCode: 'finalize_failed' });

    await textProvider.retry(`text:${KEY}`);
    await device.settle();

    // Saved: the model is registered, its row is gone, and no second transfer started.
    expect(useAppStore.getState().downloadedModels.map(m => m.id)).toContain(KEY);
    expect(useDownloadStore.getState().downloads[KEY]).toBeUndefined();
    expect(device.nativeRows().filter(row => row.fileName === 'model.gguf' && row.status !== 'completed')).toHaveLength(0);
  });
});
