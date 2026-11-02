import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

function portableCrypto() {
  const mod = NativeModules.AtlasDevice;
  if (Platform.OS !== 'android' || !mod?.encryptPortableBackup || !mod?.decryptPortableBackup) {
    throw new Error('Portable encrypted backups require the updated Android Atlas build.');
  }
  return mod as { encryptPortableBackup(text: string, password: string): Promise<string>; decryptPortableBackup(text: string, password: string): Promise<string> };
}
import RNFS from 'react-native-fs';
import { pick, saveDocuments, types } from '@react-native-documents/picker';
import { resolvePickedFileUri } from '../utils/resolvePickedFileUri';
import { collectProjectFiles, restoreProjectFiles } from './projectBackupFiles';
import type { ProjectBackupFile } from './projectBackupFiles';
import { rehydrateStores } from './storeRegistry';
import { keepThisDevice } from './deviceSettings';
import { useBackupReminder } from './backupReminder';

/**
 * Backup = every saved app setting in one JSON file: agents and their lessons, projects,
 * chats, learning history, voice and search settings, app settings.
 * Password-encrypted archives include project knowledge-base files and searchable chunks.
 * Plain JSON exports omit private content, project documents and downloaded models.
 */
const MAGIC = 'OffGridAtlasBackup';
// Explicit persistent-store allowlist also permits restore on a fresh install.
// Add other reviewed store keys here as their schemas are audited.
export const RESTORABLE_STORE_KEYS = new Set([
  'local-llm-chat-storage', 'local-llm-app-storage', 'local-llm-project-storage',
  'atlas-agent-storage', 'atlas-learning', 'atlas-study', 'atlas-voice-settings',
  // Saved map places, Survival Manual notes, library list and app preferences.
  // (Secret fields are stripped by stripSensitiveFields; API keys live in the Keychain.)
  'atlas-maps', 'atlas-survival-manual', 'atlas-offline-library', 'atlas-off-grid',
  'atlas-chat-prefs', 'atlas-daily-brief', 'atlas-low-power', 'remote-servers',
  'atlas-study-progress', 'atlas-checklists', 'atlas-skills', 'atlas-schedule',
  // Language course: levels, stars, streak, written lessons, saved words and review schedule.
  'atlas-language',
]);
// Never export or restore credentials, vault contents, or authentication state.
export const EXCLUDED_BACKUP_KEYS = /auth|passphrase|lock|vault|keychain|credential|secret|token|api.?key|atlas-search-settings/i;
const SENSITIVE_FIELDS = /api.?key|secret|token|password|passphrase|credential/i;
// Settings about text length that merely contain the word "token" (maxTokens, contextTokens, tokensPerSecond).
// They are not credentials, and stripping them reset the value on every restore and sync.
const TOKEN_COUNT_FIELDS = /^(max|min|context|ctx|n|num|total|prompt|completion|generated|reserved)[-_]?tokens?($|[-_A-Z0-9])|^tokens[-_]?(per|limit|used|count|budget)/i;
const isSensitiveField = (key: string) => SENSITIVE_FIELDS.test(key) && !TOKEN_COUNT_FIELDS.test(key);
function stripSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !isSensitiveField(key))
      .map(([key, item]) => [key, stripSensitiveFields(item)]));
  }
  return value;
}
export function sanitizeBackupValue(raw: string): string | null {
  try { return JSON.stringify(stripSensitiveFields(JSON.parse(raw))); }
  catch { return null; }
}
function portableStoreValue(key: string, raw: string): string | null {
  const safe = sanitizeBackupValue(raw);
  if (!safe) return null;
  if (key !== 'local-llm-project-storage' && key !== 'local-llm-chat-storage') return safe;
  try {
    const parsed = JSON.parse(safe);
    const isChats = key === 'local-llm-chat-storage';
    const collection = isChats ? 'conversations' : 'projects';
    if (!Array.isArray(parsed?.state?.[collection])) return null;
    const { isLockedChatBlob } = require('../stores/encryptedChatStorage');
    // Protected projects are device-bound and never exported. A locked chat travels only as
    // its title-less placeholder plus ciphertext: never with readable messages or a title.
    const { isPortableProjectBlob } = require('../stores/protectedProjectStorage');
    parsed.state[collection] = parsed.state[collection].flatMap((item: any) => {
      if (!item.pinVerifier && !item.protectedBlob) return [item];
      // A protected project travels only as a PIN-sealed portable blob with no readable fields.
      if (!isChats) {
        return item.pinVerifier && isPortableProjectBlob(item.protectedBlob) ? [{
          id: item.id, name: 'Locked project', description: '', systemPrompt: '', createdAt: item.createdAt,
          updatedAt: item.updatedAt, pinVerifier: item.pinVerifier, protectedBlob: item.protectedBlob,
        }] : [];
      }
      if (!item.pinVerifier || !isLockedChatBlob(item.protectedBlob)) return [];
      return [{ ...item, title: 'Locked conversation', messages: [] }];
    });
    return JSON.stringify(parsed);
  } catch { return null; }
}

/** PIN-locked chats that a password backup can only carry as device-bound ciphertext (restorable on this phone only). */
export function lockedChatsNotOpen(): number {
  try {
    const { useChatStore } = require('../stores/chatStore');
    return useChatStore.getState().conversations
      .filter((c: any) => c.pinVerifier && !(Array.isArray(c.messages) && c.messages.length > 0)).length;
  } catch { return 0; }
}

export async function exportBackup(password?: string): Promise<string | null> {
  if (password !== undefined && password.length < 12) throw new Error('Encrypted backups require a password of at least 12 characters.');
  // Device-bound encrypted chats cannot be decrypted after transfer to a new
  // phone. Do not export legacy plaintext chat records into readable backups.
  const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
    k !== 'local-llm-chat-storage' && RESTORABLE_STORE_KEYS.has(k) && !EXCLUDED_BACKUP_KEYS.test(k));
  const pairs = await AsyncStorage.multiGet(keys);
  const safe = pairs.flatMap(([key, value]) => {
    if (value == null) return [];
    const sanitized = portableStoreValue(key, value);
    return sanitized == null ? [] : [[key, sanitized] as [string, string]];
  });
  if (password) {
    const { encryptedChatStorage } = require('../stores/encryptedChatStorage');
    const chatJson = await encryptedChatStorage.getItem('local-llm-chat-storage');
    if (chatJson) {
      const sanitized = portableStoreValue('local-llm-chat-storage', chatJson);
      if (sanitized) {
        // Locked chats stay locked in the backup. Ones open right now are re-sealed with a key
        // derived from their PIN, so they can move to a new phone and open there with that PIN.
        // Ones still locked keep their on-phone ciphertext (restorable on this phone only).
        const parsed = JSON.parse(sanitized);
        const { openLockedChatsForBackup } = require('../stores/encryptedChatStorage');
        const portable: any[] = await openLockedChatsForBackup();
        const ids = new Set(portable.map((c) => c.id));
        parsed.state.conversations = [...parsed.state.conversations.filter((c: any) => !ids.has(c.id)), ...portable];
        safe.push(['local-llm-chat-storage', JSON.stringify(parsed)]);
      }
    }
  }
  if (password) {
    // Unlocked protected projects go in sealed with their own PIN (record, documents and study
    // outputs), so they can be restored on a new phone. Locked ones cannot be sealed portably.
    const { openProtectedProjectsForBackup } = require('../stores/protectedProjectStorage');
    const portable: any[] = await openProtectedProjectsForBackup();
    const index = safe.findIndex(([key]) => key === 'local-llm-project-storage');
    if (portable.length && index >= 0) {
      const parsed = JSON.parse(safe[index][1]);
      parsed.state.projects = [...parsed.state.projects, ...portable];
      safe[index] = ['local-llm-project-storage', JSON.stringify(parsed)];
    }
  }
  // Only encrypted backups may carry original project files. Include the original
  // file bytes, searchable chunks, enabled flag and stable project ID together.
  const projectRecord = safe.find(([key]) => key === 'local-llm-project-storage')?.[1];
  const projectIds: string[] = projectRecord
    ? JSON.parse(projectRecord).state.projects.map((p: { id: string }) => p.id) : [];
  const projectFiles: ProjectBackupFile[] = password ? await collectProjectFiles(projectIds) : [];
  const data = { format: MAGIC, version: password ? 2 : 1, createdAt: new Date().toISOString(),
    items: Object.fromEntries(safe), ...(password ? { projectFiles } : {}) };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const name = `OffGridAtlas-backup-${stamp}.${password ? 'atlasbackup' : 'json'}`;
  const path = `${RNFS.CachesDirectoryPath}/${name}`;
  const backupJson = JSON.stringify(data);
  // Protect memory/storage from accidentally exporting unbounded chat archives.
  // UTF-8 may occupy more bytes than the JavaScript string length.
  const bytes = unescape(encodeURIComponent(backupJson)).length;
  if (bytes > (password ? 35 : 50) * 1024 * 1024) {
    throw new Error('Backup exceeds 50 MB. Export fewer conversations or use a future encrypted archive format.');
  }
  const output = password ? await portableCrypto().encryptPortableBackup(backupJson, password) : backupJson;
  await RNFS.writeFile(path, output, 'utf8');
  try {
    const [res] = await saveDocuments({ sourceUris: [`file://${path}`], mimeType: password ? 'application/octet-stream' : 'application/json', fileName: name, copy: true });
    // Only when the person actually saved it (cancelling throws above). A failure to note it must never fail the backup.
    try { useBackupReminder.getState().markBackedUp(); } catch { /* the reminder just stays on */ }
    return res?.name ?? name;
  } finally {
    RNFS.unlink(path).catch(() => undefined);
  }
}

async function readPortableBackup(password?: string): Promise<{ data: any; encrypted: boolean } | null> {
  const files = await pick({ mode: 'open', type: [types.json, types.plainText, types.allFiles], allowMultiSelection: false });
  if (!files?.length) return null;
  const local = await resolvePickedFileUri(files[0].uri, files[0].name || 'backup.json');
  const stat = await RNFS.stat(local.replace(/^file:\/\//, ''));
  // Never parse unbounded attacker-controlled JSON into the app's memory.
  const bytes = Number(stat.size);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 50 * 1024 * 1024)
    throw new Error('Backup size is invalid or exceeds the 50 MB import limit.');
  const text = await RNFS.readFile(local.replace(/^file:\/\//, ''), 'utf8');
  const encrypted = text.startsWith('atlasbackup:v1:');
  if (encrypted && !password) throw new Error('This encrypted backup requires its password.');
  if (!encrypted && password) throw new Error('Selected backup is not encrypted.');
  const decoded = encrypted ? await portableCrypto().decryptPortableBackup(text, password!) : text;
  const data = JSON.parse(decoded);
  if (data?.format !== MAGIC || ![1, 2].includes(data.version) || !data.items ||
      typeof data.items !== 'object' || Array.isArray(data.items))
    throw new Error('This is not a supported Atlas backup file.');
  return { data, encrypted };
}

/** Adds this phone's protected projects / locked chats that the restored list does not have. */
export async function keepDeviceProtected(key: string, restored: string): Promise<string> {
  // Hardware settings (backend, threads, GPU layers, cache, context) and the model list stay
  // this device's own: a phone's NPU setting restored on a tablet stopped every model loading.
  if (key === 'local-llm-app-storage') return keepThisDevice(await AsyncStorage.getItem(key), restored);
  if (key !== 'local-llm-project-storage' && key !== 'local-llm-chat-storage') return restored;
  const collection = key === 'local-llm-chat-storage' ? 'conversations' : 'projects';
  try {
    const current = key === 'local-llm-chat-storage'
      ? await require('../stores/encryptedChatStorage').encryptedChatStorage.getItem(key)
      : await AsyncStorage.getItem(key);
    const mine = current ? JSON.parse(current)?.state?.[collection] : null;
    if (!Array.isArray(mine)) return restored;
    const parsed = JSON.parse(restored);
    const have = new Set(parsed.state[collection].map((x: any) => x.id));
    const keep = mine.filter((x: any) => x.pinVerifier && x.protectedBlob && !have.has(x.id));
    if (!keep.length) return restored;
    parsed.state[collection] = [...parsed.state[collection], ...keep];
    return JSON.stringify(parsed);
  } catch { return restored; }
}

/** Returns the number of restored entries. The app must be closed and reopened afterwards. */
export async function importBackup(password?: string): Promise<number | null> {
  const source = await readPortableBackup(password);
  if (!source) return null;
  const { data, encrypted } = source;
  // A backup must not create arbitrary AsyncStorage keys or reintroduce secrets.
  const pairs = Object.entries(data.items).flatMap(([key, value]) => {
    if (!RESTORABLE_STORE_KEYS.has(key) || EXCLUDED_BACKUP_KEYS.test(key) || typeof value !== 'string') return [];
    const sanitized = portableStoreValue(key, value);
    return sanitized == null ? [] : [[key, sanitized] as [string, string]];
  });
  if (!pairs.length) throw new Error('No supported backup settings found. Only reviewed app stores are restorable; secrets and vault data are excluded.');
  if (data.version === 2 && !encrypted) throw new Error('Project document backups must be password-encrypted.');
  const projectPair = pairs.find(([key]) => key === 'local-llm-project-storage');
  if (data.version === 2 && !projectPair && data.projectFiles?.length) throw new Error('Project file backup is missing the project records.');
  const projectIds: string[] = projectPair
    ? JSON.parse(projectPair[1]).state.projects.map((p: { id: string }) => p.id) : [];
  // Do not claim restoration succeeded if a document is missing or damaged.
  // Older v1 backups are supported without replacing existing knowledge-base data.
  const restoredDocs = data.version === 2
    ? await restoreProjectFiles(data.projectFiles as ProjectBackupFile[], projectIds) : 0;
  // Restoring must never delete protected data that exists only on this phone (its keys and
  // encrypted files are here): keep this phone's protected projects and locked chats that the
  // backup does not contain.
  const merged = await Promise.all(pairs.map(async ([key, value]) => [key, await keepDeviceProtected(key, value)] as [string, string]));
  const chatPair = merged.find(([key]) => key === 'local-llm-chat-storage');
  const settingsPairs = merged.filter(([key]) => key !== 'local-llm-chat-storage');
  if (chatPair && !encrypted) throw new Error('Chat restoration requires an encrypted backup.');
  // Restore via the selected-chat storage adapter. Ordinary chats are readable
  // on disk by design; protected chats must never enter a portable backup.
  if (chatPair) {
    const { encryptedChatStorage } = require('../stores/encryptedChatStorage');
    await encryptedChatStorage.setItem('local-llm-chat-storage', chatPair[1]);
  }
  if (settingsPairs.length) await AsyncStorage.multiSet(settingsPairs);
  // Load the restored data into the running app right away, so nothing writes old data back over it.
  // Items that drop out of the stores because the backup is older are not deliberate deletions: offline
  // sync must not tell the other phone to delete them.
  const reload = () => rehydrateStores(merged.map(([key]) => key));
  await require('../services/nearbySync').nearbySync.suppressRemovals(reload);
  return pairs.length + restoredDocs;
}
