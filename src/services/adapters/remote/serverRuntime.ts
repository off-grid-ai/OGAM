/** Native and provider I/O ports for Shared remote-server application logic. */
import * as Keychain from 'react-native-keychain';
import type { PersistedRemoteServer } from '@offgrid/models';
import { remoteAuthorizationHeaders } from '@offgrid/models';
import { createOpenAITransport } from '../providers/openAICompatibleProvider';
import { remoteTextTransportRegistry } from '../providers/registry';
import logger from '../../../utils/logger';

const KEYCHAIN_SERVICE = 'ai.offgridmobile.servers';

export async function storeApiKeyImpl(serverId: string, apiKey: string): Promise<void> {
  await Keychain.setGenericPassword(`server_${serverId}`, apiKey, {
    service: `${KEYCHAIN_SERVICE}.${serverId}`,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

export async function getApiKeyImpl(serverId: string): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({
    service: `${KEYCHAIN_SERVICE}.${serverId}`,
  });
  return credentials ? credentials.password : null;
}

export async function removeApiKeyImpl(serverId: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE}.${serverId}` });
}

export {
  detectRemoteVisionCapability as detectVisionCapability,
} from '@offgrid/models';

export async function createProviderForServerImpl(
  server: PersistedRemoteServer,
  suppliedApiKey?: string | null,
): Promise<void> {
  const apiKey = suppliedApiKey === undefined ? await getApiKeyImpl(server.id) : suppliedApiKey;
  const authorization = remoteAuthorizationHeaders(server.endpoint, apiKey);
  remoteTextTransportRegistry.register(
    server.id,
    createOpenAITransport(server.id, server.endpoint, {
      apiKey: authorization.Authorization?.replace(/^Bearer /, ''),
    }),
  );
  logger.log('[RemoteServerAdapter] Provider registered:', server.id);
}
