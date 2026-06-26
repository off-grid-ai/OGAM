import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';

const mockBackgroundDownloadService = {
  isAvailable: jest.fn(),
  getActiveDownloads: jest.fn(),
  moveCompletedDownload: jest.fn(),
};

const mockModelManager = {
  getImageModelsDirectory: jest.fn(),
  addDownloadedImageModel: jest.fn(),
};

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackgroundDownloadService,
}));

jest.mock('../../../src/services', () => ({
  modelManager: mockModelManager,
  hardwareService: {
    getSoCInfo: jest.fn(),
  },
  backgroundDownloadService: mockBackgroundDownloadService,
}));

jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string) => ({ visible: true, title, message })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
const { resumeImageDownload } = require('../../../src/screens/ModelsScreen/imageDownloadResume');
const { useDownloadStore } = require('../../../src/stores/downloadStore');

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockUnzip = unzip as jest.MockedFunction<typeof unzip>;

type DirItem = RNFS.ReadDirResItemT;

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

describe('image download recovery integration', () => {
  let existingPaths: Set<string>;
  let dirEntries: Record<string, DirItem[]>;
  let statSizes: Record<string, number>;
  let headers: Record<string, string>;

  const imageModelsDir = '/mock/image_models';
  const modelDir = `${imageModelsDir}/test-model`;
  const zipPath = `${imageModelsDir}/test-model.zip`;

  beforeEach(() => {
    jest.clearAllMocks();
    existingPaths = new Set<string>();
    dirEntries = {};
    statSizes = {};
    headers = {};

    useDownloadStore.setState({
      downloads: {},
      downloadIdIndex: {},
      repairingVisionIds: {},
    });

    mockModelManager.getImageModelsDirectory.mockReturnValue(imageModelsDir);
    mockModelManager.addDownloadedImageModel.mockResolvedValue(undefined);
    mockBackgroundDownloadService.isAvailable.mockReturnValue(true);
    mockBackgroundDownloadService.moveCompletedDownload.mockImplementation(async () => {
      existingPaths.add(zipPath);
      statSizes[zipPath] = 1000;
      headers[zipPath] = 'PK34';
      return zipPath;
    });

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
    mockUnzip.mockImplementation(async () => {
      existingPaths.add(modelDir);
      dirEntries[modelDir] = [makeFileItem(`${modelDir}/weights.bin`)];
      return '/unzipped';
    });
  });

  it('hydrates a completed image row as processing and recovers by replacing an invalid destination zip', async () => {
    existingPaths.add(zipPath);
    statSizes[zipPath] = 128;
    headers[zipPath] = 'NOPE';

    mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-1',
        modelId: 'image:test-model',
        modelKey: 'image:test-model',
        fileName: 'test-model.zip',
        modelType: 'image',
        status: 'completed',
        bytesDownloaded: 1000,
        totalBytes: 1000,
        combinedTotalBytes: 1000,
        createdAt: 1,
        metadataJson: JSON.stringify({
          imageDownloadType: 'zip',
          imageModelName: 'Test Model',
          imageModelDescription: 'desc',
          imageModelSize: 1000,
          imageModelBackend: 'mnn',
        }),
      },
    ]);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['image:test-model'];
    expect(entry.status).toBe('processing');

    const deps = {
      addDownloadedImageModel: jest.fn(),
      activeImageModelId: null,
      setActiveImageModelId: jest.fn(),
      setAlertState: jest.fn(),
      triedImageGen: true,
    };

    await resumeImageDownload(entry, deps as any);

    expect(mockBackgroundDownloadService.moveCompletedDownload).toHaveBeenCalledWith('dl-1', zipPath);
    expect(mockModelManager.addDownloadedImageModel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'test-model',
      modelPath: modelDir,
    }));
    expect(deps.addDownloadedImageModel).toHaveBeenCalled();
    expect(useDownloadStore.getState().downloads['image:test-model']).toBeUndefined();
  });
});
