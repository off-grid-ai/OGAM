/**
 * API keys go across in offline sync: two phones are played by swapping the keychain and
 * storage (the device boundary). A key missing on the other phone arrives in its keychain;
 * a key changed more recently on this phone is not overwritten by an older one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockChain = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED: 'w' },
  setGenericPassword: jest.fn(async (_u: string, p: string, o: { service: string }) => { mockChain.set(o.service, p); return true; }),
  getGenericPassword: jest.fn(async (o: { service: string }) => (mockChain.has(o.service) ? { username: 'u', password: mockChain.get(o.service) } : false)),
  resetGenericPassword: jest.fn(async (o: { service: string }) => { mockChain.delete(o.service); return true; }),
}));

import { applySecrets, localSecrets } from '../../../src/services/nearbySync/secrets';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { useSearchSettings } from '../../../src/services/tools/webSearchProviders';

const server = { id: 'srv-1', name: 'Home server', endpoint: 'http://192.168.1.5:11434', providerType: 'openai-compatible', createdAt: '2026-01-01T00:00:00.000Z' };

async function phone(keys: Record<string, string>) {
  await AsyncStorage.clear();
  mockChain = new Map(Object.entries(keys));
  useRemoteServerStore.setState({ servers: [server] } as never);
}

it('sends the remote server and web search keys to the other phone\'s keychain', async () => {
  await phone({ 'ai.offgridmobile.servers.srv-1': 'sk-from-a', 'ai.offgridmobile.search.tavily': 'tvly-a' });
  const fromA = await localSecrets(1000);
  expect(Object.keys(fromA).sort()).toEqual(['search:tavily', 'server:srv-1']);

  await phone({});
  expect((await applySecrets(fromA)).sort()).toEqual(['search:tavily', 'server:srv-1']);
  expect(mockChain.get('ai.offgridmobile.servers.srv-1')).toBe('sk-from-a');
  expect(useSearchSettings.getState().keys.tavily).toBe('tvly-a');
});

it('keeps a key changed more recently on this phone', async () => {
  await phone({ 'ai.offgridmobile.servers.srv-1': 'sk-old' });
  const fromA = await localSecrets(1000);
  await phone({ 'ai.offgridmobile.servers.srv-1': 'sk-new' });
  await localSecrets(5000);
  expect(await applySecrets(fromA)).toEqual([]);
  expect(mockChain.get('ai.offgridmobile.servers.srv-1')).toBe('sk-new');
});
