import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { backgroundDownloadService, modelManager } from '../../../../src/services';
import { registerAndNotify } from '../../../../src/screens/ModelsScreen/imageDownloadActions';
import { resumeImageDownload } from '../../../../src/screens/ModelsScreen/imageDownloadResume';

jest.mock('react-native-fs', () => ({
  exists: jest.fn(),
  readDir: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(),
}));

// Integrity is a boundary here (resume orchestration is under test, not the completeness
// rule). Default to "complete" so mocked RNFS fixtures don't trip the post-unzip gate.
jest.mock('../../../../src/utils/imageModelIntegrity', () => ({
  validateImageModelDir: jest.fn(async () => ({ complete: true, missing: [] })),
  ensureImageExtractionComplete: jest.fn(async () => {}),
}));

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: jest.fn(),
    getDownloadedImageModels: jest.fn(() => Promise.resolve([])),
  },
  backgroundDownloadService: {
    moveCompletedDownload: jest.fn(),
  },
}));

const mockSetStatus = jest.fn();
jest.mock('../../../../src/stores/downloadStore', () => ({
  useDownloadStore: {
    getState: () => ({
      setStatus: mockSetStatus,
    }),
  },
}));

jest.mock('../../../../src/screens/ModelsScreen/imageDownloadActions', () => ({
  registerAndNotify: jest.fn(),
}));

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockUnzip = unzip as jest.MockedFunction<typeof unzip>;
const mockMoveCompletedDownload = backgroundDownloadService.moveCompletedDownload as jest.MockedFunction<typeof backgroundDownloadService.moveCompletedDownload>;
const mockRegisterAndNotify = registerAndNotify as jest.MockedFunction<typeof registerAndNotify>;
const mockGetImageModelsDirectory = modelManager.getImageModelsDirectory as jest.MockedFunction<typeof modelManager.getImageModelsDirectory>;

type DirItem = RNFS.ReadDirResItemT;

const imageModelsDir = '/mock/image_models';

function makeFileItem(path: string): DirItem {
  const name = path.split('/').pop() || path;
  return {
    ctime: new Date(0),
    mtime: new Date(0),
    name,
    path,
    size: 1,
    isFile: () => true,
    isDirectory: () => false,
  };
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    modelKey: 'image:test-model',
    downloadId: 'dl-1',
    modelId: 'image:test-model',
    fileName: 'test-model.zip',
    quantization: '',
    modelType: 'image',
    status: 'processing',
    bytesDownloaded: 1000,
    totalBytes: 1000,
    combinedTotalBytes: 1000,
    progress: 1,
    createdAt: Date.now(),
    metadataJson: JSON.stringify({
      imageDownloadType: 'zip',
      imageModelName: 'Test Model',
      imageModelDescription: 'desc',
      imageModelSize: 1000,
      imageModelBackend: 'mnn',
    }),
    ...overrides,
  } as any;
}

function makeDeps() {
  return {
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    setAlertState: jest.fn(),
    triedImageGen: true,
  };
}

describe('resumeImageDownload', () => {
  let existingPaths: Set<string>;
  let dirEntries: Record<string, DirItem[]>;
  let statSizes: Record<string, number>;
  let headers: Record<string, string>;

  const modelDir = `${imageModelsDir}/test-model`;
  const zipPath = `${imageModelsDir}/test-model.zip`;

  beforeEach(() => {
    jest.clearAllMocks();
    existingPaths = new Set<string>();
    dirEntries = {};
    statSizes = {};
    headers = {};

    mockGetImageModelsDirectory.mockReturnValue(imageModelsDir);
    mockedRNFS.exists.mockImplementation(async (path: string) => existingPaths.has(path));
    mockedRNFS.readDir.mockImplementation(async (path: string) => dirEntries[path] ?? []);
    mockedRNFS.stat.mockImplementation(async (path: string) => ({ size: statSizes[path] ?? 0 } as any));
    mockedRNFS.read.mockImplementation(async (path: string) => headers[path] ?? '');
    mockedRNFS.mkdir.mockImplementation(async (path: string) => {
      existingPaths.add(path);
    });
    mockedRNFS.unlink.mockImplementation(async (path: string) => {
      existingPaths.delete(path);
      delete dirEntries[path];
      delete statSizes[path];
      delete headers[path];
    });
    mockUnzip.mockResolvedValue('/unzipped');
    mockMoveCompletedDownload.mockResolvedValue(zipPath);
  });

  it('registers immediately when modelDir already contains files', async () => {
    existingPaths.add(modelDir);
    dirEntries[modelDir] = [makeFileItem(`${modelDir}/weights.bin`)];

    await resumeImageDownload(makeEntry(), makeDeps() as any);

    expect(mockRegisterAndNotify).toHaveBeenCalledTimes(1);
    expect(mockMoveCompletedDownload).not.toHaveBeenCalled();
    expect(mockUnzip).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('deletes invalid destination zip and falls back to moveCompletedDownload', async () => {
    existingPaths.add(zipPath);
    statSizes[zipPath] = 128;
    headers[zipPath] = 'NOPE';

    mockMoveCompletedDownload.mockImplementation(async () => {
      existingPaths.add(zipPath);
      statSizes[zipPath] = 1000;
      headers[zipPath] = 'PK34';
      return zipPath;
    });

    await resumeImageDownload(makeEntry(), makeDeps() as any);

    expect(mockedRNFS.unlink).toHaveBeenCalledWith(zipPath);
    expect(mockMoveCompletedDownload).toHaveBeenCalledWith('dl-1', zipPath);
    expect(mockUnzip).toHaveBeenCalledWith(zipPath, modelDir);
    expect(mockRegisterAndNotify).toHaveBeenCalledTimes(1);
  });

  it('cleans empty modelDir and failed zip before recovering', async () => {
    existingPaths.add(modelDir);
    existingPaths.add(zipPath);
    dirEntries[modelDir] = [];
    statSizes[zipPath] = 64;
    headers[zipPath] = 'BAD!';

    mockMoveCompletedDownload.mockImplementation(async () => {
      existingPaths.add(zipPath);
      statSizes[zipPath] = 1000;
      headers[zipPath] = 'PK34';
      return zipPath;
    });

    await resumeImageDownload(makeEntry(), makeDeps() as any);

    expect(mockedRNFS.unlink).toHaveBeenCalledWith(modelDir);
    expect(mockedRNFS.unlink).toHaveBeenCalledWith(zipPath);
    expect(mockMoveCompletedDownload).toHaveBeenCalledTimes(1);
    expect(mockRegisterAndNotify).toHaveBeenCalledTimes(1);
  });

  it('marks the entry failed and removes partial modelDir when unzip fails after move recovery', async () => {
    mockMoveCompletedDownload.mockImplementation(async () => {
      existingPaths.add(zipPath);
      statSizes[zipPath] = 1000;
      headers[zipPath] = 'PK34';
      return zipPath;
    });
    mockUnzip.mockRejectedValue(new Error('corrupt zip'));

    await resumeImageDownload(makeEntry(), makeDeps() as any);

    expect(mockedRNFS.unlink).toHaveBeenCalledWith(modelDir);
    expect(mockSetStatus).toHaveBeenCalledWith('dl-1', 'failed', { message: 'corrupt zip' });
    expect(mockRegisterAndNotify).not.toHaveBeenCalled();
  });

  it('unzips valid zip directly without calling moveCompletedDownload', async () => {
    existingPaths.add(zipPath);
    statSizes[zipPath] = 1000;
    headers[zipPath] = 'PK34';

    await resumeImageDownload(makeEntry(), makeDeps() as any);

    expect(mockMoveCompletedDownload).not.toHaveBeenCalled();
    expect(mockUnzip).toHaveBeenCalledWith(zipPath, modelDir);
    expect(mockRegisterAndNotify).toHaveBeenCalledTimes(1);
  });

  it('registers multifile model when modelDir exists', async () => {
    const entry = makeEntry({
      metadataJson: JSON.stringify({
        imageDownloadType: 'multifile',
        imageModelName: 'Test Model',
        imageModelDescription: 'desc',
        imageModelSize: 1000,
        imageModelBackend: 'mnn',
      }),
    });
    existingPaths.add(modelDir);

    await resumeImageDownload(entry, makeDeps() as any);

    expect(mockRegisterAndNotify).toHaveBeenCalledTimes(1);
    expect(mockMoveCompletedDownload).not.toHaveBeenCalled();
  });
});
