import { selectedRemoteServerId } from './modelSelectionProjection';
import {
  mergeRemoteSelections,
  shouldAutoDiscoverRemoteModels,
  type RemoteServerApplicationPorts,
  type PersistedRemoteServer,
  type RemoteModelModality,
  type RemoteServerConfiguration,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { applicationFacade } from '../applicationFacade';
import { remoteTextTransportRegistry } from '../adapters/providers/registry';
import {
  discoverLANServers,
  fetchModelsFromServer,
  testServerConnection,
} from '../composition/remote';
import {
  createProviderForServerImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  storeApiKeyImpl,
} from '../adapters/remote/serverRuntime';
import { activateOffGridDesktopModel } from '../adapters/remote/offGridDesktopModels';
import { removeCanonicalServerSelections } from './modelSelectionCommandPort';
import type { RemoteModel, RemoteServer } from '../../types';
import {
  createZustandReadinessAdapter,
  type ZustandPersistApi,
} from '../adapters/persistence/zustandHydration';

const remotePersistApi = (): ZustandPersistApi | undefined =>
  (
    useRemoteServerStore as typeof useRemoteServerStore & {
      persist?: ZustandPersistApi;
    }
  ).persist;
const remoteReadiness = createZustandReadinessAdapter(
  remotePersistApi,
  'Saved remote servers',
);

function readConfiguration(): RemoteServerConfiguration {
  const state = useRemoteServerStore.getState();
  // The active server is the text route's server, not a fact of its own.
  return {
    version: 1,
    activeServerId: selectedRemoteServerId('text'),
    servers: state.servers,
  };
}

function writeConfiguration(value: RemoteServerConfiguration): void {
  const ids = new Set(value.servers.map(server => server.id));
  useRemoteServerStore.setState(state => ({
    servers: value.servers.map(server => ({
      ...server,
      createdAt: server.createdAt ?? new Date(0).toISOString(),
    })),
    serverHealth: Object.fromEntries(
      Object.entries(state.serverHealth).filter(([id]) => ids.has(id)),
    ),
  }));
}

interface ManagedActivationInput {
  server: PersistedRemoteServer;
  modality: RemoteModelModality;
  modelId: string;
  credential: string | null;
}

/** Translate Shared's credential-free record into the Mobile HTTP adapter input. */
function mobileTransportServer(
  server: PersistedRemoteServer,
  credential: string | null,
): RemoteServer {
  return {
    id: server.id,
    name: server.name,
    endpoint: server.endpoint,
    provider: server.provider,
    selections: server.selections,
    catalog: server.catalog,
    ...(server.modelManagement
      ? { modelManagement: server.modelManagement }
      : {}),
    createdAt: server.createdAt ?? new Date(0).toISOString(),
    ...(server.screenFramesAllowed === true
      ? { screenFramesAllowed: true }
      : {}),
    ...(credential ? { apiKey: credential } : {}),
  };
}

function isRemoteModel(value: unknown): value is RemoteModel {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<RemoteModel>;
  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    typeof model.serverId === 'string' &&
    typeof model.lastUpdated === 'string' &&
    Boolean(model.capabilities)
  );
}

function activateManagedRemote({
  server,
  modality,
  modelId,
  credential,
}: ManagedActivationInput) {
  return activateOffGridDesktopModel(
    mobileTransportServer(server, credential),
    modality,
    modelId,
  );
}

/**
 * Mobile's remote-server I/O, handed to the shared ModelWorkspace. Selection is NOT a port here:
 * the workspace resolves a server's model to this device's route and writes it through the one
 * selection authority. `clearSelections` stays a port until the per-source candidate projection
 * moves into shared.
 */
export const mobileRemoteServerPorts: Omit<
  RemoteServerApplicationPorts,
  'select'
> = {
  configuration: {
    read: readConfiguration,
    write: writeConfiguration,
    isReady: remoteReadiness.isReady,
    awaitReady: remoteReadiness.awaitReady,
    retryReady: remoteReadiness.retryReady,
  },
  credentials: {
    read: getApiKeyImpl,
    write: storeApiKeyImpl,
    remove: removeApiKeyImpl,
  },
  providers: {
    register: (server, credential) =>
      createProviderForServerImpl(server, credential),
    update: (server, credential) =>
      createProviderForServerImpl(server, credential),
    unregister(serverId) {
      remoteTextTransportRegistry.unregister(serverId);
    },
  },
  clearSelections: removeCanonicalServerSelections,
  async discover(server, credential) {
    const models = await fetchModelsFromServer({
      ...server,
      createdAt: server.createdAt ?? new Date(0).toISOString(),
      apiKey: credential ?? undefined,
    });
    return { models };
  },
  projectDiscovery(serverId, result) {
    const models = (result.models ?? []).filter(isRemoteModel);
    useRemoteServerStore.getState().setDiscoveredModels(serverId, models);
  },
  async test(server, credential) {
    const result = await testServerConnection({
      ...server,
      createdAt: server.createdAt ?? new Date(0).toISOString(),
      apiKey: credential ?? undefined,
    });
    useRemoteServerStore
      .getState()
      .updateServerHealth(server.id, result.success);
    if (result.models) {
      useRemoteServerStore
        .getState()
        .setDiscoveredModels(server.id, result.models);
    }
    if (result.success && result.selections) {
      const current = readConfiguration();
      const found = current.servers.find(
        candidate => candidate.id === server.id,
      );
      if (found) {
        writeConfiguration({
          ...current,
          servers: current.servers.map(candidate =>
            candidate.id === server.id
              ? {
                  ...candidate,
                  selections: mergeRemoteSelections(
                    candidate.selections,
                    result.selections,
                    result.modelManagement === 'offgrid-desktop-v1',
                  ),
                  catalog: result.catalog ?? candidate.catalog,
                  modelManagement:
                    result.modelManagement ?? candidate.modelManagement,
                }
              : candidate,
          ),
        });
      }
    }
    return result;
  },
  scan: (onFound, onProgress) =>
    discoverLANServers(undefined, onFound, onProgress),
  activateManaged(...args) {
    return activateManagedRemote({
      server: args[0],
      modality: args[1],
      modelId: args[2],
      credential: args[3],
    });
  },
};

export function shouldRecoverRemoteServers(): boolean {
  return shouldAutoDiscoverRemoteModels(
    applicationFacade().models.settings.current(),
  );
}
