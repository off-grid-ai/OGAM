import { embeddingModelChanger } from '../../documents/embeddingModel';
import { activeEmbeddingModel } from '../../documents/store';
import { embeddingService } from '../../rag/embedding';
import { RECOMMENDED_EMBEDDING_MODELS } from '../../huggingFaceModelBrowser';
import { uniformDownloadId } from '../uniformId';
import type { DownloadProvider, ModelDownload } from '../types';

/**
 * Search (embedding) models in the Download Manager: the model being installed, with its real
 * progress, Cancel and Retry; and each downloaded model, which can be deleted when not in use.
 * The download itself stays with the embedding model changer (download, check, switch).
 */
const bare = (id: string) => id.replace(/^embedding:/, '');

function known(): Array<{ id: string; name: string; size: number }> {
  let active: { id: string; name: string; size: number } | null = null;
  try {
    active = activeEmbeddingModel();
  } catch {
    active = null;
  }
  const list = [...RECOMMENDED_EMBEDDING_MODELS];
  return active && !list.some(model => model.id === active!.id) ? [...list, active] : list;
}

export const embeddingProvider: DownloadProvider = {
  modelType: 'embedding',
  async list() {
    const change = embeddingModelChanger.getChange();
    const rows: ModelDownload[] = [];
    const installing = change.candidateId ? known().find(model => model.id === change.candidateId) : undefined;
    const base = (model: { id: string; name: string; size: number }) => ({
      id: uniformDownloadId('embedding', model.id),
      modelType: 'embedding' as const,
      name: model.name,
      sizeBytes: model.size,
    });
    if (installing && (change.busy || change.error)) {
      const fraction = change.fraction ?? 0;
      rows.push({
        ...base(installing),
        bytesDownloaded: Math.round(installing.size * fraction),
        progress: fraction,
        status: change.busy ? 'downloading' : 'error',
        error: change.error || undefined,
        capabilities: { cancel: true, retry: true, remove: false, resumable: false, determinateProgress: true },
      });
    }
    for (const model of known()) {
      if (installing?.id === model.id && change.busy) continue;
      if (!(await embeddingService.hasModelFile(model))) continue;
      rows.push({
        ...base(model),
        bytesDownloaded: model.size,
        progress: 1,
        status: 'completed',
        capabilities: { cancel: false, retry: false, remove: true, resumable: false, determinateProgress: true },
      });
    }
    return rows;
  },
  async cancel() {
    embeddingModelChanger.cancel();
  },
  async retry() {
    await embeddingModelChanger.retry();
  },
  async remove(id) {
    await embeddingService.deleteModelFile({ id: bare(id) });
  },
  subscribe: onChange => embeddingModelChanger.subscribe(onChange),
};
