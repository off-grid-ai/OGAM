import { searchRemoteComputer, type RemoteSearchOutcome } from '@offgrid/rag';
import type { RemoteServer } from '../types';
import { remoteServerManager } from './remoteServerManager';
import {
  REMOTE_FETCH_REDIRECT_POLICY,
  remoteAuthorizationHeaders,
} from './remoteTransportPolicy';

/** The paired Off Grid AI Desktop this phone searches: the active server when it is one, else the first. */
export function pairedComputer(
  servers: readonly RemoteServer[],
  activeServerId: string | null,
): RemoteServer | null {
  const computers = servers.filter(server => server.modelManagement === 'offgrid-desktop-v1');
  return computers.find(server => server.id === activeServerId) ?? computers[0] ?? null;
}

/** Search the paired computer with its saved key. A newer search aborts this one (the abort is rethrown). */
export async function searchPairedComputer(
  server: RemoteServer,
  query: string,
  signal: AbortSignal,
): Promise<RemoteSearchOutcome> {
  const apiKey = await remoteServerManager.getApiKey(server.id);
  return searchRemoteComputer({
    endpoint: server.endpoint,
    query,
    headers: remoteAuthorizationHeaders(server.endpoint, apiKey),
    signal,
    fetch: (url, init) => fetch(url, { ...init, redirect: REMOTE_FETCH_REDIRECT_POLICY }),
  });
}
