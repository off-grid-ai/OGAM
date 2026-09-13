/**
 * Remote Server Manager — utilities extracted to keep remoteServerManager.ts under 350 lines.
 * Keychain helpers, capability detectors, provider creation, and long methods.
 */
import * as Keychain from 'react-native-keychain';
import type { RemoteServer } from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import {
  createOpenAIProvider,
  OpenAICompatibleProvider,
} from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import { capabilitiesUnknown } from '../stores/remoteModelCapabilities';
import logger from '../utils/logger';
import { remoteAuthorizationHeaders } from './remoteTransportPolicy';
import { activateOffGridDesktopModel } from './offGridDesktopModels';

const KEYCHAIN_SERVICE = 'ai.offgridmobile.servers';

// ---------------------------------------------------------------------------
// Keychain helpers
// ---------------------------------------------------------------------------

export async function storeApiKeyImpl(
  serverId: string,
  apiKey: string,
): Promise<void> {
  try {
    await Keychain.setGenericPassword(`server_${serverId}`, apiKey, {
      service: `${KEYCHAIN_SERVICE}.${serverId}`,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
    });
    logger.log('[RemoteServerManager] API key stored for server:', serverId);
  } catch (error) {
    logger.error('[RemoteServerManager] Failed to store API key:', error);
    throw error;
  }
}

export async function getApiKeyImpl(serverId: string): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({
      service: `${KEYCHAIN_SERVICE}.${serverId}`,
    });
    return credentials ? credentials.password : null;
  } catch (error) {
    logger.error('[RemoteServerManager] Failed to get API key:', error);
    throw error;
  }
}

export async function removeApiKeyImpl(serverId: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({
      service: `${KEYCHAIN_SERVICE}.${serverId}`,
    });
    logger.log('[RemoteServerManager] API key removed for server:', serverId);
  } catch (error) {
    logger.error('[RemoteServerManager] Failed to remove API key:', error);
  }
}

// ---------------------------------------------------------------------------
// Capability detectors (pure)
// ---------------------------------------------------------------------------

// The pure capability detectors live in utils/remoteCapabilityDetect so the store layer can import
// them without depending on this (store-touching) service — that was a cycle. Re-exported here.
export {
  detectVisionCapability,
  detectToolCallingCapability,
} from '../utils/remoteCapabilityDetect';

// ---------------------------------------------------------------------------
// Provider creation
// ---------------------------------------------------------------------------

export async function createProviderForServerImpl(
  server: RemoteServer,
): Promise<void> {
  const apiKey = await getApiKeyImpl(server.id);
  logger.log(
    '[RemoteServerManager] createProvider:',
    server.name,
    '| endpoint:',
    server.endpoint,
    '| hasApiKey:',
    !!apiKey,
  );
  const authorization = remoteAuthorizationHeaders(server.endpoint, apiKey);
  const provider = createOpenAIProvider(server.id, server.endpoint, {
    apiKey: authorization.Authorization?.replace(/^Bearer /, ''),
  });
  providerRegistry.registerProvider(server.id, provider);
}

// ---------------------------------------------------------------------------
// Active model setters
// ---------------------------------------------------------------------------

export async function setActiveRemoteTextModelImpl(
  serverId: string,
  modelId: string,
): Promise<void> {
  const store = useRemoteServerStore.getState();
  logger.log('[RemoteServerManager] setActiveRemoteTextModel called:', {
    serverId,
    modelId,
  });

  const configuredServer = store.getServerById(serverId);
  if (!configuredServer) throw new Error(`Server not found: ${serverId}`);
  const desktopManaged =
    configuredServer.modelManagement === 'offgrid-desktop-v1';
  const confirmedModels =
    desktopManaged
      ? await activateOffGridDesktopModel(
          {
            ...configuredServer,
            apiKey: (await getApiKeyImpl(serverId)) ?? undefined,
          },
          'text',
          modelId,
        )
      : { ...configuredServer.mediaModels, text: modelId };
  if (!desktopManaged) {
    // Generic servers keep the existing publish-first behavior. New-chat local
    // preparation uses these IDs to avoid starting the prior local model.
    store.setActiveRemoteTextModelId(modelId);
    store.setActiveServerId(serverId);
    if (configuredServer.mediaModels?.text !== modelId) {
      store.updateServer(serverId, { mediaModels: confirmedModels });
    }
  }

  let provider = providerRegistry.getProvider(serverId);
  if (!provider) {
    logger.log(
      '[RemoteServerManager] Creating provider for server:',
      serverId,
      configuredServer.endpoint,
    );
    await createProviderForServerImpl(configuredServer);
    provider = providerRegistry.getProvider(serverId);
  }

  if (provider) {
    logger.log('[RemoteServerManager] Loading model on provider:', modelId);
    await provider.loadModel(modelId);
    // Apply the discovered capabilities. A record that says the model can do NOTHING is the shape a
    // failed probe leaves behind, and it is stored exactly like a real answer - so the thinking
    // toggle stayed hidden and the kwarg was never sent, for the life of the install, because of one
    // timeout at discovery. Ask again before believing a no.
    let discoveredModel = store.getModelById(serverId, modelId);
    if (!discoveredModel || capabilitiesUnknown(discoveredModel.capabilities)) {
      logger.log(
        '[RemoteServerManager] Capabilities unknown for',
        modelId,
        '— re-discovering',
      );
      try {
        await store.discoverModels(serverId);
        discoveredModel = store.getModelById(serverId, modelId);
      } catch (e) {
        logger.warn(
          '[RemoteServerManager] Re-discovery failed, using what we have:',
          e,
        );
      }
    }
    if (discoveredModel && provider instanceof OpenAICompatibleProvider) {
      provider.updateCapabilities({
        supportsVision: discoveredModel.capabilities.supportsVision,
        supportsToolCalling: discoveredModel.capabilities.supportsToolCalling,
        supportsThinking: discoveredModel.capabilities.supportsThinking,
        thinkingLevelsOnly: discoveredModel.capabilities.thinkingLevelsOnly,
        acceptsThinkingKwarg: discoveredModel.capabilities.acceptsThinkingKwarg,
      });
      logger.log(
        '[RemoteServerManager] Applied discovered capabilities for',
        modelId,
        '— supportsVision:',
        discoveredModel.capabilities.supportsVision,
        'supportsThinking:',
        discoveredModel.capabilities.supportsThinking,
        'acceptsThinkingKwarg:',
        discoveredModel.capabilities.acceptsThinkingKwarg,
      );
    }
    providerRegistry.setActiveProvider(serverId);
    logger.log(
      '[RemoteServerManager] Provider ready:',
      await provider.isReady(),
    );
  } else {
    logger.warn(
      '[RemoteServerManager] Could not create provider for server:',
      serverId,
    );
    if (desktopManaged) {
      throw new Error('The Desktop model provider could not be prepared.');
    }
  }

  // Commit Mobile state only after Desktop has confirmed activation and the
  // provider is ready. A failed activation leaves the prior selection intact.
  if (desktopManaged) {
    store.updateServer(serverId, { mediaModels: confirmedModels });
    store.setActiveRemoteTextModelId(modelId);
    store.setActiveServerId(serverId);
  }

  logger.log(
    '[RemoteServerManager] Active remote text model set:',
    serverId,
    modelId,
  );
}

export async function setActiveRemoteImageModelImpl(
  serverId: string,
  modelId: string,
): Promise<void> {
  const store = useRemoteServerStore.getState();
  store.setActiveRemoteMediaServerId('image', serverId);
  store.setActiveRemoteImageModelId(modelId);

  let provider = providerRegistry.getProvider(serverId);
  if (!provider) {
    const server = store.getServerById(serverId);
    if (server) {
      logger.log(
        '[RemoteServerManager] Creating provider for server:',
        serverId,
      );
      await createProviderForServerImpl(server);
      provider = providerRegistry.getProvider(serverId);
    }
  }

  if (provider) {
    await provider.loadModel(modelId);
  } else {
    logger.warn(
      '[RemoteServerManager] Could not create provider for server:',
      serverId,
    );
  }

  logger.log(
    '[RemoteServerManager] Active remote image model set:',
    serverId,
    modelId,
  );
}

// ---------------------------------------------------------------------------
// Bulk initialization
// ---------------------------------------------------------------------------

export async function initializeProvidersImpl(
  getServers: () => RemoteServer[],
): Promise<void> {
  const servers = getServers();
  const store = useRemoteServerStore.getState();
  logger.log(
    '[RemoteServerManager] Initializing providers for',
    servers.length,
    'servers',
  );

  for (const server of servers) {
    try {
      // One-time migration from builds that wrote the key into AsyncStorage. Move it into Keychain,
      // then rewrite the public server record without the credential.
      if (server.apiKey) {
        await storeApiKeyImpl(server.id, server.apiKey);
        store.updateServer(server.id, { apiKey: undefined });
      }
      await createProviderForServerImpl(server);
      // Re-discover models on startup to refresh capability data from the server
      // (persisted data may be stale if models were added/removed while offline)
      try {
        const models = await store.discoverModels(server.id);
        logger.log(
          '[RemoteServerManager] Discovered',
          models.length,
          'models for',
          server.name,
        );
      } catch (discoverError) {
        logger.warn(
          '[RemoteServerManager] Failed to discover models for',
          server.name,
          discoverError,
        );
      }
    } catch (error) {
      logger.error(
        '[RemoteServerManager] Failed to initialize provider for',
        server.name,
        error,
      );
    }
  }

  // Restore active remote model selection if persisted.
  // Re-read from the store to detect if the user already made a different
  // selection while we were fetching models in the background.
  const currentStore = useRemoteServerStore.getState();
  const activeServerId = currentStore.activeServerId;
  const activeRemoteTextModelId = currentStore.activeRemoteTextModelId;

  if (activeServerId && activeRemoteTextModelId) {
    logger.log(
      '[RemoteServerManager] Restoring active remote model:',
      activeRemoteTextModelId,
      'on server:',
      activeServerId,
    );
    try {
      await setActiveRemoteTextModelImpl(
        activeServerId,
        activeRemoteTextModelId,
      );
      logger.log(
        '[RemoteServerManager] Successfully restored remote model selection',
      );
    } catch (error) {
      logger.error(
        '[RemoteServerManager] Failed to restore remote model selection:',
        error,
      );
    }
  }
}
