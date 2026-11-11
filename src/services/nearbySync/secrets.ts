/**
 * API keys for offline sync: remote AI servers' keys and web search keys. They live in each
 * phone's secure keychain, never in app storage, so they travel separately here, inside the
 * same end-to-end encrypted message between paired devices only. On arrival they go straight
 * back into the keychain. The newer key wins (noticed by a key changing, tracked by a one-way
 * hash, never the key itself).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { sha256 } from 'js-sha256';

const STAMPS = 'atlas-sync-secret-stamps-v1';
const SEARCH = ['exa', 'parallel', 'tavily'] as const;
const ID = /^[\w.-]{1,160}$/;

export interface SecretEntry { key: string; changedAt: number }
export type SecretSnapshot = Record<string, SecretEntry>;
type Stamps = Record<string, { hash: string; changedAt: number }>;

const searchService = (p: string) => `ai.offgridmobile.search.${p}`;

async function readKeys(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const { useRemoteServerStore } = require('../../stores/remoteServerStore');
  const { getApiKeyImpl } = require('../remoteServerManagerUtils');
  for (const server of useRemoteServerStore.getState().servers as { id: string }[]) {
    if (!ID.test(server.id)) continue;
    const key = await getApiKeyImpl(server.id).catch(() => null);
    if (key) out[`server:${server.id}`] = key;
  }
  for (const p of SEARCH) {
    try {
      const found = await Keychain.getGenericPassword({ service: searchService(p) });
      if (found && found.password) out[`search:${p}`] = found.password;
    } catch { /* keychain unavailable: skip */ }
  }
  return out;
}

async function readStamps(): Promise<Stamps> {
  try { return JSON.parse((await AsyncStorage.getItem(STAMPS)) ?? '{}'); } catch { return {}; }
}

/** This phone's API keys, each with when it last changed. */
export async function localSecrets(now = Date.now()): Promise<SecretSnapshot> {
  const keys = await readKeys();
  const stamps = await readStamps();
  const out: SecretSnapshot = {};
  for (const [name, key] of Object.entries(keys)) {
    const hash = sha256(key);
    if (stamps[name]?.hash !== hash) stamps[name] = { hash, changedAt: now };
    out[name] = { key, changedAt: stamps[name].changedAt };
  }
  await AsyncStorage.setItem(STAMPS, JSON.stringify(stamps));
  return out;
}

/** Puts the other phone's keys into this phone's keychain where they are newer or missing here. */
export async function applySecrets(remote: unknown): Promise<string[]> {
  if (!remote || typeof remote !== 'object') return [];
  const mine = await localSecrets();
  const stamps = await readStamps();
  const { useRemoteServerStore } = require('../../stores/remoteServerStore');
  const { storeApiKeyImpl, createProviderForServerImpl } = require('../remoteServerManagerUtils');
  const changed: string[] = [];
  for (const [name, entry] of Object.entries(remote as Record<string, SecretEntry>)) {
    if (typeof entry?.key !== 'string' || !entry.key || entry.key.length > 4096 || typeof entry.changedAt !== 'number') continue;
    if (mine[name]?.key === entry.key || (mine[name] && mine[name].changedAt >= entry.changedAt)) continue;
    const [kind, id] = name.split(':');
    if (!ID.test(id ?? '')) continue;
    if (kind === 'server') {
      const server = useRemoteServerStore.getState().servers.find((s: { id: string }) => s.id === id);
      if (!server) continue;
      await storeApiKeyImpl(id, entry.key);
      await createProviderForServerImpl(server).catch(() => undefined);
    } else if (kind === 'search' && (SEARCH as readonly string[]).includes(id)) {
      const { useSearchSettings } = require('../tools/webSearchProviders');
      useSearchSettings.getState().setKey(id, entry.key);
    } else continue;
    stamps[name] = { hash: sha256(entry.key), changedAt: entry.changedAt };
    changed.push(name);
  }
  await AsyncStorage.setItem(STAMPS, JSON.stringify(stamps));
  return changed;
}
