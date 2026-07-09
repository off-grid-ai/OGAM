/**
 * Regression: Download Manager "Remove" on an in-flight STT download was a silent
 * no-op. The View dispatched the raw store id (`stt:whisper-medium.en`) while the STT
 * provider listed the canonical bare id (`stt:medium.en`), so ModelDownloadService
 * matched neither and logged `[DL-SM] … REFUSED: not found`. This drives the REAL
 * service + REAL sttProvider + REAL downloadStore through the exact id the View now
 * produces (uniformDownloadId) and asserts the entry is actually removed.
 */
const mockCancelDownload = jest.fn(async (..._a: any[]) => {});
const mockListDownloaded = jest.fn(async (..._a: any[]) => [] as any[]);
const mockDeleteModel = jest.fn(async (..._a: any[]) => {});

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    cancelDownload: (...a: any[]) => mockCancelDownload(...a),
    // The service consults the queue owner on a not-found cancel/remove; mirror the
    // real contract (empty queue here) so dispatch refuses cleanly instead of throwing.
    getQueuedItems: () => [],
    cancelQueued: () => false,
  },
}));
jest.mock('../../../src/services/whisperService', () => ({
  whisperService: {
    listDownloadedModels: (...a: any[]) => mockListDownloaded(...a),
    deleteModel: (...a: any[]) => mockDeleteModel(...a),
  },
}));

import { modelDownloadService } from '../../../src/services/modelDownloadService';
import { sttProvider } from '../../../src/services/modelDownloadService/providers/sttProvider';
import { uniformDownloadId } from '../../../src/services/modelDownloadService/uniformId';
import { useDownloadStore, DownloadEntry } from '../../../src/stores/downloadStore';
import { makeModelKey } from '../../../src/utils/modelKey';
import logger from '../../../src/utils/logger';

jest.spyOn(logger, 'log').mockImplementation(() => {});

const KEY = makeModelKey('whisper-medium.en', 'ggml-medium.en.bin');

const sttEntry = (over: Partial<DownloadEntry> = {}): DownloadEntry => ({
  modelKey: KEY, downloadId: 'dl-stt-1', modelId: 'whisper-medium.en', fileName: 'ggml-medium.en.bin',
  quantization: 'Unknown', modelType: 'stt', status: 'failed',
  bytesDownloaded: 0, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0, createdAt: 1000,
  ...over,
});

beforeEach(() => {
  modelDownloadService._reset();
  modelDownloadService.register(sttProvider);
  useDownloadStore.setState({ downloads: { [KEY]: sttEntry() }, downloadIdIndex: { 'dl-stt-1': KEY } });
  mockCancelDownload.mockClear();
  mockListDownloaded.mockResolvedValue([]);
});

describe('STT Remove routing (real service + provider + store)', () => {
  it('lists the in-flight whisper row under the canonical bare id', async () => {
    const list = await modelDownloadService.list();
    expect(list.map(d => d.id)).toContain('stt:medium.en');
  });

  it('the id the View produces matches the id the provider listed', async () => {
    const list = await modelDownloadService.list();
    // What useDownloadManager.idOf now computes from the raw store modelId:
    expect(uniformDownloadId('stt', 'whisper-medium.en')).toBe('stt:medium.en');
    expect(list.some(d => d.id === uniformDownloadId('stt', 'whisper-medium.en'))).toBe(true);
  });

  it('removes the in-flight entry when dispatched with the View-derived id', async () => {
    await modelDownloadService.cancel(uniformDownloadId('stt', 'whisper-medium.en'));
    expect(mockCancelDownload).toHaveBeenCalledWith('dl-stt-1');
    expect(useDownloadStore.getState().downloads[KEY]).toBeUndefined();
  });

  it('the OLD raw id (whisper- prefix intact) is the bug: service refuses it, entry survives', async () => {
    await modelDownloadService.cancel('stt:whisper-medium.en');
    expect(mockCancelDownload).not.toHaveBeenCalled();
    expect(useDownloadStore.getState().downloads[KEY]).toBeDefined();
  });
});
