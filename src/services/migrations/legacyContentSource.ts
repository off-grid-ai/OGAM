import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LegacyContentSourcePort } from './contentPersistencePreflight';

const PROJECT_STORAGE_KEY = 'local-llm-project-storage';
const CHAT_STORAGE_KEY = 'local-llm-chat-storage';

export type StoredRecord = Record<string, unknown>;

export interface LegacyContentSnapshot {
  projects: StoredRecord[];
  conversations: StoredRecord[];
}

export function storedRecord(value: unknown, label: string): StoredRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as StoredRecord;
}

function envelopeRows(raw: string | null, field: string): StoredRecord[] {
  if (raw === null) return [];
  const envelope = storedRecord(JSON.parse(raw), `${field} storage`);
  const state = storedRecord(envelope.state, `${field} storage state`);
  const rows = state[field];
  if (!Array.isArray(rows)) throw new Error(`${field} storage has no array`);
  return rows.map((value, index) => storedRecord(value, `${field}[${index}]`));
}

export const legacyContentSource: LegacyContentSourcePort & {
  readSnapshot(): Promise<LegacyContentSnapshot>;
} = {
  readProjects: () => AsyncStorage.getItem(PROJECT_STORAGE_KEY),
  readChats: () => AsyncStorage.getItem(CHAT_STORAGE_KEY),
  async readSnapshot() {
    const [projects, chats] = await Promise.all([
      this.readProjects(),
      this.readChats(),
    ]);
    return {
      projects: envelopeRows(projects, 'projects'),
      conversations: envelopeRows(chats, 'conversations'),
    };
  },
};
