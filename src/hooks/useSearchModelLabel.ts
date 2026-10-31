import { useSyncExternalStore } from 'react';
import { embeddingModelChanger } from '../services/documents/embeddingModel';
import { activeEmbeddingModel } from '../services/documents/store';

/** The document search model's name, kept current when it changes. */
export function useSearchModelLabel(): string {
  useSyncExternalStore(embeddingModelChanger.subscribe, embeddingModelChanger.getChange);
  try {
    return activeEmbeddingModel()?.name ?? 'MiniLM (built-in)';
  } catch {
    return 'MiniLM (built-in)';
  }
}
