// Changing the embedding model behind document search: download, check the model really embeds,
// then switch (store.commitEmbeddingModel). Documents re-embed with the new model as they are used.

import { embeddingService } from '../rag/embedding';
import { commitEmbeddingModel, type EmbeddingModelSelection } from './store';

interface EmbeddingModelCandidate {
  id: string;
  name: string;
  size: number;
  downloadUrl: string;
  sha256?: string;
}

interface EmbeddingModelChange {
  busy: boolean;
  message: string;
  error: string;
}

class EmbeddingModelChanger {
  private change: EmbeddingModelChange = { busy: false, message: '', error: '' };
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;

  getChange = (): EmbeddingModelChange => this.change;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  cancel = (): void => {
    this.abort?.abort();
  };

  private report(busy: boolean, message: string, error = ''): void {
    this.change = { busy, message, error };
    this.listeners.forEach(listener => listener());
  }

  /** null switches back to the built-in model. */
  async install(candidate: EmbeddingModelCandidate | null): Promise<void> {
    if (this.change.busy) throw new Error('An embedding model change is already in progress.');
    const controller = new AbortController();
    this.abort = controller;
    const progress = (message: string) => this.report(true, message);
    progress('Preparing model change...');
    try {
      const model: EmbeddingModelSelection | null = candidate
        ? await embeddingService.downloadModel(candidate, progress, controller.signal)
        : null;
      await embeddingService.runExclusive(async () => {
        if (controller.signal.aborted) throw new Error('Model change cancelled');
        progress('Checking model compatibility...');
        await embeddingService.withRebuildModel(model, async () => {
          if (controller.signal.aborted) throw new Error('Model change cancelled');
          commitEmbeddingModel(model);
        });
      });
      this.report(false, 'Search model changed. Documents update as you use them.');
    } catch (error) {
      this.report(
        false,
        '',
        controller.signal.aborted
          ? 'Model change cancelled. The previous model is still active.'
          : `${error instanceof Error ? error.message : String(error)} The previous model is still active.`,
      );
      throw error;
    } finally {
      this.abort = null;
    }
  }
}

export const embeddingModelChanger = new EmbeddingModelChanger();
