/**
 * STT download provider — wraps the existing whisper + downloadStore bridge under
 * the uniform DownloadProvider contract. Verifies list merges in-flight + completed,
 * retry/cancel/remove delegate to the working service calls, and reconcile strands
 * an interrupted (non-resumable) download as a retriable error.
 */
jest.mock('../../../src/services/whisperService', () => ({
  whisperService: {
    listDownloadedModels: jest.fn(async () => []),
    downloadModel: jest.fn(async () => '/path'),
    deleteModel: jest.fn(async () => {}),
  },
}));
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: { cancelDownload: jest.fn(async () => {}) },
}));
jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { sttProvider } from '../../../src/services/modelDownloadService/providers/sttProvider';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { whisperService } from '../../../src/services/whisperService';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';

const mockWhisper = whisperService as unknown as { listDownloadedModels: jest.Mock; downloadModel: jest.Mock; deleteModel: jest.Mock };
const mockBg = backgroundDownloadService as unknown as { cancelDownload: jest.Mock };

const entry = (over: any = {}) => ({
  modelKey: 'whisper-base.en/ggml-base.en.bin', downloadId: 'dl-1', modelId: 'whisper-base.en',
  fileName: 'ggml-base.en.bin', quantization: '', modelType: 'stt', status: 'running',
  bytesDownloaded: 50, totalBytes: 100, combinedTotalBytes: 100, progress: 0.5, createdAt: 1, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
  useDownloadStore.getState().add(entry());
});

describe('sttProvider', () => {
  it('lists an in-flight download mapped to the uniform shape (downloading)', async () => {
    const list = await sttProvider.list();
    const d = list.find(x => x.id === 'stt:base.en');
    expect(d?.status).toBe('downloading');
    expect(d?.modelType).toBe('stt');
    expect(d?.capabilities.resumable).toBe(false);
    expect(d?.progress).toBe(0.5);
  });

  it('lists completed disk models, skipping ones already in-flight', async () => {
    mockWhisper.listDownloadedModels.mockResolvedValue([
      { modelId: 'base.en', fileName: 'ggml-base.en.bin', sizeBytes: 100, filePath: '/p' }, // dup of in-flight
      { modelId: 'small', fileName: 'ggml-small.bin', sizeBytes: 400, filePath: '/p2' },
    ]);
    const list = await sttProvider.list();
    expect(list.filter(d => d.id === 'stt:base.en')).toHaveLength(1); // not duplicated
    const done = list.find(d => d.id === 'stt:small');
    expect(done?.status).toBe('completed');
  });

  it('cancel cancels the native task and clears the store row', async () => {
    await sttProvider.cancel('stt:base.en');
    expect(mockBg.cancelDownload).toHaveBeenCalledWith('dl-1');
    expect(useDownloadStore.getState().downloads['whisper-base.en/ggml-base.en.bin']).toBeUndefined();
  });

  it('retry clears the dead row then re-downloads via whisperService', async () => {
    await sttProvider.retry('stt:base.en');
    expect(mockBg.cancelDownload).toHaveBeenCalledWith('dl-1');
    expect(mockWhisper.downloadModel).toHaveBeenCalledWith('base.en');
  });

  it('retry restores a failed row if the re-download fails before re-registering (no vanished model)', async () => {
    mockWhisper.downloadModel.mockRejectedValueOnce(new Error('network down'));
    await sttProvider.retry('stt:base.en');
    // A moment for the fire-and-forget re-download rejection to settle.
    await new Promise(r => setImmediate(r));
    const restored = useDownloadStore.getState().downloads['whisper-base.en/ggml-base.en.bin'];
    expect(restored).toBeDefined();
    expect(restored.status).toBe('failed');
    expect(restored.errorMessage).toBe('network down');
  });

  it('remove deletes the model from disk', async () => {
    await sttProvider.remove('stt:base.en');
    expect(mockWhisper.deleteModel).toHaveBeenCalledWith('base.en');
  });

  it('reconcile strands an interrupted in-flight download as failed (not resumable)', async () => {
    await sttProvider.reconcile!();
    const e = useDownloadStore.getState().downloads['whisper-base.en/ggml-base.en.bin'];
    expect(e.status).toBe('failed');
  });
});
