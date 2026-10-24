import { videoModelDisplayName } from '../utils/modelHelpers';
import type {
  RemoteModelCategory,
  RemoteModelOption,
  RemoteServer,
} from '../types';
import { displayModelName } from '../stores/remoteServerHelpers';

export interface RemoteServerModelOption extends RemoteModelOption {
  serverId: string;
  serverName: string;
}

function configuredOption(
  server: RemoteServer,
  category: RemoteModelCategory,
): RemoteModelOption[] {
  const selectedId = server.mediaModels?.[category]?.trim();
  if (!selectedId) return [];
  return [{ id: selectedId, name: displayModelName(selectedId) }];
}

/**
 * Project the server-reported catalogue into picker rows. A manually configured
 * model remains selectable when the server does not publish model kinds.
 */
export function remoteServerModelOptions(
  servers: RemoteServer[],
  category: RemoteModelCategory,
): RemoteServerModelOption[] {
  return servers
    .filter(
      server =>
        category !== 'video' || server.modelManagement === 'offgrid-desktop-v1',
    )
    .flatMap(server => {
      const reported = server.modelCatalog?.[category] ?? [];
      const options =
        reported.length > 0 ? reported : configuredOption(server, category);
      return options.map(option => ({
        ...option,
        name: category === 'video'
          ? videoModelDisplayName(option.id, option.name)
          : option.name,
        serverId: server.id,
        serverName: server.name,
      }));
    });
}

export function selectedRemoteModelName(
  server: RemoteServer | null | undefined,
  category: RemoteModelCategory,
): string | null {
  const selectedId = server?.mediaModels?.[category]?.trim();
  if (!server || !selectedId) return null;
  const name =
    server.modelCatalog?.[category]?.find(model => model.id === selectedId)
      ?.name ?? displayModelName(selectedId);
  return category === 'video' ? videoModelDisplayName(selectedId, name) : name;
}
