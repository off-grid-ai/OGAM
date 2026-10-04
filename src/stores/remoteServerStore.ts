/**
 * Remote Server Store
 *
 * Zustand store for managing remote LLM server configurations.
 * Handles server CRUD, model discovery, and active server selection.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RemoteServer, RemoteModel } from '../types';
import {
  migrateRemoteServerConfiguration,
  type RemoteServerHealth,
} from '@offgrid/application';

interface RemoteServerState {
  /** Configured remote servers */
  servers: RemoteServer[];
  /** @deprecated Legacy persistence read once by the selection migration. The active server is the text route's. */
  activeServerId?: string | null;
  /** Server health status */
  serverHealth: Record<string, RemoteServerHealth>;
  /** Loading states */
  isLoading: boolean;
  testingServerId: string | null;
  discoveringServerId: string | null;

  /** @deprecated Legacy persistence read once by the selection migration. */
  activeRemoteTextModelId?: string | null;
  /** @deprecated Legacy persistence read once by the selection migration. */
  activeRemoteImageModelId?: string | null;

  /** The ONE write for what discovery learned about a server: its text catalog. */
  setDiscoveredModels: (serverId: string, models: RemoteModel[]) => void;
  updateServerHealth: (serverId: string, isHealthy: boolean) => void;

  // Utility
  getServerById: (id: string) => RemoteServer | null;
}

type PersistedRemoteServerState = Partial<RemoteServerState>;
export function migrateRemoteServerState(
  persisted: unknown,
): PersistedRemoteServerState {
  // Retired persisted mirrors: discovered models live on the server catalog; media server
  // selection lives in the selection store (migrated once by modelSelectionProjection).
  const { discoveredModels: _discovered, activeRemoteMediaServerIds: _media, ...raw } =
    (persisted ?? {}) as PersistedRemoteServerState & {
      discoveredModels?: unknown;
      activeRemoteMediaServerIds?: unknown;
    };
  const migrated = migrateRemoteServerConfiguration(persisted);
  const servers = migrated.servers.map(server => ({
    ...server,
    createdAt: server.createdAt ?? new Date(0).toISOString(),
  })) as RemoteServer[];
  return { ...raw, servers, activeServerId: migrated.activeServerId };
}

export const useRemoteServerStore = create<RemoteServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      serverHealth: {},
      isLoading: false,
      testingServerId: null,
      discoveringServerId: null,
      setDiscoveredModels: (serverId, models) => {
        // Discovered text models and their capabilities are catalog facts of the server: the shared
        // inventory reads a server's catalog, so the record carries what discovery learned.
        set(state => ({
          servers: state.servers.map(server => server.id === serverId
            ? {
                ...server,
                catalog: {
                  ...server.catalog,
                  text: models.map(model => ({
                    id: model.id,
                    name: model.name,
                    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
                  })),
                },
              }
            : server),
        }));
      },

      updateServerHealth: (serverId, isHealthy) => {
        set(state => ({
          serverHealth: {
            ...state.serverHealth,
            [serverId]: {
              status: isHealthy ? 'healthy' : 'unhealthy',
              checkedAt: new Date().toISOString(),
            },
          },
        }));
      },

      // Utility
      getServerById: id => {
        const { servers } = get();
        return servers.find(s => s.id === id) || null;
      },

    }),
    {
      name: 'remote-servers',
      version: 4,
      migrate: migrateRemoteServerState,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        servers: state.servers.map(({ apiKey: _apiKey, ...server }) => server),
        // Don't persist health status - it should be refreshed
      }),
    },
  ),
);
