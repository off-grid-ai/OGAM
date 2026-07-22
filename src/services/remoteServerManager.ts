/**
 * Remote Server Manager
 *
 * Manages remote LLM server connections, including:
 * - CRUD operations for server configurations
 * - Secure API key storage using React Native Keychain
 * - Provider creation and management
 */

import { RemoteServer, RemoteModel, ServerTestResult } from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import logger from '../utils/logger';
import { activeModelService } from './activeModelService';
import { clearActiveRemoteModelSelection } from './remoteModelSelection';
import {
  storeApiKeyImpl,
  getApiKeyImpl,
  removeApiKeyImpl,
  createProviderForServerImpl,
  setActiveRemoteTextModelImpl,
  setActiveRemoteImageModelImpl,
  initializeProvidersImpl,
} from './remoteServerManagerUtils';

class RemoteServerManager {
  /**
   * Add a new remote server
   */
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string }
  ): Promise<RemoteServer> {
    const store = useRemoteServerStore.getState();

    // Deduplicate: if a server with the same endpoint already exists, return it
    const trimSlashes = (url: string) => { let s = url.toLowerCase(); while (s.endsWith('/')) s = s.slice(0, -1); return s; };
    const normalizedEndpoint = trimSlashes(config.endpoint);
    const existing = store.servers.find(
      (s) => trimSlashes(s.endpoint) === normalizedEndpoint
    );
    if (existing) {
      logger.log('[RemoteServerManager] Server already exists:', existing.name);
      return existing;
    }

    const id = store.addServer(config);
    if (config.apiKey) {
      await this.storeApiKey(id, config.apiKey);
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
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>
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
      (provider as OpenAICompatibleProvider).updateConfig({
        endpoint: updates.endpoint || existingServer.endpoint,
        apiKey: apiKey || undefined,
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
  async getServerWithApiKey(id: string): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;
    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey || undefined };
  }

  /**
   * Test server connection
   */
  async testConnection(
    id: string
  ): Promise<{ success: boolean; error?: string; models?: RemoteModel[] }> {
    const store = useRemoteServerStore.getState();
    return store.testConnection(id);
  }

  /** Test connection to a server by endpoint (before adding) */
  async testConnectionByEndpoint(
    endpoint: string,
    apiKey?: string
  ): Promise<ServerTestResult> {
    return useRemoteServerStore.getState().testConnectionByEndpoint(endpoint, apiKey);
  }

  /**
   * Discover models from a server
   */
  async discoverModels(id: string): Promise<RemoteModel[]> {
    const store = useRemoteServerStore.getState();
    const server = store.getServerById(id);
    if (!server) throw new Error(`Server not found: ${id}`);

    return store.discoverModels(id);
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
  async setActiveRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    // Remote text replaces local text; it never stacks on top of a resident
    // heavyweight engine. Keep this lifecycle rule at the service boundary so
    // Home, Chat, onboarding, and reconnection cannot drift apart.
    await activeModelService.unloadTextModel();
    return setActiveRemoteTextModelImpl(serverId, modelId);
  }

  /** Set the active remote vision/image model */
  async setActiveRemoteImageModel(serverId: string, modelId: string): Promise<void> {
    return setActiveRemoteImageModelImpl(serverId, modelId);
  }

  /**
   * Clear active remote model (switch back to local)
   */
  clearActiveRemoteModel(): void {
    clearActiveRemoteModelSelection();
    logger.log('[RemoteServerManager] Cleared active remote model');
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
