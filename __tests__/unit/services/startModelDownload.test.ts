/**
 * startModelDownload — the single download action shared by the Models screen and
 * the onboarding ModelDownloadScreen. Verifies the duplicate guard, the
 * downloadModelBackground→watchDownload wiring, register+clear on completion, and the
 * error path (failed status + onError).
 */
const mockDownloadModelBackground = jest.fn();
const mockWatchDownload = jest.fn();
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    downloadModelBackground: (...a: unknown[]) => mockDownloadModelBackground(...a),
    watchDownload: (...a: unknown[]) => mockWatchDownload(...a),
  },
}));

const mockStore: { downloads: Record<string, { status: string }>; add: jest.Mock; remove: jest.Mock; setStatus: jest.Mock } = {
  downloads: {}, add: jest.fn(), remove: jest.fn(), setStatus: jest.fn(),
};
jest.mock('../../../src/stores/downloadStore', () => ({
  useDownloadStore: { getState: () => mockStore },
  isActiveStatus: (s: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(s),
}));

const mockAddDownloadedModel = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => ({ addDownloadedModel: mockAddDownloadedModel }) },
}));
jest.mock('../../../src/utils/modelKey', () => ({ makeModelKey: (id: string, f: string) => `${id}/${f}` }));

import { startModelDownload } from '../../../src/services/startModelDownload';

const MODEL_ID = 'author/model';
const FILE = { name: 'model.gguf' } as any;
const KEY = 'author/model/model.gguf';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.downloads = {};
});

describe('startModelDownload', () => {
  it('starts the download and wires watchDownload; completion registers + clears + onRegistered', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    let onComplete: ((m: any) => void) | undefined;
    mockWatchDownload.mockImplementation((_id, c) => { onComplete = c; });
    const onRegistered = jest.fn();

    await startModelDownload(MODEL_ID, FILE, { onRegistered });

    expect(mockDownloadModelBackground).toHaveBeenCalledWith(MODEL_ID, FILE);
    expect(mockWatchDownload).toHaveBeenCalled();

    const dm = { id: KEY };
    onComplete!(dm);
    expect(mockAddDownloadedModel).toHaveBeenCalledWith(dm);
    expect(mockStore.remove).toHaveBeenCalledWith(KEY);
    expect(onRegistered).toHaveBeenCalledWith(dm);
  });

  it('is a no-op when a download is already active (duplicate guard)', async () => {
    mockStore.downloads = { [KEY]: { status: 'running' } };
    await startModelDownload(MODEL_ID, FILE, {});
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
  });

  it('surfaces a start failure via onError and fails the queued placeholder row', async () => {
    mockDownloadModelBackground.mockRejectedValue(new Error('boom'));
    const onError = jest.fn();
    await startModelDownload(MODEL_ID, FILE, { onError });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    // The failure target before a real native id exists is the queued placeholder row.
    expect(mockStore.setStatus).toHaveBeenCalledWith(`queued:${KEY}`, 'failed', { message: 'boom' });
  });

  it('swallows a cancellation of a still-queued start and removes the placeholder row', async () => {
    // Cancelling a "Queued" row rejects the awaited start with `.cancelled` — it is not
    // an error, so it must NOT surface onError, and the placeholder row must be removed.
    const cancelled = Object.assign(new Error('Download cancelled'), { cancelled: true });
    mockDownloadModelBackground.mockRejectedValue(cancelled);
    const onError = jest.fn();
    await startModelDownload(MODEL_ID, FILE, { onError });
    expect(onError).not.toHaveBeenCalled();
    expect(mockStore.setStatus).not.toHaveBeenCalled();
    expect(mockStore.remove).toHaveBeenCalledWith(KEY);
  });

  it('publishes a QUEUED (pending) store row up-front, before the native start', async () => {
    // The row must exist immediately so the Models/onboarding screens (which read the
    // store) can show "Queued" while the download waits for a concurrency slot.
    let resolveStart: (v: any) => void;
    mockDownloadModelBackground.mockReturnValue(new Promise(res => { resolveStart = res; }));

    const p = startModelDownload(MODEL_ID, FILE, {});
    // add() was called synchronously, before downloadModelBackground resolved.
    expect(mockStore.add).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: KEY, downloadId: `queued:${KEY}`, status: 'pending', modelType: 'text',
    }));
    resolveStart!({ downloadId: 'dl-1' });
    await p;
  });

  it('stores the mmproj FILENAME (not the main gguf name) on a vision queued row', async () => {
    mockDownloadModelBackground.mockReturnValue(new Promise(() => {}));
    startModelDownload(MODEL_ID, { name: 'model.gguf', mmProjFile: { size: 500 } } as any, {});
    expect(mockStore.add).toHaveBeenCalledWith(expect.objectContaining({
      mmProjFileName: 'model-mmproj.gguf', mmProjFileSize: 500,
    }));
  });

  it('is a no-op on a second tap while the first is still QUEUED (dedup)', async () => {
    // Simulate the first tap having published the queued row (status pending).
    mockStore.downloads = { [KEY]: { status: 'pending' } };
    await startModelDownload(MODEL_ID, FILE, {});
    expect(mockDownloadModelBackground).not.toHaveBeenCalled();
    expect(mockStore.add).not.toHaveBeenCalled();
  });

  it('marks the entry failed + calls onError when watchDownload reports an error', async () => {
    mockDownloadModelBackground.mockResolvedValue({ downloadId: 'dl-1' });
    let onErr: ((e: Error) => void) | undefined;
    mockWatchDownload.mockImplementation((_id, _c, e) => { onErr = e; });
    const onError = jest.fn();

    await startModelDownload(MODEL_ID, FILE, { onError });
    onErr!(new Error('net'));

    expect(mockStore.setStatus).toHaveBeenCalledWith('dl-1', 'failed', { message: 'net' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'net' }));
  });
});
