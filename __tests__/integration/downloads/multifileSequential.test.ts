/**
 * ADVERSARIAL multi-file (sequential) transport for the DOWNLOAD domain.
 *
 * Drives the REAL downloadHuggingFaceModel / downloadCoreMLMultiFile against the REAL
 * downloadStore, mocking ONLY the genuine boundaries (RNFS, and
 * backgroundDownloadService.downloadFileTo — the native transfer). The terminal artifact
 * asserted is what the user perceives:
 *   - a REGISTERED model + the store entry cleared, OR
 *   - NO registration + the entry flipped to 'failed' with an honest "missing/empty" reason.
 *
 * The high-risk cell: a part download resolves "successfully" (HTTP 200) yet wrote a
 * 0-byte or truncated file (empty body). validateMultifileComplete MUST reject this before
 * registration — otherwise a broken model gets marked _ready and crashes at generation
 * with a misleading error. Covered across backend { mnn (HuggingFace), coreml } × platform
 * { android, ios } × part-position (first vs last part truncated).
 */
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

const mockDownloadFileTo = jest.fn();
const mockBackgroundDownloadService = {
  downloadFileTo: (opts: any) => mockDownloadFileTo(opts),
  cancelDownload: jest.fn(async () => {}),
  cancelQueued: jest.fn(() => true),
  startProgressPolling: jest.fn(),
};
const mockModelManager = {
  getImageModelsDirectory: jest.fn(() => '/mock/documents/image_models'),
  addDownloadedImageModel: jest.fn(async () => {}),
};

jest.mock('../../../src/services', () => ({
  modelManager: mockModelManager,
  hardwareService: { getSoCInfo: jest.fn(async () => ({ hasNPU: true, qnnVariant: '8gen2' })) },
  backgroundDownloadService: mockBackgroundDownloadService,
}));
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackgroundDownloadService,
}));
jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string, buttons?: any) => ({ visible: true, title, message, buttons })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));
jest.mock('../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn(async (p: string) => p),
  downloadCoreMLTokenizerFiles: jest.fn(async () => {}),
}));

const { downloadHuggingFaceModel, downloadCoreMLMultiFile } =
  require('../../../src/screens/ModelsScreen/imageDownloadActions') as typeof import('../../../src/screens/ModelsScreen/imageDownloadActions');
const { useDownloadStore } = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
import type { ImageDownloadDeps } from '../../../src/screens/ModelsScreen/imageDownloadActions';
import type { ImageModelDescriptor } from '../../../src/screens/ModelsScreen/types';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const IMG_DIR = '/mock/documents/image_models';

function makeDeps(): ImageDownloadDeps {
  return {
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    setAlertState: jest.fn(),
    triedImageGen: true,
  };
}

const hfModel = (over: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor => ({
  id: 'hf-mnn', name: 'HF MNN', description: 'd', downloadUrl: '', size: 1_000_000,
  style: 'creative', backend: 'mnn', huggingFaceRepo: 'test/repo',
  huggingFaceFiles: [
    { path: 'unet.mnn', size: 600_000 },
    { path: 'vae.mnn', size: 400_000 },
  ],
  ...over,
});

const coremlModel = (over: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor => ({
  id: 'cm-1', name: 'CM', description: 'd', downloadUrl: '', size: 1_000_000,
  style: 'photorealistic', backend: 'coreml', repo: 'apple/sd',
  coremlFiles: [
    { path: 'unet.mlmodelc', relativePath: 'unet.mlmodelc', size: 600_000, downloadUrl: 'https://x/unet' },
    { path: 'vae.mlmodelc', relativePath: 'vae.mlmodelc', size: 400_000, downloadUrl: 'https://x/vae' },
  ],
  ...over,
});

/**
 * Wire a filesystem where every download writes its declared size, EXCEPT the part index
 * in `truncateIndex` (which writes 0 bytes — a 200 with no body). downloadFileTo resolves
 * successfully for every part regardless (the native layer reported success).
 */
function wireMultifile(opts: { partSizes: number[]; truncateIndex?: number }) {
  const present = new Set<string>([IMG_DIR]);
  const sizes = new Map<string, number>();
  let call = 0;

  mockedRNFS.exists.mockImplementation(async (p: string) => present.has(p));
  mockedRNFS.mkdir.mockImplementation(async (p: string) => { present.add(p); });
  mockedRNFS.unlink.mockImplementation(async (p: string) => {
    present.delete(p);
    for (const k of [...sizes.keys()]) if (k === p || k.startsWith(`${p}/`)) sizes.delete(k);
  });
  mockedRNFS.writeFile.mockImplementation(async () => {});
  mockedRNFS.stat.mockImplementation(async (p: string) => {
    if (!sizes.has(p)) return Promise.reject(new Error('ENOENT'));
    return { size: sizes.get(p)! } as any;
  });

  mockDownloadFileTo.mockImplementation((o: { destPath: string }) => {
    const idx = call++;
    const size = opts.truncateIndex === idx ? 0 : opts.partSizes[idx];
    if (size > 0) { sizes.set(o.destPath, size); present.add(o.destPath); }
    return { downloadIdPromise: Promise.resolve(`native-${idx}`), promise: Promise.resolve() };
  });
  return { present, sizes };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModelManager.getImageModelsDirectory.mockReturnValue(IMG_DIR);
  mockModelManager.addDownloadedImageModel.mockResolvedValue(undefined);
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} });
});

const setPlatform = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

describe('multi-file sequential — truncated part rejects BEFORE register', () => {
  describe.each<['ios' | 'android']>([['ios'], ['android']])('platform=%s', (os) => {
    beforeEach(() => setPlatform(os));

    it('mnn/HuggingFace: a 0-byte FIRST part ⇒ NOT registered, entry FAILED (missing/empty)', async () => {
      wireMultifile({ partSizes: [600_000, 400_000], truncateIndex: 0 });
      const deps = makeDeps();

      await downloadHuggingFaceModel(hfModel(), deps);

      expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
      const entry = useDownloadStore.getState().downloads['image:hf-mnn'];
      expect(entry?.status).toBe('failed');
      expect(entry?.errorMessage ?? '').toMatch(/missing or empty/i);
    });

    it('mnn/HuggingFace: a 0-byte LAST part ⇒ NOT registered, entry FAILED', async () => {
      wireMultifile({ partSizes: [600_000, 400_000], truncateIndex: 1 });
      const deps = makeDeps();

      await downloadHuggingFaceModel(hfModel(), deps);

      expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
      expect(useDownloadStore.getState().downloads['image:hf-mnn']?.status).toBe('failed');
    });

    it('coreml: a 0-byte part ⇒ NOT registered, entry FAILED', async () => {
      wireMultifile({ partSizes: [600_000, 400_000], truncateIndex: 1 });
      const deps = makeDeps();

      await downloadCoreMLMultiFile(coremlModel(), deps);

      expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
      expect(useDownloadStore.getState().downloads['image:cm-1']?.status).toBe('failed');
    });
  });
});

describe('multi-file sequential — all parts intact ⇒ REGISTERED', () => {
  describe.each<['ios' | 'android']>([['ios'], ['android']])('platform=%s', (os) => {
    beforeEach(() => setPlatform(os));

    it('mnn/HuggingFace: every part non-empty ⇒ model registered, entry cleared', async () => {
      wireMultifile({ partSizes: [600_000, 400_000] });
      const deps = makeDeps();

      await downloadHuggingFaceModel(hfModel(), deps);

      expect(mockModelManager.addDownloadedImageModel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hf-mnn', modelPath: `${IMG_DIR}/hf-mnn`, backend: 'mnn' }),
      );
      expect(useDownloadStore.getState().downloads['image:hf-mnn']).toBeUndefined();
    });

    it('coreml: every part non-empty ⇒ model registered, entry cleared', async () => {
      wireMultifile({ partSizes: [600_000, 400_000] });
      const deps = makeDeps();

      await downloadCoreMLMultiFile(coremlModel(), deps);

      expect(mockModelManager.addDownloadedImageModel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cm-1', backend: 'coreml' }),
      );
      expect(useDownloadStore.getState().downloads['image:cm-1']).toBeUndefined();
    });
  });
});
