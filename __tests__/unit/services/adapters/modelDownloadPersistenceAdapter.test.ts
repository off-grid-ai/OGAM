import AsyncStorage from '@react-native-async-storage/async-storage';
import { modelDownloadPersistenceAdapter } from '../../../../src/services/adapters/downloads/modelDownloadPersistenceAdapter';
import type { PersistedModelDownload } from '@offgrid/models';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const KEY = '@offgrid/model_downloads_v2';

const record = {
  id: 'text:repo/model.gguf',
  phase: 'downloading',
  artifacts: [],
} as unknown as PersistedModelDownload;

describe('modelDownloadPersistenceAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes the stored snapshot when the coordinator has no downloads', async () => {
    await modelDownloadPersistenceAdapter.write([]);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it('writes the coordinator snapshot without a second state projection', async () => {
    await modelDownloadPersistenceAdapter.write([record]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(KEY, JSON.stringify([record]));
  });

  it('reads a stored coordinator snapshot', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify([record]));
    await expect(modelDownloadPersistenceAdapter.read()).resolves.toEqual([record]);
  });

  it.each([null, '{}', 'not-json'])('returns no records for absent or invalid storage: %p', async value => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(value);
    await expect(modelDownloadPersistenceAdapter.read()).resolves.toEqual([]);
  });

  it('returns no records when storage is unavailable', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage error'));
    await expect(modelDownloadPersistenceAdapter.read()).resolves.toEqual([]);
  });
});
