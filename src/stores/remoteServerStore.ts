/**
 * Remote Server Store
 *
 * Zustand store for managing remote LLM server configurations.
 * Handles server CRUD, model discovery, and active server selection.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  RemoteServer,
  RemoteModel,
  RemoteModelCategory,
  ServerTestResult,
} from '../types';
import logger from '../utils/logger';
import { generateId } from '../utils/generateId';
import { createHydrationGatedStorage } from '../utils/hydrationGatedStorage';
import {
  testServerConnection,
  testEndpointAndGetModels,
  fetchModelsFromServer,
} from './remoteServerHelpers';

interface RemoteServerState {
  /** Configured remote servers */
  servers: RemoteServer[];
  /** Currently active server ID (null = local only) */
  activeServerId: string | null;
  /** Models discovered per server */
  discoveredModels: Record<string, RemoteModel[]>;
  /** Server health status */
  serverHealth: Record<string, { isHealthy: boolean; lastCheck: string }>;
  /** Loading states */
  isLoading: boolean;
  testingServerId: string | null;
  discoveringServerId: string | null;

  /** Active remote text model ID (when using remote for text generation) */
  activeRemoteTextModelId: string | null;
  /** Active remote image/vision model ID (when using remote for vision) */
  activeRemoteImageModelId: string | null;
  /** Active server per non-text category. Text keeps activeServerId for provider routing. */
  activeRemoteMediaServerIds: Partial<
    Record<Exclude<RemoteModelCategory, 'text'>, string>
  >;

  // Server CRUD
  addServer: (server: Omit<RemoteServer, 'id' | 'createdAt'>) => string;
  updateServer: (id: string, updates: Partial<RemoteServer>) => void;
  removeServer: (id: string) => void;

  // Active server
  setActiveServerId: (id: string | null) => void;
  getActiveServer: () => RemoteServer | null;

  // Active remote model selection
  setActiveRemoteTextModelId: (id: string | null) => void;
  setActiveRemoteImageModelId: (id: string | null) => void;
  getActiveRemoteTextModel: () => RemoteModel | null;
  getActiveRemoteImageModel: () => RemoteModel | null;
  setActiveRemoteMediaServerId: (
    category: Exclude<RemoteModelCategory, 'text'>,
    serverId: string | null,
  ) => void;
  getActiveRemoteMediaServer: (
    category: Exclude<RemoteModelCategory, 'text'>,
  ) => RemoteServer | null;

  // Model discovery
  discoverModels: (serverId: string, apiKey?: string) => Promise<RemoteModel[]>;
  setDiscoveredModels: (serverId: string, models: RemoteModel[]) => void;
  clearDiscoveredModels: (serverId: string) => void;

  // Health check
  testConnection: (serverId: string, apiKey?: string) => Promise<ServerTestResult>;
  testConnectionByEndpoint: (
    endpoint: string,
    apiKey?: string,
  ) => Promise<ServerTestResult>;
  updateServerHealth: (serverId: string, isHealthy: boolean) => void;

  // Utility
  getServerById: (id: string) => RemoteServer | null;
  getModelById: (serverId: string, modelId: string) => RemoteModel | null;
  clearAllServers: () => void;
}

type PersistedRemoteServerState = Partial<RemoteServerState>;

export function migrateRemoteServerState(
  persisted: unknown,
): PersistedRemoteServerState {
  const state = (persisted ?? {}) as PersistedRemoteServerState;
  if (state.activeRemoteMediaServerIds) return state;
  const activeServer = state.servers?.find(
    server => server.id === state.activeServerId,
  );
  if (!activeServer) return { ...state, activeRemoteMediaServerIds: {} };
  return {
    ...state,
    activeRemoteMediaServerIds: {
      ...(state.activeRemoteImageModelId && activeServer.mediaModels?.image
        ? { image: activeServer.id }
        : {}),
      ...(activeServer.mediaModels?.transcription
        ? { transcription: activeServer.id }
        : {}),
      ...(activeServer.mediaModels?.voice ? { voice: activeServer.id } : {}),
    },
  };
}

const remoteServerStorage = createHydrationGatedStorage<PersistedRemoteServerState>();

export const useRemoteServerStore = create<RemoteServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      activeServerId: null,
      discoveredModels: {},
      serverHealth: {},
      isLoading: false,
      testingServerId: null,
      discoveringServerId: null,
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
      activeRemoteMediaServerIds: {},

      // Server CRUD
      addServer: serverData => {
        const id = generateId();
        const { apiKey: _apiKey, ...publicData } = serverData;
        const server: RemoteServer = {
          ...publicData,
          id,
          createdAt: new Date().toISOString(),
        };
        set(state => ({
          servers: [...state.servers, server],
        }));
        logger.log('[RemoteServer] Added server:', server.name);
        return id;
      },

      updateServer: (id, updates) => {
        set(state => ({
          servers: state.servers.map(server => {
            if (server.id !== id) return server;
            const { apiKey: _apiKey, ...publicServer } = {
              ...server,
              ...updates,
            };
            return publicServer;
          }),
        }));
        logger.log('[RemoteServer] Updated server:', id);
      },

      removeServer: id => {
        const state = get();
        // Clear active server and model IDs if removing the active server
        if (state.activeServerId === id) {
          set({
            activeServerId: null,
            activeRemoteTextModelId: null,
          });
        }
        set(prev => ({
          servers: prev.servers.filter(srv => srv.id !== id),
          discoveredModels: Object.fromEntries(
            Object.entries(prev.discoveredModels).filter(([key]) => key !== id),
          ),
          serverHealth: Object.fromEntries(
            Object.entries(prev.serverHealth).filter(([key]) => key !== id),
          ),
          activeRemoteMediaServerIds: Object.fromEntries(
            Object.entries(prev.activeRemoteMediaServerIds).filter(
              ([, serverId]) => serverId !== id,
          ),
          ),
          activeRemoteImageModelId:
            prev.activeRemoteMediaServerIds.image === id
              ? null
              : prev.activeRemoteImageModelId,
        }));
        logger.log('[RemoteServer] Removed server:', id);
      },

      // Active server
      setActiveServerId: id => {
        set({ activeServerId: id });
        logger.log('[RemoteServer] Active server set to:', id || 'local');
      },

      getActiveServer: () => {
        const { servers, activeServerId } = get();
        return servers.find(s => s.id === activeServerId) || null;
      },

      // Active remote model selection
      setActiveRemoteTextModelId: id => {
        set({ activeRemoteTextModelId: id });
        logger.log(
          '[RemoteServer] Active remote text model set to:',
          id || 'none',
        );
      },

      setActiveRemoteImageModelId: id => {
        set({ activeRemoteImageModelId: id });
        logger.log(
          '[RemoteServer] Active remote image model set to:',
          id || 'none',
        );
      },

      getActiveRemoteTextModel: () => {
        const { activeRemoteTextModelId, activeServerId, discoveredModels } =
          get();
        if (!activeRemoteTextModelId || !activeServerId) return null;
        const models = discoveredModels[activeServerId] || [];
        return models.find(m => m.id === activeRemoteTextModelId) || null;
      },

      getActiveRemoteImageModel: () => {
        const {
          activeRemoteImageModelId,
          activeRemoteMediaServerIds,
          discoveredModels,
        } = get();
        const serverId = activeRemoteMediaServerIds.image;
        if (!activeRemoteImageModelId || !serverId) return null;
        const models = discoveredModels[serverId] || [];
        return models.find(m => m.id === activeRemoteImageModelId) || null;
      },

      setActiveRemoteMediaServerId: (category, serverId) => {
        set(state => ({
          activeRemoteMediaServerIds: serverId
            ? { ...state.activeRemoteMediaServerIds, [category]: serverId }
            : Object.fromEntries(
                Object.entries(state.activeRemoteMediaServerIds).filter(
                  ([key]) => key !== category,
                ),
              ),
        }));
      },

      getActiveRemoteMediaServer: category => {
        const { servers, activeRemoteMediaServerIds } = get();
        const serverId = activeRemoteMediaServerIds[category];
        return servers.find(server => server.id === serverId) ?? null;
      },

      // Model discovery
      discoverModels: async (serverId, apiKey) => {
        const { servers } = get();
        const server = servers.find(s => s.id === serverId);
        if (!server) {
          throw new Error(`Server not found: ${serverId}`);
        }

        set({ discoveringServerId: serverId, isLoading: true });

        try {
          const models = await fetchModelsFromServer({ ...server, apiKey });
          set(state => ({
            discoveredModels: {
              ...state.discoveredModels,
              [serverId]: models,
            },
            isLoading: false,
            discoveringServerId: null,
          }));
          logger.log('[RemoteServer] Discovered models:', models.length);
          return models;
        } catch (error) {
          set({ isLoading: false, discoveringServerId: null });
          throw error;
        }
      },

      setDiscoveredModels: (serverId, models) => {
        set(state => ({
          discoveredModels: {
            ...state.discoveredModels,
            [serverId]: models,
          },
        }));
      },

      clearDiscoveredModels: serverId => {
        set(state => {
          const newDiscovered = { ...state.discoveredModels };
          delete newDiscovered[serverId];
          return { discoveredModels: newDiscovered };
        });
      },

      // Health check
      testConnection: async (serverId, apiKey) => {
        const { servers } = get();
        const server = servers.find(s => s.id === serverId);
        if (!server) {
          return { success: false, error: 'Server not found' };
        }

        set({ testingServerId: serverId, isLoading: true });

        try {
          const result = await testServerConnection({ ...server, apiKey });

          set(state => ({
            serverHealth: {
              ...state.serverHealth,
              [serverId]: {
                isHealthy: result.success,
                lastCheck: new Date().toISOString(),
              },
            },
            isLoading: false,
            testingServerId: null,
          }));

          // Update models if discovered
          if (result.success && result.models) {
            set(state => ({
              discoveredModels: {
                ...state.discoveredModels,
                [serverId]: result.models!,
              },
            }));
          }

          if (result.success && result.mediaModels) {
            set(state => ({
              servers: state.servers.map(candidate =>
                candidate.id === serverId
                  ? {
                    ...candidate,
                    mediaModels:
                      result.modelManagement === 'offgrid-desktop-v1'
                        ? result.mediaModels
                        : {
                            ...result.mediaModels,
                            ...candidate.mediaModels,
                          },
                    modelCatalog:
                      result.modelCatalog ?? candidate.modelCatalog,
                    modelManagement:
                      result.modelManagement ?? candidate.modelManagement,
                    updatedAt: new Date().toISOString(),
                  }
                  : candidate,
              ),
            }));
          }

          return result;
        } catch (error) {
          set({ isLoading: false, testingServerId: null });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },

      testConnectionByEndpoint: async (endpoint, apiKey) => {
        set({ isLoading: true });
        try {
          const result = await testEndpointAndGetModels(endpoint, apiKey);
          set({ isLoading: false });
          return result;
        } catch (error) {
          set({ isLoading: false });
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },

      updateServerHealth: (serverId, isHealthy) => {
        set(state => ({
          serverHealth: {
            ...state.serverHealth,
            [serverId]: {
              isHealthy,
              lastCheck: new Date().toISOString(),
            },
          },
        }));
      },

      // Utility
      getServerById: id => {
        const { servers } = get();
        return servers.find(s => s.id === id) || null;
      },

      getModelById: (serverId, modelId) => {
        const { discoveredModels } = get();
        const models = discoveredModels[serverId] || [];
        return models.find(m => m.id === modelId) || null;
      },

      clearAllServers: () => {
        set({
          servers: [],
          activeServerId: null,
          discoveredModels: {},
          serverHealth: {},
          activeRemoteTextModelId: null,
          activeRemoteImageModelId: null,
          activeRemoteMediaServerIds: {},
        });
      },
    }),
    {
      name: 'remote-servers',
      version: 2,
      migrate: migrateRemoteServerState,
      storage: remoteServerStorage.storage,
      onRehydrateStorage: () => () => remoteServerStorage.markHydrated(),
      partialize: (state): PersistedRemoteServerState => ({
        servers: state.servers.map(({ apiKey: _apiKey, ...server }) => server),
        activeServerId: state.activeServerId,
        activeRemoteTextModelId: state.activeRemoteTextModelId,
        activeRemoteImageModelId: state.activeRemoteImageModelId,
        activeRemoteMediaServerIds: state.activeRemoteMediaServerIds,
        discoveredModels: state.discoveredModels,
        // Don't persist health status - it should be refreshed
      }),
    },
  ),
);
