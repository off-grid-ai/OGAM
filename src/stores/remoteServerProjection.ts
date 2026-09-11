import { remoteServerModelOptions } from '@offgrid/application';
import type { RemoteModel, RemoteServer } from '../types';

/**
 * Discovered models are a READ of the server's catalog in the shape the UI expects. There is no
 * second stored copy. Capabilities stay evidence-based: an absent field means unknown, not "no".
 */
export function serverDiscoveredModels(server: RemoteServer): RemoteModel[] {
  return remoteServerModelOptions([server], 'text').map(option => ({
    id: option.id,
    name: option.name,
    serverId: option.serverId,
    capabilities: { ...option.capabilities } as RemoteModel['capabilities'],
    details: { serverName: option.serverName },
    lastUpdated: server.createdAt,
  }));
}

export function discoveredRemoteModels(servers: RemoteServer[]): Record<string, RemoteModel[]> {
  return Object.fromEntries(servers.map(server => [server.id, serverDiscoveredModels(server)]));
}
