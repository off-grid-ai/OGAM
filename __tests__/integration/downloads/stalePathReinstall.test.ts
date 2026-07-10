/**
 * ADVERSARIAL reinstall / stale-absolute-path recovery for the DOWNLOAD registry.
 *
 * On iOS every app reinstall (and some OS updates) mints a NEW random container UUID, so
 * the ABSOLUTE modelPath persisted at download time (…/Application/OLD-UUID/Documents/…)
 * is dead on next launch — the bytes are still on disk, just under the NEW UUID. The load
 * path must relocate the stored absolute path relative to the CURRENT Documents dir, or a
 * perfectly-good downloaded model silently vanishes after every reinstall.
 *
 * This drives the REAL resolver (resolveStoredPath) AND the REAL registry load
 * (loadDownloadedImageModels), mocking only the IO boundaries (RNFS.exists +
 * AsyncStorage). The terminal artifact asserted is what the user perceives: the model
 * STILL appears in the registry after relaunch, now pointing at the live path.
 *
 * Axes: backend { mnn, qnn, coreml } × asset-state { stale-abs-path relocatable,
 * genuinely-gone (dropped from registry) }. modelType is image here; the text/mmproj
 * relocation shares the exact same resolveStoredPath seam (asserted directly).
 */
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveStoredPath, IMAGE_MODELS_STORAGE_KEY, loadDownloadedImageModels } from '../../../src/services/modelManager/storage';
import type { ImageBackend } from '../../../src/utils/imageModelIntegrity';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

const CURRENT_DOCS = '/mock/documents';
const CURRENT_IMG_DIR = `${CURRENT_DOCS}/image_models`;
const OLD_UUID_PREFIX = '/var/mobile/Containers/Data/Application/OLD-DEAD-UUID/Documents';

const staleImagePath = (modelId: string) => `${OLD_UUID_PREFIX}/image_models/${modelId}`;
const liveImagePath = (modelId: string) => `${CURRENT_IMG_DIR}/${modelId}`;

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

describe('resolveStoredPath — the single relocation seam (text + image share it)', () => {
  it.each<[ImageBackend, string]>([
    ['mnn', 'anything-v5-mnn'],
    ['qnn', 'anything-v5-qnn'],
    ['coreml', 'sd-coreml'],
  ])('backend=%s: a stale absolute container path relocates under the current dir', (_backend, modelId) => {
    const resolved = resolveStoredPath(staleImagePath(modelId), CURRENT_IMG_DIR);
    expect(resolved).toBe(liveImagePath(modelId));
  });

  it('a path that does not contain the base-dir marker is unresolvable (returns null)', () => {
    expect(resolveStoredPath('/totally/unrelated/place/model.bin', CURRENT_IMG_DIR)).toBeNull();
  });

  it('a path already under the current dir resolves to itself (idempotent, no double-prefix)', () => {
    const live = liveImagePath('anything-v5');
    expect(resolveStoredPath(live, CURRENT_IMG_DIR)).toBe(live);
  });

  it('relocates a nested file path (mmproj / weight sibling), preserving the sub-path', () => {
    const staleFile = `${OLD_UUID_PREFIX}/models/TheBloke/model.Q4.gguf`;
    expect(resolveStoredPath(staleFile, `${CURRENT_DOCS}/models`)).toBe(`${CURRENT_DOCS}/models/TheBloke/model.Q4.gguf`);
  });
});

describe('loadDownloadedImageModels — reinstall recovery end-to-end', () => {
  function seedRegistry(models: Array<{ id: string; modelPath: string; backend: ImageBackend }>) {
    const stored = models.map(m => ({
      id: m.id, name: m.id, description: '', modelPath: m.modelPath,
      downloadedAt: new Date(0).toISOString(), size: 1000, style: 'creative', backend: m.backend,
    }));
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(stored));
  }

  it('a model stored under a DEAD container UUID is relocated + kept (survives reinstall)', async () => {
    const modelId = 'anything-v5-qnn';
    seedRegistry([{ id: modelId, modelPath: staleImagePath(modelId), backend: 'qnn' }]);
    // The old absolute path is dead; the relocated live path exists.
    mockedRNFS.exists.mockImplementation(async (p: string) => p === liveImagePath(modelId));

    const models = await loadDownloadedImageModels(CURRENT_IMG_DIR);

    expect(models).toHaveLength(1);
    expect(models[0].modelPath).toBe(liveImagePath(modelId));
    // The registry is rewritten with the relocated path so the next launch is cheap.
    const written = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)![1]);
    expect(written[0].modelPath).toBe(liveImagePath(modelId));
  });

  it('a model whose bytes are genuinely gone (neither old nor relocated path exists) is DROPPED', async () => {
    const modelId = 'deleted-model';
    seedRegistry([{ id: modelId, modelPath: staleImagePath(modelId), backend: 'mnn' }]);
    mockedRNFS.exists.mockResolvedValue(false); // nothing on disk anywhere

    const models = await loadDownloadedImageModels(CURRENT_IMG_DIR);

    expect(models).toHaveLength(0);
    // registry rewritten to reflect the removal (no phantom entry left)
    const written = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)![1]);
    expect(written).toHaveLength(0);
  });

  it('mixed: one relocatable + one gone ⇒ keeps the live one, drops the dead one', async () => {
    seedRegistry([
      { id: 'live-mnn', modelPath: staleImagePath('live-mnn'), backend: 'mnn' },
      { id: 'gone-coreml', modelPath: staleImagePath('gone-coreml'), backend: 'coreml' },
    ]);
    mockedRNFS.exists.mockImplementation(async (p: string) => p === liveImagePath('live-mnn'));

    const models = await loadDownloadedImageModels(CURRENT_IMG_DIR);

    expect(models.map(m => m.id)).toEqual(['live-mnn']);
    expect(models[0].modelPath).toBe(liveImagePath('live-mnn'));
  });

  it('a model already at a live current-dir path is kept untouched (no relocation, no rewrite churn)', async () => {
    const modelId = 'fresh-mnn';
    seedRegistry([{ id: modelId, modelPath: liveImagePath(modelId), backend: 'mnn' }]);
    mockedRNFS.exists.mockImplementation(async (p: string) => p === liveImagePath(modelId));

    const models = await loadDownloadedImageModels(CURRENT_IMG_DIR);

    expect(models).toHaveLength(1);
    expect(models[0].modelPath).toBe(liveImagePath(modelId));
    // Nothing changed → no unnecessary rewrite.
    expect(AsyncStorage.setItem as jest.Mock).not.toHaveBeenCalled();
  });
});
