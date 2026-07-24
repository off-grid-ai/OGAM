/**
 * B5 / G1 — a transient filesystem error must NEVER unlink a valid, fully-downloaded model.
 *
 * loadDownloadedModels() prunes any model whose file it can't find, then PERSISTS the pruned
 * registry (saveModelsList). The regression: the existence probe (RNFS.exists) treated a
 * transient rejection (I/O blip, container not yet mounted) the same as "file absent", so a
 * momentary FS hiccup silently dropped the user's multi-GB model from storage — permanent loss.
 *
 * These tests drive the REAL seam (the actual loadDownloadedModels + validateAndResolveModels
 * code) and only fault the third-party FS boundary (RNFS), which is the only way to reproduce a
 * transient FS error deterministically. We assert OUR behaviour: the model survives and the
 * registry is not rewritten to exclude it — while a PROVABLY absent file is still pruned.
 */
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadDownloadedModels } from '../../../../src/services/modelManager/storage';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const MODELS_DIR = '/data/models';
const VALID_MODEL = {
  id: 'unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q4_K_M.gguf',
  fileName: 'gemma-4-E2B-it-Q4_K_M.gguf',
  filePath: `${MODELS_DIR}/gemma-4-E2B-it-Q4_K_M.gguf`,
  engine: 'llama',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAsyncStorage.getItem.mockResolvedValue(JSON.stringify([VALID_MODEL]));
  mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);
});

describe('loadDownloadedModels — transient FS error (B5/G1)', () => {
  it('KEEPS a valid model when the existence check throws (transient), and does not rewrite the registry', async () => {
    // RNFS.exists rejects — a transient I/O error, NOT proof the file is gone.
    mockedRNFS.exists.mockRejectedValue(new Error('EIO: i/o error, stat'));

    const models = await loadDownloadedModels(MODELS_DIR);

    // The model is retained — no silent data loss.
    expect(models).toHaveLength(1);
    expect(models[0].filePath).toBe(VALID_MODEL.filePath);
    // And the stored registry is NOT rewritten to a pruned list (nothing was provably removed).
    expect(mockedAsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('still PRUNES and persists when the file is provably absent (exists cleanly resolves false)', async () => {
    // Clean "false" everywhere — the file is genuinely gone; registry cleanup must still happen.
    mockedRNFS.exists.mockResolvedValue(false);

    const models = await loadDownloadedModels(MODELS_DIR);

    expect(models).toHaveLength(0);
    // The pruned (empty) registry is persisted — real orphan cleanup is preserved.
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [, persisted] = mockedAsyncStorage.setItem.mock.calls[0];
    expect(JSON.parse(persisted as string)).toHaveLength(0);
  });

  it('KEEPS a present model untouched (exists resolves true — no rewrite)', async () => {
    mockedRNFS.exists.mockResolvedValue(true);

    const models = await loadDownloadedModels(MODELS_DIR);

    expect(models).toHaveLength(1);
    expect(mockedAsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
