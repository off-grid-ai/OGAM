/**
 * FAILURE JOURNEY — image extraction interrupted (missing unet.bin), then relaunch (B7).
 *
 * Cluster D. Two phases, both driven through REAL code:
 *
 * PHASE 1 (same session): a zip download completes its BYTES, but the unzip lands an
 * INCOMPLETE model dir (missing unet.bin). The REAL ensureImageExtractionComplete
 * re-unzips once (still incomplete via the DYNAMIC unzip mock) and throws. The REAL
 * proceedWithDownload complete handler catches it → marks the store entry failed and
 * deletes the on-disk dir + zip.
 *   Terminal artifacts: entry is FAILED + retriable/removable (via imageProvider.list),
 *   model NOT registered, disk dir + zip deleted.
 *
 * PHASE 2 (relaunch): downloadStore is a plain create() (NOT persisted) so a fresh
 * process starts with an EMPTY store; hydrateDownloadStore rebuilds ONLY from native
 * rows. When the native row is gone (completed-then-failed extraction), the failed
 * model is INVISIBLE — no retriable/removable surface, and the on-disk partial was
 * already deleted. This test PINS that current terminal state (the B7 gap) so the fix
 * (persist failed entries OR scan disk for incomplete image dirs) is a visible diff.
 *
 * The unzip boundary is DYNAMIC: it always yields an incomplete dir (missing unet.bin),
 * so the integrity gate genuinely fails both times — a static "complete" mock could not
 * exercise the failure path.
 */
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { useDownloadStore } from '../../../../src/stores/downloadStore';
import { makeImageModelKey } from '../../../../src/utils/modelKey';

const mockBackground = {
  startDownload: jest.fn(),
  moveCompletedDownload: jest.fn(async () => ''),
  startProgressPolling: jest.fn(),
  onComplete: jest.fn(),
  onError: jest.fn(),
  cancelDownload: jest.fn(async () => {}),
  isAvailable: jest.fn(() => true),
  getActiveDownloads: jest.fn(async () => []),
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
// hydration imports backgroundDownloadService from its own module path.
jest.mock('../../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackground,
}));
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string) => ({ visible: true, title, message })),
  hideAlert: jest.fn(() => ({ visible: false })),
}));

const { proceedWithDownload } = require('../../../../src/screens/ModelsScreen/imageDownloadActions');
const { hydrateDownloadStore } = require('../../../../src/services/downloadHydration');
const { imageProvider } = require('../../../../src/services/modelDownloadService/providers/imageProvider');
const { useAppStore } = require('../../../../src/stores/appStore');

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockUnzip = unzip as jest.MockedFunction<typeof unzip>;

const MODEL_ID = 'anythingv5';
const KEY = makeImageModelKey(MODEL_ID);
const imageModelsDir = '/mock/image_models';
const modelDir = `${imageModelsDir}/${MODEL_ID}`;
const zipPath = `${imageModelsDir}/${MODEL_ID}.zip`;

type DirItem = RNFS.ReadDirResItemT;
function fileItem(path: string, size = 1): DirItem {
  const name = path.split('/').pop() || path;
  return { ctime: new Date(0), mtime: new Date(0), name, path, size, isFile: () => true, isDirectory: () => false };
}

describe('failure journey — partial extraction (missing unet.bin) then relaunch (B7)', () => {
  let existingPaths: Set<string>;
  let dirEntries: Record<string, DirItem[]>;
  let completeCb: (() => Promise<void>) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    existingPaths = new Set<string>();
    dirEntries = {};
    completeCb = null;
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} } as any);
    useAppStore.setState({ downloadedImageModels: [] });

    existingPaths.add(imageModelsDir);
    mockedRNFS.exists.mockImplementation(async (p: string) => existingPaths.has(p));
    mockedRNFS.mkdir.mockImplementation(async (p: string) => { existingPaths.add(p); });
    mockedRNFS.writeFile.mockImplementation(async (p: string) => { existingPaths.add(p); });
    mockedRNFS.readDir.mockImplementation(async (p: string) => dirEntries[p] ?? []);
    mockedRNFS.unlink.mockImplementation(async (p: string) => {
      existingPaths.delete(p);
      delete dirEntries[p];
    });

    // DYNAMIC unzip: always produces an INCOMPLETE mnn dir (unet.mnn present but its
    // *.mnn.weight sibling and pos_emb.bin are missing) → integrity fails every time.
    mockUnzip.mockImplementation(async (_zip: string, dest: string) => {
      existingPaths.add(dest);
      dirEntries[dest] = [
        fileItem(`${dest}/unet.mnn`, 1000),
        fileItem(`${dest}/tokenizer.json`, 10),
        // NOTE: no pos_emb.bin, no token_emb.bin, no unet.mnn.weight → INCOMPLETE
      ];
      return '/unzipped';
    });

    mockBackground.startDownload.mockResolvedValue({ downloadId: 'dl-1' });
    mockBackground.onComplete.mockImplementation((_id: string, cb: () => Promise<void>) => {
      completeCb = cb;
      return () => {};
    });
    mockBackground.onError.mockImplementation(() => () => {});
    mockBackground.moveCompletedDownload.mockImplementation(async () => {
      existingPaths.add(zipPath);
      return zipPath;
    });
  });

  const deps = () => ({
    addDownloadedImageModel: jest.fn(),
    activeImageModelId: null,
    setActiveImageModelId: jest.fn(),
    setAlertState: jest.fn(),
    triedImageGen: true,
  });

  it('PHASE 1 (same session): failed extraction → entry failed+retriable, model NOT registered, disk wiped', async () => {
    const d = deps();
    await proceedWithDownload(
      { id: MODEL_ID, name: 'AnythingV5', description: '', size: 1000, backend: 'mnn', downloadUrl: 'http://x/a.zip' } as any,
      d as any,
    );
    // Bytes finished → native fires complete → run the registered finalizer.
    expect(completeCb).toBeTruthy();
    await completeCb!();

    // Terminal artifact: model NOT registered (broken extraction).
    expect(mockModelManager.addDownloadedImageModel).not.toHaveBeenCalled();

    // Terminal artifact: store entry ended FAILED (retriable this session).
    const entry = useDownloadStore.getState().downloads[KEY];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('failed');

    // The uniform list still shows it as retriable + removable (same session).
    const rowsNow = await imageProvider.list();
    const row = rowsNow.find((r: any) => r.name?.includes(MODEL_ID) || r.modelType === 'image');
    expect(row).toBeDefined();
    expect(row.capabilities.retry).toBe(true);

    // Terminal artifact: the partial dir AND zip were deleted from disk.
    expect(existingPaths.has(modelDir)).toBe(false);
    expect(existingPaths.has(zipPath)).toBe(false);
  });

  it('PHASE 2 (relaunch): store not persisted + native row gone + disk wiped → model is INVISIBLE (B7 gap pinned)', async () => {
    // Run phase 1 to reach the failed+wiped state.
    const d = deps();
    await proceedWithDownload(
      { id: MODEL_ID, name: 'AnythingV5', description: '', size: 1000, backend: 'mnn', downloadUrl: 'http://x/a.zip' } as any,
      d as any,
    );
    await completeCb!();

    // ---- RELAUNCH ---- a fresh process: the plain-create() store starts EMPTY.
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} } as any);
    // The native row for a completed-then-failed extraction is gone (moved + no
    // longer active). Hydration therefore rebuilds NOTHING.
    mockBackground.getActiveDownloads.mockResolvedValue([]);
    await hydrateDownloadStore();

    // B7: the failed model is INVISIBLE — no store entry, and imageProvider.list()
    // has no in-flight rows and no registered model (appStore was never written).
    expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(0);
    const rows = await imageProvider.list();
    expect(rows).toHaveLength(0);

    // And the disk holds no recoverable dir (already deleted in phase 1), so even a
    // future disk scan would find nothing to surface. This is the exact B7 loss:
    // no retriable/removable affordance survives the relaunch.
    expect(existingPaths.has(modelDir)).toBe(false);
  });
});
