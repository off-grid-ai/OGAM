/**
 * FAILURE JOURNEY — a multi-file image download where ONE part truncates to 0 bytes.
 *
 * Cluster D. Drives the REAL downloadHuggingFaceModel orchestration + REAL
 * validateMultifileComplete + REAL downloadStore. The network boundary
 * (downloadFileTo) is the only fake and it returns DIFFERENT results per part:
 * every part "succeeds" (200 OK) but the SECOND writes a 0-byte body (a silent
 * truncation — a 200 with no content). A static mock that always writes real bytes
 * would never exercise the reject-before-register guard.
 *
 * Terminal artifacts asserted:
 *   - the model is NEVER registered (addDownloadedImageModel not called) — garbage
 *     must not become a usable model.
 *   - the store entry ends FAILED with a retriable message (not silently completed).
 *   - the partial dir is cleaned up.
 */
import RNFS from 'react-native-fs';
import { useDownloadStore } from '../../../../src/stores/downloadStore';
import { makeImageModelKey } from '../../../../src/utils/modelKey';

const mockBackground = {
  downloadFileTo: jest.fn(),
  cancelDownload: jest.fn(async () => {}),
  cancelQueued: jest.fn(),
};
const mockModelManager = {
  getImageModelsDirectory: jest.fn(() => '/mock/image_models'),
  addDownloadedImageModel: jest.fn(async () => {}),
};

jest.mock('../../../../src/services', () => ({
  modelManager: mockModelManager,
  hardwareService: { getSoCInfo: jest.fn() },
  backgroundDownloadService: mockBackground,
}));
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string) => ({ visible: true, title, message })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

const { downloadHuggingFaceModel } = require('../../../../src/screens/ModelsScreen/imageDownloadActions');
const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

const MODEL_ID = 'sd-multifile';
const KEY = makeImageModelKey(MODEL_ID);
const dir = '/mock/image_models/sd-multifile';

describe('failure journey — multi-file download, one part truncates to 0 bytes', () => {
  let fileSizes: Record<string, number>;
  let existingPaths: Set<string>;

  beforeEach(() => {
    jest.clearAllMocks();
    fileSizes = {};
    existingPaths = new Set<string>();
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} } as any);

    mockedRNFS.exists.mockImplementation(async (p: string) => existingPaths.has(p));
    mockedRNFS.mkdir.mockImplementation(async (p: string) => { existingPaths.add(p); });
    mockedRNFS.unlink.mockImplementation(async (p: string) => { existingPaths.delete(p); });
    mockedRNFS.stat.mockImplementation(async (p: string) => ({ size: fileSizes[p] ?? -1 } as any));

    // DYNAMIC boundary: each part "downloads" but the 2nd writes a 0-byte file.
    mockBackground.downloadFileTo.mockImplementation((opts: any) => {
      const write = async () => {
        const isTruncated = opts.destPath.includes('unet');
        fileSizes[opts.destPath] = isTruncated ? 0 : 1000; // 0-byte truncation on unet
        existingPaths.add(opts.destPath);
      };
      return {
        downloadIdPromise: Promise.resolve(`native-${opts.params.fileName}`),
        promise: write(),
      };
    });
  });

  it('rejects before register: no model registered, entry failed + retriable, dir cleaned', async () => {
    const deps = {
      addDownloadedImageModel: jest.fn(),
      activeImageModelId: null,
      setActiveImageModelId: jest.fn(),
      setAlertState: jest.fn(),
      triedImageGen: true,
    };

    await downloadHuggingFaceModel(
      {
        id: MODEL_ID,
        name: 'SD Multifile',
        description: 'd',
        size: 2000,
        backend: 'mnn',
        huggingFaceRepo: 'org/repo',
        huggingFaceFiles: [
          { path: 'vae.bin', size: 1000 },
          { path: 'unet.bin', size: 1000 }, // this one truncates to 0
        ],
      } as any,
      deps as any,
    );

    // Terminal artifact 1: NEVER registered a broken model.
    expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
    expect(deps.addDownloadedImageModel).not.toHaveBeenCalled();

    // Terminal artifact 2: the store entry is FAILED (retriable), not completed.
    const entry = useDownloadStore.getState().downloads[KEY];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('failed');
    expect(entry.errorMessage).toMatch(/missing or empty|retry/i);

    // Terminal artifact 3: the partial dir was cleaned up.
    expect(existingPaths.has(dir)).toBe(false);

    // The user saw a failure alert (not a false "Success").
    const alertCalls = (deps.setAlertState as jest.Mock).mock.calls.map(c => c[0]);
    expect(alertCalls.some(a => /Failed/i.test(a?.title))).toBe(true);
    expect(alertCalls.some(a => /Success/i.test(a?.title))).toBe(false);
  });
});
