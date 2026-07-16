import { useCallback } from 'react';
import { showAlert, hideAlert } from '../../../components';
import { useRemoteServerStore } from '../../../stores/remoteServerStore';
import { remoteServerManager } from '../../../services';
import { discoverLANServers } from '../../../services/networkDiscovery';
import type { HomeScreenNavigationProp } from './types';
import type { RemoteServer } from '../../../types';
import logger from '../../../utils/logger';

const getPort = (endpoint: string): string | null => {
  try { return new URL(endpoint).port; } catch { return null; }
};

interface LANDiscoveryParams {
  navigation: HomeScreenNavigationProp;
  setAlertState: (state: any) => void;
}

async function updateMovedServer(
  samePortServer: RemoteServer,
  d: { endpoint: string; name: string },
  store: ReturnType<typeof useRemoteServerStore.getState>,
): Promise<void> {
  logger.log('[HomeScreen] Server moved to new IP, updating:', samePortServer.name, '->', d.endpoint);
  await remoteServerManager.updateServer(samePortServer.id, { endpoint: d.endpoint, name: d.name });
  try { await store.discoverModels(samePortServer.id); } catch { /* offline */ }
  if (store.activeServerId === samePortServer.id && store.activeRemoteTextModelId) {
    try {
      await remoteServerManager.setActiveRemoteTextModel(samePortServer.id, store.activeRemoteTextModelId);
    } catch { /* user can re-select */ }
  }
}

export function useLANDiscovery({ navigation, setAlertState }: LANDiscoveryParams) {
  const addNewServersAndNotify = useCallback(async (
    newServersToAdd: Awaited<ReturnType<typeof discoverLANServers>>
  ) => {
    for (const server of newServersToAdd) {
      logger.log('[HomeScreen] Auto-adding discovered server:', server.name);
      const added = await remoteServerManager.addServer({
        name: server.name,
        endpoint: server.endpoint,
        providerType: 'openai-compatible',
      });
      remoteServerManager.testConnection(added.id).catch(() => { });
    }

    if (newServersToAdd.length === 0) return;

    const names = newServersToAdd.map(s => s.name).join(', ');
    const title = newServersToAdd.length === 1
      ? 'LLM Server Found'
      : `${newServersToAdd.length} LLM Servers Found`;
    setAlertState(showAlert(
      title,
      `Discovered on your network: ${names}. You can select a model from the model picker.`,
      [
        { text: 'Dismiss', style: 'cancel' },
        {
          text: 'View Servers', onPress: () => {
            setAlertState(hideAlert());
            navigation.navigate('RemoteServers');
          }
        },
      ],
    ));
  }, [navigation, setAlertState]);

  const runLANDiscovery = useCallback(async () => {
    let discovered: Awaited<ReturnType<typeof discoverLANServers>>;
    try {
      discovered = await discoverLANServers();
    } catch (error) {
      logger.warn('[HomeScreen] LAN discovery skipped:', (error as Error).message);
      return;
    }
    if (discovered.length === 0) return;

    const store = useRemoteServerStore.getState();
    const existingServers = store.servers;
    const existingEndpoints = new Set(existingServers.map(s => s.endpoint.replace(/\/$/, '')));

    const newServersToAdd: typeof discovered = [];

    for (const d of discovered) {
      if (existingEndpoints.has(d.endpoint.replace(/\/$/, ''))) continue;

      const dPort = getPort(d.endpoint);
      const samePortServer = dPort
        ? existingServers.find(s => getPort(s.endpoint) === dPort)
        : null;

      if (samePortServer) {
        await updateMovedServer(samePortServer, d, store);
      } else {
        newServersToAdd.push(d);
      }
    }

    await addNewServersAndNotify(newServersToAdd);
  }, [addNewServersAndNotify]);

  return { runLANDiscovery };
}
