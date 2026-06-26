/**
 * OuteTTSEngine download tests
 *
 * Covers the move onto the shared background download engine + the partial-file
 * fix: downloads route through backgroundDownloadService.downloadFileTo, and a
 * present-but-truncated file is treated as NOT downloaded (instead of being
 * reported complete as the old RNFS-exists check did).
 */
const mockFiles: Record<string, number> = {};
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/doc',
  exists: jest.fn((p: string) => Promise.resolve(p in mockFiles)),
  stat: jest.fn((p: string) => Promise.resolve({ size: mockFiles[p] ?? 0, isFile: () => true })),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn((p: string) => { delete mockFiles[p]; return Promise.resolve(); }),
  downloadFile: jest.fn(() => ({ promise: Promise.resolve({ statusCode: 200 }) })),
}));

const mockIsAvailable = jest.fn(() => true);
const mockDownloadFileTo = jest.fn();
jest.mock('@offgrid/core/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: () => mockIsAvailable(),
    downloadFileTo: (...a: any[]) => mockDownloadFileTo(...a),
  },
}));

import { OuteTTSEngine } from '../../../pro/audio/engine/tts/engines/outetts/OuteTTSEngine';
import { OUTETTS_BACKBONE, OUTETTS_VOCODER } from '../../../pro/audio/engine/tts/engines/outetts/models';

const pathFor = (filename: string) => `/doc/tts-models/${filename}`;

describe('OuteTTSEngine downloads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockFiles)) delete mockFiles[k];
    // Default: a successful full-size download lands the file on disk.
    mockIsAvailable.mockReturnValue(true);
    mockDownloadFileTo.mockImplementation(({ destPath, params }: any) => {
      mockFiles[destPath] = params.totalBytes;
      return { downloadIdPromise: Promise.resolve('1'), promise: Promise.resolve() };
    });
  });

  it('treats a truncated file on disk as not-downloaded', async () => {
    mockFiles[pathFor(OUTETTS_BACKBONE.filename)] = 1000; // tiny / partial
    mockFiles[pathFor(OUTETTS_VOCODER.filename)] = OUTETTS_VOCODER.sizeBytes; // full

    const states = await new OuteTTSEngine().checkAssetStatus();
    const backbone = states.find(s => s.asset.id === 'backbone');
    const vocoder = states.find(s => s.asset.id === 'vocoder');
    expect(backbone?.status).toBe('not-downloaded');
    expect(vocoder?.status).toBe('downloaded');
  });

  it('downloads through the shared background download engine', async () => {
    const engine = new OuteTTSEngine();
    await engine.downloadAssets(['backbone']);

    expect(mockDownloadFileTo).toHaveBeenCalledTimes(1);
    const arg = mockDownloadFileTo.mock.calls[0][0];
    expect(arg.params.url).toBe(OUTETTS_BACKBONE.url);
    expect(arg.destPath).toBe(pathFor(OUTETTS_BACKBONE.filename));
    expect(arg.params.modelId).toBe('tts-outetts-backbone');
  });

  it('falls back to RNFS when the native downloader is unavailable', async () => {
    mockIsAvailable.mockReturnValue(false);
    const RNFS = require('react-native-fs');
    RNFS.downloadFile.mockImplementation(({ toFile }: any) => {
      mockFiles[toFile] = OUTETTS_BACKBONE.sizeBytes;
      return { promise: Promise.resolve({ statusCode: 200 }) };
    });

    await new OuteTTSEngine().downloadAssets(['backbone']);

    expect(RNFS.downloadFile).toHaveBeenCalled();
    expect(mockDownloadFileTo).not.toHaveBeenCalled();
  });

  it('rejects and cleans up when the downloaded file is incomplete', async () => {
    mockDownloadFileTo.mockImplementation(({ destPath }: any) => {
      mockFiles[destPath] = 1000; // truncated
      return { downloadIdPromise: Promise.resolve('1'), promise: Promise.resolve() };
    });

    await expect(new OuteTTSEngine().downloadAssets(['backbone'])).rejects.toThrow(/incomplete/i);
    expect(mockFiles[pathFor(OUTETTS_BACKBONE.filename)]).toBeUndefined(); // unlinked
  });
});
