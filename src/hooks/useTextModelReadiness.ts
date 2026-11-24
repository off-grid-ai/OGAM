import { useCallback, useMemo, useState } from 'react';
import { modelReadiness, type Readiness } from '@offgrid/features';
import { useAppStore } from '../stores';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { remoteServerManager } from '../services/remoteServerManager';
import { remoteServerModelOptions } from '../services/remoteModelSelection';
import logger from '../utils/logger';
import { useActiveTextModel } from './useActiveTextModel';

export interface TextModelReadiness {
  readiness: Readiness;
  /** Try the offline computer again; when it answers, its chat model is chosen again. */
  retry: () => void;
  retrying: boolean;
  /** The chat model's computer is asleep. */
  offline: boolean;
}

/**
 * Can a chat answer now. When the computer that served the chat model is asleep, its models drop out of
 * the picker and the chat had only a dash: this names the computer and offers to try it again, or to
 * get or choose a model on the phone.
 */
export function useTextModelReadiness(): TextModelReadiness {
  const active = useActiveTextModel();
  const servers = useRemoteServerStore(s => s.servers);
  const health = useRemoteServerStore(s => s.serverHealth);
  const activeServerId = useRemoteServerStore(s => s.activeServerId);
  const hasLocalModel = useAppStore(s => s.downloadedModels.length > 0);
  const [retrying, setRetrying] = useState(false);

  const { readiness, offlineServerId } = useMemo(() => {
    const offline = (id: string) => health[id]?.isHealthy === false;
    const hasTextModels = (id: string) =>
      remoteServerModelOptions(servers.filter(s => s.id === id), 'text').length > 0;
    const activeOffline = active.isRemote && !!activeServerId && offline(activeServerId);
    if (active.modelId && !activeOffline) {
      return { readiness: modelReadiness({ need: 'chat', ready: true }), offlineServerId: undefined };
    }
    const offlineServer = activeOffline
      ? servers.find(s => s.id === activeServerId)
      : servers.find(s => offline(s.id) && hasTextModels(s.id));
    const canChoose = hasLocalModel || servers.some(s => !offline(s.id) && hasTextModels(s.id));
    return {
      readiness: modelReadiness({ need: 'chat', ready: false, canChoose, offlineComputer: offlineServer?.name }),
      offlineServerId: offlineServer?.id,
    };
  }, [active.isRemote, active.modelId, activeServerId, health, servers, hasLocalModel]);

  const retry = useCallback(() => {
    if (!offlineServerId || retrying) return;
    setRetrying(true);
    remoteServerManager
      .testConnection(offlineServerId)
      .then(async result => {
        if (!result.success) return;
        const server = remoteServerManager.getServers().find(s => s.id === offlineServerId);
        const modelId = server ? remoteServerModelOptions([server], 'text')[0]?.id : undefined;
        if (modelId && !useRemoteServerStore.getState().activeRemoteTextModelId) {
          await remoteServerManager.setActiveRemoteTextModel(offlineServerId, server?.mediaModels?.text ?? modelId);
        }
      })
      .catch(error => logger.log('[Readiness] computer retry failed:', error))
      .finally(() => setRetrying(false));
  }, [offlineServerId, retrying]);

  return { readiness, retry, retrying, offline: !readiness.ready && !!offlineServerId };
}
