/**
 * Remote Server Manager — utilities extracted to keep remoteServerManager.ts under 350 lines.
 * Keychain helpers, capability detectors, provider creation, and long methods.
 */
import * as Keychain from 'react-native-keychain';
import type { RemoteServer } from '../types';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { createOpenAIProvider, OpenAICompatibleProvider } from './providers/openAICompatibleProvider';
import { providerRegistry } from './providers/registry';
import logger from '../utils/logger';

const KEYCHAIN_SERVICE = 'ai.offgridmobile.servers';

// ---------------------------------------------------------------------------
// Keychain helpers
// ---------------------------------------------------------------------------

export async function storeApiKeyImpl(serverId: string, apiKey: string): Promise<void> {
  try {
    await Keychain.setGenericPassword(
      `server_${serverId}`,
      apiKey,
      {
        service: `${KEYCHAIN_SERVICE}.${serverId}`,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      }
    );
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
    return null;
  }
}

export async function removeApiKeyImpl(serverId: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE}.${serverId}` });
    logger.log('[RemoteServerManager] API key removed for server:', serverId);
  } catch (error) {
    logger.error('[RemoteServerManager] Failed to remove API key:', error);
  }
}

// ---------------------------------------------------------------------------
// Capability detectors (pure)
// ---------------------------------------------------------------------------

export function detectVisionCapability(modelId: string): boolean {
  const patterns = [
    '-vl', 'vl-', ':vl',   // common VL naming (qwen3-vl, llava, etc.)
    'vision', 'llava', 'bakllava', 'moondream', 'cogvlm',
    'cogagent', 'fuyu', 'idefics', 'qwen-vl', 'gpt-4-vision',
    'gpt-4o', 'claude-3', 'gemini', 'pixtral', 'phi-3.5-vision',
    'minicpm-v', 'internvl', 'yi-vl',
  ];
  return patterns.some(p => modelId.toLowerCase().includes(p));
}

export function detectToolCallingCapability(modelId: string): boolean {
  const patterns = [
    'gpt-4', 'gpt-3.5-turbo', 'claude', 'gemini', 'mistral',
    'qwen', 'llama-3', 'command-r', 'dbrx', 'firefunction',
  ];
  const lower = modelId.toLowerCase();
  if (patterns.some(p => lower.includes(p))) return true;
  if (lower.includes('tool') || lower.includes('function')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Provider creation
// ---------------------------------------------------------------------------

export async function createProviderForServerImpl(server: RemoteServer): Promise<void> {
  const apiKey = await getApiKeyImpl(server.id);
  logger.log('[RemoteServerManager] createProvider:', server.name, '| endpoint:', server.endpoint, '| hasApiKey:', !!apiKey);
  const provider = createOpenAIProvider(server.id, server.endpoint, { apiKey: apiKey || undefined });
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
  logger.log('[RemoteServerManager] setActiveRemoteTextModel called:', { serverId, modelId });

  store.setActiveServerId(serverId);
  store.setActiveRemoteTextModelId(modelId);

  let provider = providerRegistry.getProvider(serverId);
  if (!provider) {
    const server = store.getServerById(serverId);
    if (server) {
      logger.log('[RemoteServerManager] Creating provider for server:', serverId, server.endpoint);
      await createProviderForServerImpl(server);
      provider = providerRegistry.getProvider(serverId);
    }
  }

  if (provider) {
    logger.log('[RemoteServerManager] Loading model on provider:', modelId);
    await provider.loadModel(modelId);
    // Apply authoritative vision capability from discovery results
    const discoveredModel = store.getModelById(serverId, modelId);
    if (discoveredModel && provider instanceof OpenAICompatibleProvider) {
      provider.updateCapabilities({
        supportsVision: discoveredModel.capabilities.supportsVision,
        supportsThinking: discoveredModel.capabilities.supportsThinking,
        acceptsThinkingKwarg: discoveredModel.capabilities.acceptsThinkingKwarg,
      });
      logger.log('[RemoteServerManager] Applied discovered capabilities for', modelId, '— supportsVision:', discoveredModel.capabilities.supportsVision, 'supportsThinking:', discoveredModel.capabilities.supportsThinking, 'acceptsThinkingKwarg:', discoveredModel.capabilities.acceptsThinkingKwarg);
    }
    providerRegistry.setActiveProvider(serverId);
    logger.log('[RemoteServerManager] Provider ready:', await provider.isReady());
  } else {
    logger.warn('[RemoteServerManager] Could not create provider for server:', serverId);
  }

  logger.log('[RemoteServerManager] Active remote text model set:', serverId, modelId);
}

export async function setActiveRemoteImageModelImpl(
  serverId: string,
  modelId: string,
): Promise<void> {
  const store = useRemoteServerStore.getState();
  store.setActiveServerId(serverId);
  store.setActiveRemoteImageModelId(modelId);

  let provider = providerRegistry.getProvider(serverId);
  if (!provider) {
    const server = store.getServerById(serverId);
    if (server) {
      logger.log('[RemoteServerManager] Creating provider for server:', serverId);
      await createProviderForServerImpl(server);
      provider = providerRegistry.getProvider(serverId);
    }
  }

  if (provider) {
    await provider.loadModel(modelId);
  } else {
    logger.warn('[RemoteServerManager] Could not create provider for server:', serverId);
  }

  logger.log('[RemoteServerManager] Active remote image model set:', serverId, modelId);
}

// ---------------------------------------------------------------------------
// Bulk initialization
// ---------------------------------------------------------------------------

export async function initializeProvidersImpl(
  getServers: () => RemoteServer[],
): Promise<void> {
  const servers = getServers();
  const store = useRemoteServerStore.getState();
  logger.log('[RemoteServerManager] Initializing providers for', servers.length, 'servers');

  for (const server of servers) {
    try {
      await createProviderForServerImpl(server);
      // Re-discover models on startup to refresh capability data from the server
      // (persisted data may be stale if models were added/removed while offline)
      try {
        const models = await store.discoverModels(server.id);
        logger.log('[RemoteServerManager] Discovered', models.length, 'models for', server.name);
      } catch (discoverError) {
        logger.warn('[RemoteServerManager] Failed to discover models for', server.name, discoverError);
      }
    } catch (error) {
      logger.error('[RemoteServerManager] Failed to initialize provider for', server.name, error);
    }
  }

  // Restore active remote model selection if persisted.
  // Re-read from the store to detect if the user already made a different
  // selection while we were fetching models in the background.
  const currentStore = useRemoteServerStore.getState();
  const activeServerId = currentStore.activeServerId;
  const activeRemoteTextModelId = currentStore.activeRemoteTextModelId;

  if (activeServerId && activeRemoteTextModelId) {
    logger.log('[RemoteServerManager] Restoring active remote model:', activeRemoteTextModelId, 'on server:', activeServerId);
    try {
      await setActiveRemoteTextModelImpl(activeServerId, activeRemoteTextModelId);
      logger.log('[RemoteServerManager] Successfully restored remote model selection');
    } catch (error) {
      logger.error('[RemoteServerManager] Failed to restore remote model selection:', error);
    }
  }
}

