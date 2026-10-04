import { modelsFailureMessage, type ModelsFailure } from '@offgrid/application';
import type { RemoteModel, RemoteModelCategory, RemoteServer, ServerTestResult } from '../../types';
import { testEndpointAndGetModels } from '../composition/remote';
import { getApiKeyImpl, storeApiKeyImpl } from '../adapters/remote/serverRuntime';
import { applicationFacade } from '../applicationFacade';
import { selectCanonicalModel } from './modelSelectionCommandPort';
import { mobileRouteId } from './mobileRoute';
import { shouldRecoverRemoteServers } from './remoteServerApplication';

class RemoteServerOperationError extends Error {
  constructor(readonly failure: ModelsFailure) {
    super(modelsFailureMessage(failure));
    this.name = 'RemoteServerOperationError';
  }
}

function requireSuccess<T>(outcome: { ok: true; value: T } | { ok: false; failure: ModelsFailure }): T {
  if (!outcome.ok) throw new RemoteServerOperationError(outcome.failure);
  return outcome.value;
}

/** Thin Mobile facade. Shared owns every remote-server decision and transaction. */
class RemoteServerManager {
  async addServer(
    config: Omit<RemoteServer, 'id' | 'createdAt'> & { apiKey?: string },
  ): Promise<RemoteServer> {
    const { apiKey, ...server } = config;
    const outcome = await applicationFacade().models.saveRemoteServer({
      ...server, createdAt: new Date().toISOString(), credential: apiKey,
    });
    return requireSuccess(outcome) as RemoteServer;
  }

  async updateServer(
    id: string,
    updates: Partial<Omit<RemoteServer, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const existing = applicationFacade().models.remoteServer(id);
    if (!existing) throw new Error(`Server not found: ${id}`);
    const { apiKey, ...publicUpdates } = updates;
    const outcome = await applicationFacade().models.saveRemoteServer({
      ...existing, ...publicUpdates, id,
      credential: apiKey || undefined, clearCredential: apiKey === '',
    });
    requireSuccess(outcome);
  }

  removeServer(id: string): Promise<void> { return applicationFacade().models.removeRemoteServer(id); }
  getServers(): RemoteServer[] {
    return [...applicationFacade().models.snapshot().servers] as RemoteServer[];
  }
  getServer(id: string): RemoteServer | null {
    return applicationFacade().models.remoteServer(id) as RemoteServer | null;
  }

  async getServerWithApiKey(id: string): Promise<(RemoteServer & { apiKey?: string }) | null> {
    const server = this.getServer(id);
    if (!server) return null;
    const apiKey = await this.getApiKey(id);
    return { ...server, apiKey: apiKey ?? undefined };
  }

  async testConnection(id: string): Promise<ServerTestResult> {
    return applicationFacade().models.checkRemoteServer(id) as Promise<ServerTestResult>;
  }
  testConnectionByEndpoint(endpoint: string, apiKey?: string): Promise<ServerTestResult> {
    return testEndpointAndGetModels(endpoint, apiKey);
  }
  async discoverModels(id: string): Promise<RemoteModel[]> {
    const outcome = await applicationFacade().models.discoverRemoteServers(id);
    return (requireSuccess(outcome).models ?? []) as RemoteModel[];
  }

  setActiveRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    return selectCanonicalModel('text', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'text', modelId,
    }));
  }
  async prepareRemoteTextModel(serverId: string, modelId: string): Promise<void> {
    requireSuccess(await applicationFacade().models.prepareRemoteServer(serverId, 'text', modelId));
  }
  setActiveRemoteImageModel(serverId: string, modelId: string): Promise<void> {
    return selectCanonicalModel('image', mobileRouteId({
      source: 'remote', hostId: serverId, modality: 'image', modelId,
    }));
  }
  setActiveRemoteMediaModel(
    serverId: string, category: Exclude<RemoteModelCategory, 'text'>, modelId: string,
  ): Promise<void> {
    return selectCanonicalModel(category, mobileRouteId({
      source: 'remote', hostId: serverId, modality: category, modelId,
    }));
  }
  async prepareRemoteMediaModel(
    serverId: string, category: Exclude<RemoteModelCategory, 'text'>, modelId: string,
  ): Promise<void> {
    requireSuccess(
      await applicationFacade().models.prepareRemoteServer(serverId, category, modelId),
    );
  }
  clearActiveRemoteTextModel(): Promise<void> { return selectCanonicalModel('text', null); }
  clearActiveRemoteMediaModel(category: Exclude<RemoteModelCategory, 'text'>): Promise<void> {
    return selectCanonicalModel(category, null);
  }
  async initializeProviders(): Promise<void> {
    requireSuccess(await applicationFacade().models.initializeRemoteServers());
  }

  async scanAndReconcile(
    onFound?: (server: { endpoint: string; name: string }) => void,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{
    moved: string[];
    found: Array<{ endpoint: string; name: string; type: 'gateway' }>;
  }> {
    const outcome = await applicationFacade().models.reconcileRemoteServers({ onFound, onProgress });
    const result = requireSuccess(outcome);
    return { ...result, found: result.found.map(server => ({ ...server, type: 'gateway' })) };
  }
  async recoverActiveConnection(): Promise<void> {
    requireSuccess(
      await applicationFacade().models.recoverRemoteServers(shouldRecoverRemoteServers()),
    );
  }
  async clearAllServers(): Promise<void> {
    for (const server of this.getServers()) await this.removeServer(server.id);
  }
  storeApiKey(serverId: string, apiKey: string): Promise<void> {
    return storeApiKeyImpl(serverId, apiKey);
  }
  getApiKey(serverId: string): Promise<string | null> { return getApiKeyImpl(serverId); }
}

export const remoteServerManager = new RemoteServerManager();
