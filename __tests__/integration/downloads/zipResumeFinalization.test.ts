/**
 * ADVERSARIAL end-to-end resume/finalize for the ZIP (WorkManager) transport.
 *
 * Drives the REAL resumeImageDownload → resumeZipDownload → REAL imageModelIntegrity
 * (validateImageModelDir / ensureImageExtractionComplete) → REAL downloadStore. The ONLY
 * mocked seams are the genuine IO/native boundaries: RNFS, react-native-zip-archive,
 * modelManager (disk registry) and backgroundDownloadService.moveCompletedDownload.
 *
 * Unlike the existing imageDownloadRecovery.test.ts (which mocks integrity to a fixed
 * "complete" verdict), this suite runs integrity FOR REAL against a mocked filesystem so
 * the intersection of {backend} × {asset-state: partial vs complete} × {zip valid/invalid}
 * is exercised. The terminal artifact asserted is what the user perceives:
 *   - a REGISTERED model (modelManager.addDownloadedImageModel called with the right path)
 *     AND the downloadStore entry cleared, OR
 *   - NO registration + the entry flipped to 'failed' (honest failure).
 *
 * High-risk cells covered:
 *   - undersized zip (bytes ≠ totalBytes) must NOT be treated as a valid artifact
 *     (finalize/extract must not proceed off a truncated download);
 *   - a partial extraction (missing unet.bin / a *.mnn.weight) must FAIL, never register;
 *   - a valid zip → complete extraction → registered.
 */
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';

const mockModelManager = {
  getImageModelsDirectory: jest.fn(() => '/mock/documents/image_models'),
  addDownloadedImageModel: jest.fn(async () => {}),
  getDownloadedImageModels: jest.fn(async () => [] as any[]),
};
const mockBackgroundDownloadService = {
  isAvailable: jest.fn(() => true),
  moveCompletedDownload: jest.fn(async () => '/mock/documents/image_models/m.zip'),
};

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackgroundDownloadService,
}));
jest.mock('../../../src/services', () => ({
  modelManager: mockModelManager,
  hardwareService: { getSoCInfo: jest.fn() },
  backgroundDownloadService: mockBackgroundDownloadService,
}));
jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string) => ({ visible: true, title, message })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

// Lazy require AFTER the jest.mock calls above (matches imageDownloadRecovery.test.ts) so
// the mocked '../../../src/services' module is in place before the SUT binds its imports.
const { resumeImageDownload } = require('../../../src/screens/ModelsScreen/imageDownloadResume') as typeof import('../../../src/screens/ModelsScreen/imageDownloadResume');
const { useDownloadStore } = require('../../../src/stores/downloadStore') as typeof import('../../../src/stores/downloadStore');
import type { DownloadEntry } from '../../../src/stores/downloadStore';
import { makeImageModelKey } from '../../../src/utils/modelKey';
import type { ImageDownloadDeps } from '../../../src/screens/ModelsScreen/imageDownloadActions';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockUnzip = unzip as jest.MockedFunction<typeof unzip>;

const IMG_DIR = '/mock/documents/image_models';

type FileMap = Record<string, { size: number }>;

// GROUND-TRUTH extraction file sets keyed by the model dir contents produced by unzip.
const MNN_COMPLETE = {
  'clip_v2.mnn': 147192, 'clip_v2.mnn.weight': 156158976,
  'unet.mnn': 1107376, 'unet.mnn.weight': 908377536,
  'vae_decoder.mnn': 153688, 'vae_decoder.mnn.weight': 98963772,
  'pos_emb.bin': 236544, 'token_emb.bin': 75890688, 'tokenizer.json': 3642034,
} as const;
const MNN_PARTIAL = { ...MNN_COMPLETE } as Record<string, number>;
delete MNN_PARTIAL['unet.mnn.weight']; // the 908MB split weight dropped mid-extract

function makeDeps(): ImageDownloadDeps & { addDownloadedImageModel: jest.Mock; setActiveImageModelId: jest.Mock; setAlertState: jest.Mock } {
  return {
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    setAlertState: jest.fn(),
    triedImageGen: true,
  };
}

function zipEntry(over: Partial<DownloadEntry> = {}): DownloadEntry {
  const modelKey = makeImageModelKey('anything-v5');
  return {
    modelKey,
    downloadId: 'dl-zip-1',
    modelId: 'image:anything-v5',
    fileName: 'anything-v5.zip',
    quantization: '',
    modelType: 'image',
    status: 'processing',
    bytesDownloaded: 1_000_000,
    totalBytes: 1_000_000,
    combinedTotalBytes: 1_000_000,
    progress: 1,
    createdAt: 1,
    metadataJson: JSON.stringify({
      imageDownloadType: 'zip',
      imageModelName: 'Anything V5',
      imageModelDescription: 'desc',
      imageModelSize: 1_000_000,
      imageModelBackend: 'mnn',
    }),
    ...over,
  };
}

/**
 * Wire a deterministic in-memory filesystem. `dirFiles` is the file set that appears
 * inside the model dir AFTER unzip runs (empty until then). `zip` describes the on-disk
 * zip artifact (present + its stat size + its header bytes).
 */
function wireFs(opts: {
  extractedOnUnzip: Record<string, number> | null;
  zip?: { size: number; header: string } | null;
  modelDirPreexists?: boolean;
  /** Files already present inside the model dir before resume runs (pre-extracted / reinstall). */
  preExtracted?: Record<string, number> | null;
}) {
  const modelDir = `${IMG_DIR}/anything-v5`;
  const zipPath = `${IMG_DIR}/anything-v5.zip`;
  const present = new Set<string>([IMG_DIR]);
  const files: FileMap = {};
  if (opts.modelDirPreexists || opts.preExtracted) present.add(modelDir);
  if (opts.preExtracted) {
    for (const [name, size] of Object.entries(opts.preExtracted)) files[`${modelDir}/${name}`] = { size };
  }
  if (opts.zip) {
    present.add(zipPath);
    files[zipPath] = { size: opts.zip.size };
  }

  mockedRNFS.exists.mockImplementation(async (p: string) => present.has(p) || p in files);
  mockedRNFS.mkdir.mockImplementation(async (p: string) => { present.add(p); });
  mockedRNFS.unlink.mockImplementation(async (p: string) => {
    present.delete(p);
    delete files[p];
    for (const key of Object.keys(files)) if (key.startsWith(`${p}/`)) delete files[key];
  });
  mockedRNFS.writeFile.mockImplementation(async () => {});
  mockedRNFS.stat.mockImplementation(async (p: string) => ({ size: files[p]?.size ?? 0 } as any));
  mockedRNFS.read.mockImplementation(async (p: string) => (p === zipPath ? (opts.zip?.header ?? '') : ''));
  mockedRNFS.readDir.mockImplementation(async (p: string) => {
    if (p !== modelDir) return [];
    return Object.entries(files)
      .filter(([k]) => k.startsWith(`${modelDir}/`) && !k.slice(modelDir.length + 1).includes('/'))
      .map(([k, v]) => ({
        name: k.slice(modelDir.length + 1), path: k, size: v.size,
        ctime: new Date(0), mtime: new Date(0), isFile: () => true, isDirectory: () => false,
      })) as any;
  });
  mockUnzip.mockImplementation(async (_zip: string, dest: string) => {
    present.add(dest);
    if (opts.extractedOnUnzip) {
      for (const [name, size] of Object.entries(opts.extractedOnUnzip)) {
        files[`${dest}/${name}`] = { size };
      }
    }
    return dest;
  });
  return { modelDir, zipPath, present, files };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockModelManager.getImageModelsDirectory.mockReturnValue(IMG_DIR);
  mockModelManager.addDownloadedImageModel.mockResolvedValue(undefined);
  mockModelManager.getDownloadedImageModels.mockResolvedValue([]);
  mockBackgroundDownloadService.isAvailable.mockReturnValue(true);
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} });
});

function seedStore(entry: DownloadEntry) {
  useDownloadStore.setState({
    downloads: { [entry.modelKey]: entry },
    downloadIdIndex: { [entry.downloadId]: entry.modelKey },
    repairingVisionIds: {},
  });
}

describe('zip resume finalization — terminal artifact across asset-state', () => {
  it('mnn: valid zip + complete extraction ⇒ model REGISTERED, store entry cleared', async () => {
    const entry = zipEntry();
    seedStore(entry);
    const { modelDir } = wireFs({
      zip: { size: 1_000_000, header: 'PK' },
      extractedOnUnzip: MNN_COMPLETE,
    });
    // moveCompletedDownload not needed here (zip already valid on disk), but keep it honest.
    mockBackgroundDownloadService.moveCompletedDownload.mockResolvedValue(`${IMG_DIR}/anything-v5.zip`);

    await resumeImageDownload(entry, makeDeps());

    expect(mockModelManager.addDownloadedImageModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'anything-v5', modelPath: modelDir, backend: 'mnn' }),
    );
    expect(useDownloadStore.getState().downloads[entry.modelKey]).toBeUndefined();
  });

  it('mnn: valid zip but PARTIAL extraction (unet.mnn.weight missing) ⇒ NOT registered, entry FAILED', async () => {
    const entry = zipEntry();
    seedStore(entry);
    // unzip yields a partial set BOTH times (the re-unzip retry can't recover a bad zip).
    wireFs({
      zip: { size: 1_000_000, header: 'PK' },
      extractedOnUnzip: MNN_PARTIAL,
    });

    await resumeImageDownload(entry, makeDeps());

    expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
    const after = useDownloadStore.getState().downloads[entry.modelKey];
    expect(after?.status).toBe('failed');
    // The failure names the missing artifact, never a misleading "backend unsupported".
    expect(after?.errorMessage ?? '').toMatch(/unet\.mnn\.weight|incomplete|missing/i);
  });

  it('undersized zip (bytes ≠ totalBytes) is rejected as an artifact — finalize does not run off it', async () => {
    // No pre-extracted model dir; the ONLY on-disk artifact is a zip that is 50% short.
    const entry = zipEntry();
    seedStore(entry);
    const fs = wireFs({
      zip: { size: 500_000, header: 'PK' }, // half of totalBytes 1_000_000
      extractedOnUnzip: MNN_COMPLETE,
    });
    // The download service has no completed native download to move (already terminal), so
    // moveCompletedDownload rejects — the resume must fall through to a failure, NOT unzip a
    // truncated zip. validateZipArtifact rejects the 50%-short zip (>0.1% diff), so it is
    // deleted and never unzipped.
    mockBackgroundDownloadService.moveCompletedDownload.mockRejectedValue(new Error('no such download'));

    await resumeImageDownload(entry, makeDeps());

    expect(mockUnzip).not.toHaveBeenCalled();
    expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
    // the invalid zip was cleaned up
    expect(fs.present.has(fs.zipPath)).toBe(false);
    expect(useDownloadStore.getState().downloads[entry.modelKey]?.status).toBe('failed');
  });

  it('coreml: a non-empty pre-extracted dir registers without an mnn/qnn file-set check', async () => {
    const entry = zipEntry({
      metadataJson: JSON.stringify({
        imageDownloadType: 'zip',
        imageModelName: 'SD CoreML',
        imageModelDescription: 'ios',
        imageModelSize: 1_000_000,
        imageModelBackend: 'coreml',
      }),
    });
    seedStore(entry);
    // model dir exists + has a file, so validateModelDir passes for coreml (non-empty only).
    wireFs({ zip: null, extractedOnUnzip: null, preExtracted: { 'Unet.mlmodelc': 10 } });

    await resumeImageDownload(entry, makeDeps());

    expect(mockModelManager.addDownloadedImageModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'anything-v5', backend: 'coreml' }),
    );
    expect(mockUnzip).not.toHaveBeenCalled();
  });
});

describe('zip resume — reinstall / already-registered short-circuit', () => {
  it('a valid pre-extracted dir that is ALREADY registered ⇒ silently drops the stale entry (no re-alert)', async () => {
    const entry = zipEntry();
    seedStore(entry);
    // A valid, complete pre-extracted model dir on disk (reinstall / stale native row case).
    const { modelDir } = wireFs({ zip: null, extractedOnUnzip: null, preExtracted: { ...MNN_COMPLETE } });
    // And the registry already contains this model.
    mockModelManager.getDownloadedImageModels.mockResolvedValue([{ id: 'anything-v5', modelPath: modelDir } as any]);
    const deps = makeDeps();

    await resumeImageDownload(entry, deps);

    // Already registered → do NOT register again, do NOT re-alert, just clear the stale entry.
    expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();
    expect(deps.setAlertState).not.toHaveBeenCalled();
    expect(useDownloadStore.getState().downloads[entry.modelKey]).toBeUndefined();
  });
});
