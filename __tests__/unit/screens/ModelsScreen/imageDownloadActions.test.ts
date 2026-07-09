import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import {
  downloadHuggingFaceModel,
  downloadCoreMLMultiFile,
  proceedWithDownload,
  handleDownloadImageModel,
  registerAndNotify,
  cancelSyntheticImageDownload,
} from '../../../../src/screens/ModelsScreen/imageDownloadActions';
import { ImageModelDescriptor } from '../../../../src/screens/ModelsScreen/types';
import { makeImageDownloadDeps } from '../../../utils/factories';

jest.mock('react-native-fs', () => ({
  exists: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
  // Default: every part is present + non-empty (validateMultifileComplete passes).
  stat: jest.fn(() => Promise.resolve({ size: 500000 })),
}));

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/unzipped')),
}));

// Integrity is a boundary here (these tests cover download orchestration, not the
// completeness rule — that has its own tests). Default it to "complete" so the mocked
// RNFS fixtures don't trip the post-unzip gate.
jest.mock('../../../../src/utils/imageModelIntegrity', () => ({
  validateImageModelDir: jest.fn(async () => ({ complete: true, missing: [] })),
  ensureImageExtractionComplete: jest.fn(async () => {}),
}));

jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((...args: any[]) => ({ visible: true, title: args[0], message: args[1], buttons: args[2] })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

const mockDownloads: Record<string, any> = {};
const mockStoreApi = {
  downloads: mockDownloads,
  add: jest.fn((entry: any) => { mockDownloads[entry.modelKey] = entry; }),
  retryEntry: jest.fn((modelKey: string, downloadId: string) => {
    mockDownloads[modelKey] = { ...mockDownloads[modelKey], modelKey, downloadId, status: 'pending' };
  }),
  remove: jest.fn((modelKey: string) => { delete mockDownloads[modelKey]; }),
  updateProgress: jest.fn(),
  setProcessing: jest.fn(),
  setStatus: jest.fn(),
};

jest.mock('../../../../src/stores/downloadStore', () => ({
  useDownloadStore: Object.assign(
    jest.fn((selector?: any) => selector ? selector(mockStoreApi) : mockStoreApi),
    { getState: () => mockStoreApi },
  ),
  isActiveStatus: (status: string) => ['pending', 'running', 'retrying', 'waiting_for_network', 'processing'].includes(status),
}));

const mockGetImageModelsDirectory = jest.fn(() => '/mock/image-models');
const mockAddDownloadedImageModel = jest.fn((_m?: any) => Promise.resolve());
const mockMoveCompletedDownload = jest.fn((_id: string, _targetPath: string) => Promise.resolve('/moved.zip'));
const mockStartDownload = jest.fn((_params: any) => Promise.resolve({ downloadId: 'zip-42' }));
const mockDownloadFileTo = jest.fn((_opts: any): { downloadIdPromise?: Promise<string>; promise: Promise<void> } => ({ promise: Promise.resolve() }));
const mockOnComplete = jest.fn((_id: string, cb: Function) => { completeCallbacks.push(cb); return jest.fn(); });
const mockOnError = jest.fn((_id: string, cb: Function) => { errorCallbacks.push(cb); return jest.fn(); });
const mockGetSoCInfo = jest.fn(() => Promise.resolve({ hasNPU: true, qnnVariant: '8gen2' }));

jest.mock('../../../../src/services', () => ({
  modelManager: {
    getImageModelsDirectory: () => mockGetImageModelsDirectory(),
    addDownloadedImageModel: (m: any) => mockAddDownloadedImageModel(m),
  },
  hardwareService: {
    getSoCInfo: () => mockGetSoCInfo(),
  },
  backgroundDownloadService: {
    startDownload: (params: any) => mockStartDownload(params),
    downloadFileTo: (opts: any) => mockDownloadFileTo(opts),
    onComplete: (id: string, cb: Function) => mockOnComplete(id, cb),
    onError: (id: string, cb: Function) => mockOnError(id, cb),
    moveCompletedDownload: (id: string, targetPath: string) => mockMoveCompletedDownload(id, targetPath),
    startProgressPolling: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
    cancelQueued: jest.fn(() => true),
  },
}));

jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn((path: string) => Promise.resolve(path)),
  downloadCoreMLTokenizerFiles: jest.fn(() => Promise.resolve()),
}));

let completeCallbacks: Function[] = [];
let errorCallbacks: Function[] = [];

const makeDeps = (overrides = {}) => makeImageDownloadDeps({ triedImageGen: true, ...overrides });

function makeHFModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-hf-model',
    name: 'Test HF Model',
    description: 'A test model',
    downloadUrl: 'https://example.com/model.zip',
    size: 1000000,
    style: 'creative',
    backend: 'mnn',
    huggingFaceRepo: 'test/repo',
    huggingFaceFiles: [
      { path: 'unet/model.onnx', size: 500000 },
      { path: 'vae/model.onnx', size: 500000 },
    ],
    ...overrides,
  };
}

function makeZipModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-zip-model',
    name: 'Test Zip Model',
    description: 'A zip model',
    downloadUrl: 'https://example.com/model.zip',
    size: 2000000,
    style: 'creative',
    backend: 'mnn',
    ...overrides,
  };
}

function makeCoreMLModelInfo(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-coreml-model',
    name: 'Test CoreML Model',
    description: 'A CoreML model',
    downloadUrl: '',
    size: 3000000,
    style: 'photorealistic',
    backend: 'coreml',
    repo: 'apple/coreml-sd',
    coremlFiles: [
      { path: 'unet.mlmodelc', relativePath: 'unet.mlmodelc', size: 2000000, downloadUrl: 'https://example.com/unet' },
      { path: 'vae.mlmodelc', relativePath: 'vae.mlmodelc', size: 1000000, downloadUrl: 'https://example.com/vae' },
    ],
    ...overrides,
  };
}

describe('imageDownloadActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.requireMock('react-native-fs').exists.mockResolvedValue(false);
    completeCallbacks = [];
    errorCallbacks = [];
    Object.keys(mockDownloads).forEach(k => delete mockDownloads[k]);
  });

  it('downloadHuggingFaceModel writes a store entry and registers on success', async () => {
    const deps = makeDeps();

    await downloadHuggingFaceModel(makeHFModelInfo(), deps);

    expect(mockStoreApi.add).toHaveBeenCalled();
    expect(mockStoreApi.setProcessing).toHaveBeenCalled();
    expect(mockAddDownloadedImageModel).toHaveBeenCalled();
    expect(deps.addDownloadedImageModel).toHaveBeenCalled();
    expect(mockStoreApi.remove).toHaveBeenCalledWith('image:test-hf-model');
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });

  it('downloadHuggingFaceModel marks failure in store on error', async () => {
    mockDownloadFileTo.mockReturnValueOnce({ promise: Promise.reject(new Error('Network failed')) });
    const deps = makeDeps();

    await downloadHuggingFaceModel(makeHFModelInfo(), deps);

    expect(mockStoreApi.setStatus).toHaveBeenCalledWith(
      'image-multi:test-hf-model',
      'failed',
      expect.objectContaining({ message: 'Network failed' }),
    );
  });

  it('downloadHuggingFaceModel fails (does NOT register) when a downloaded part is missing/empty', async () => {
    // A part resolves "successfully" but wrote a 0-byte file → validateMultifileComplete rejects.
    (RNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 0 });
    const deps = makeDeps();

    await downloadHuggingFaceModel(makeHFModelInfo(), deps);

    expect(mockAddDownloadedImageModel).not.toHaveBeenCalled();
    expect(mockStoreApi.setStatus).toHaveBeenCalledWith(
      'image-multi:test-hf-model',
      'failed',
      expect.objectContaining({ message: expect.stringContaining('missing or empty') }),
    );
  });

  it('downloadCoreMLMultiFile writes a store entry and registers on success', async () => {
    const deps = makeDeps();

    await downloadCoreMLMultiFile(makeCoreMLModelInfo(), deps);

    expect(mockStoreApi.add).toHaveBeenCalled();
    expect(mockStoreApi.setProcessing).toHaveBeenCalled();
    expect(mockAddDownloadedImageModel).toHaveBeenCalled();
    expect(mockStoreApi.remove).toHaveBeenCalledWith('image:test-coreml-model');
  });

  it('proceedWithDownload uses native zip flow and completes via listeners', async () => {
    const deps = makeDeps();

    await proceedWithDownload(makeZipModelInfo(), deps);

    expect(mockStartDownload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'test-zip-model.zip',
      modelKey: 'image:test-zip-model',
      modelType: 'image',
    }));
    expect(completeCallbacks).toHaveLength(1);

    await completeCallbacks[0]();

    expect(mockStoreApi.setProcessing).toHaveBeenCalledWith('zip-42');
    expect(mockMoveCompletedDownload).toHaveBeenCalled();
    expect(unzip).toHaveBeenCalled();
    expect(mockStoreApi.remove).toHaveBeenCalledWith('image:test-zip-model');
  });

  it('proceedWithDownload keeps failed zip entry visible on error callback', async () => {
    const deps = makeDeps();

    await proceedWithDownload(makeZipModelInfo(), deps);
    expect(errorCallbacks).toHaveLength(1);

    errorCallbacks[0]({ reason: 'Connection lost' });

    expect(mockStoreApi.remove).not.toHaveBeenCalledWith('image:test-zip-model');
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Download Failed' }));
  });

  it('registerAndNotify removes the active entry after registration', async () => {
    const deps = makeDeps();

    await registerAndNotify(deps, {
      imageModel: {
        id: 'img-1',
        name: 'Img 1',
        description: 'desc',
        modelPath: '/path',
        downloadedAt: new Date().toISOString(),
        size: 123,
        style: 'creative',
        backend: 'mnn',
      },
      modelName: 'Img 1',
    });

    expect(mockAddDownloadedImageModel).toHaveBeenCalled();
    expect(mockStoreApi.remove).toHaveBeenCalledWith('image:img-1');
    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }));
  });

  it('handleDownloadImageModel shows incompatibility alert for unsupported QNN device', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    mockGetSoCInfo.mockResolvedValueOnce({ hasNPU: false, qnnVariant: 'min' });
    const deps = makeDeps();

    await handleDownloadImageModel(makeZipModelInfo({ backend: 'qnn' }), deps);

    expect(deps.setAlertState).toHaveBeenCalledWith(expect.objectContaining({ title: 'Incompatible Model' }));
    expect(mockStartDownload).not.toHaveBeenCalled();
    Object.defineProperty(Platform, 'OS', { value: originalPlatform });
  });

  it('handleDownloadImageModel proceeds for non-QNN models', async () => {
    const deps = makeDeps();

    await handleDownloadImageModel(makeZipModelInfo({ backend: 'mnn' }), deps);

    expect(mockStartDownload).toHaveBeenCalled();
  });

  it('proceedWithDownload zip flow stores imageModelDownloadUrl in metadataJson', async () => {
    const deps = makeDeps();
    const modelInfo = makeZipModelInfo({ downloadUrl: 'https://example.com/model.zip' });

    await proceedWithDownload(modelInfo, deps);

    expect(mockStartDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.stringContaining('"imageModelDownloadUrl":"https://example.com/model.zip"'),
      }),
    );
  });

  it('downloadHuggingFaceModel stores imageModelHuggingFaceFiles in metadataJson', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();

    await downloadHuggingFaceModel(modelInfo, deps);

    const addCall = mockStoreApi.add.mock.calls[0][0];
    const meta = JSON.parse(addCall.metadataJson);
    expect(meta.imageModelHuggingFaceFiles).toEqual(modelInfo.huggingFaceFiles);
  });

  it('downloadCoreMLMultiFile stores imageModelCoremlFiles in metadataJson', async () => {
    const deps = makeDeps();
    const modelInfo = makeCoreMLModelInfo();

    await downloadCoreMLMultiFile(modelInfo, deps);

    const addCall = mockStoreApi.add.mock.calls[0][0];
    const meta = JSON.parse(addCall.metadataJson);
    expect(meta.imageModelCoremlFiles).toEqual(modelInfo.coremlFiles);
  });

  it('cancelSyntheticImageDownload does nothing when no runtime exists', async () => {
    const { cancelSyntheticImageDownload: cancel } = jest.requireActual(
      '../../../../src/screens/ModelsScreen/imageDownloadActions',
    ) as typeof import('../../../../src/screens/ModelsScreen/imageDownloadActions');
    await expect(cancel('non-existent-model')).resolves.toBeUndefined();
  });

  it('downloadHuggingFaceModel cancels cleanly when store entry removed mid-download', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    let resolveFirst!: () => void;
    const firstFilePromise = new Promise<void>(res => { resolveFirst = res; });
    let callCount = 0;
    mockDownloadFileTo.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { promise: firstFilePromise };
      }
      return { promise: Promise.resolve() };
    });

    const downloadPromise = downloadHuggingFaceModel(modelInfo, deps);
    mockStoreApi.remove('image:test-hf-model');
    resolveFirst();
    await downloadPromise;

    expect(mockStoreApi.setStatus).not.toHaveBeenCalledWith('image-multi:test-hf-model', 'failed', expect.anything());
  });

  it('cancelSyntheticImageDownload cancels native download when currentDownloadId is set', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    let resolveFile!: () => void;
    const filePromise = new Promise<void>(res => { resolveFile = res; });
    const idPromise = Promise.resolve('native-42');
    mockDownloadFileTo.mockReturnValueOnce({ downloadIdPromise: idPromise, promise: filePromise });
    mockDownloadFileTo.mockReturnValue({ promise: Promise.resolve() });

    const downloadPromise = downloadHuggingFaceModel(modelInfo, deps);
    await idPromise;
    await new Promise(r => setTimeout(r, 0));
    await cancelSyntheticImageDownload(modelInfo.id);
    resolveFile();
    await downloadPromise;

    const { backgroundDownloadService: svc } = jest.requireMock('../../../../src/services');
    expect(svc.cancelDownload).toHaveBeenCalledWith('native-42');
  });

  it('cancelSyntheticImageDownload drops a QUEUED part immediately (no native id yet)', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    // A queued part: its downloadId never resolves (waiting for a slot) and its file
    // promise stays pending — the classic "Queued" row. Cancel must still reach it.
    const idPromise = new Promise<string>(() => {}); // never resolves
    const filePromise = new Promise<void>(() => {});  // never settles on its own
    mockDownloadFileTo.mockReturnValue({ downloadIdPromise: idPromise, promise: filePromise });

    downloadHuggingFaceModel(modelInfo, deps); // don't await — it's blocked on the queued part
    await new Promise(r => setTimeout(r, 0));
    await cancelSyntheticImageDownload(modelInfo.id);

    const { backgroundDownloadService: svc } = jest.requireMock('../../../../src/services');
    // Routed to the queue owner by the part's key (== makeImageModelKey), not left to
    // promote-then-cancel. Native cancelDownload is NOT used (there is no downloadId).
    expect(svc.cancelQueued).toHaveBeenCalledWith('image:test-hf-model');
    expect(svc.cancelDownload).not.toHaveBeenCalled();
  });

  it('multi-file image parts are typed as image downloads (so the queue + cancel route correctly)', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    mockDownloadFileTo.mockReturnValue({ downloadIdPromise: Promise.resolve('id'), promise: Promise.resolve() });
    await downloadHuggingFaceModel(modelInfo, deps);
    expect(mockDownloadFileTo).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ modelType: 'image' }) }),
    );
  });

  it('downloadHuggingFaceModel does not start if active entry already exists', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    mockStoreApi.downloads['image:test-hf-model'] = { status: 'running' };

    await downloadHuggingFaceModel(modelInfo, deps);

    expect(mockDownloadFileTo).not.toHaveBeenCalled();
  });

  it('proceedWithDownload reuses failed store entry via retryEntry', async () => {
    const deps = makeDeps();
    const modelInfo = makeZipModelInfo();
    mockStoreApi.downloads['image:test-zip-model'] = { status: 'failed' };

    await proceedWithDownload(modelInfo, deps);

    expect(mockStoreApi.retryEntry).toHaveBeenCalledWith('image:test-zip-model', expect.any(String));
    expect(mockStoreApi.add).not.toHaveBeenCalled();
  });

  it('downloadHuggingFaceModel reuses failed store entry via retryEntry', async () => {
    const deps = makeDeps();
    const modelInfo = makeHFModelInfo();
    mockStoreApi.downloads['image:test-hf-model'] = { status: 'failed' };

    await downloadHuggingFaceModel(modelInfo, deps);

    expect(mockStoreApi.retryEntry).toHaveBeenCalledWith('image:test-hf-model', expect.any(String));
  });
});
