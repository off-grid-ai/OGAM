// Composition root: the port-driven Remote Server Editor use case over Mobile's stores and manager.
import { activeMobileRoute } from '../modelServices/mobileLLMService';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { createRemoteServerEditorApplication } from '../modelServices/remoteServerEditorApplication';
import { remoteServerManager } from '../modelServices/remoteServerController';
import { selectRemoteMobileModel } from '../modelServices/selectionCommands';

export const remoteServerEditorApplication = createRemoteServerEditorApplication({
  credentials: { read: serverId => remoteServerManager.getApiKey(serverId) },
  servers: {
    add: input => remoteServerManager.addServer(input),
    update: (id, input) => remoteServerManager.updateServer(id, input),
    testCandidate: (endpoint, apiKey) =>
      remoteServerManager.testConnectionByEndpoint(endpoint, apiKey),
    testSaved: serverId => remoteServerManager.testConnection(serverId),
  },
  models: {
    project: (serverId, models) =>
      useRemoteServerStore.getState().setDiscoveredModels(serverId, models),
    select: (serverId, modality, modelId) =>
      selectRemoteMobileModel(serverId, modality, modelId),
  },
  activeServerId: () => activeMobileRoute('text').model?.serverId ?? null,
});
