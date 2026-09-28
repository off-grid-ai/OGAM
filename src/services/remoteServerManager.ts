/**
 * Remote Server Manager
 *
 * Manages remote LLM server connections, including:
 * - CRUD operations for server configurations
 * - Secure API key storage using React Native Keychain
 * - Provider creation and management
 */

import {
  RemoteServer,
  RemoteModel,
  RemoteModelCategory,
  ServerTestResult,
} from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { useAppStore } from '../stores/appStore';
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import {
  discoverLANServers,
  type DiscoveredServer,
  type DiscoveryOptions,
} from './networkDiscovery';
import { shouldAutoDiscoverRemoteModels } from '../utils/remoteAutoDiscovery';
import logger from '../utils/logger';
import {
  storeApiKeyImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  createProviderForServerImpl,
  setActiveRemoteTextModelImpl,
  setActiveRemoteImageModelImpl,
  initializeProvidersImpl,
} from './remoteServerManagerUtils';
import { remoteAuthorizationHeaders } from './remoteTransportPolicy';
import { activateOffGridDesktopModel } from './offGridDesktopModels';

/** Normalize an endpoint for identity comparison (lowercase, no trailing slashes). */
const trimSlash = (url: string): string => {
  let s = url.toLowerCase();
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
};

class RemoteServerManager {
  /**
   * Add a new remote server
   */
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string },
    stableId?: string,
  ): Promise<RemoteServer> {
    const store = useRemoteServerStore.getState();

    // Deduplicate: if a server with the same endpoint already exists, return it
    const normalizedEndpoint = trimSlash(config.endpoint);
    const existing = store.servers.find(
      s => trimSlash(s.endpoint) === normalizedEndpoint,
    );
    if (existing) {
      logger.log('[RemoteServerManager] Server already exists:', existing.name);
      return existing;
    }

    // Credentials belong only in Keychain. Never put them in the persisted Zustand server record.
    const { apiKey, ...publicConfig } = config;
    const id = store.addServer(publicConfig, stableId);
    if (apiKey) {
      await this.storeApiKey(id, apiKey);
    }

    const server = store.getServerById(id);
    if (!server) throw new Error('Failed to create server');

    await createProviderForServerImpl(server);
    logger.log('[RemoteServerManager] Added server:', server.name);
    return server;
  }

  /**
   * Update a server configuration
   */
  async updateServer(
    id: string,
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const store = useRemoteServerStore.getState();
    const existingServer = store.getServerById(id);

    if (!existingServer) throw new Error(`Server not found: ${id}`);

    if (updates.apiKey !== undefined) {
      if (updates.apiKey) {
        await this.storeApiKey(id, updates.apiKey);
      } else {
        await this.removeApiKey(id);
      }
    }

    const { apiKey: _, ...storeUpdates } = updates;
    store.updateServer(id, storeUpdates);

    const provider = providerRegistry.getProvider(id);
    if (provider && 'updateConfig' in provider) {
      const apiKey = await this.getApiKey(id);
      const endpoint = updates.endpoint || existingServer.endpoint;
      const authorization = remoteAuthorizationHeaders(endpoint, apiKey);
      (provider as OpenAICompatibleProvider).updateConfig({
        endpoint,
        apiKey: authorization.Authorization?.replace(/^Bearer /, ''),
      });
    }

    logger.log('[RemoteServerManager] Updated server:', id);
  }

  /**
   * Remove a server
   */
  async removeServer(id: string): Promise<void> {
    providerRegistry.unregisterProvider(id);
    await this.removeApiKey(id);
    useRemoteServerStore.getState().removeServer(id);
    logger.log('[RemoteServerManager] Removed server:', id);
  }

  /** Get all servers (without API keys) */
  getServers(): RemoteServer[] {
    return useRemoteServerStore.getState().servers;
  }

  /** Get a server by ID */
  getServer(id: string): RemoteServer | null {
    return useRemoteServerStore.getState().getServerById(id);
  }

  /** Get server with API key (for provider) */
  async getServerWithApiKey(
    id: string,
  ): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;
    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey || undefined };
  }

  /**
   * Test server connection
   */
  async testConnection(
    id: string,
  ): Promise<{ success: boolean; error?: string; models?: RemoteModel[] }> {
    const store = useRemoteServerStore.getState();
    const apiKey = await this.getApiKey(id);
    return store.testConnection(id, apiKey || undefined);
  }

  /** Test connection to a server by endpoint (before adding) */
  async testConnectionByEndpoint(
    endpoint: string,
    apiKey?: string,
  ): Promise<ServerTestResult> {
    return useRemoteServerStore
      .getState()
      .testConnectionByEndpoint(endpoint, apiKey);
  }

  /**
   * Discover models from a server
   */
  async discoverModels(id: string): Promise<RemoteModel[]> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(id);
    if (!server) throw new Error(`Server not found: ${id}`);

    const apiKey = await this.getApiKey(id);
    return store.discoverModels(id, apiKey || undefined);
  }

  /**
   * Set the active server (null for local)
   */
  setActiveServer(id: string | null): void {
    useRemoteServerStore.getState().setActiveServerId(id);
    providerRegistry.setActiveProvider(id ?? 'local');
    logger.log('[RemoteServerManager] Active server set to:', id || 'local');
  }

  /** Set the active remote text model */
  async setActiveRemoteTextModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    return setActiveRemoteTextModelImpl(serverId, modelId);
  }

  /** Set the active remote vision/image model */
  async setActiveRemoteImageModel(
    serverId: string,
    modelId: string,
  ): Promise<void> {
    const server = useRemoteServerStore.getState().getServerById(serverId);
    return server?.modelManagement === 'offgrid-desktop-v1'
      ? this.setActiveRemoteMediaModel(serverId, 'image', modelId)
      : setActiveRemoteImageModelImpl(serverId, modelId);
  }

  /** Select one remote model for image, transcription, or voice work. */
  async setActiveRemoteMediaModel(
    serverId: string,
    category: Exclude<RemoteModelCategory, 'text'>,
    modelId: string,
  ): Promise<void> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    const confirmedState =
      server.modelManagement === 'offgrid-desktop-v1'
        ? await activateOffGridDesktopModel(
            {
              ...server,
              apiKey: (await this.getApiKey(serverId)) ?? undefined,
            },
            category,
            modelId,
          )
        : null;
    const confirmedModels = confirmedState?.active ?? {
      ...server.mediaModels,
      [category]: modelId,
    };
    store.updateServer(serverId, {
      mediaModels: confirmedModels,
    });
    store.setActiveRemoteMediaServerId(category, serverId);
    if (category === 'image') store.setActiveRemoteImageModelId(modelId);
    logger.log('[RemoteServerManager] Active remote media model set:', {
      serverId,
      category,
      modelId,
    });
  }

  /**
   * Clear active remote model (switch back to local)
   */
  clearActiveRemoteModel(): void {
    const store = useRemoteServerStore.getState();
    store.setActiveServerId(null);
    store.setActiveRemoteTextModelId(null);
    store.setActiveRemoteImageModelId(null);
    store.setActiveRemoteMediaServerId('video', null);
    store.setActiveRemoteMediaServerId('image', null);
    store.setActiveRemoteMediaServerId('transcription', null);
    store.setActiveRemoteMediaServerId('voice', null);
    providerRegistry.setActiveProvider('local');
    logger.log('[RemoteServerManager] Cleared active remote model');
  }

  clearActiveRemoteTextModel(): void {
    const store = useRemoteServerStore.getState();
    store.setActiveServerId(null);
    store.setActiveRemoteTextModelId(null);
    providerRegistry.setActiveProvider('local');
  }

  clearActiveRemoteMediaModel(
    category: Exclude<RemoteModelCategory, 'text'>,
  ): void {
    const store = useRemoteServerStore.getState();
    store.setActiveRemoteMediaServerId(category, null);
    if (category === 'image') store.setActiveRemoteImageModelId(null);
  }

  /** Get the active server */
  getActiveServer(): RemoteServer | null {
    return useRemoteServerStore.getState().getActiveServer();
  }

  /**
   * Initialize providers for all stored servers.
   * Also re-discovers models for each server to repopulate discoveredModels.
   * Restores active remote model selection if persisted.
   */
  async initializeProviders(): Promise<void> {
    return initializeProvidersImpl(() => this.getServers());
  }

  /**
   * Scan the LAN and report endpoints not already saved. A matching port does not prove server
   * identity, so a scan must never move a saved server or its credentials to a new host.
   */
  async scanAndReconcile(options: DiscoveryOptions = {}): Promise<{
    moved: string[];
    found: DiscoveredServer[];
  }> {
    let discovered: DiscoveredServer[];
    const savedEndpoints = new Set(
      useRemoteServerStore
        .getState()
        .servers.map(server => trimSlash(server.endpoint)),
    );
    try {
      discovered = await discoverLANServers(undefined, {
        ...options,
        onFound: server => {
          if (!savedEndpoints.has(trimSlash(server.endpoint))) options.onFound?.(server);
        },
      });
    } catch (error) {
      logger.warn(
        '[RemoteServerManager] LAN scan failed:',
        (error as Error).message,
      );
      return { moved: [], found: [] };
    }
    return {
      moved: [],
      found: discovered.filter(
        server => !savedEndpoints.has(trimSlash(server.endpoint)),
      ),
    };
  }

  /**
   * Recover the active remote connection after a network change. Cheap-first: if there is an active
   * server and it is still reachable at its known endpoint, do nothing. Only when it is unreachable
   * (or the user has enabled auto-discovery) do we scan the LAN to find where it moved and reconnect.
   * This keeps LAN scanning off unless the user is actually relying on a remote server, and makes the
   * "connected" state honest again after the peer's IP changes.
   */
  async recoverActiveConnection(): Promise<void> {
    const activeId = useRemoteServerStore.getState().activeServerId;
    const autoDiscover = shouldAutoDiscoverRemoteModels(
      useAppStore.getState().settings,
    );

    if (activeId) {
      const result = await this.testConnection(activeId).catch(() => ({
        success: false,
      }));
      if (result.success && !autoDiscover) {
        logger.log(
          '[RemoteServerManager] Active server still reachable; no rescan needed',
        );
        return;
      }
      logger.log(
        result.success
          ? '[RemoteServerManager] Active server reachable; scanning because auto-discovery is enabled'
          : '[RemoteServerManager] Active server unreachable; rescanning to recover',
      );
    }

    const allowScan = autoDiscover || !!activeId;
    if (!allowScan) return;

    const { moved, found } = await this.scanAndReconcile();
    logger.log(
      `[RemoteServerManager] Recovery scan complete: ${moved.length} moved, ${found.length} new`,
    );
  }

  /**
   * Clear all servers
   */
  async clearAllServers(): Promise<void> {
    for (const server of this.getServers()) {
      await this.removeApiKey(server.id);
    }
    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  }

  // -------------------------------------------------------------------------
  // Keychain wrappers — public so tests + updateServer can call them
  // -------------------------------------------------------------------------

  async storeApiKey(serverId: string, apiKey: string): Promise<void> {
    return storeApiKeyImpl(serverId, apiKey);
  }

  async getApiKey(serverId: string): Promise<string | null> {
    return getApiKeyImpl(serverId);
  }

  private async removeApiKey(serverId: string): Promise<void> {
    return removeApiKeyImpl(serverId);
  }
}

/** Singleton instance */
export const remoteServerManager = new RemoteServerManager();
