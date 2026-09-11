// Composition root: shared remote discovery services over Mobile's HTTP and device ports.
import {
  detectRemoteToolCallingCapability,
  detectRemoteVisionCapability,
  once,
  projectRemoteTextModels,
  RemoteCapabilityDiscoveryApplicationService,
  RemoteLanDiscoveryApplicationService,
  RemoteProviderDiscoveryApplicationService,
  remoteLanScanKinds,
  type RemoteTextDiscoveryCandidate,
} from '@offgrid/models';
import type { RemoteModel, RemoteServer, ServerTestResult } from '../../types';
import logger from '../../utils/logger';
import { applicationFacade } from '../applicationFacade';
import {
  mobileRemoteCapabilityPorts,
  type RemoteModelInfo,
} from '../adapters/remote/modelCapabilityDiscovery';
import {
  mobileRemoteProviderDiscoveryPorts,
  RemoteModelDiscoveryError,
} from '../adapters/remote/serverDiscovery';
import {
  mobileLanDiscoveryPorts,
  type DiscoveredServer,
} from '../networkDiscovery';

const remoteCapabilityDiscovery = once(
  () =>
    new RemoteCapabilityDiscoveryApplicationService(
      mobileRemoteCapabilityPorts(),
    ),
);

async function mapTextModels(input: {
  candidates: readonly RemoteTextDiscoveryCandidate[];
  capabilityBaseUrl: string;
  serverId: string;
}): Promise<RemoteModel[]> {
  const probedEntries = await Promise.all(
    input.candidates.map(
      async candidate =>
        [
          candidate.id,
          await fetchModelCapabilities(input.capabilityBaseUrl, candidate.id, {
            vision: detectRemoteVisionCapability,
            toolCalling: detectRemoteToolCallingCapability,
          }),
        ] as const,
    ),
  );
  return projectRemoteTextModels({
    candidates: input.candidates,
    serverId: input.serverId,
    probed: new Map(probedEntries),
    now: new Date().toISOString(),
  });
}

const remoteProviderDiscovery = once(
  () =>
    new RemoteProviderDiscoveryApplicationService(
      mobileRemoteProviderDiscoveryPorts(mapTextModels),
    ),
);
const remoteLanDiscovery = once(
  () => new RemoteLanDiscoveryApplicationService(mobileLanDiscoveryPorts()),
);

function fetchModelCapabilities(
  endpoint: string,
  modelId: string,
  nameBasedDetect: {
    vision: (id: string) => boolean;
    toolCalling: (id: string) => boolean;
  },
): Promise<RemoteModelInfo> {
  return remoteCapabilityDiscovery().discover({
    endpoint,
    modelId,
    fallbackVision: nameBasedDetect.vision(modelId),
    fallbackToolCalling: nameBasedDetect.toolCalling(modelId),
  });
}

async function discoverServer(server: RemoteServer): Promise<ServerTestResult> {
  const result = await remoteProviderDiscovery().discover({
    serverId: server.id,
    endpoint: server.endpoint,
    apiKey: server.apiKey,
    expectedModelManagement: server.modelManagement,
  });
  return {
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    latency: result.latency,
    models: result.models,
    selections: result.selections,
    catalog: result.catalog,
    modelManagement: result.modelManagement,
    serverInfo: result.serverInfo,
  };
}

export async function testServerConnection(
  server: RemoteServer,
): Promise<ServerTestResult> {
  try {
    return await discoverServer(server);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function testEndpointAndGetModels(
  endpoint: string,
  apiKey?: string,
): Promise<ServerTestResult> {
  return testServerConnection({
    id: 'temp',
    name: 'temp',
    endpoint,
    provider: 'openai-compatible',
    createdAt: new Date().toISOString(),
    apiKey,
  });
}

export async function fetchModelsFromServer(
  server: RemoteServer,
): Promise<RemoteModel[]> {
  const result = await discoverServer(server);
  if (!result.success) {
    throw new RemoteModelDiscoveryError(
      result.error ?? 'Remote server model discovery failed.',
    );
  }
  return result.models ?? [];
}

export function discoverLANServers(
  onLog?: (message: string) => void,
  onFound?: (server: DiscoveredServer) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<DiscoveredServer[]> {
  return remoteLanDiscovery().discover(
    message => {
      logger.warn('[Discovery]', message);
      onLog?.(message);
    },
    onFound,
    {
      kinds: remoteLanScanKinds(applicationFacade().models.settings.current()),
      onProgress,
    },
  );
}
