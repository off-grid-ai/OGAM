import { useMemo } from 'react';
import { discoveredRemoteModels } from '../stores/remoteServerProjection';
import type { RemoteModel, RemoteServer } from '../types';
import { useModelsProjection } from './useApplicationProjection';

/** Reactive read of every server's discovered text models, derived from the server catalogs. */
export function useDiscoveredRemoteModels(): Record<string, RemoteModel[]> {
  const servers = useModelsProjection().servers;
  return useMemo(
    () => discoveredRemoteModels(servers as RemoteServer[]),
    [servers],
  );
}
