/**
 * startModelDownload ↔ real downloadStore ↔ real appStore.
 *
 * The unit test mocks the stores; this exercises the REAL stores so the shared
 * download action's actual mutations are validated: a completed download registers
 * the model in appStore AND clears its in-flight downloadStore entry; the duplicate
 * guard reads the real store; a watch error flips the real entry to 'failed'. Only the
 * native boundary (modelManager.downloadModelBackground/watchDownload) is mocked.
 */
let mockOnComplete: ((m: any) => void) | undefined;
let mockOnError: ((e: Error) => void) | undefined;
const mockDownloadModelBackground = jest.fn();
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    downloadModelBackground: (...a: unknown[]) => mockDownloadModelBackground(...a),
    watchDownload: (_id: string, c: (m: any) => void, e: (err: Error) => void) => { mockOnComplete = c; mockOnError = e; },
  },
}));

import { startModelDownload } from '../../../src/services/startModelDownload';
import { useDownloadStore, DownloadEntry } from '../../../src/stores/downloadStore';
import { useAppStore } from '../../../src/stores';
import { makeModelKey } from '../../../src/utils/modelKey';
import { createDownloadedModel } from '../../utils/factories';

const FILE = { name: 'model.gguf' } as any;
const KEY = makeModelKey('author/model', 'model.gguf');

const inflightEntry = (over: Partial<DownloadEntry> = {}): DownloadEntry => ({
  modelKey: KEY, downloadId: 'dl-1', modelId: 'author/model', fileName: 'model.gguf',
  quantization: 'Q4_K_M', modelType: 'text', status: 'pending',
  bytesDownloaded: 0, totalBytes: 1000, combinedTotalBytes: 1000, progress: 0, createdAt: 1000,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOnComplete = undefined;
  mockOnError = undefined;
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
  useAppStore.setState({ downloadedModels: [] });
});

describe('startModelDownload flow (real stores)', () => {
  it('completion registers the model in appStore and clears the in-flight entry', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    await startModelDownload('author/model', FILE);
    // startModelDownload already published a queued placeholder row; download.ts (mocked
    // here) reconciles it to the real downloadId via retryEntry — simulate that.
    useDownloadStore.getState().retryEntry(KEY, 'dl-1');

    mockOnComplete!(createDownloadedModel({ id: 'author/model/model.gguf' }));

    expect(useAppStore.getState().downloadedModels.some(m => m.id === 'author/model/model.gguf')).toBe(true);
    expect(useDownloadStore.getState().downloads[KEY]).toBeUndefined();
  });

  it('does not start a second download when one is already active (real-store guard)', async () => {
    useDownloadStore.getState().add(inflightEntry({ status: 'running' }));
    await startModelDownload('author/model', FILE);
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
  });

  it('publishes a real queued (pending) row up-front so screens can show it', async () => {
    // Never resolve the start → the download stays "queued"; the row must still exist.
    mockDownloadModelBackground.mockReturnValue(new Promise(() => {}));
    startModelDownload('author/model', FILE);
    const entry = useDownloadStore.getState().downloads[KEY];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('pending');
    expect(entry.downloadId).toBe(`queued:${KEY}`);
  });

  it('dedups a rapid second tap while the first is still queued (real store)', async () => {
    mockDownloadModelBackground.mockReturnValue(new Promise(() => {}));
    startModelDownload('author/model', FILE); // queues, publishes pending row
    await startModelDownload('author/model', FILE); // second tap
    expect(mockDownloadModelBackground).toHaveBeenCalledTimes(1);
  });

  it('flips the real entry to failed when the watch reports an error', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    await startModelDownload('author/model', FILE);
    // Reconcile the queued placeholder to the real id (download.ts does this), then let
    // native progress mark it running — the state the watch error fires against.
    useDownloadStore.getState().retryEntry(KEY, 'dl-1');
    useDownloadStore.getState().setStatus('dl-1', 'running');

    mockOnError!(new Error('net'));

    expect(useDownloadStore.getState().downloads[KEY].status).toBe('failed');
  });
});
