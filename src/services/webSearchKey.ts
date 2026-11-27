/**
 * The person's own web search key (Brave Search API or Tavily), kept in the device Keychain and never in
 * app settings or backups. One item per provider, so switching providers keeps each key.
 */
import * as Keychain from 'react-native-keychain';
import { webSearchKeyName, type WebSearchProviderId } from '@offgrid/models';

const KEYCHAIN_SERVICE = 'ai.offgridmobile.websearch';

const serviceFor = (provider: WebSearchProviderId) => `${KEYCHAIN_SERVICE}.${provider}`;

export async function saveWebSearchKey(provider: WebSearchProviderId, key: string): Promise<void> {
  await Keychain.setGenericPassword(webSearchKeyName(provider), key, {
    service: serviceFor(provider),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

export async function getWebSearchKey(provider: WebSearchProviderId): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({ service: serviceFor(provider) });
  return credentials ? credentials.password : null;
}

export async function removeWebSearchKey(provider: WebSearchProviderId): Promise<void> {
  await Keychain.resetGenericPassword({ service: serviceFor(provider) });
}
