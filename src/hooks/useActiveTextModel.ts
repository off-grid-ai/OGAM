import { useMemo } from 'react';
import { useAppStore, useRemoteServerStore } from '../stores';
import { activeModelService } from '../services/activeModelService';
import { displayModelName } from '../utils/displayModelName';
import { DownloadedModel, RemoteModel } from '../types';

export type ActiveTextModelResult = {
  /** The resolved active model (remote preferred over local) */
  model: DownloadedModel | RemoteModel | null;
  /** The model ID suitable for creating conversations */
  modelId: string | null;
  /** Display name */
  modelName: string;
  /** Whether the active model is remote */
  isRemote: boolean;
};

/**
 * The active text model, preferring remote over local. THE answer to "is a text model available" -
 * chat, the chat list and Home all read it here rather than each repeating the lookup.
 *
 * The local branch delegates to activeModelService, which tolerates a selected id whose entry was
 * rebuilt under a different id (see resolveModel). Repeating `find(m => m.id === activeModelId)` in a
 * view is what let the chat refuse to send to a model the engine had loaded.
 */
export function useActiveTextModel(): ActiveTextModelResult {
  const downloadedModels = useAppStore((s) => s.downloadedModels);
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeServerId = useRemoteServerStore((s) => s.activeServerId);
  const activeRemoteTextModelId = useRemoteServerStore((s) => s.activeRemoteTextModelId);
  const discoveredModels = useRemoteServerStore((s) => s.discoveredModels);

  return useMemo(() => {
    // Check remote first
    if (activeServerId && activeRemoteTextModelId) {
      const remoteModel = (discoveredModels[activeServerId] || []).find(
        (m) => m.id === activeRemoteTextModelId,
      );
      // The persisted server + model IDs are the selection. Discovery metadata is
      // refreshed independently and can be empty for one render while a provider
      // is already ready. Keep that remote choice authoritative during the gap;
      // falling through here loads the last local model into a new chat.
      return {
        model: remoteModel ?? null,
        modelId: activeRemoteTextModelId,
        modelName: remoteModel?.name ?? displayModelName(activeRemoteTextModelId),
        isRemote: true,
      };
    }
    // Fall back to local. Resolved by the owning service, not by an id comparison here.
    const localModel = activeModelService.resolveSelectedTextModel();
    if (localModel) {
      return {
        model: localModel,
        modelId: localModel.id,
        modelName: localModel.name,
        isRemote: false,
      };
    }
    return { model: null, modelId: null, modelName: 'Unknown', isRemote: false };
    // activeModelId and downloadedModels look unused now that the service resolves the local model,
    // but they are exactly what makes this hook REACTIVE: the service reads them imperatively, so
    // without them here a selection or a rescan would not re-render anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, activeRemoteTextModelId, discoveredModels, activeModelId, downloadedModels]);
}
