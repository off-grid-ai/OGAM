import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DownloadPersistencePort, PersistedModelDownload } from '@offgrid/models';

const KEY = '@offgrid/model_downloads_v2';

export const modelDownloadPersistenceAdapter: DownloadPersistencePort = {
  async read(): Promise<PersistedModelDownload[]> {
    try {
      const value = await AsyncStorage.getItem(KEY);
      if (!value) return [];
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as PersistedModelDownload[] : [];
    } catch { return []; }
  },
  async write(downloads): Promise<void> {
    if (downloads.length === 0) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, JSON.stringify(downloads));
  },
};
