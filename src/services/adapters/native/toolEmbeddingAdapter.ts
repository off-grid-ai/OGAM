import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  PersistedToolEmbedding,
  ToolEmbeddingExecutionPort,
  ToolEmbeddingStoragePort,
} from '@offgrid/models';
import logger from '../../../utils/logger';
import { executeMobileEmbedding } from '../../mobileSidecarGeneration';

const CACHE_STORAGE_KEY = 'tool-embedding-cache-v1';

/** React Native persistence only. Shared owns identity, validation, ranking, and eviction. */
export const mobileToolEmbeddingStorage: ToolEmbeddingStoragePort = {
  async read() {
    try {
      const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Record<
        string,
        PersistedToolEmbedding | { h?: string; v?: number[] }
      >;
      return Object.fromEntries(Object.entries(parsed).map(([name, entry]) => [
        name,
        'hash' in entry ? entry : { hash: entry.h ?? '', vector: entry.v ?? [] },
      ]));
    } catch (error) {
      logger.warn(`[ToolRouter] failed to hydrate embedding cache: ${String(error)}`);
      return undefined;
    }
  },
  async write(entries) {
    try {
      const legacy = Object.fromEntries(Object.entries(entries).map(([name, entry]) => [
        name,
        { h: entry.hash, v: entry.vector },
      ]));
      await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(legacy));
    } catch (error) {
      logger.warn(`[ToolRouter] failed to persist embedding cache: ${String(error)}`);
    }
  },
};

/** Native embedding execution port. It contains no routing or ranking policy. */
export const mobileToolEmbeddingPort: ToolEmbeddingExecutionPort = {
  embed: inputs => executeMobileEmbedding([...inputs]),
};
