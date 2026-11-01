/**
 * Regression: Download Manager "Remove" on an in-flight STT download was a silent
 * no-op. The View dispatched the raw store id (`stt:whisper-medium.en`) while the STT
 * provider listed the canonical bare id (`stt:medium.en`), so ModelDownloadService
 * matched neither and logged `[DL-SM] … REFUSED: not found`. This drives the REAL
 * service + REAL sttProvider + REAL whisperService + REAL backgroundDownloadService +
 * REAL downloadStore through the exact id the View now produces (uniformDownloadId) and
 * asserts the entry is actually removed — from the store and from the native downloader.
 * Only the phone is faked: the native download module and the disk.
 */
import { installNativeBoundary, type NativeBoundary } from '../../harness/nativeBoundary';

let boundary: NativeBoundary;
let modelDownloadService: any;
let useDownloadStore: any;
let uniformDownloadId: (type: string, modelId: string) => string;
let KEY: string;

beforeEach(() => {
  boundary = installNativeBoundary({ download: true, fs: true });
  ({ modelDownloadService } = require('../../../src/services/modelDownloadService'));
  const { sttProvider } = require('../../../src/services/modelDownloadService/providers/sttProvider');
  ({ uniformDownloadId } = require('../../../src/services/modelDownloadService/uniformId'));
  ({ useDownloadStore } = require('../../../src/stores/downloadStore'));
  KEY = require('../../../src/utils/modelKey').makeModelKey('whisper-medium.en', 'ggml-medium.en.bin');

  modelDownloadService._reset();
  modelDownloadService.register(sttProvider);

  // The whisper download in flight: the native downloader holds its row, the store its entry.
  boundary.download!.seedActive({
    downloadId: 'dl-stt-1', modelId: 'whisper-medium.en', fileName: 'ggml-medium.en.bin',
    modelType: 'stt', status: 'running', bytesDownloaded: 0, totalBytes: 1000,
  });
  useDownloadStore.getState().add({
    modelKey: KEY, downloadId: 'dl-stt-1', modelId: 'whisper-medium.en', fileName: 'ggml-medium.en.bin',
    quantization: 'Unknown', modelType: 'stt', status: 'running',
    bytesDownloaded: 0, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0, createdAt: 1000,
  });
});

const nativeRowIds = () => boundary.download!.active().map(row => row.downloadId);

describe('STT Remove routing (real service + provider + store)', () => {
  it('lists the in-flight whisper row under the canonical bare id', async () => {
    const list = await modelDownloadService.list();
    expect(list.map((d: { id: string }) => d.id)).toContain('stt:medium.en');
  });

  it('the id the View produces matches the id the provider listed', async () => {
    const list = await modelDownloadService.list();
    // What useDownloadManager.idOf now computes from the raw store modelId:
    expect(uniformDownloadId('stt', 'whisper-medium.en')).toBe('stt:medium.en');
    expect(list.some((d: { id: string }) => d.id === uniformDownloadId('stt', 'whisper-medium.en'))).toBe(true);
  });

  it('removes the in-flight entry when dispatched with the View-derived id', async () => {
    await modelDownloadService.cancel(uniformDownloadId('stt', 'whisper-medium.en'));
    expect(nativeRowIds()).not.toContain('dl-stt-1');
    expect(useDownloadStore.getState().downloads[KEY]).toBeUndefined();
  });

  it('the OLD raw id (whisper- prefix intact) is the bug: service refuses it, entry survives', async () => {
    await modelDownloadService.cancel('stt:whisper-medium.en');
    expect(nativeRowIds()).toContain('dl-stt-1');
    expect(useDownloadStore.getState().downloads[KEY]).toBeDefined();
  });
});
